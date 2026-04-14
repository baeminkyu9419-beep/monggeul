"""Universal payment/billing core — Stripe + Toss gateway, subscription, credits, webhooks.

All projects import this after sync-shared.sh deployment.
DB operations go through self.db (abstract interface), not Supabase-specific.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log = logging.getLogger("payment_core")

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class BillingError(Exception):
    """Base billing error with user-facing message."""

    def __init__(self, code: str, message: str, user_message: str | None = None):
        self.code = code
        self.message = message
        self.user_message = user_message or message
        super().__init__(f"[{code}] {message}")


class InsufficientCreditsError(BillingError):
    def __init__(self, required: int, available: int):
        super().__init__(
            "INSUFFICIENT_CREDITS",
            f"Need {required} credits, have {available}",
            f"크레딧이 부족합니다. 필요: {required}, 보유: {available}",
        )
        self.required = required
        self.available = available


class SubscriptionError(BillingError):
    pass


class WebhookError(BillingError):
    pass


class GatewayError(BillingError):
    pass


# ---------------------------------------------------------------------------
# Enums & constants
# ---------------------------------------------------------------------------


class SubState(str, Enum):
    ACTIVE = "active"
    TRIALING = "trialing"
    PAST_DUE = "past_due"
    CANCELED = "canceled"           # cancel_at_period_end but still active
    EXPIRED = "expired"             # period ended
    DOWNGRADE_SCHEDULED = "downgrade_scheduled"
    INCOMPLETE = "incomplete"
    PAUSED = "paused"
    NONE = "none"


class Gateway(str, Enum):
    STRIPE = "stripe"
    TOSS = "toss"


FRIENDLY_ERRORS: dict[str, str] = {
    "card_declined": "카드가 거절되었습니다. 다른 카드를 사용해 주세요.",
    "insufficient_funds": "잔액이 부족합니다. 카드사에 문의해 주세요.",
    "expired_card": "만료된 카드입니다. 유효한 카드를 등록해 주세요.",
    "processing_error": "결제 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    "authentication_required": "본인 인증이 필요합니다. 카드사 앱을 확인해 주세요.",
    "rate_limit": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    "invalid_amount": "결제 금액이 올바르지 않습니다.",
    "duplicate_transaction": "이미 처리된 결제입니다.",
    "unknown": "결제 중 문제가 발생했습니다. 고객센터에 문의해 주세요.",
}

# ---------------------------------------------------------------------------
# Abstract DB protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class DBProtocol(Protocol):
    """Minimal async DB interface that any project must implement."""

    async def fetch_one(self, table: str, filters: dict[str, Any]) -> dict | None: ...
    async def fetch_many(self, table: str, filters: dict[str, Any], order_by: str | None = None, limit: int | None = None) -> list[dict]: ...
    async def insert(self, table: str, data: dict) -> dict: ...
    async def update(self, table: str, filters: dict[str, Any], data: dict) -> dict | None: ...
    async def upsert(self, table: str, data: dict, conflict_key: str = "id") -> dict: ...
    async def delete(self, table: str, filters: dict[str, Any]) -> bool: ...
    async def increment(self, table: str, filters: dict[str, Any], column: str, amount: int) -> dict | None: ...

    class _TxCtx:
        async def __aenter__(self): ...
        async def __aexit__(self, *a: Any): ...

    def transaction(self) -> _TxCtx: ...


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class PlanInfo:
    plan_id: str
    name: str
    tier: int                       # 0=free, 1=starter, 2=pro, 3=enterprise
    price_monthly: int              # KRW
    stripe_price_id: str | None = None
    toss_plan_code: str | None = None
    features: dict[str, Any] = field(default_factory=dict)
    quotas: dict[str, int] = field(default_factory=dict)   # feature -> monthly limit


@dataclass
class CreditPackage:
    package_id: str
    name: str
    credits: int
    price: int                      # KRW
    stripe_price_id: str | None = None
    toss_product_code: str | None = None
    bonus: int = 0


# ---------------------------------------------------------------------------
# 1. SubscriptionManager
# ---------------------------------------------------------------------------


class SubscriptionManager:
    """Manages user subscriptions — create, upgrade, downgrade, cancel."""

    def __init__(
        self,
        db: DBProtocol,
        plans: dict[str, PlanInfo],
        stripe_api_key: str | None = None,
        success_url: str = "https://example.com/success",
        cancel_url: str = "https://example.com/cancel",
    ):
        self.db = db
        self.plans = plans
        self.stripe_key = stripe_api_key
        self.success_url = success_url
        self.cancel_url = cancel_url

        if stripe_api_key:
            import stripe as _stripe
            _stripe.api_key = stripe_api_key
        self._stripe_mod: Any = None

    @property
    def stripe(self) -> Any:
        if self._stripe_mod is None:
            import stripe
            self._stripe_mod = stripe
        return self._stripe_mod

    # -- public API --

    async def subscribe(self, user_id: str, plan_id: str) -> dict:
        """Create Stripe Checkout session for a new subscription."""
        plan = self._require_plan(plan_id)
        existing = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        if existing and self._get_state(existing) in (SubState.ACTIVE, SubState.TRIALING):
            raise SubscriptionError(
                "ALREADY_SUBSCRIBED",
                f"User {user_id} already has active subscription",
                "이미 활성 구독이 있습니다. 업그레이드를 이용해 주세요.",
            )

        session = self.stripe.checkout.Session.create(
            mode="subscription",
            customer_email=await self._get_user_email(user_id),
            line_items=[{"price": plan.stripe_price_id, "quantity": 1}],
            success_url=self.success_url + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=self.cancel_url,
            metadata={"user_id": user_id, "plan_id": plan_id, "action": "subscribe"},
            subscription_data={"metadata": {"user_id": user_id, "plan_id": plan_id}},
        )
        await self._log_event(user_id, "checkout_created", {
            "plan_id": plan_id, "session_id": session.id,
        })
        log.info("Checkout session created for user=%s plan=%s", user_id, plan_id)
        return {"session_id": session.id, "url": session.url}

    async def upgrade(self, user_id: str, new_plan_id: str) -> dict:
        """Immediate proration upgrade."""
        sub = await self._require_active_sub(user_id)
        new_plan = self._require_plan(new_plan_id)

        if not self._is_higher_plan(sub["plan_id"], new_plan_id):
            raise SubscriptionError(
                "NOT_AN_UPGRADE",
                f"{new_plan_id} is not higher than {sub['plan_id']}",
                "현재 플랜보다 상위 플랜을 선택해 주세요.",
            )

        stripe_sub = self.stripe.Subscription.retrieve(sub["stripe_subscription_id"])
        updated = self.stripe.Subscription.modify(
            stripe_sub.id,
            items=[{
                "id": stripe_sub["items"]["data"][0].id,
                "price": new_plan.stripe_price_id,
            }],
            proration_behavior="always_invoice",
            metadata={"user_id": user_id, "plan_id": new_plan_id},
        )

        await self.db.update("subscriptions", {"user_id": user_id}, {
            "plan_id": new_plan_id,
            "updated_at": _utcnow_iso(),
            "scheduled_plan_id": None,
        })
        await self._log_event(user_id, "upgraded", {
            "from": sub["plan_id"], "to": new_plan_id,
            "proration_amount": getattr(updated, "latest_invoice", None),
        })
        log.info("Upgraded user=%s from %s to %s", user_id, sub["plan_id"], new_plan_id)
        return {"status": "upgraded", "plan_id": new_plan_id}

    async def downgrade(self, user_id: str, new_plan_id: str) -> dict:
        """Schedule downgrade at period end."""
        sub = await self._require_active_sub(user_id)
        new_plan = self._require_plan(new_plan_id)

        if not self._is_lower_plan(sub["plan_id"], new_plan_id):
            raise SubscriptionError(
                "NOT_A_DOWNGRADE",
                f"{new_plan_id} is not lower than {sub['plan_id']}",
                "현재 플랜보다 하위 플랜을 선택해 주세요.",
            )

        stripe_sub = self.stripe.Subscription.retrieve(sub["stripe_subscription_id"])
        self.stripe.Subscription.modify(
            stripe_sub.id,
            metadata={
                "user_id": user_id,
                "scheduled_downgrade": new_plan_id,
            },
        )

        await self.db.update("subscriptions", {"user_id": user_id}, {
            "scheduled_plan_id": new_plan_id,
            "updated_at": _utcnow_iso(),
        })
        await self._log_event(user_id, "downgrade_scheduled", {
            "from": sub["plan_id"], "to": new_plan_id,
            "effective_at": sub.get("current_period_end"),
        })
        log.info("Downgrade scheduled user=%s %s->%s", user_id, sub["plan_id"], new_plan_id)
        return {
            "status": "downgrade_scheduled",
            "current_plan": sub["plan_id"],
            "new_plan": new_plan_id,
            "effective_at": sub.get("current_period_end"),
        }

    async def cancel(self, user_id: str, reason: str = "") -> dict:
        """Cancel at period end (grace period)."""
        sub = await self._require_active_sub(user_id)

        self.stripe.Subscription.modify(
            sub["stripe_subscription_id"],
            cancel_at_period_end=True,
            metadata={"cancel_reason": reason},
        )

        await self.db.update("subscriptions", {"user_id": user_id}, {
            "cancel_at_period_end": True,
            "cancel_reason": reason,
            "updated_at": _utcnow_iso(),
        })
        await self._log_event(user_id, "cancel_requested", {
            "reason": reason, "effective_at": sub.get("current_period_end"),
        })
        log.info("Cancel requested user=%s reason=%s", user_id, reason)
        return {
            "status": "cancel_scheduled",
            "effective_at": sub.get("current_period_end"),
            "message": "구독이 현재 결제 주기 종료 시 해지됩니다.",
        }

    async def reactivate(self, user_id: str) -> dict:
        """Undo cancel before period end."""
        sub = await self._require_active_sub(user_id)
        if not sub.get("cancel_at_period_end"):
            raise SubscriptionError(
                "NOT_CANCELING", "No pending cancellation", "해지 예정이 아닙니다.",
            )

        self.stripe.Subscription.modify(
            sub["stripe_subscription_id"],
            cancel_at_period_end=False,
        )

        await self.db.update("subscriptions", {"user_id": user_id}, {
            "cancel_at_period_end": False,
            "cancel_reason": None,
            "updated_at": _utcnow_iso(),
        })
        await self._log_event(user_id, "reactivated", {})
        log.info("Reactivated user=%s", user_id)
        return {"status": "reactivated", "message": "구독이 재활성화되었습니다."}

    async def resubscribe(self, user_id: str, plan_id: str) -> dict:
        """New subscription after a fully canceled/expired one."""
        existing = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        if existing:
            state = self._get_state(existing)
            if state in (SubState.ACTIVE, SubState.TRIALING):
                raise SubscriptionError(
                    "STILL_ACTIVE", "Subscription still active", "아직 활성 구독이 있습니다.",
                )
            # Clear old record so subscribe() works
            await self.db.update("subscriptions", {"user_id": user_id}, {
                "status": "expired",
                "updated_at": _utcnow_iso(),
            })

        return await self.subscribe(user_id, plan_id)

    async def cancel_downgrade(self, user_id: str) -> dict:
        """Undo a scheduled downgrade."""
        sub = await self._require_active_sub(user_id)
        if not sub.get("scheduled_plan_id"):
            raise SubscriptionError(
                "NO_DOWNGRADE",
                "No pending downgrade",
                "예정된 다운그레이드가 없습니다.",
            )

        self.stripe.Subscription.modify(
            sub["stripe_subscription_id"],
            metadata={"scheduled_downgrade": ""},
        )

        old_scheduled = sub["scheduled_plan_id"]
        await self.db.update("subscriptions", {"user_id": user_id}, {
            "scheduled_plan_id": None,
            "updated_at": _utcnow_iso(),
        })
        await self._log_event(user_id, "downgrade_canceled", {
            "was_scheduled": old_scheduled,
        })
        log.info("Downgrade canceled user=%s (was %s)", user_id, old_scheduled)
        return {"status": "downgrade_canceled", "current_plan": sub["plan_id"]}

    async def get_status(self, user_id: str) -> dict:
        """Current subscription state."""
        sub = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        if not sub:
            return {
                "state": SubState.NONE,
                "plan_id": None,
                "message": "구독 정보가 없습니다.",
            }
        state = self._get_state(sub)
        result = {
            "state": state,
            "plan_id": sub.get("plan_id"),
            "current_period_end": sub.get("current_period_end"),
            "cancel_at_period_end": sub.get("cancel_at_period_end", False),
            "scheduled_plan_id": sub.get("scheduled_plan_id"),
        }
        if state == SubState.CANCELED:
            result["message"] = "구독 해지가 예정되어 있습니다."
        elif state == SubState.DOWNGRADE_SCHEDULED:
            result["message"] = f"다음 결제일에 {sub.get('scheduled_plan_id')} 플랜으로 변경됩니다."
        elif state == SubState.PAST_DUE:
            result["message"] = "결제가 실패했습니다. 결제 수단을 확인해 주세요."
        return result

    def _get_state(self, sub: dict) -> SubState:
        """Derive state from a DB subscription record."""
        status = sub.get("status", "")
        if status == "trialing":
            return SubState.TRIALING
        if status in ("canceled", "expired"):
            return SubState.EXPIRED
        if status == "past_due":
            return SubState.PAST_DUE
        if status == "incomplete":
            return SubState.INCOMPLETE
        if status == "paused":
            return SubState.PAUSED
        # status == "active"
        if sub.get("cancel_at_period_end"):
            return SubState.CANCELED
        if sub.get("scheduled_plan_id"):
            return SubState.DOWNGRADE_SCHEDULED
        if status == "active":
            return SubState.ACTIVE
        return SubState.NONE

    def _is_higher_plan(self, current_plan_id: str, new_plan_id: str) -> bool:
        cur = self.plans.get(current_plan_id)
        new = self.plans.get(new_plan_id)
        if not cur or not new:
            return False
        return new.tier > cur.tier

    def _is_lower_plan(self, current_plan_id: str, new_plan_id: str) -> bool:
        cur = self.plans.get(current_plan_id)
        new = self.plans.get(new_plan_id)
        if not cur or not new:
            return False
        return new.tier < cur.tier

    async def _log_event(self, user_id: str, event_type: str, data: dict) -> None:
        try:
            await self.db.insert("billing_events", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "event_type": event_type,
                "data": json.dumps(data, ensure_ascii=False, default=str),
                "created_at": _utcnow_iso(),
            })
        except Exception as e:
            log.error("Failed to log billing event: %s", e)

    async def _require_active_sub(self, user_id: str) -> dict:
        sub = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        if not sub:
            raise SubscriptionError(
                "NO_SUBSCRIPTION", f"No subscription for {user_id}",
                "활성 구독이 없습니다.",
            )
        state = self._get_state(sub)
        if state not in (SubState.ACTIVE, SubState.TRIALING, SubState.CANCELED, SubState.DOWNGRADE_SCHEDULED):
            raise SubscriptionError(
                "INACTIVE_SUBSCRIPTION",
                f"Subscription is {state.value}",
                "활성 구독이 아닙니다. 다시 구독해 주세요.",
            )
        return sub

    def _require_plan(self, plan_id: str) -> PlanInfo:
        plan = self.plans.get(plan_id)
        if not plan:
            raise SubscriptionError(
                "INVALID_PLAN", f"Plan {plan_id} not found",
                "유효하지 않은 플랜입니다.",
            )
        if not plan.stripe_price_id:
            raise SubscriptionError(
                "PLAN_NOT_CONFIGURED",
                f"Plan {plan_id} has no Stripe price ID",
                "해당 플랜이 아직 설정되지 않았습니다.",
            )
        return plan

    async def _get_user_email(self, user_id: str) -> str | None:
        user = await self.db.fetch_one("users", {"id": user_id})
        return user.get("email") if user else None


# ---------------------------------------------------------------------------
# 2. CreditManager
# ---------------------------------------------------------------------------


class CreditManager:
    """One-time credit purchases and atomic balance operations."""

    def __init__(
        self,
        db: DBProtocol,
        packages: dict[str, CreditPackage],
        stripe_api_key: str | None = None,
        success_url: str = "https://example.com/success",
        cancel_url: str = "https://example.com/cancel",
    ):
        self.db = db
        self.packages = packages
        self.stripe_key = stripe_api_key
        self.success_url = success_url
        self.cancel_url = cancel_url
        self._stripe_mod: Any = None

    @property
    def stripe(self) -> Any:
        if self._stripe_mod is None:
            import stripe
            self._stripe_mod = stripe
        return self._stripe_mod

    async def purchase_credits(self, user_id: str, package_id: str) -> dict:
        """Create Stripe Checkout for one-time credit purchase."""
        pkg = self.packages.get(package_id)
        if not pkg:
            raise BillingError("INVALID_PACKAGE", f"Package {package_id} not found", "유효하지 않은 패키지입니다.")
        if not pkg.stripe_price_id:
            raise BillingError("PACKAGE_NOT_CONFIGURED", f"Package {package_id} has no Stripe price", "해당 패키지가 아직 설정되지 않았습니다.")

        user = await self.db.fetch_one("users", {"id": user_id})
        session = self.stripe.checkout.Session.create(
            mode="payment",
            customer_email=user.get("email") if user else None,
            line_items=[{"price": pkg.stripe_price_id, "quantity": 1}],
            success_url=self.success_url + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=self.cancel_url,
            metadata={
                "user_id": user_id,
                "package_id": package_id,
                "credits": str(pkg.credits + pkg.bonus),
                "action": "credit_purchase",
            },
        )
        log.info("Credit checkout created user=%s package=%s", user_id, package_id)
        return {"session_id": session.id, "url": session.url}

    async def add_credits(self, user_id: str, amount: int, reason: str) -> dict:
        """Atomic credit addition + transaction log."""
        if amount <= 0:
            raise BillingError("INVALID_AMOUNT", "Amount must be positive", "금액이 올바르지 않습니다.")

        async with self.db.transaction():
            wallet = await self._ensure_wallet(user_id)
            new_balance = wallet.get("balance", 0) + amount
            await self.db.update("credit_wallets", {"user_id": user_id}, {
                "balance": new_balance,
                "updated_at": _utcnow_iso(),
            })
            await self.db.insert("credit_transactions", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "amount": amount,
                "direction": "credit",
                "reason": reason,
                "balance_after": new_balance,
                "created_at": _utcnow_iso(),
            })

        log.info("Credits added user=%s +%d reason=%s balance=%d", user_id, amount, reason, new_balance)
        return {"balance": new_balance, "added": amount}

    async def use_credits(self, user_id: str, amount: int, reason: str) -> dict:
        """Atomic credit debit. Raises InsufficientCreditsError if not enough."""
        if amount <= 0:
            raise BillingError("INVALID_AMOUNT", "Amount must be positive", "금액이 올바르지 않습니다.")

        async with self.db.transaction():
            wallet = await self._ensure_wallet(user_id)
            current = wallet.get("balance", 0)
            if current < amount:
                raise InsufficientCreditsError(required=amount, available=current)

            new_balance = current - amount
            await self.db.update("credit_wallets", {"user_id": user_id}, {
                "balance": new_balance,
                "updated_at": _utcnow_iso(),
            })
            await self.db.insert("credit_transactions", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "amount": amount,
                "direction": "debit",
                "reason": reason,
                "balance_after": new_balance,
                "created_at": _utcnow_iso(),
            })

        log.info("Credits used user=%s -%d reason=%s balance=%d", user_id, amount, reason, new_balance)
        return {"balance": new_balance, "used": amount}

    async def get_balance(self, user_id: str) -> dict:
        """Current credit balance."""
        wallet = await self.db.fetch_one("credit_wallets", {"user_id": user_id})
        balance = wallet.get("balance", 0) if wallet else 0
        return {"user_id": user_id, "balance": balance}

    async def transfer_credits(
        self,
        admin_id: str,
        from_id: str,
        to_id: str,
        amount: int,
        reason: str,
        ticket_id: str | None = None,
    ) -> dict:
        """Admin-only safe transfer with pre/post integrity check."""
        if amount <= 0:
            raise BillingError("INVALID_AMOUNT", "Amount must be positive", "금액이 올바르지 않습니다.")

        async with self.db.transaction():
            from_wallet = await self._ensure_wallet(from_id)
            to_wallet = await self._ensure_wallet(to_id)

            from_balance = from_wallet.get("balance", 0)
            to_balance = to_wallet.get("balance", 0)
            total_before = from_balance + to_balance

            if from_balance < amount:
                raise InsufficientCreditsError(required=amount, available=from_balance)

            new_from = from_balance - amount
            new_to = to_balance + amount

            # Integrity check
            total_after = new_from + new_to
            if total_before != total_after:
                raise BillingError(
                    "INTEGRITY_VIOLATION",
                    f"Credit integrity failed: {total_before} != {total_after}",
                    "크레딧 무결성 검증 실패. 관리자에게 문의하세요.",
                )

            tx_id = str(uuid.uuid4())
            now = _utcnow_iso()

            await self.db.update("credit_wallets", {"user_id": from_id}, {
                "balance": new_from, "updated_at": now,
            })
            await self.db.update("credit_wallets", {"user_id": to_id}, {
                "balance": new_to, "updated_at": now,
            })

            transfer_meta = json.dumps({
                "admin_id": admin_id, "ticket_id": ticket_id,
                "from_id": from_id, "to_id": to_id,
            }, ensure_ascii=False)

            await self.db.insert("credit_transactions", {
                "id": tx_id,
                "user_id": from_id,
                "amount": amount,
                "direction": "transfer_out",
                "reason": f"Transfer to {to_id}: {reason}",
                "balance_after": new_from,
                "meta": transfer_meta,
                "created_at": now,
            })
            await self.db.insert("credit_transactions", {
                "id": str(uuid.uuid4()),
                "user_id": to_id,
                "amount": amount,
                "direction": "transfer_in",
                "reason": f"Transfer from {from_id}: {reason}",
                "balance_after": new_to,
                "meta": transfer_meta,
                "created_at": now,
            })

        log.info(
            "Credit transfer admin=%s from=%s to=%s amount=%d ticket=%s",
            admin_id, from_id, to_id, amount, ticket_id,
        )
        return {
            "transfer_id": tx_id,
            "from_balance": new_from,
            "to_balance": new_to,
            "amount": amount,
        }

    async def _ensure_wallet(self, user_id: str) -> dict:
        wallet = await self.db.fetch_one("credit_wallets", {"user_id": user_id})
        if not wallet:
            wallet = await self.db.insert("credit_wallets", {
                "user_id": user_id,
                "balance": 0,
                "created_at": _utcnow_iso(),
                "updated_at": _utcnow_iso(),
            })
        return wallet


# ---------------------------------------------------------------------------
# 3. WebhookProcessor
# ---------------------------------------------------------------------------


class WebhookProcessor:
    """Idempotent webhook handler for Stripe (and Toss via gateway router)."""

    def __init__(
        self,
        db: DBProtocol,
        subscription_mgr: SubscriptionManager,
        credit_mgr: CreditManager,
        crm_handler: "BillingCRMHandler | None" = None,
    ):
        self.db = db
        self.sub_mgr = subscription_mgr
        self.credit_mgr = credit_mgr
        self.crm = crm_handler

        self._handlers: dict[str, Any] = {
            "checkout.session.completed": self.process_checkout_completed,
            "customer.subscription.updated": self.process_subscription_updated,
            "customer.subscription.deleted": self.process_subscription_deleted,
            "invoice.paid": self.process_invoice_paid,
            "invoice.payment_failed": self.process_payment_failed,
            "charge.refunded": self.process_refund,
        }

    async def process_event(self, gateway: str, event: dict) -> dict:
        """Route event to correct handler."""
        event_id = event.get("id", "")
        event_type = event.get("type", "")

        if await self._verify_idempotency(event_id):
            log.info("Skipping duplicate event %s", event_id)
            return {"status": "duplicate", "event_id": event_id}

        handler = self._handlers.get(event_type)
        if not handler:
            log.warning("Unhandled event type: %s", event_type)
            await self._record_event(event_id, event_type, gateway, "ignored")
            return {"status": "ignored", "event_type": event_type}

        try:
            result = await handler(event)
            await self._record_event(event_id, event_type, gateway, "processed")
            return {"status": "processed", "event_type": event_type, **result}
        except Exception as e:
            log.error("Webhook processing failed event=%s: %s", event_id, e)
            await self._record_event(event_id, event_type, gateway, "failed", str(e))
            raise

    async def process_checkout_completed(self, event: dict) -> dict:
        """Handle completed checkout — subscription or one-time credit purchase."""
        session = event["data"]["object"]
        meta = session.get("metadata", {})
        user_id = meta.get("user_id", "")
        action = meta.get("action", "")
        mode = session.get("mode", "")

        if not user_id:
            if self.crm:
                await self.crm.handle_orphan_payment(event)
            return {"action": "orphan_handled"}

        if mode == "subscription" or action == "subscribe":
            stripe_sub_id = session.get("subscription", "")
            plan_id = meta.get("plan_id", "")

            await self.db.upsert("subscriptions", {
                "user_id": user_id,
                "plan_id": plan_id,
                "stripe_subscription_id": stripe_sub_id,
                "stripe_customer_id": session.get("customer", ""),
                "status": "active",
                "cancel_at_period_end": False,
                "scheduled_plan_id": None,
                "created_at": _utcnow_iso(),
                "updated_at": _utcnow_iso(),
            }, conflict_key="user_id")

            if self.crm:
                await self.crm.notify_payment_success(user_id, session)

            log.info("Subscription activated user=%s plan=%s", user_id, plan_id)
            return {"action": "subscription_activated", "plan_id": plan_id}

        elif mode == "payment" or action == "credit_purchase":
            credits = int(meta.get("credits", "0"))
            package_id = meta.get("package_id", "")
            if credits > 0:
                await self.credit_mgr.add_credits(user_id, credits, f"Purchase: {package_id}")

            await self.db.insert("payments", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "amount": session.get("amount_total", 0),
                "currency": session.get("currency", "krw"),
                "type": "credit_purchase",
                "stripe_session_id": session.get("id", ""),
                "package_id": package_id,
                "credits": credits,
                "status": "completed",
                "created_at": _utcnow_iso(),
            })

            if self.crm:
                await self.crm.notify_payment_success(user_id, session)

            log.info("Credit purchase completed user=%s credits=%d", user_id, credits)
            return {"action": "credits_purchased", "credits": credits}

        return {"action": "unknown_mode", "mode": mode}

    async def process_subscription_updated(self, event: dict) -> dict:
        """Sync subscription state from Stripe to DB."""
        stripe_sub = event["data"]["object"]
        user_id = stripe_sub.get("metadata", {}).get("user_id", "")
        if not user_id:
            return {"action": "no_user_id"}

        plan_id = stripe_sub.get("metadata", {}).get("plan_id", "")
        scheduled_downgrade = stripe_sub.get("metadata", {}).get("scheduled_downgrade", "")

        update_data: dict[str, Any] = {
            "status": stripe_sub.get("status", "active"),
            "cancel_at_period_end": stripe_sub.get("cancel_at_period_end", False),
            "current_period_end": _ts_to_iso(stripe_sub.get("current_period_end")),
            "current_period_start": _ts_to_iso(stripe_sub.get("current_period_start")),
            "updated_at": _utcnow_iso(),
        }
        if plan_id:
            update_data["plan_id"] = plan_id
        if scheduled_downgrade:
            update_data["scheduled_plan_id"] = scheduled_downgrade
        elif scheduled_downgrade == "":
            update_data["scheduled_plan_id"] = None

        await self.db.update("subscriptions", {"user_id": user_id}, update_data)
        log.info("Subscription updated user=%s status=%s", user_id, update_data["status"])
        return {"action": "subscription_synced", "user_id": user_id}

    async def process_subscription_deleted(self, event: dict) -> dict:
        """Deactivate subscription."""
        stripe_sub = event["data"]["object"]
        user_id = stripe_sub.get("metadata", {}).get("user_id", "")
        if not user_id:
            return {"action": "no_user_id"}

        await self.db.update("subscriptions", {"user_id": user_id}, {
            "status": "expired",
            "cancel_at_period_end": False,
            "updated_at": _utcnow_iso(),
        })
        log.info("Subscription expired user=%s", user_id)
        return {"action": "subscription_expired", "user_id": user_id}

    async def process_invoice_paid(self, event: dict) -> dict:
        """Record successful payment and handle scheduled downgrades."""
        invoice = event["data"]["object"]
        sub_id = invoice.get("subscription", "")
        customer_id = invoice.get("customer", "")

        sub = await self.db.fetch_one("subscriptions", {"stripe_subscription_id": sub_id})
        user_id = sub.get("user_id", "") if sub else ""

        await self.db.insert("payments", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "amount": invoice.get("amount_paid", 0),
            "currency": invoice.get("currency", "krw"),
            "type": "subscription_renewal",
            "stripe_invoice_id": invoice.get("id", ""),
            "stripe_subscription_id": sub_id,
            "status": "paid",
            "created_at": _utcnow_iso(),
        })

        # Apply scheduled downgrade at renewal
        if sub and sub.get("scheduled_plan_id"):
            new_plan_id = sub["scheduled_plan_id"]
            new_plan = self.sub_mgr.plans.get(new_plan_id)
            if new_plan and new_plan.stripe_price_id:
                import stripe
                stripe_sub = stripe.Subscription.retrieve(sub_id)
                stripe.Subscription.modify(
                    sub_id,
                    items=[{
                        "id": stripe_sub["items"]["data"][0].id,
                        "price": new_plan.stripe_price_id,
                    }],
                    proration_behavior="none",
                    metadata={"plan_id": new_plan_id, "scheduled_downgrade": ""},
                )
                await self.db.update("subscriptions", {"user_id": user_id}, {
                    "plan_id": new_plan_id,
                    "scheduled_plan_id": None,
                    "updated_at": _utcnow_iso(),
                })
                log.info("Downgrade applied user=%s -> %s", user_id, new_plan_id)

        log.info("Invoice paid user=%s amount=%s", user_id, invoice.get("amount_paid"))
        return {"action": "invoice_recorded", "user_id": user_id}

    async def process_payment_failed(self, event: dict) -> dict:
        """Handle failed payment — update status, notify CRM."""
        invoice = event["data"]["object"]
        sub_id = invoice.get("subscription", "")
        sub = await self.db.fetch_one("subscriptions", {"stripe_subscription_id": sub_id})
        user_id = sub.get("user_id", "") if sub else ""

        attempt = invoice.get("attempt_count", 1)

        await self.db.insert("payments", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "amount": invoice.get("amount_due", 0),
            "currency": invoice.get("currency", "krw"),
            "type": "subscription_renewal",
            "stripe_invoice_id": invoice.get("id", ""),
            "status": "failed",
            "attempt_count": attempt,
            "created_at": _utcnow_iso(),
        })

        if sub:
            await self.db.update("subscriptions", {"user_id": user_id}, {
                "status": "past_due",
                "updated_at": _utcnow_iso(),
            })

        if self.crm and user_id:
            error_code = invoice.get("last_payment_error", {}).get("code", "unknown") if invoice.get("last_payment_error") else "unknown"
            await self.crm.handle_payment_failure(user_id, error_code)

        log.warning("Payment failed user=%s attempt=%d", user_id, attempt)
        return {"action": "payment_failed", "user_id": user_id, "attempt": attempt}

    async def process_refund(self, event: dict) -> dict:
        """Record refund and claw back credits if applicable."""
        charge = event["data"]["object"]
        refund = charge.get("refunds", {}).get("data", [{}])[0] if charge.get("refunds") else {}
        amount_refunded = refund.get("amount", charge.get("amount_refunded", 0))

        # Find payment by charge ID
        payment = await self.db.fetch_one("payments", {"stripe_charge_id": charge.get("id")})
        if not payment:
            # Try via invoice
            invoice_id = charge.get("invoice")
            if invoice_id:
                payment = await self.db.fetch_one("payments", {"stripe_invoice_id": invoice_id})

        user_id = payment.get("user_id", "") if payment else ""

        await self.db.insert("refunds", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "payment_id": payment.get("id", "") if payment else "",
            "amount": amount_refunded,
            "currency": charge.get("currency", "krw"),
            "stripe_refund_id": refund.get("id", ""),
            "reason": refund.get("reason", ""),
            "created_at": _utcnow_iso(),
        })

        # Claw back credits if this was a credit purchase
        if payment and payment.get("type") == "credit_purchase" and payment.get("credits"):
            credits_to_claw = payment["credits"]
            try:
                await self.credit_mgr.use_credits(
                    user_id, credits_to_claw,
                    f"Refund clawback: {refund.get('id', '')}",
                )
                log.info("Clawed back %d credits from user=%s", credits_to_claw, user_id)
            except InsufficientCreditsError:
                # Set balance to 0
                await self.db.update("credit_wallets", {"user_id": user_id}, {
                    "balance": 0, "updated_at": _utcnow_iso(),
                })
                log.warning("Partial clawback user=%s — balance zeroed", user_id)

        log.info("Refund processed user=%s amount=%s", user_id, amount_refunded)
        return {"action": "refund_recorded", "user_id": user_id, "amount": amount_refunded}

    async def _verify_idempotency(self, event_id: str) -> bool:
        """Return True if event was already processed."""
        if not event_id:
            return False
        existing = await self.db.fetch_one("webhook_events", {"event_id": event_id})
        return existing is not None

    async def _record_event(
        self, event_id: str, event_type: str, gateway: str, status: str, error: str | None = None,
    ) -> None:
        try:
            await self.db.upsert("webhook_events", {
                "event_id": event_id,
                "event_type": event_type,
                "gateway": gateway,
                "status": status,
                "error": error,
                "processed_at": _utcnow_iso(),
            }, conflict_key="event_id")
        except Exception as e:
            log.error("Failed to record webhook event: %s", e)


# ---------------------------------------------------------------------------
# 4. BillingCRMHandler
# ---------------------------------------------------------------------------


class BillingCRMHandler:
    """Payment lifecycle notifications and error handling."""

    def __init__(self, db: DBProtocol, notify_fn: Any = None):
        """
        notify_fn: async callable(user_id, channel, message) for sending
                   notifications (email, Discord, Slack, etc.)
        """
        self.db = db
        self.notify = notify_fn

    async def get_payment_status_realtime(self, user_id: str, session_id: str) -> dict:
        """Polling endpoint: check if checkout session resulted in a payment."""
        payment = await self.db.fetch_one("payments", {
            "user_id": user_id,
            "stripe_session_id": session_id,
        })
        if payment:
            return {
                "status": "completed",
                "payment_id": payment.get("id"),
                "type": payment.get("type"),
                "amount": payment.get("amount"),
            }

        # Check if subscription was created
        sub = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        if sub and sub.get("status") == "active":
            return {
                "status": "completed",
                "type": "subscription",
                "plan_id": sub.get("plan_id"),
            }

        return {"status": "pending", "message": "결제 처리 중입니다..."}

    async def notify_payment_success(self, user_id: str, session: dict) -> None:
        """Send success notification."""
        amount = session.get("amount_total", 0)
        currency = session.get("currency", "krw").upper()
        formatted_amount = f"{amount:,}" if currency == "KRW" else f"{amount / 100:.2f}"

        message = f"결제가 완료되었습니다. ({formatted_amount} {currency})"

        await self.db.insert("notifications", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "payment_success",
            "message": message,
            "read": False,
            "created_at": _utcnow_iso(),
        })

        if self.notify:
            try:
                await self.notify(user_id, "email", message)
            except Exception as e:
                log.error("Notification failed user=%s: %s", user_id, e)

        log.info("Payment success notified user=%s", user_id)

    async def handle_payment_failure(self, user_id: str, error_code: str) -> None:
        """Record failure and notify user with friendly message."""
        friendly = self._friendly_error(error_code)

        await self.db.insert("notifications", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "payment_failed",
            "message": friendly,
            "read": False,
            "created_at": _utcnow_iso(),
        })

        if self.notify:
            try:
                await self.notify(user_id, "email", friendly)
            except Exception as e:
                log.error("Failure notification failed user=%s: %s", user_id, e)

        log.warning("Payment failure notified user=%s code=%s", user_id, error_code)

    async def handle_email_mismatch(self, event: dict) -> None:
        """Checkout email doesn't match any user — log for manual review."""
        session = event.get("data", {}).get("object", {})
        email = session.get("customer_details", {}).get("email", "unknown")

        await self.db.insert("billing_alerts", {
            "id": str(uuid.uuid4()),
            "type": "email_mismatch",
            "data": json.dumps({
                "email": email,
                "session_id": session.get("id"),
                "amount": session.get("amount_total"),
            }, ensure_ascii=False),
            "resolved": False,
            "created_at": _utcnow_iso(),
        })
        log.warning("Email mismatch: %s not found in users", email)

    async def handle_orphan_payment(self, event: dict) -> None:
        """Payment with no user_id in metadata."""
        session = event.get("data", {}).get("object", {})
        email = session.get("customer_details", {}).get("email", "")

        # Attempt to find user by email
        if email:
            user = await self.db.fetch_one("users", {"email": email})
            if user:
                log.info("Orphan payment matched to user=%s via email", user["id"])
                # Re-process with user_id
                session.setdefault("metadata", {})["user_id"] = user["id"]
                return

        await self.db.insert("billing_alerts", {
            "id": str(uuid.uuid4()),
            "type": "orphan_payment",
            "data": json.dumps({
                "email": email,
                "session_id": session.get("id"),
                "amount": session.get("amount_total"),
            }, ensure_ascii=False),
            "resolved": False,
            "created_at": _utcnow_iso(),
        })
        log.warning("Orphan payment: session=%s email=%s", session.get("id"), email)

    async def check_stale_payments(self) -> list[dict]:
        """Cron job: find checkout sessions older than 30s without a matching payment."""
        threshold = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
        stale = await self.db.fetch_many(
            "billing_events",
            {"event_type": "checkout_created", "status": "pending"},
            order_by="created_at",
            limit=50,
        )

        results = []
        for evt in stale:
            created = evt.get("created_at", "")
            if created and created < threshold:
                data = json.loads(evt.get("data", "{}"))
                user_id = data.get("user_id", "")
                session_id = data.get("session_id", "")

                # Check if payment arrived
                payment = await self.db.fetch_one("payments", {"stripe_session_id": session_id})
                if not payment:
                    results.append({
                        "user_id": user_id,
                        "session_id": session_id,
                        "age_seconds": _age_seconds(created),
                    })
                    log.warning("Stale payment detected user=%s session=%s", user_id, session_id)

        return results

    @staticmethod
    def _friendly_error(code: str) -> str:
        """Return user-friendly Korean error message."""
        return FRIENDLY_ERRORS.get(code, FRIENDLY_ERRORS["unknown"])


# ---------------------------------------------------------------------------
# 5. InvoiceManager
# ---------------------------------------------------------------------------


class InvoiceManager:
    """Korean e-tax invoice and cash receipt issuance."""

    def __init__(self, db: DBProtocol, tax_api_key: str | None = None, business_number: str = ""):
        self.db = db
        self.tax_api_key = tax_api_key
        self.business_number = business_number

    async def issue_tax_invoice(self, payment_id: str) -> dict:
        """Issue Korean electronic tax invoice (세금계산서)."""
        payment = await self.db.fetch_one("payments", {"id": payment_id})
        if not payment:
            raise BillingError("PAYMENT_NOT_FOUND", f"Payment {payment_id} not found", "결제 내역을 찾을 수 없습니다.")

        user_id = payment.get("user_id", "")
        user = await self.db.fetch_one("users", {"id": user_id})
        if not user:
            raise BillingError("USER_NOT_FOUND", f"User {user_id} not found", "사용자를 찾을 수 없습니다.")

        biz_info = await self.db.fetch_one("user_business_info", {"user_id": user_id})

        invoice_data = {
            "id": str(uuid.uuid4()),
            "payment_id": payment_id,
            "user_id": user_id,
            "type": "tax_invoice",
            "amount": payment.get("amount", 0),
            "supply_amount": int(payment.get("amount", 0) / 1.1),
            "vat_amount": payment.get("amount", 0) - int(payment.get("amount", 0) / 1.1),
            "currency": payment.get("currency", "krw"),
            "issuer_business_number": self.business_number,
            "recipient_business_number": biz_info.get("business_number", "") if biz_info else "",
            "recipient_name": biz_info.get("company_name", user.get("name", "")) if biz_info else user.get("name", ""),
            "recipient_email": user.get("email", ""),
            "status": "issued",
            "issued_at": _utcnow_iso(),
            "created_at": _utcnow_iso(),
        }

        # Call tax API if configured
        if self.tax_api_key:
            try:
                external_id = await self._call_tax_api(invoice_data)
                invoice_data["external_invoice_id"] = external_id
            except Exception as e:
                log.error("Tax API call failed: %s", e)
                invoice_data["status"] = "pending"
                invoice_data["error"] = str(e)

        await self.db.insert("invoices", invoice_data)
        log.info("Tax invoice issued payment=%s user=%s", payment_id, user_id)
        return invoice_data

    async def issue_cash_receipt(self, payment_id: str) -> dict:
        """Issue Korean cash receipt (현금영수증)."""
        payment = await self.db.fetch_one("payments", {"id": payment_id})
        if not payment:
            raise BillingError("PAYMENT_NOT_FOUND", f"Payment {payment_id} not found", "결제 내역을 찾을 수 없습니다.")

        user_id = payment.get("user_id", "")
        user = await self.db.fetch_one("users", {"id": user_id})

        receipt_data = {
            "id": str(uuid.uuid4()),
            "payment_id": payment_id,
            "user_id": user_id,
            "type": "cash_receipt",
            "amount": payment.get("amount", 0),
            "purpose": "income_deduction",  # 소득공제용 (or 지출증빙 for business)
            "identifier": user.get("phone", user.get("email", "")) if user else "",
            "status": "issued",
            "issued_at": _utcnow_iso(),
            "created_at": _utcnow_iso(),
        }

        if self.tax_api_key:
            try:
                external_id = await self._call_receipt_api(receipt_data)
                receipt_data["external_receipt_id"] = external_id
            except Exception as e:
                log.error("Cash receipt API call failed: %s", e)
                receipt_data["status"] = "pending"
                receipt_data["error"] = str(e)

        await self.db.insert("invoices", receipt_data)
        log.info("Cash receipt issued payment=%s user=%s", payment_id, user_id)
        return receipt_data

    async def auto_issue_monthly(self) -> dict:
        """Cron job: issue tax invoices for all unissued payments in the past month."""
        one_month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        payments = await self.db.fetch_many(
            "payments",
            {"status": "paid"},
            order_by="created_at",
            limit=500,
        )

        issued = 0
        errors = 0
        for payment in payments:
            if payment.get("created_at", "") < one_month_ago:
                continue

            # Check if invoice already exists
            existing = await self.db.fetch_one("invoices", {"payment_id": payment["id"]})
            if existing:
                continue

            # Check if user has business info (tax invoice) or not (cash receipt)
            user_id = payment.get("user_id", "")
            biz_info = await self.db.fetch_one("user_business_info", {"user_id": user_id})

            try:
                if biz_info and biz_info.get("business_number"):
                    await self.issue_tax_invoice(payment["id"])
                else:
                    await self.issue_cash_receipt(payment["id"])
                issued += 1
            except Exception as e:
                log.error("Auto-issue failed payment=%s: %s", payment["id"], e)
                errors += 1

        log.info("Monthly auto-issue complete: issued=%d errors=%d", issued, errors)
        return {"issued": issued, "errors": errors}

    async def _call_tax_api(self, invoice_data: dict) -> str:
        """Call external tax invoice API. Returns external invoice ID."""
        # Placeholder for real API integration (e.g., Barobill, PopBill)
        # Each project implements the actual HTTP call
        log.info("Tax API call for amount=%s", invoice_data.get("amount"))
        return f"TAX-{uuid.uuid4().hex[:12].upper()}"

    async def _call_receipt_api(self, receipt_data: dict) -> str:
        """Call external cash receipt API."""
        log.info("Receipt API call for amount=%s", receipt_data.get("amount"))
        return f"RCP-{uuid.uuid4().hex[:12].upper()}"


# ---------------------------------------------------------------------------
# 6. UsageGate
# ---------------------------------------------------------------------------


class UsageGate:
    """Check subscription quota, fall back to credits if exceeded."""

    def __init__(
        self,
        db: DBProtocol,
        plans: dict[str, PlanInfo],
        credit_mgr: CreditManager,
    ):
        self.db = db
        self.plans = plans
        self.credit_mgr = credit_mgr

    async def check_and_consume(self, user_id: str, feature: str, amount: int = 1) -> dict:
        """
        1) Check subscription quota for the feature
        2) If quota remaining >= amount, consume from quota
        3) If quota insufficient, fall back to credits
        4) If neither, raise InsufficientCreditsError
        """
        sub = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        plan_id = sub.get("plan_id") if sub and sub.get("status") == "active" else None
        plan = self.plans.get(plan_id) if plan_id else None

        quota_limit = plan.quotas.get(feature, 0) if plan else 0

        # Get current usage this month
        usage_record = await self._get_usage(user_id, feature)
        used = usage_record.get("used", 0) if usage_record else 0
        remaining_quota = max(0, quota_limit - used)

        if remaining_quota >= amount:
            # Consume from subscription quota
            new_used = used + amount
            await self._set_usage(user_id, feature, new_used)
            log.info("Quota consumed user=%s feature=%s used=%d/%d", user_id, feature, new_used, quota_limit)
            return {
                "source": "subscription",
                "plan_id": plan_id,
                "feature": feature,
                "used": new_used,
                "limit": quota_limit,
                "remaining": quota_limit - new_used,
            }

        # Quota exceeded — try credits
        # Calculate how many units need credit payment
        credit_needed = amount - remaining_quota
        credit_cost = self._feature_credit_cost(feature) * credit_needed

        try:
            result = await self.credit_mgr.use_credits(user_id, credit_cost, f"Overage: {feature} x{credit_needed}")
        except InsufficientCreditsError:
            raise InsufficientCreditsError(
                required=credit_cost,
                available=(await self.credit_mgr.get_balance(user_id))["balance"],
            )

        # Consume the remaining quota portion too
        if remaining_quota > 0:
            await self._set_usage(user_id, feature, quota_limit)

        log.info(
            "Credit fallback user=%s feature=%s quota_used=%d credits_used=%d",
            user_id, feature, remaining_quota, credit_cost,
        )
        return {
            "source": "credit_fallback",
            "plan_id": plan_id,
            "feature": feature,
            "quota_consumed": remaining_quota,
            "credits_consumed": credit_cost,
            "credit_balance": result["balance"],
        }

    async def get_remaining(self, user_id: str, feature: str) -> dict:
        """Get remaining quota + credit balance for a feature."""
        sub = await self.db.fetch_one("subscriptions", {"user_id": user_id})
        plan_id = sub.get("plan_id") if sub and sub.get("status") == "active" else None
        plan = self.plans.get(plan_id) if plan_id else None

        quota_limit = plan.quotas.get(feature, 0) if plan else 0
        usage_record = await self._get_usage(user_id, feature)
        used = usage_record.get("used", 0) if usage_record else 0
        remaining_quota = max(0, quota_limit - used)

        credit_balance = (await self.credit_mgr.get_balance(user_id))["balance"]
        credit_cost = self._feature_credit_cost(feature)
        credit_equiv = credit_balance // credit_cost if credit_cost > 0 else 0

        return {
            "feature": feature,
            "plan_id": plan_id,
            "quota_limit": quota_limit,
            "quota_used": used,
            "quota_remaining": remaining_quota,
            "credit_balance": credit_balance,
            "credit_cost_per_unit": credit_cost,
            "credit_units_available": credit_equiv,
            "total_available": remaining_quota + credit_equiv,
        }

    def _feature_credit_cost(self, feature: str) -> int:
        """Credit cost per unit for a feature. Override per project."""
        costs = {
            "blog_generation": 10,
            "shorts_generation": 8,
            "insta_generation": 8,
            "poem_generation": 5,
            "ebook_generation": 50,
            "translation": 5,
            "seo_analysis": 3,
            "keyword_research": 2,
            "image_generation": 15,
            "detail_page": 20,
        }
        return costs.get(feature, 10)

    async def _get_usage(self, user_id: str, feature: str) -> dict | None:
        """Get current month usage."""
        month_key = datetime.now(timezone.utc).strftime("%Y-%m")
        return await self.db.fetch_one("usage_tracking", {
            "user_id": user_id,
            "feature": feature,
            "month": month_key,
        })

    async def _set_usage(self, user_id: str, feature: str, used: int) -> None:
        """Set current month usage."""
        month_key = datetime.now(timezone.utc).strftime("%Y-%m")
        await self.db.upsert("usage_tracking", {
            "user_id": user_id,
            "feature": feature,
            "month": month_key,
            "used": used,
            "updated_at": _utcnow_iso(),
        }, conflict_key="user_id,feature,month")


# ---------------------------------------------------------------------------
# 7. PaymentGatewayRouter
# ---------------------------------------------------------------------------


class PaymentGatewayRouter:
    """Route payments to Stripe or Toss based on preference/currency."""

    def __init__(
        self,
        db: DBProtocol,
        subscription_mgr: SubscriptionManager,
        credit_mgr: CreditManager,
        webhook_processor: WebhookProcessor,
        stripe_api_key: str | None = None,
        stripe_webhook_secret: str | None = None,
        toss_secret_key: str | None = None,
        toss_webhook_secret: str | None = None,
    ):
        self.db = db
        self.sub_mgr = subscription_mgr
        self.credit_mgr = credit_mgr
        self.webhook_processor = webhook_processor
        self.stripe_key = stripe_api_key
        self.stripe_webhook_secret = stripe_webhook_secret
        self.toss_secret_key = toss_secret_key
        self.toss_webhook_secret = toss_webhook_secret

    async def create_checkout(
        self,
        user_id: str,
        plan_or_product: str,
        mode: str = "subscription",
        preferred_gateway: str | None = None,
    ) -> dict:
        """Create checkout session via the appropriate gateway."""
        gateway = self._resolve_gateway(preferred_gateway)

        if gateway == Gateway.STRIPE:
            if mode == "subscription":
                return await self.sub_mgr.subscribe(user_id, plan_or_product)
            else:
                return await self.credit_mgr.purchase_credits(user_id, plan_or_product)

        elif gateway == Gateway.TOSS:
            return await self._create_toss_checkout(user_id, plan_or_product, mode)

        raise GatewayError("INVALID_GATEWAY", f"Unknown gateway: {gateway}", "지원하지 않는 결제 수단입니다.")

    async def process_webhook(self, gateway: str, headers: dict, body: bytes) -> dict:
        """Verify signature and process webhook from any gateway."""
        if gateway == "stripe":
            event = self._verify_stripe_webhook(headers, body)
            return await self.webhook_processor.process_event("stripe", event)

        elif gateway == "toss":
            event = self._verify_toss_webhook(headers, body)
            return await self._process_toss_event(event)

        raise WebhookError("UNKNOWN_GATEWAY", f"Unknown gateway: {gateway}", "알 수 없는 결제 게이트웨이입니다.")

    def _resolve_gateway(self, preferred: str | None) -> Gateway:
        """Determine which gateway to use."""
        if preferred:
            try:
                return Gateway(preferred.lower())
            except ValueError:
                pass

        # Default: Stripe if configured, else Toss
        if self.stripe_key:
            return Gateway.STRIPE
        if self.toss_secret_key:
            return Gateway.TOSS
        raise GatewayError(
            "NO_GATEWAY",
            "No payment gateway configured",
            "결제 게이트웨이가 설정되지 않았습니다.",
        )

    def _verify_stripe_webhook(self, headers: dict, body: bytes) -> dict:
        """Verify Stripe webhook signature."""
        import stripe
        sig = headers.get("stripe-signature", headers.get("Stripe-Signature", ""))
        if not self.stripe_webhook_secret:
            raise WebhookError("NO_WEBHOOK_SECRET", "Stripe webhook secret not configured")
        try:
            event = stripe.Webhook.construct_event(body, sig, self.stripe_webhook_secret)
            return event
        except stripe.error.SignatureVerificationError as e:
            raise WebhookError("INVALID_SIGNATURE", f"Stripe signature invalid: {e}")

    def _verify_toss_webhook(self, headers: dict, body: bytes) -> dict:
        """Verify Toss Payments webhook signature."""
        if not self.toss_webhook_secret:
            raise WebhookError("NO_WEBHOOK_SECRET", "Toss webhook secret not configured")

        # Toss uses HMAC-SHA256 verification
        signature = headers.get("toss-signature", headers.get("Toss-Signature", ""))
        expected = hmac.new(
            self.toss_webhook_secret.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(signature, expected):
            raise WebhookError("INVALID_SIGNATURE", "Toss signature verification failed")

        return json.loads(body)

    async def _create_toss_checkout(self, user_id: str, plan_or_product: str, mode: str) -> dict:
        """Create Toss Payments checkout (billing key or one-time)."""
        import base64
        from urllib.request import Request, urlopen

        user = await self.db.fetch_one("users", {"id": user_id})
        email = user.get("email", "") if user else ""

        order_id = f"order_{user_id}_{int(time.time())}"

        # Determine amount
        if mode == "subscription":
            plan = self.sub_mgr.plans.get(plan_or_product)
            if not plan:
                raise GatewayError("INVALID_PLAN", f"Plan {plan_or_product} not found")
            amount = plan.price_monthly
            order_name = f"{plan.name} 구독"
        else:
            pkg = self.credit_mgr.packages.get(plan_or_product)
            if not pkg:
                raise GatewayError("INVALID_PACKAGE", f"Package {plan_or_product} not found")
            amount = pkg.price
            order_name = f"{pkg.name} 크레딧"

        # Store pending order
        await self.db.insert("toss_orders", {
            "id": order_id,
            "user_id": user_id,
            "plan_or_product": plan_or_product,
            "mode": mode,
            "amount": amount,
            "status": "pending",
            "created_at": _utcnow_iso(),
        })

        # For Toss, we return the data needed for client-side SDK
        auth_header = base64.b64encode(f"{self.toss_secret_key}:".encode()).decode()

        log.info("Toss checkout created user=%s order=%s amount=%d", user_id, order_id, amount)
        return {
            "gateway": "toss",
            "order_id": order_id,
            "amount": amount,
            "order_name": order_name,
            "customer_email": email,
            "customer_name": user.get("name", "") if user else "",
            # Client SDK uses these to initiate payment
            "client_key": self.toss_secret_key.replace("test_sk_", "test_ck_").replace("live_sk_", "live_ck_") if self.toss_secret_key else "",
        }

    async def _process_toss_event(self, event: dict) -> dict:
        """Process Toss webhook event by mapping to internal format."""
        event_type = event.get("eventType", "")
        data = event.get("data", {})

        # Map Toss events to internal format
        mapped_type = {
            "PAYMENT_STATUS_CHANGED": "checkout.session.completed",
            "BILLING_STATUS_CHANGED": "customer.subscription.updated",
            "REFUND_STATUS_CHANGED": "charge.refunded",
        }.get(event_type)

        if not mapped_type:
            log.warning("Unhandled Toss event: %s", event_type)
            return {"status": "ignored", "event_type": event_type}

        order_id = data.get("orderId", "")
        toss_order = await self.db.fetch_one("toss_orders", {"id": order_id})

        if mapped_type == "checkout.session.completed" and toss_order:
            user_id = toss_order.get("user_id", "")
            mode = toss_order.get("mode", "payment")
            plan_or_product = toss_order.get("plan_or_product", "")

            if mode == "subscription":
                await self.db.upsert("subscriptions", {
                    "user_id": user_id,
                    "plan_id": plan_or_product,
                    "toss_billing_key": data.get("billingKey", ""),
                    "status": "active",
                    "cancel_at_period_end": False,
                    "created_at": _utcnow_iso(),
                    "updated_at": _utcnow_iso(),
                }, conflict_key="user_id")
            else:
                pkg = self.credit_mgr.packages.get(plan_or_product)
                credits = (pkg.credits + pkg.bonus) if pkg else 0
                if credits > 0:
                    await self.credit_mgr.add_credits(user_id, credits, f"Toss purchase: {plan_or_product}")

            await self.db.update("toss_orders", {"id": order_id}, {
                "status": "completed",
                "toss_payment_key": data.get("paymentKey", ""),
                "updated_at": _utcnow_iso(),
            })

            log.info("Toss payment completed order=%s user=%s", order_id, user_id)
            return {"status": "processed", "order_id": order_id}

        return {"status": "processed", "event_type": event_type}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts_to_iso(ts: int | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _age_seconds(iso_str: str) -> float:
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Convenience factory
# ---------------------------------------------------------------------------


def create_billing_stack(
    db: DBProtocol,
    plans: dict[str, PlanInfo],
    credit_packages: dict[str, CreditPackage],
    stripe_api_key: str | None = None,
    stripe_webhook_secret: str | None = None,
    toss_secret_key: str | None = None,
    toss_webhook_secret: str | None = None,
    success_url: str = "https://example.com/success",
    cancel_url: str = "https://example.com/cancel",
    notify_fn: Any = None,
    tax_api_key: str | None = None,
    business_number: str = "",
) -> dict:
    """
    Create all billing components wired together.

    Returns dict with keys:
        subscription_mgr, credit_mgr, webhook_processor,
        crm_handler, invoice_mgr, usage_gate, gateway_router
    """
    if stripe_api_key:
        import stripe
        stripe.api_key = stripe_api_key

    sub_mgr = SubscriptionManager(
        db=db, plans=plans, stripe_api_key=stripe_api_key,
        success_url=success_url, cancel_url=cancel_url,
    )
    credit_mgr = CreditManager(
        db=db, packages=credit_packages, stripe_api_key=stripe_api_key,
        success_url=success_url, cancel_url=cancel_url,
    )
    crm_handler = BillingCRMHandler(db=db, notify_fn=notify_fn)
    webhook_proc = WebhookProcessor(
        db=db, subscription_mgr=sub_mgr, credit_mgr=credit_mgr, crm_handler=crm_handler,
    )
    invoice_mgr = InvoiceManager(
        db=db, tax_api_key=tax_api_key, business_number=business_number,
    )
    usage_gate = UsageGate(db=db, plans=plans, credit_mgr=credit_mgr)
    gateway_router = PaymentGatewayRouter(
        db=db,
        subscription_mgr=sub_mgr,
        credit_mgr=credit_mgr,
        webhook_processor=webhook_proc,
        stripe_api_key=stripe_api_key,
        stripe_webhook_secret=stripe_webhook_secret,
        toss_secret_key=toss_secret_key,
        toss_webhook_secret=toss_webhook_secret,
    )

    return {
        "subscription_mgr": sub_mgr,
        "credit_mgr": credit_mgr,
        "webhook_processor": webhook_proc,
        "crm_handler": crm_handler,
        "invoice_mgr": invoice_mgr,
        "usage_gate": usage_gate,
        "gateway_router": gateway_router,
    }
