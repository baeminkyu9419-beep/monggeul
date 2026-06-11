"""Universal Retention Engine — churn prediction, intervention, value reporting, onboarding, downsell, referral.

All projects import this after sync-shared.sh deployment.
DB operations go through self.db (abstract DBProtocol), not Supabase-specific.

Usage:
    from shared.retention_engine import create_retention_stack
    stack = create_retention_stack(db=my_db, project="ongle")
    await stack.engine.daily_check()
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log = logging.getLogger("retention_engine")

# ---------------------------------------------------------------------------
# Abstract DB Protocol (mirrors payment_core)
# ---------------------------------------------------------------------------


@runtime_checkable
class DBProtocol(Protocol):
    """Minimal async DB interface — project adapters implement this."""

    async def fetch_one(self, table: str, filters: dict[str, Any]) -> dict | None: ...
    async def fetch_many(self, table: str, filters: dict[str, Any], order_by: str | None = None, limit: int | None = None) -> list[dict]: ...
    async def insert(self, table: str, data: dict) -> dict: ...
    async def update(self, table: str, filters: dict[str, Any], data: dict) -> dict | None: ...
    async def upsert(self, table: str, data: dict, conflict_key: str = "id") -> dict: ...
    async def delete(self, table: str, filters: dict[str, Any]) -> bool: ...


# ---------------------------------------------------------------------------
# Optional dependencies — graceful degradation
# ---------------------------------------------------------------------------

_email_send: Callable | None = None
_push_send: Callable | None = None
_slack_send: Callable | None = None

try:
    from shared.notifications import send_email as _email_send  # type: ignore
except ImportError:
    pass

try:
    from shared.notifications import send_push as _push_send  # type: ignore
except ImportError:
    pass

try:
    from shared.notifications import send_slack as _slack_send  # type: ignore
except ImportError:
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _days_ago(dt: datetime | str | None) -> int:
    """Return days elapsed since *dt*. None → 9999."""
    if dt is None:
        return 9999
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return 9999
    now = _utcnow()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, (now - dt).days)


# ---------------------------------------------------------------------------
# Enums & constants
# ---------------------------------------------------------------------------


class RiskTier(str, Enum):
    SAFE = "safe"
    WATCH = "watch"
    WARNING = "warning"
    CRITICAL = "critical"


class MilestoneType(str, Enum):
    MONTH_1 = "1month"
    MONTH_3 = "3month"
    MONTH_6 = "6month"
    MONTH_12 = "12month"


class OnboardingStep(str, Enum):
    SIGNUP = "signup"
    PROFILE = "profile"
    FIRST_ACTION = "first_action"
    EXPLORE_FEATURE = "explore_feature"
    INVITE_FRIEND = "invite_friend"
    UPGRADE = "upgrade"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class UserHealth:
    user_id: str
    risk_score: int  # 0-100
    risk_tier: RiskTier
    signals: list[str]
    days_since_login: int
    feature_usage_trend: str  # "increasing" | "stable" | "declining" | "inactive"
    subscription_age_days: int
    ltv_to_date: float
    last_intervention: str | None  # ISO datetime or None


@dataclass
class InterventionLog:
    user_id: str
    intervention_type: str
    tier: RiskTier
    channel: str  # "email" | "in_app" | "push" | "slack" | "personal_call"
    message_key: str
    sent_at: str  # ISO datetime
    result: str  # "sent" | "opened" | "clicked" | "converted" | "failed"


@dataclass
class ValueReport:
    user_id: str
    period_start: str
    period_end: str
    content_count: int
    hours_saved: float
    cost_saved: float
    views: int
    estimated_revenue: float
    roi_multiple: float
    highlights: list[str]
    project: str


@dataclass
class OnboardingProgress:
    user_id: str
    completed_steps: list[str]
    remaining_steps: list[str]
    health_score: int  # 0-100
    stuck_at: str | None
    started_at: str  # ISO datetime
    last_step_at: str | None  # ISO datetime


@dataclass
class ReferralStats:
    user_id: str
    referral_code: str
    total_referred: int
    converted: int
    rewards_earned: float
    pending_rewards: float


# ---------------------------------------------------------------------------
# Project-specific value metric calculators
# ---------------------------------------------------------------------------

# Each project registers custom metric logic. Defaults provide sane fallbacks.

PROJECT_VALUE_CALCULATORS: dict[str, dict[str, Any]] = {
    "ongle": {
        "hours_per_content": 3.0,
        "cost_per_content_manual": 50_000,  # KRW
        "rpm_default": 3.5,
        "currency": "KRW",
        "content_table": "generation_history",
        "views_table": "content_performance",
        "highlights_templates": [
            "{content_count}개 콘텐츠를 자동 생성했습니다",
            "약 {hours_saved:.0f}시간을 절약했습니다",
            "예상 수익: {estimated_revenue:,.0f}원",
        ],
    },
    "workroot": {
        "hours_per_content": 2.0,
        "cost_per_content_manual": 30_000,
        "rpm_default": 0,
        "currency": "KRW",
        "content_table": "analysis_history",
        "views_table": None,
        "highlights_templates": [
            "{content_count}건 분석을 완료했습니다",
            "약 {hours_saved:.0f}시간의 리서치 시간을 절약했습니다",
            "커리어 경쟁력 점수: 상위 {percentile}%",
        ],
    },
    "monggeul": {
        "hours_per_content": 0.5,
        "cost_per_content_manual": 5_000,
        "rpm_default": 0,
        "currency": "KRW",
        "content_table": "dream_logs",
        "views_table": None,
        "highlights_templates": [
            "{content_count}개 꿈을 기록하고 해몽했습니다",
            "달이와 {chat_count}번 대화했습니다",
            "연속 기록 {streak}일째!",
        ],
    },
    "naeum": {
        "hours_per_content": 1.0,
        "cost_per_content_manual": 20_000,
        "rpm_default": 0,
        "currency": "KRW",
        "content_table": "health_records",
        "views_table": None,
        "highlights_templates": [
            "{content_count}일 건강 데이터를 분석했습니다",
            "식단 최적화로 약 {cost_saved:,.0f}원 절약",
            "건강 점수 변화: {health_delta:+.1f}점",
        ],
    },
}

# Default fallback for unregistered projects
_DEFAULT_PROJECT_CONFIG: dict[str, Any] = {
    "hours_per_content": 1.0,
    "cost_per_content_manual": 10_000,
    "rpm_default": 0,
    "currency": "KRW",
    "content_table": "user_activity",
    "views_table": None,
    "highlights_templates": [
        "{content_count}건의 작업을 완료했습니다",
        "약 {hours_saved:.0f}시간을 절약했습니다",
    ],
}


# ---------------------------------------------------------------------------
# Korean message templates
# ---------------------------------------------------------------------------

_INTERVENTION_MESSAGES = {
    RiskTier.WATCH: {
        "email": {
            "subject": "다시 돌아와 주세요 - 새로운 기능이 기다리고 있어요",
            "body": (
                "{name}님, 안녕하세요!\n\n"
                "최근 {days}일간 접속이 없으셨네요. "
                "그 사이 새로운 기능이 추가되었어요:\n\n"
                "{new_features}\n\n"
                "지금 바로 확인해 보세요!\n\n"
                "- {project_name} 팀 드림"
            ),
        },
        "in_app": {
            "title": "다시 오셨군요!",
            "body": "최근 업데이트를 확인해 보세요. 새로운 기능이 추가되었습니다.",
        },
    },
    RiskTier.WARNING: {
        "email": {
            "subject": "{name}님만을 위한 특별 혜택",
            "body": (
                "{name}님, 안녕하세요.\n\n"
                "오랜만이에요! 소중한 회원님을 위해 특별 혜택을 준비했습니다.\n\n"
                "지금 접속하시면 {offer_detail}을 드립니다.\n\n"
                "이 혜택은 {expire_days}일 후 만료됩니다.\n\n"
                "- {project_name} 팀 드림"
            ),
        },
        "in_app": {
            "title": "특별 혜택이 도착했어요!",
            "body": "{offer_detail} - 지금 확인하세요.",
        },
        "offer": {
            "type": "bonus_credits",
            "amount": 50,
            "description": "보너스 크레딧 50개 지급",
        },
    },
    RiskTier.CRITICAL: {
        "email": {
            "subject": "[중요] {name}님, 계정이 곧 비활성화됩니다",
            "body": (
                "{name}님, 안녕하세요.\n\n"
                "{days}일간 서비스를 이용하지 않으셨습니다.\n\n"
                "계정 비활성화 전에 아래 혜택을 확인해 주세요:\n"
                "- 다음 달 50% 할인 쿠폰\n"
                "- 보너스 크레딧 100개\n"
                "- 1:1 온보딩 세션 제공\n\n"
                "아래 버튼을 눌러 계정을 유지하세요.\n\n"
                "- {project_name} 팀 드림"
            ),
        },
        "in_app": {
            "title": "계정 유지 혜택",
            "body": "특별 할인과 보너스 크레딧을 받으세요!",
        },
        "offer": {
            "type": "discount",
            "percentage": 50,
            "duration_months": 1,
            "description": "다음 달 50% 할인",
        },
        "personal_call": {
            "trigger": True,
            "script": (
                "안녕하세요, {name}님. {project_name}의 고객 성공 매니저입니다. "
                "혹시 서비스 이용에 불편한 점이 있으셨나요? "
                "저희가 도움을 드릴 수 있는 부분이 있다면 말씀해 주세요."
            ),
        },
    },
}

_NPS_MESSAGES = {
    30: {
        "subject": "한 달 사용 후기를 들려주세요",
        "body": (
            "{name}님, 가입 후 한 달이 되었어요!\n\n"
            "0~10점 중, 주변 지인에게 추천할 의향은 몇 점인가요?\n\n"
            "소중한 의견을 반영해 더 나은 서비스를 만들겠습니다."
        ),
    },
    90: {
        "subject": "3개월 파워유저님의 의견을 듣고 싶어요",
        "body": (
            "{name}님, 벌써 3개월이나 함께해 주셨네요!\n\n"
            "그동안 {project_name}가 업무에 도움이 되셨나요?\n"
            "0~10점으로 추천 의향을 알려주시면, 더 좋은 기능으로 보답하겠습니다."
        ),
    },
    180: {
        "subject": "6개월 장기 회원님 - 프리미엄 피드백 요청",
        "body": (
            "{name}님, 반년 동안 함께해 주셔서 감사합니다!\n\n"
            "장기 사용자의 피드백은 서비스 방향을 결정하는 데 큰 힘이 됩니다.\n"
            "간단한 설문에 답해 주시면 감사의 의미로 보너스 크레딧을 드립니다."
        ),
    },
}

_MILESTONE_REWARDS = {
    MilestoneType.MONTH_1: {
        "credits": 30,
        "badge": "1개월 달성",
        "message": "한 달 동안 꾸준히 이용해 주셨네요! 보너스 크레딧 30개를 드립니다.",
    },
    MilestoneType.MONTH_3: {
        "credits": 100,
        "badge": "3개월 파워유저",
        "message": "3개월 파워유저가 되셨습니다! 보너스 크레딧 100개 + 전용 배지를 드립니다.",
    },
    MilestoneType.MONTH_6: {
        "credits": 200,
        "badge": "6개월 마스터",
        "message": "반년 동안의 여정, 대단합니다! 크레딧 200개 + 마스터 배지 + 1개월 Pro 체험을 드립니다.",
        "bonus": {"type": "trial_upgrade", "tier": "pro", "days": 30},
    },
    MilestoneType.MONTH_12: {
        "credits": 500,
        "badge": "1년 레전드",
        "message": "1년 레전드! 크레딧 500개 + 레전드 배지 + 평생 5% 할인을 드립니다.",
        "bonus": {"type": "permanent_discount", "percentage": 5},
    },
}

_WINBACK_MESSAGES = {
    7: {
        "subject": "벌써 일주일이 됐어요 - 돌아와 주세요",
        "body": (
            "{name}님, 마지막 접속으로부터 일주일이 지났습니다.\n\n"
            "지금 돌아오시면 보너스 크레딧 20개를 드려요!\n"
            "쿠폰 코드: {coupon_code}\n\n"
            "- {project_name} 팀 드림"
        ),
        "offer_credits": 20,
    },
    30: {
        "subject": "한 달이 지났어요 - 특별 복귀 혜택",
        "body": (
            "{name}님, 한 달간 접속이 없으셨네요.\n\n"
            "복귀 기념 특별 혜택:\n"
            "- 보너스 크레딧 50개\n"
            "- 다음 달 30% 할인\n\n"
            "쿠폰 코드: {coupon_code}\n\n"
            "- {project_name} 팀 드림"
        ),
        "offer_credits": 50,
        "discount_percent": 30,
    },
    90: {
        "subject": "오랜만이에요 - 무료 복귀 혜택",
        "body": (
            "{name}님, 오랜만에 연락 드려요.\n\n"
            "혹시 다른 서비스를 찾고 계신가요?\n"
            "저희가 부족했던 점을 개선했습니다:\n\n"
            "{improvements}\n\n"
            "복귀 혜택: 1개월 무료 + 크레딧 100개\n"
            "쿠폰 코드: {coupon_code}\n\n"
            "- {project_name} 팀 드림"
        ),
        "offer_credits": 100,
        "free_months": 1,
    },
}

_ONBOARDING_RECOVERY_MESSAGES = {
    1: {
        "subject": "시작이 반입니다 - 프로필을 완성해 보세요",
        "body": (
            "{name}님, 가입을 환영합니다!\n\n"
            "아직 프로필 설정이 완료되지 않았어요.\n"
            "2분이면 끝나는 간단한 설정으로 맞춤형 서비스를 받아보세요.\n\n"
            "- {project_name} 팀 드림"
        ),
    },
    3: {
        "subject": "첫 번째 기능을 사용해 보세요",
        "body": (
            "{name}님, 아직 핵심 기능을 사용하지 않으셨네요.\n\n"
            "지금 바로 첫 번째 {action_name}을(를) 시작해 보세요!\n"
            "다른 사용자들은 평균 {avg_time}분 만에 완료합니다.\n\n"
            "- {project_name} 팀 드림"
        ),
    },
    7: {
        "subject": "도움이 필요하신가요?",
        "body": (
            "{name}님, 혹시 사용 중 어려운 점이 있으셨나요?\n\n"
            "1:1 온보딩 세션을 무료로 예약하실 수 있습니다.\n"
            "아래 링크에서 편한 시간을 선택하세요.\n\n"
            "- {project_name} 팀 드림"
        ),
    },
    14: {
        "subject": "마지막 기회 - 설정을 완료하고 혜택 받으세요",
        "body": (
            "{name}님, 아직 온보딩이 완료되지 않았어요.\n\n"
            "지금 설정을 완료하시면 보너스 크레딧 30개를 드립니다!\n"
            "이 혜택은 3일 후 만료됩니다.\n\n"
            "- {project_name} 팀 드림"
        ),
    },
    30: {
        "subject": "계정 정리 안내",
        "body": (
            "{name}님, 가입 후 30일이 지났지만 아직 설정이 완료되지 않았습니다.\n\n"
            "비활성 계정은 60일 후 자동 정리됩니다.\n"
            "계속 사용하시려면 로그인하여 설정을 완료해 주세요.\n\n"
            "- {project_name} 팀 드림"
        ),
    },
}

_DOWNSELL_OFFERS: dict[str, list[dict[str, Any]]] = {
    "ongle": [
        {
            "id": "lite_plan",
            "name": "라이트 플랜",
            "description": "월 5개 콘텐츠 생성 + 기본 SEO (현재 플랜의 50% 가격)",
            "discount_percent": 50,
            "features": ["월 5개 콘텐츠", "기본 SEO", "1개 플랫폼"],
            "message": "모든 기능이 필요하지 않으시다면, 라이트 플랜은 어떠세요?",
        },
        {
            "id": "pause_1month",
            "name": "1개월 일시정지",
            "description": "구독을 1개월간 일시정지합니다. 데이터는 그대로 보존됩니다.",
            "discount_percent": 100,
            "features": ["데이터 보존", "1개월 후 자동 재개", "언제든 조기 복귀"],
            "message": "잠시 쉬고 싶으시다면, 1개월 일시정지도 가능합니다.",
        },
        {
            "id": "annual_discount",
            "name": "연간 결제 전환",
            "description": "연간 결제로 전환하면 월 33% 할인!",
            "discount_percent": 33,
            "features": ["연간 결제 할인", "동일 기능", "언제든 환불"],
            "message": "월 비용이 부담되시나요? 연간 결제로 33% 절약하세요.",
        },
    ],
    "workroot": [
        {
            "id": "lite_plan",
            "name": "라이트 플랜",
            "description": "월 3회 분석 + 기본 기능",
            "discount_percent": 50,
            "features": ["월 3회 분석", "기본 리포트"],
            "message": "분석 횟수를 줄이는 대신 합리적인 가격으로 이용하세요.",
        },
        {
            "id": "pause_1month",
            "name": "1개월 일시정지",
            "description": "구독을 1개월간 일시정지합니다.",
            "discount_percent": 100,
            "features": ["데이터 보존", "1개월 후 자동 재개"],
            "message": "지금 당장 필요하지 않다면, 잠시 쉬어가세요.",
        },
    ],
    "monggeul": [
        {
            "id": "free_downgrade",
            "name": "무료 플랜 전환",
            "description": "프리미엄 해몽은 못 쓰지만, 기본 기록은 유지됩니다.",
            "discount_percent": 100,
            "features": ["꿈 기록 유지", "기본 해몽", "달이 대화 월 5회"],
            "message": "무료 플랜으로 전환하면 꿈 기록은 그대로 유지됩니다.",
        },
    ],
    "naeum": [
        {
            "id": "lite_plan",
            "name": "베이직 플랜",
            "description": "기본 건강 기록 + 주간 분석",
            "discount_percent": 50,
            "features": ["건강 기록", "주간 분석", "기본 식단"],
            "message": "일일 분석 대신 주간 분석으로 합리적으로 이용하세요.",
        },
    ],
}

_CANCELLATION_PAGE_TEMPLATE = {
    "title": "정말 떠나시나요?",
    "subtitle": "저희가 더 나아질 수 있도록 이유를 알려주세요",
    "reasons": [
        {"id": "too_expensive", "label": "가격이 부담됩니다", "followup": "downsell"},
        {"id": "not_useful", "label": "필요한 기능이 없습니다", "followup": "feedback"},
        {"id": "too_complex", "label": "사용이 어렵습니다", "followup": "onboarding"},
        {"id": "found_alternative", "label": "다른 서비스를 찾았습니다", "followup": "compare"},
        {"id": "temporary", "label": "일시적으로 필요 없습니다", "followup": "pause"},
        {"id": "other", "label": "기타", "followup": "feedback"},
    ],
    "final_message": "그동안 이용해 주셔서 감사합니다. 언제든 다시 돌아오세요!",
}


# ---------------------------------------------------------------------------
# ChurnPredictor
# ---------------------------------------------------------------------------


class ChurnPredictor:
    """Predict churn risk based on user behavior signals."""

    RISK_SIGNALS: dict[str, dict[str, Any]] = {
        "login_gap_3d": {"weight": 2, "description": "3일 미접속"},
        "login_gap_7d": {"weight": 5, "description": "7일 미접속"},
        "login_gap_14d": {"weight": 10, "description": "14일 미접속"},
        "login_gap_30d": {"weight": 20, "description": "30일 미접속"},
        "usage_decline_50": {"weight": 8, "description": "사용량 50% 감소"},
        "usage_decline_80": {"weight": 15, "description": "사용량 80% 감소"},
        "no_core_feature_7d": {"weight": 6, "description": "7일간 핵심 기능 미사용"},
        "support_ticket_unresolved": {"weight": 4, "description": "미해결 고객문의"},
        "payment_failed": {"weight": 12, "description": "결제 실패"},
        "downgrade_request": {"weight": 10, "description": "다운그레이드 요청"},
        "cancel_page_visited": {"weight": 15, "description": "해지 페이지 방문"},
        "negative_feedback": {"weight": 7, "description": "부정적 피드백"},
        "no_onboarding_complete": {"weight": 5, "description": "온보딩 미완료"},
        "competitor_search": {"weight": 8, "description": "경쟁사 검색 감지"},
        "session_duration_decline": {"weight": 4, "description": "체류시간 감소"},
        "feature_adoption_low": {"weight": 6, "description": "핵심 기능 채택률 낮음"},
    }

    TIER_THRESHOLDS = {
        RiskTier.SAFE: (0, 15),
        RiskTier.WATCH: (15, 35),
        RiskTier.WARNING: (35, 60),
        RiskTier.CRITICAL: (60, 101),
    }

    def __init__(self, db: DBProtocol):
        self.db = db

    async def calculate_risk(self, user_id: str) -> dict[str, Any]:
        """Calculate churn risk for a user.

        Returns:
            {"risk_score": 0-100, "tier": RiskTier, "signals": [...]}
        """
        signals = await self._detect_signals(user_id)
        raw_score = sum(
            self.RISK_SIGNALS[s]["weight"] for s in signals if s in self.RISK_SIGNALS
        )
        risk_score = min(100, raw_score)
        tier = self._score_to_tier(risk_score)

        log.info(
            "churn_risk user=%s score=%d tier=%s signals=%s",
            user_id, risk_score, tier.value, signals,
        )
        return {
            "risk_score": risk_score,
            "tier": tier,
            "signals": signals,
            "signal_details": [
                {"signal": s, "weight": self.RISK_SIGNALS[s]["weight"],
                 "description": self.RISK_SIGNALS[s]["description"]}
                for s in signals if s in self.RISK_SIGNALS
            ],
        }

    async def _detect_signals(self, user_id: str) -> list[str]:
        """Check all signal conditions against DB data."""
        signals: list[str] = []

        # Fetch user record
        user = await self.db.fetch_one("users", {"user_id": user_id})
        if not user:
            log.warning("churn_detect user=%s not found", user_id)
            return ["login_gap_30d"]  # Unknown user = high risk

        # Login gap signals
        last_login = user.get("last_login_at") or user.get("last_active_at")
        gap = _days_ago(last_login)
        if gap >= 30:
            signals.append("login_gap_30d")
        elif gap >= 14:
            signals.append("login_gap_14d")
        elif gap >= 7:
            signals.append("login_gap_7d")
        elif gap >= 3:
            signals.append("login_gap_3d")

        # Usage trend — compare recent 7d vs prior 7d
        recent_activity = await self.db.fetch_many(
            "user_activity",
            {"user_id": user_id},
            order_by="created_at",
            limit=100,
        )
        if recent_activity:
            now = _utcnow()
            week1 = [a for a in recent_activity
                     if _days_ago(a.get("created_at", "")) <= 7]
            week2 = [a for a in recent_activity
                     if 7 < _days_ago(a.get("created_at", "")) <= 14]

            count_recent = len(week1)
            count_prior = len(week2) or 1  # avoid division by zero

            ratio = count_recent / count_prior
            if ratio <= 0.2:
                signals.append("usage_decline_80")
            elif ratio <= 0.5:
                signals.append("usage_decline_50")

            # Core feature check (any activity in last 7 days with type=core)
            core_recent = [a for a in week1 if a.get("activity_type") == "core"]
            if count_recent > 0 and not core_recent:
                signals.append("no_core_feature_7d")

            # Session duration decline
            if len(week1) >= 2 and len(week2) >= 2:
                avg_dur_recent = sum(a.get("duration_sec", 0) for a in week1) / len(week1)
                avg_dur_prior = sum(a.get("duration_sec", 0) for a in week2) / len(week2)
                if avg_dur_prior > 0 and avg_dur_recent / avg_dur_prior < 0.5:
                    signals.append("session_duration_decline")
        else:
            if gap >= 7:
                signals.append("no_core_feature_7d")

        # Support tickets
        tickets = await self.db.fetch_many(
            "support_tickets",
            {"user_id": user_id},
            limit=10,
        )
        unresolved = [t for t in tickets if t.get("status") not in ("resolved", "closed")]
        if unresolved:
            signals.append("support_ticket_unresolved")

        # Payment failures
        payments = await self.db.fetch_many(
            "payment_history",
            {"user_id": user_id},
            order_by="created_at",
            limit=5,
        )
        recent_failures = [
            p for p in payments
            if p.get("status") == "failed" and _days_ago(p.get("created_at", "")) <= 30
        ]
        if recent_failures:
            signals.append("payment_failed")

        # Cancel page visit / downgrade request
        events = await self.db.fetch_many(
            "user_events",
            {"user_id": user_id},
            order_by="created_at",
            limit=50,
        )
        recent_events = [e for e in events if _days_ago(e.get("created_at", "")) <= 14]
        event_types = {e.get("event_type") for e in recent_events}

        if "cancel_page_visit" in event_types:
            signals.append("cancel_page_visited")
        if "downgrade_request" in event_types:
            signals.append("downgrade_request")
        if "competitor_search" in event_types:
            signals.append("competitor_search")

        # Feedback sentiment
        feedback = await self.db.fetch_many(
            "user_feedback",
            {"user_id": user_id},
            order_by="created_at",
            limit=5,
        )
        negative = [f for f in feedback
                    if f.get("rating", 5) <= 2 and _days_ago(f.get("created_at", "")) <= 30]
        if negative:
            signals.append("negative_feedback")

        # Onboarding completion
        onboarding = await self.db.fetch_one("onboarding_progress", {"user_id": user_id})
        if onboarding and not onboarding.get("completed", False):
            signals.append("no_onboarding_complete")

        # Feature adoption
        feature_count = user.get("features_used_count", 0)
        total_features = user.get("total_features", 10)
        if total_features > 0 and feature_count / total_features < 0.3:
            signals.append("feature_adoption_low")

        return signals

    def _score_to_tier(self, score: int) -> RiskTier:
        for tier, (lo, hi) in self.TIER_THRESHOLDS.items():
            if lo <= score < hi:
                return tier
        return RiskTier.CRITICAL


# ---------------------------------------------------------------------------
# InterventionManager
# ---------------------------------------------------------------------------


class InterventionManager:
    """Execute and track automated interventions based on risk tier."""

    def __init__(self, db: DBProtocol, project: str = "ongle"):
        self.db = db
        self.project = project
        self.project_name = {
            "ongle": "온글",
            "workroot": "워크루트",
            "monggeul": "몽글",
            "naeum": "나음",
        }.get(project, project.capitalize())

    async def execute_intervention(self, user_id: str, tier: RiskTier) -> list[InterventionLog]:
        """Send appropriate intervention messages for the given risk tier."""
        if tier == RiskTier.SAFE:
            return []

        templates = _INTERVENTION_MESSAGES.get(tier, {})
        if not templates:
            log.warning("no_intervention_template tier=%s", tier.value)
            return []

        user = await self.db.fetch_one("users", {"user_id": user_id})
        name = (user or {}).get("name", "회원") or "회원"

        # Check cooldown — don't spam the same user
        last = await self.db.fetch_many(
            "intervention_log",
            {"user_id": user_id},
            order_by="sent_at",
            limit=1,
        )
        if last:
            days_since = _days_ago(last[0].get("sent_at", ""))
            cooldown = {RiskTier.WATCH: 7, RiskTier.WARNING: 3, RiskTier.CRITICAL: 1}.get(tier, 3)
            if days_since < cooldown:
                log.info(
                    "intervention_cooldown user=%s tier=%s days_since=%d cooldown=%d",
                    user_id, tier.value, days_since, cooldown,
                )
                return []

        logs: list[InterventionLog] = []
        now_iso = _utcnow().isoformat()

        # Gather new features for messaging
        new_features = "- 성능 개선 및 신규 기능 업데이트"

        fill = {
            "name": name,
            "days": _days_ago((user or {}).get("last_login_at")),
            "project_name": self.project_name,
            "new_features": new_features,
            "offer_detail": templates.get("offer", {}).get("description", "특별 혜택"),
            "expire_days": 7,
        }

        # Email
        if "email" in templates and _email_send:
            tmpl = templates["email"]
            try:
                email = (user or {}).get("email")
                if email:
                    subject = tmpl["subject"].format(**fill)
                    body = tmpl["body"].format(**fill)
                    await _email_send(to=email, subject=subject, body=body)
                    result = "sent"
                else:
                    result = "failed"
                    log.warning("no_email user=%s", user_id)
            except Exception as e:
                result = "failed"
                log.error("intervention_email_failed user=%s err=%s", user_id, e)

            il = InterventionLog(
                user_id=user_id, intervention_type="auto",
                tier=tier, channel="email",
                message_key=f"{tier.value}_email", sent_at=now_iso, result=result,
            )
            logs.append(il)

        # In-app notification (always record — frontend pulls from DB)
        if "in_app" in templates:
            tmpl = templates["in_app"]
            notification_data = {
                "user_id": user_id,
                "title": tmpl["title"].format(**fill),
                "body": tmpl["body"].format(**fill),
                "type": "retention_intervention",
                "tier": tier.value,
                "created_at": now_iso,
                "read": False,
            }
            try:
                await self.db.insert("notifications", notification_data)
                result = "sent"
            except Exception as e:
                result = "failed"
                log.error("intervention_inapp_failed user=%s err=%s", user_id, e)

            il = InterventionLog(
                user_id=user_id, intervention_type="auto",
                tier=tier, channel="in_app",
                message_key=f"{tier.value}_in_app", sent_at=now_iso, result=result,
            )
            logs.append(il)

        # Offer (bonus credits / discount)
        if "offer" in templates:
            offer = templates["offer"]
            offer_data = {
                "user_id": user_id,
                "offer_type": offer.get("type", "bonus"),
                "details": json.dumps(offer, ensure_ascii=False),
                "status": "pending",
                "created_at": now_iso,
                "expires_at": (_utcnow() + timedelta(days=7)).isoformat(),
            }
            try:
                await self.db.insert("retention_offers", offer_data)
            except Exception as e:
                log.error("offer_insert_failed user=%s err=%s", user_id, e)

        # Personal call trigger (critical only)
        if "personal_call" in templates:
            call_data = {
                "user_id": user_id,
                "priority": "high",
                "script": templates["personal_call"]["script"].format(**fill),
                "status": "pending",
                "created_at": now_iso,
            }
            try:
                await self.db.insert("call_queue", call_data)
                il = InterventionLog(
                    user_id=user_id, intervention_type="auto",
                    tier=tier, channel="personal_call",
                    message_key=f"{tier.value}_call", sent_at=now_iso, result="queued",
                )
                logs.append(il)
            except Exception as e:
                log.error("call_queue_failed user=%s err=%s", user_id, e)

        # Persist all logs
        for il in logs:
            await self.track_intervention(il.user_id, il.message_key, il.result)

        log.info(
            "intervention_executed user=%s tier=%s channels=%s",
            user_id, tier.value, [l.channel for l in logs],
        )
        return logs

    async def track_intervention(self, user_id: str, intervention_type: str, result: str) -> None:
        """Log intervention effectiveness."""
        try:
            await self.db.insert("intervention_log", {
                "user_id": user_id,
                "intervention_type": intervention_type,
                "result": result,
                "sent_at": _utcnow().isoformat(),
            })
        except Exception as e:
            log.error("track_intervention_failed user=%s err=%s", user_id, e)


# ---------------------------------------------------------------------------
# ValueReporter
# ---------------------------------------------------------------------------


class ValueReporter:
    """Generate weekly value reports showing ROI to users."""

    def __init__(self, db: DBProtocol, project: str = "ongle"):
        self.db = db
        self.project = project
        self.config = PROJECT_VALUE_CALCULATORS.get(project, _DEFAULT_PROJECT_CONFIG)

    async def calculate_weekly_value(self, user_id: str) -> dict[str, Any]:
        """Calculate value delivered to user in the past 7 days."""
        now = _utcnow()
        week_ago = now - timedelta(days=7)
        week_ago_iso = week_ago.isoformat()

        content_table = self.config["content_table"]

        # Fetch recent content/actions
        all_content = await self.db.fetch_many(
            content_table,
            {"user_id": user_id},
            order_by="created_at",
            limit=500,
        )
        weekly_content = [
            c for c in all_content
            if c.get("created_at", "") >= week_ago_iso
        ]
        content_count = len(weekly_content)

        # Hours saved
        hours_saved = content_count * self.config["hours_per_content"]

        # Cost saved (vs manual/freelancer)
        cost_saved = content_count * self.config["cost_per_content_manual"]

        # Views & revenue (if applicable)
        views = 0
        estimated_revenue = 0.0
        views_table = self.config.get("views_table")
        if views_table:
            perf_records = await self.db.fetch_many(
                views_table,
                {"user_id": user_id},
                order_by="created_at",
                limit=500,
            )
            weekly_perf = [
                p for p in perf_records
                if p.get("created_at", "") >= week_ago_iso
            ]
            views = sum(p.get("views", 0) for p in weekly_perf)
            rpm = self.config.get("rpm_default", 3.5)
            estimated_revenue = (views / 1000) * rpm

        # ROI calculation
        # Estimate subscription cost per week (assume monthly / 4)
        user = await self.db.fetch_one("users", {"user_id": user_id})
        monthly_cost = (user or {}).get("subscription_price", 0) or 0
        weekly_cost = monthly_cost / 4 if monthly_cost else 1  # avoid div/0
        total_value = cost_saved + estimated_revenue
        roi_multiple = total_value / weekly_cost if weekly_cost > 0 else 0

        # Additional project-specific metrics
        extra: dict[str, Any] = {}
        if self.project == "monggeul":
            chats = await self.db.fetch_many("chat_logs", {"user_id": user_id}, limit=200)
            weekly_chats = [c for c in chats if c.get("created_at", "") >= week_ago_iso]
            extra["chat_count"] = len(weekly_chats)
            # Streak
            extra["streak"] = (user or {}).get("current_streak", 0)

        if self.project == "naeum":
            extra["health_delta"] = (user or {}).get("health_score_delta_7d", 0.0)

        if self.project == "workroot":
            extra["percentile"] = (user or {}).get("career_percentile", 50)

        metrics = {
            "content_count": content_count,
            "hours_saved": hours_saved,
            "cost_saved": cost_saved,
            "views": views,
            "estimated_revenue": estimated_revenue,
            "roi_multiple": roi_multiple,
            "period_start": week_ago.strftime("%Y-%m-%d"),
            "period_end": now.strftime("%Y-%m-%d"),
            **extra,
        }

        log.info(
            "weekly_value user=%s content=%d hours=%.1f roi=%.1fx",
            user_id, content_count, hours_saved, roi_multiple,
        )
        return metrics

    def format_value_report(self, metrics: dict[str, Any]) -> dict[str, str]:
        """Format value metrics into email-ready Korean messages."""
        templates = self.config.get("highlights_templates", [])
        highlights: list[str] = []
        for tmpl in templates:
            try:
                highlights.append(tmpl.format(**metrics))
            except (KeyError, ValueError):
                pass

        currency = self.config.get("currency", "KRW")
        if currency == "KRW":
            cost_str = f"{metrics.get('cost_saved', 0):,.0f}원"
            rev_str = f"{metrics.get('estimated_revenue', 0):,.0f}원"
        else:
            cost_str = f"${metrics.get('cost_saved', 0):,.2f}"
            rev_str = f"${metrics.get('estimated_revenue', 0):,.2f}"

        subject = f"주간 성과 리포트 ({metrics.get('period_start', '')} ~ {metrics.get('period_end', '')})"

        body_lines = [
            "이번 주 성과를 한눈에 확인하세요!\n",
            f"생성 콘텐츠: {metrics.get('content_count', 0)}건",
            f"절약한 시간: {metrics.get('hours_saved', 0):.0f}시간",
            f"절약한 비용: {cost_str}",
        ]
        if metrics.get("views", 0) > 0:
            body_lines.append(f"총 조회수: {metrics['views']:,}회")
            body_lines.append(f"예상 수익: {rev_str}")
        if metrics.get("roi_multiple", 0) > 0:
            body_lines.append(f"ROI: {metrics['roi_multiple']:.1f}배")

        if highlights:
            body_lines.append("\n--- 하이라이트 ---")
            body_lines.extend(f"- {h}" for h in highlights)

        return {
            "subject": subject,
            "body": "\n".join(body_lines),
            "highlights": highlights,
        }


# ---------------------------------------------------------------------------
# OnboardingTracker
# ---------------------------------------------------------------------------


class OnboardingTracker:
    """Monitor and recover onboarding health."""

    DEFAULT_STEPS = [s.value for s in OnboardingStep]

    def __init__(self, db: DBProtocol, project: str = "ongle"):
        self.db = db
        self.project = project
        self.project_name = {
            "ongle": "온글", "workroot": "워크루트",
            "monggeul": "몽글", "naeum": "나음",
        }.get(project, project.capitalize())

    async def track_step(self, user_id: str, step_name: str) -> OnboardingProgress:
        """Record an onboarding step completion."""
        record = await self.db.fetch_one("onboarding_progress", {"user_id": user_id})
        now_iso = _utcnow().isoformat()

        if record:
            completed = record.get("completed_steps", [])
            if isinstance(completed, str):
                try:
                    completed = json.loads(completed)
                except (json.JSONDecodeError, TypeError):
                    completed = []
        else:
            completed = []
            record = {
                "user_id": user_id,
                "completed_steps": [],
                "started_at": now_iso,
            }

        if step_name not in completed:
            completed.append(step_name)

        remaining = [s for s in self.DEFAULT_STEPS if s not in completed]
        health_score = int(len(completed) / len(self.DEFAULT_STEPS) * 100) if self.DEFAULT_STEPS else 0
        is_complete = len(remaining) == 0

        data = {
            "user_id": user_id,
            "completed_steps": json.dumps(completed),
            "remaining_steps": json.dumps(remaining),
            "health_score": health_score,
            "completed": is_complete,
            "last_step_at": now_iso,
            "started_at": record.get("started_at", now_iso),
        }
        await self.db.upsert("onboarding_progress", data, conflict_key="user_id")

        log.info(
            "onboarding_step user=%s step=%s progress=%d/%d",
            user_id, step_name, len(completed), len(self.DEFAULT_STEPS),
        )

        stuck_at = remaining[0] if remaining else None
        return OnboardingProgress(
            user_id=user_id,
            completed_steps=completed,
            remaining_steps=remaining,
            health_score=health_score,
            stuck_at=stuck_at,
            started_at=record.get("started_at", now_iso),
            last_step_at=now_iso,
        )

    async def get_onboarding_health(self, user_id: str) -> OnboardingProgress:
        """Get current onboarding status."""
        record = await self.db.fetch_one("onboarding_progress", {"user_id": user_id})

        if not record:
            return OnboardingProgress(
                user_id=user_id,
                completed_steps=[],
                remaining_steps=self.DEFAULT_STEPS.copy(),
                health_score=0,
                stuck_at=self.DEFAULT_STEPS[0] if self.DEFAULT_STEPS else None,
                started_at=_utcnow().isoformat(),
                last_step_at=None,
            )

        completed_raw = record.get("completed_steps", [])
        if isinstance(completed_raw, str):
            try:
                completed_raw = json.loads(completed_raw)
            except (json.JSONDecodeError, TypeError):
                completed_raw = []

        remaining = [s for s in self.DEFAULT_STEPS if s not in completed_raw]
        health_score = int(len(completed_raw) / len(self.DEFAULT_STEPS) * 100) if self.DEFAULT_STEPS else 0

        return OnboardingProgress(
            user_id=user_id,
            completed_steps=completed_raw,
            remaining_steps=remaining,
            health_score=health_score,
            stuck_at=remaining[0] if remaining else None,
            started_at=record.get("started_at", _utcnow().isoformat()),
            last_step_at=record.get("last_step_at"),
        )

    async def trigger_recovery(self, user_id: str) -> dict[str, Any]:
        """Re-engage user who abandoned onboarding."""
        progress = await self.get_onboarding_health(user_id)
        user = await self.db.fetch_one("users", {"user_id": user_id})
        name = (user or {}).get("name", "회원") or "회원"

        days_since_start = _days_ago(progress.started_at)

        # Pick the right recovery message
        recovery_day = None
        for day_threshold in sorted(_ONBOARDING_RECOVERY_MESSAGES.keys()):
            if days_since_start >= day_threshold:
                recovery_day = day_threshold

        if recovery_day is None:
            return {"action": "none", "reason": "too_early"}

        tmpl = _ONBOARDING_RECOVERY_MESSAGES[recovery_day]
        fill = {
            "name": name,
            "project_name": self.project_name,
            "action_name": progress.stuck_at or "기능",
            "avg_time": 5,
        }

        subject = tmpl["subject"].format(**fill)
        body = tmpl["body"].format(**fill)

        # In-app notification
        try:
            await self.db.insert("notifications", {
                "user_id": user_id,
                "title": subject,
                "body": body,
                "type": "onboarding_recovery",
                "created_at": _utcnow().isoformat(),
                "read": False,
            })
        except Exception as e:
            log.error("onboarding_recovery_notification_failed user=%s err=%s", user_id, e)

        # Email if available
        email = (user or {}).get("email")
        if email and _email_send:
            try:
                await _email_send(to=email, subject=subject, body=body)
            except Exception as e:
                log.error("onboarding_recovery_email_failed user=%s err=%s", user_id, e)

        log.info(
            "onboarding_recovery user=%s day=%d stuck_at=%s",
            user_id, recovery_day, progress.stuck_at,
        )

        return {
            "action": "recovery_sent",
            "day_threshold": recovery_day,
            "stuck_at": progress.stuck_at,
            "health_score": progress.health_score,
        }

    async def check_day_n(self, user_id: str, day: int) -> dict[str, Any]:
        """Day 1/3/7/14/30 check — assess if user is on track."""
        progress = await self.get_onboarding_health(user_id)
        days_since_start = _days_ago(progress.started_at)

        if days_since_start < day:
            return {"status": "not_yet", "days_since_start": days_since_start}

        expected_steps_by_day = {
            1: 1,   # signup only
            3: 2,   # + profile
            7: 3,   # + first_action
            14: 4,  # + explore_feature
            30: 5,  # + invite_friend
        }
        expected = expected_steps_by_day.get(day, 1)
        actual = len(progress.completed_steps)
        on_track = actual >= expected

        result = {
            "day": day,
            "on_track": on_track,
            "expected_steps": expected,
            "actual_steps": actual,
            "health_score": progress.health_score,
            "stuck_at": progress.stuck_at,
        }

        if not on_track:
            recovery = await self.trigger_recovery(user_id)
            result["recovery_action"] = recovery

        log.info("day_%d_check user=%s on_track=%s", day, user_id, on_track)
        return result


# ---------------------------------------------------------------------------
# DownsellManager
# ---------------------------------------------------------------------------


class DownsellManager:
    """Prevent cancellations with downsell offers."""

    def __init__(self, db: DBProtocol, project: str = "ongle"):
        self.db = db
        self.project = project
        self.offers = _DOWNSELL_OFFERS.get(project, _DOWNSELL_OFFERS.get("ongle", []))

    async def start_downsell_flow(self, user_id: str) -> dict[str, Any]:
        """Present downsell options when user tries to cancel."""
        user = await self.db.fetch_one("users", {"user_id": user_id})
        name = (user or {}).get("name", "회원") or "회원"
        current_tier = (user or {}).get("tier", "free")

        # Record cancellation intent
        await self.db.insert("user_events", {
            "user_id": user_id,
            "event_type": "cancel_intent",
            "metadata": json.dumps({"tier": current_tier}),
            "created_at": _utcnow().isoformat(),
        })

        # Build response
        response = {
            "page": _CANCELLATION_PAGE_TEMPLATE,
            "user_name": name,
            "current_tier": current_tier,
            "offers": self.offers,
            "message": f"{name}님, 정말 떠나시나요? 저희가 더 나은 옵션을 제안드릴게요.",
        }

        log.info("downsell_flow_started user=%s tier=%s", user_id, current_tier)
        return response

    async def record_downsell_result(
        self, user_id: str, accepted: bool, offer_id: str | None = None, reason: str = ""
    ) -> dict[str, Any]:
        """Record whether user accepted a downsell offer or proceeded with cancellation."""
        now_iso = _utcnow().isoformat()

        data = {
            "user_id": user_id,
            "accepted": accepted,
            "offer_id": offer_id,
            "reason": reason,
            "created_at": now_iso,
        }
        await self.db.insert("downsell_results", data)

        if accepted and offer_id:
            # Apply the offer
            offer = next((o for o in self.offers if o["id"] == offer_id), None)
            if offer:
                await self.db.insert("retention_offers", {
                    "user_id": user_id,
                    "offer_type": offer_id,
                    "details": json.dumps(offer, ensure_ascii=False),
                    "status": "accepted",
                    "created_at": now_iso,
                })
                log.info("downsell_accepted user=%s offer=%s", user_id, offer_id)
                return {"status": "saved", "offer_applied": offer}
        else:
            log.info("downsell_rejected user=%s reason=%s", user_id, reason)

            # Record churn reason for analysis
            await self.db.insert("churn_reasons", {
                "user_id": user_id,
                "reason": reason,
                "tier_at_churn": (await self.db.fetch_one("users", {"user_id": user_id}) or {}).get("tier", "unknown"),
                "created_at": now_iso,
            })

        return {"status": "recorded", "accepted": accepted}


# ---------------------------------------------------------------------------
# ReferralManager
# ---------------------------------------------------------------------------


class ReferralManager:
    """Referral program — generate links, track conversions, grant rewards."""

    REFERRER_REWARD_CREDITS = 50
    REFERRED_REWARD_CREDITS = 30

    def __init__(self, db: DBProtocol, project: str = "ongle"):
        self.db = db
        self.project = project
        self.base_url = {
            "ongle": "https://ongle.me",
            "workroot": "https://workroot.me",
            "monggeul": "https://monggeul.me",
            "naeum": "https://naeum.me",
        }.get(project, f"https://{project}.me")

    async def generate_referral_link(self, user_id: str) -> str:
        """Generate a unique referral link for the user."""
        existing = await self.db.fetch_one("referral_codes", {"user_id": user_id})
        if existing:
            code = existing["referral_code"]
        else:
            code = hashlib.sha256(f"{user_id}:{uuid.uuid4().hex}".encode()).hexdigest()[:12].upper()
            await self.db.insert("referral_codes", {
                "user_id": user_id,
                "referral_code": code,
                "created_at": _utcnow().isoformat(),
            })

        link = f"{self.base_url}/ref/{code}"
        log.info("referral_link_generated user=%s code=%s", user_id, code)
        return link

    async def track_referral(self, referrer_id: str, referred_id: str) -> dict[str, Any]:
        """Record a referral when a new user signs up via referral link."""
        now_iso = _utcnow().isoformat()

        # Check duplicate
        existing = await self.db.fetch_one("referrals", {"referred_id": referred_id})
        if existing:
            log.info("referral_duplicate referred=%s", referred_id)
            return {"status": "duplicate", "message": "이미 등록된 추천입니다"}

        await self.db.insert("referrals", {
            "referrer_id": referrer_id,
            "referred_id": referred_id,
            "status": "pending",
            "created_at": now_iso,
        })

        # Immediate reward for referred user (signup bonus)
        await self._grant_credits(referred_id, self.REFERRED_REWARD_CREDITS, "referral_signup_bonus")

        log.info("referral_tracked referrer=%s referred=%s", referrer_id, referred_id)
        return {
            "status": "tracked",
            "referrer_id": referrer_id,
            "referred_id": referred_id,
            "referred_bonus": self.REFERRED_REWARD_CREDITS,
        }

    async def process_referral_conversion(self, referred_id: str) -> dict[str, Any]:
        """Grant rewards when referred user converts (paid subscription)."""
        referral = await self.db.fetch_one("referrals", {"referred_id": referred_id})
        if not referral:
            return {"status": "no_referral"}

        if referral.get("status") == "converted":
            return {"status": "already_converted"}

        referrer_id = referral["referrer_id"]

        # Update referral status
        await self.db.update(
            "referrals",
            {"referred_id": referred_id},
            {"status": "converted", "converted_at": _utcnow().isoformat()},
        )

        # Reward referrer
        await self._grant_credits(referrer_id, self.REFERRER_REWARD_CREDITS, "referral_conversion_reward")

        # Notify referrer
        try:
            await self.db.insert("notifications", {
                "user_id": referrer_id,
                "title": "추천 보상 지급!",
                "body": f"추천하신 분이 유료 전환했습니다! 크레딧 {self.REFERRER_REWARD_CREDITS}개가 지급되었습니다.",
                "type": "referral_reward",
                "created_at": _utcnow().isoformat(),
                "read": False,
            })
        except Exception as e:
            log.error("referral_notify_failed referrer=%s err=%s", referrer_id, e)

        log.info(
            "referral_converted referrer=%s referred=%s reward=%d",
            referrer_id, referred_id, self.REFERRER_REWARD_CREDITS,
        )
        return {
            "status": "converted",
            "referrer_id": referrer_id,
            "referrer_reward": self.REFERRER_REWARD_CREDITS,
        }

    async def get_referral_stats(self, user_id: str) -> ReferralStats:
        """Get referral program stats for a user."""
        code_record = await self.db.fetch_one("referral_codes", {"user_id": user_id})
        referral_code = (code_record or {}).get("referral_code", "")

        referrals = await self.db.fetch_many("referrals", {"referrer_id": user_id}, limit=1000)
        total = len(referrals)
        converted = len([r for r in referrals if r.get("status") == "converted"])

        rewards_earned = converted * self.REFERRER_REWARD_CREDITS
        pending = len([r for r in referrals if r.get("status") == "pending"])
        pending_rewards = pending * self.REFERRER_REWARD_CREDITS

        return ReferralStats(
            user_id=user_id,
            referral_code=referral_code,
            total_referred=total,
            converted=converted,
            rewards_earned=float(rewards_earned),
            pending_rewards=float(pending_rewards),
        )

    async def _grant_credits(self, user_id: str, amount: int, reason: str) -> None:
        """Add credits to user account."""
        try:
            result = await self.db.increment("users", {"user_id": user_id}, "credits", amount)
            if result is None:
                # Fallback: fetch-update if increment not supported
                user = await self.db.fetch_one("users", {"user_id": user_id})
                if user:
                    current = user.get("credits", 0)
                    await self.db.update(
                        "users",
                        {"user_id": user_id},
                        {"credits": current + amount},
                    )
            await self.db.insert("credit_transactions", {
                "user_id": user_id,
                "amount": amount,
                "reason": reason,
                "created_at": _utcnow().isoformat(),
            })
        except Exception as e:
            log.error("grant_credits_failed user=%s amount=%d err=%s", user_id, amount, e)


# ---------------------------------------------------------------------------
# RetentionEngine — main orchestrator
# ---------------------------------------------------------------------------


class RetentionEngine:
    """Main retention orchestrator — daily checks, NPS, milestones, win-back."""

    def __init__(
        self,
        db: DBProtocol,
        project: str = "ongle",
        churn_predictor: ChurnPredictor | None = None,
        intervention_manager: InterventionManager | None = None,
        value_reporter: ValueReporter | None = None,
        onboarding_tracker: OnboardingTracker | None = None,
        downsell_manager: DownsellManager | None = None,
        referral_manager: ReferralManager | None = None,
    ):
        self.db = db
        self.project = project
        self.project_name = {
            "ongle": "온글", "workroot": "워크루트",
            "monggeul": "몽글", "naeum": "나음",
        }.get(project, project.capitalize())

        self.churn = churn_predictor or ChurnPredictor(db)
        self.intervention = intervention_manager or InterventionManager(db, project)
        self.value = value_reporter or ValueReporter(db, project)
        self.onboarding = onboarding_tracker or OnboardingTracker(db, project)
        self.downsell = downsell_manager or DownsellManager(db, project)
        self.referral = referral_manager or ReferralManager(db, project)

    async def daily_check(self) -> dict[str, Any]:
        """Assess all active users' health, auto-intervene for at-risk users.

        Should be called once per day via scheduler/cron.
        """
        log.info("daily_check started project=%s", self.project)
        results = {
            "checked": 0,
            "safe": 0,
            "watch": 0,
            "warning": 0,
            "critical": 0,
            "interventions_sent": 0,
            "errors": 0,
        }

        # Fetch all active users
        all_users = await self.db.fetch_many("users", {"status": "active"}, limit=10000)
        results["checked"] = len(all_users)

        for user in all_users:
            user_id = user.get("user_id")
            if not user_id:
                continue

            try:
                risk = await self.churn.calculate_risk(user_id)
                tier = risk["tier"]
                results[tier.value] = results.get(tier.value, 0) + 1

                # Store health snapshot
                health = UserHealth(
                    user_id=user_id,
                    risk_score=risk["risk_score"],
                    risk_tier=tier,
                    signals=risk["signals"],
                    days_since_login=_days_ago(user.get("last_login_at")),
                    feature_usage_trend=self._classify_usage_trend(user),
                    subscription_age_days=_days_ago(user.get("created_at")),
                    ltv_to_date=user.get("ltv", 0.0),
                    last_intervention=None,
                )
                await self.db.upsert("user_health", {
                    "user_id": user_id,
                    "risk_score": health.risk_score,
                    "risk_tier": health.risk_tier.value,
                    "signals": json.dumps(health.signals),
                    "days_since_login": health.days_since_login,
                    "feature_usage_trend": health.feature_usage_trend,
                    "updated_at": _utcnow().isoformat(),
                }, conflict_key="user_id")

                # Auto-intervene for at-risk users
                if tier in (RiskTier.WATCH, RiskTier.WARNING, RiskTier.CRITICAL):
                    logs = await self.intervention.execute_intervention(user_id, tier)
                    results["interventions_sent"] += len(logs)

            except Exception as e:
                results["errors"] += 1
                log.error("daily_check_error user=%s err=%s", user_id, e)

        log.info(
            "daily_check completed checked=%d safe=%d watch=%d warning=%d critical=%d interventions=%d",
            results["checked"], results["safe"], results["watch"],
            results["warning"], results["critical"], results["interventions_sent"],
        )
        return results

    async def send_weekly_value_report(self) -> dict[str, Any]:
        """Send personalized value reports to all active paid users."""
        log.info("weekly_value_report started project=%s", self.project)
        results = {"sent": 0, "skipped": 0, "errors": 0}

        # Only send to paid users
        paid_users = await self.db.fetch_many("users", {"status": "active"}, limit=10000)
        paid_users = [u for u in paid_users if u.get("tier") not in ("free", None)]

        for user in paid_users:
            user_id = user.get("user_id")
            if not user_id:
                continue

            try:
                metrics = await self.value.calculate_weekly_value(user_id)
                if metrics["content_count"] == 0 and metrics["views"] == 0:
                    results["skipped"] += 1
                    continue

                report = self.value.format_value_report(metrics)

                # Store report
                await self.db.insert("value_reports", {
                    "user_id": user_id,
                    "metrics": json.dumps(metrics, ensure_ascii=False),
                    "report": json.dumps(report, ensure_ascii=False),
                    "created_at": _utcnow().isoformat(),
                })

                # In-app notification
                await self.db.insert("notifications", {
                    "user_id": user_id,
                    "title": report["subject"],
                    "body": report["body"][:200] + "...",
                    "type": "weekly_value_report",
                    "created_at": _utcnow().isoformat(),
                    "read": False,
                })

                # Email
                email = user.get("email")
                if email and _email_send:
                    try:
                        await _email_send(
                            to=email,
                            subject=report["subject"],
                            body=report["body"],
                        )
                    except Exception as e:
                        log.error("value_report_email_failed user=%s err=%s", user_id, e)

                results["sent"] += 1

            except Exception as e:
                results["errors"] += 1
                log.error("value_report_error user=%s err=%s", user_id, e)

        log.info(
            "weekly_value_report completed sent=%d skipped=%d errors=%d",
            results["sent"], results["skipped"], results["errors"],
        )
        return results

    async def send_nps_survey(self) -> dict[str, Any]:
        """Send NPS surveys at 30/90/180 day milestones."""
        log.info("nps_survey started project=%s", self.project)
        results = {"sent": 0, "skipped": 0}

        all_users = await self.db.fetch_many("users", {"status": "active"}, limit=10000)

        for user in all_users:
            user_id = user.get("user_id")
            if not user_id:
                continue

            age_days = _days_ago(user.get("created_at"))
            name = user.get("name", "회원") or "회원"

            # Check which milestone (exact day +/- 1)
            target_milestone: int | None = None
            for milestone_day in sorted(_NPS_MESSAGES.keys()):
                if abs(age_days - milestone_day) <= 1:
                    target_milestone = milestone_day
                    break

            if target_milestone is None:
                continue

            # Check if already sent for this milestone
            existing = await self.db.fetch_many(
                "nps_surveys",
                {"user_id": user_id},
                limit=100,
            )
            already_sent_milestones = {s.get("milestone_day") for s in existing}
            if target_milestone in already_sent_milestones:
                results["skipped"] += 1
                continue

            tmpl = _NPS_MESSAGES[target_milestone]
            fill = {"name": name, "project_name": self.project_name}
            subject = tmpl["subject"].format(**fill)
            body = tmpl["body"].format(**fill)

            # Record survey
            await self.db.insert("nps_surveys", {
                "user_id": user_id,
                "milestone_day": target_milestone,
                "sent_at": _utcnow().isoformat(),
                "score": None,
                "feedback": None,
            })

            # Notification
            await self.db.insert("notifications", {
                "user_id": user_id,
                "title": subject,
                "body": body,
                "type": "nps_survey",
                "created_at": _utcnow().isoformat(),
                "read": False,
            })

            # Email
            email = user.get("email")
            if email and _email_send:
                try:
                    await _email_send(to=email, subject=subject, body=body)
                except Exception as e:
                    log.error("nps_email_failed user=%s err=%s", user_id, e)

            results["sent"] += 1
            log.info("nps_sent user=%s milestone=%d", user_id, target_milestone)

        log.info("nps_survey completed sent=%d skipped=%d", results["sent"], results["skipped"])
        return results

    async def process_milestone(self, user_id: str, milestone: MilestoneType | str) -> dict[str, Any]:
        """Grant rewards at 1/3/6/12 month milestones."""
        if isinstance(milestone, str):
            try:
                milestone = MilestoneType(milestone)
            except ValueError:
                return {"status": "invalid_milestone", "milestone": milestone}

        reward = _MILESTONE_REWARDS.get(milestone)
        if not reward:
            return {"status": "no_reward", "milestone": milestone.value}

        # Check if already granted
        existing = await self.db.fetch_many(
            "milestone_rewards",
            {"user_id": user_id},
            limit=100,
        )
        granted = {r.get("milestone") for r in existing}
        if milestone.value in granted:
            return {"status": "already_granted", "milestone": milestone.value}

        now_iso = _utcnow().isoformat()

        # Grant credits
        credits = reward.get("credits", 0)
        if credits > 0:
            await self.referral._grant_credits(user_id, credits, f"milestone_{milestone.value}")

        # Grant badge
        await self.db.insert("user_badges", {
            "user_id": user_id,
            "badge": reward["badge"],
            "granted_at": now_iso,
        })

        # Record milestone
        await self.db.insert("milestone_rewards", {
            "user_id": user_id,
            "milestone": milestone.value,
            "credits_granted": credits,
            "badge": reward["badge"],
            "created_at": now_iso,
        })

        # Apply bonus (trial upgrade, permanent discount)
        bonus = reward.get("bonus")
        if bonus:
            await self.db.insert("user_bonuses", {
                "user_id": user_id,
                "bonus_type": bonus["type"],
                "details": json.dumps(bonus, ensure_ascii=False),
                "created_at": now_iso,
            })

        # Notification
        await self.db.insert("notifications", {
            "user_id": user_id,
            "title": f"{reward['badge']} 달성!",
            "body": reward["message"],
            "type": "milestone",
            "created_at": now_iso,
            "read": False,
        })

        log.info(
            "milestone_granted user=%s milestone=%s credits=%d badge=%s",
            user_id, milestone.value, credits, reward["badge"],
        )
        return {
            "status": "granted",
            "milestone": milestone.value,
            "credits": credits,
            "badge": reward["badge"],
            "message": reward["message"],
            "bonus": bonus,
        }

    async def calculate_churn_risk(self, user_id: str) -> UserHealth:
        """Calculate churn risk and return full UserHealth dataclass."""
        risk = await self.churn.calculate_risk(user_id)
        user = await self.db.fetch_one("users", {"user_id": user_id})

        last_intervention_records = await self.db.fetch_many(
            "intervention_log",
            {"user_id": user_id},
            order_by="sent_at",
            limit=1,
        )
        last_interv = last_intervention_records[0].get("sent_at") if last_intervention_records else None

        return UserHealth(
            user_id=user_id,
            risk_score=risk["risk_score"],
            risk_tier=risk["tier"],
            signals=risk["signals"],
            days_since_login=_days_ago((user or {}).get("last_login_at")),
            feature_usage_trend=self._classify_usage_trend(user or {}),
            subscription_age_days=_days_ago((user or {}).get("created_at")),
            ltv_to_date=(user or {}).get("ltv", 0.0),
            last_intervention=last_interv,
        )

    async def run_win_back_campaign(self) -> dict[str, Any]:
        """Target churned users at 7/30/90 day intervals."""
        log.info("win_back_campaign started project=%s", self.project)
        results = {"targeted": 0, "sent": 0, "errors": 0}

        # Fetch inactive/churned users
        all_users = await self.db.fetch_many("users", {}, limit=10000)
        churned = [
            u for u in all_users
            if u.get("status") in ("inactive", "canceled", "churned")
            or _days_ago(u.get("last_login_at")) >= 7
        ]

        for user in churned:
            user_id = user.get("user_id")
            if not user_id:
                continue

            results["targeted"] += 1
            gap = _days_ago(user.get("last_login_at"))
            name = user.get("name", "회원") or "회원"

            # Find the right campaign tier
            campaign_day: int | None = None
            for day_threshold in sorted(_WINBACK_MESSAGES.keys(), reverse=True):
                if gap >= day_threshold:
                    campaign_day = day_threshold
                    break

            if campaign_day is None:
                continue

            # Check cooldown (don't send same campaign twice within 14 days)
            existing = await self.db.fetch_many(
                "winback_log",
                {"user_id": user_id},
                order_by="sent_at",
                limit=5,
            )
            recent_same = [
                w for w in existing
                if w.get("campaign_day") == campaign_day
                and _days_ago(w.get("sent_at", "")) < 14
            ]
            if recent_same:
                continue

            tmpl = _WINBACK_MESSAGES[campaign_day]
            coupon_code = f"WINBACK{campaign_day}-{hashlib.md5(user_id.encode()).hexdigest()[:6].upper()}"

            # Gather recent improvements for 90-day message
            improvements = "- 성능 대폭 개선\n- 새로운 AI 모델 적용\n- UX 리뉴얼"

            fill = {
                "name": name,
                "project_name": self.project_name,
                "coupon_code": coupon_code,
                "improvements": improvements,
            }

            subject = tmpl["subject"].format(**fill)
            body = tmpl["body"].format(**fill)

            try:
                # Log campaign
                await self.db.insert("winback_log", {
                    "user_id": user_id,
                    "campaign_day": campaign_day,
                    "coupon_code": coupon_code,
                    "sent_at": _utcnow().isoformat(),
                    "status": "sent",
                })

                # Create coupon
                offer_data: dict[str, Any] = {
                    "user_id": user_id,
                    "offer_type": f"winback_{campaign_day}d",
                    "coupon_code": coupon_code,
                    "status": "active",
                    "created_at": _utcnow().isoformat(),
                    "expires_at": (_utcnow() + timedelta(days=14)).isoformat(),
                }
                if "offer_credits" in tmpl:
                    offer_data["credits"] = tmpl["offer_credits"]
                if "discount_percent" in tmpl:
                    offer_data["discount_percent"] = tmpl["discount_percent"]
                if "free_months" in tmpl:
                    offer_data["free_months"] = tmpl["free_months"]

                await self.db.insert("retention_offers", offer_data)

                # Email
                email = user.get("email")
                if email and _email_send:
                    try:
                        await _email_send(to=email, subject=subject, body=body)
                    except Exception as e:
                        log.error("winback_email_failed user=%s err=%s", user_id, e)

                results["sent"] += 1

            except Exception as e:
                results["errors"] += 1
                log.error("winback_error user=%s err=%s", user_id, e)

        log.info(
            "win_back_campaign completed targeted=%d sent=%d errors=%d",
            results["targeted"], results["sent"], results["errors"],
        )
        return results

    def _classify_usage_trend(self, user: dict[str, Any]) -> str:
        """Classify usage trend from user metadata."""
        trend = user.get("usage_trend")
        if trend in ("increasing", "stable", "declining", "inactive"):
            return trend
        # Fallback: check last_login gap
        gap = _days_ago(user.get("last_login_at"))
        if gap >= 14:
            return "inactive"
        elif gap >= 7:
            return "declining"
        else:
            return "stable"


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def create_retention_stack(
    db: DBProtocol,
    project: str = "ongle",
) -> RetentionEngine:
    """Factory — create a fully wired RetentionEngine with all sub-components.

    Usage:
        stack = create_retention_stack(db=my_db, project="ongle")
        await stack.daily_check()
        await stack.send_weekly_value_report()
        # Access sub-components:
        health = await stack.churn.calculate_risk(user_id)
        stats = await stack.referral.get_referral_stats(user_id)
    """
    churn = ChurnPredictor(db)
    intervention = InterventionManager(db, project)
    value = ValueReporter(db, project)
    onboarding = OnboardingTracker(db, project)
    downsell = DownsellManager(db, project)
    referral = ReferralManager(db, project)

    engine = RetentionEngine(
        db=db,
        project=project,
        churn_predictor=churn,
        intervention_manager=intervention,
        value_reporter=value,
        onboarding_tracker=onboarding,
        downsell_manager=downsell,
        referral_manager=referral,
    )

    log.info("retention_stack_created project=%s", project)
    return engine
