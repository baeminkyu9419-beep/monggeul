"""
MONGGEUL Edge Function 결제 라우팅 — 변경 민감(change-sensitive) 단위 테스트
================================================================================

배경 (왜 이 파일이 존재하나):
  기존 test_business_logic.py::TestPaymentFlow 는 src/services/payment.js 의
  '문자열 존재'만 확인했다. create-checkout/index.ts · stripe-webhook/index.ts
  (실제 결제 분기 로직)는 단 한 번도 열어보지 않는다. 따라서 .ts 버그를
  되돌려도 'passed' 수가 동일 → 결제 수정의 검증이 무의미했다(오도성 검증).

이 파일은 그 결함을 고친다:
  1) 실제 .ts 소스를 읽어, resolveSku/SKU_ALIAS/isPack/isOneTime 분기와
     webhook one_time→remaining:1 매핑을 소스에서 직접 파싱해 실행한다.
  2) 핵심 매핑을 단언한다:
        pro_monthly        → subscription
        pack_15            → pack (payment)
        unconscious_profile→ one_time (remaining:1, 구독 오부여 금지)
  3) 뮤테이션 입증: 옛 버그(unconscious_profile→구독 오부여)를 인메모리로
     재현하면 위 단언이 반드시 FAIL 한다 = 변경에 민감하다.

Deno 미설치 → .ts 를 직접 실행하지 않고, 라우팅 결정을 소스 텍스트에서
파싱해 모델링한다. 분기가 사라지면 파싱 결과가 바뀌므로 .ts 변경에 결합된다.
순수 파일 기반. 네트워크/빌드 불필요.
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FUNCS = ROOT / "supabase" / "functions"
CHECKOUT_TS = FUNCS / "create-checkout" / "index.ts"
WEBHOOK_TS = FUNCS / "stripe-webhook" / "index.ts"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# create-checkout/index.ts — 소스에서 SKU 라우팅 파싱
# ═══════════════════════════════════════════════════════════════

def parse_sku_alias(src: str) -> dict:
    """Edge Function(.ts) SKU_ALIAS 검사 — 클라 payment.js판은 2026-06-12 dead-export로 제거됨, .ts판이 정본.

    const SKU_ALIAS: Record<string,string> = { legacy: canonical } 블록 추출."""
    m = re.search(r"SKU_ALIAS[^=]*=\s*\{(.*?)\}", src, re.DOTALL)
    assert m, "SKU_ALIAS block not found in create-checkout/index.ts"
    alias = {}
    for k, v in re.findall(r"([A-Za-z_]\w*)\s*:\s*'([^']+)'", m.group(1)):
        alias[k] = v
    return alias


def resolve_sku(src: str, raw: str) -> str:
    """.ts 의 resolveSku = SKU_ALIAS[s] || s 미러."""
    return parse_sku_alias(src).get(raw, raw)


def _checkout_one_time_skus(src: str) -> set:
    """isOneTime = sku === '...' 로 one_time 취급되는 SKU 집합 (소스 파싱)."""
    return set(re.findall(r"isOneTime\s*=\s*sku\s*===\s*'([^']+)'", src))


def _checkout_payment_predicates(src: str) -> set:
    """mode='payment' 를 게이트하는 조건 술어 — `if (isPack || isOneTime) {... priceId = PACK_PRICE_IDS`."""
    m = re.search(
        r"if\s*\(([^)]*)\)\s*\{[^}]*priceId\s*=\s*PACK_PRICE_IDS",
        src,
        re.DOTALL,
    )
    assert m, "payment-mode branch (priceId = PACK_PRICE_IDS) not found in create-checkout"
    return set(re.findall(r"is[A-Za-z]+", m.group(1)))


def checkout_mode(src: str, raw_sku: str) -> str:
    """주어진 raw SKU 가 create-checkout 에서 'payment' 인지 'subscription' 인지 — 소스 기준."""
    sku = resolve_sku(src, raw_sku)
    preds = _checkout_payment_predicates(src)
    has_pack_pred = bool(re.search(r"isPack\s*=\s*sku\.startsWith\('pack_'\)", src))
    is_pack = sku.startswith("pack_") and "isPack" in preds and has_pack_pred
    is_one_time = sku in _checkout_one_time_skus(src) and "isOneTime" in preds
    return "payment" if (is_pack or is_one_time) else "subscription"


# ═══════════════════════════════════════════════════════════════
# stripe-webhook/index.ts — 소스에서 entitlement 분기 파싱
# ═══════════════════════════════════════════════════════════════

def _webhook_completed_block(src: str) -> str:
    """checkout.session.completed case 본문 추출 (다음 case 직전까지)."""
    m = re.search(
        r"case 'checkout\.session\.completed':\s*\{(.*?)\n\s*case ",
        src,
        re.DOTALL,
    )
    assert m, "checkout.session.completed case not found in stripe-webhook"
    return m.group(1)


def _webhook_one_time_branch(src: str):
    """`} else if (isOneTime) { ... }` 분기 본문, 없으면 None."""
    block = _webhook_completed_block(src)
    m = re.search(r"else if \(isOneTime\)\s*\{(.*?)\}\s*else\s*\{", block, re.DOTALL)
    return m.group(1) if m else None


def _webhook_pack_branch(src: str):
    block = _webhook_completed_block(src)
    m = re.search(r"if \(isPack\)\s*\{(.*?)\}\s*else", block, re.DOTALL)
    return m.group(1) if m else None


def _webhook_defines_one_time(src: str) -> bool:
    return bool(re.search(r"isOneTime\s*=\s*productId\s*===\s*'unconscious_profile'", src))


def webhook_route(src: str, product_id: str) -> dict:
    """productId 가 webhook 에서 어느 권한 분기로 가는지 — 소스 기준 모델.

    반환: {branch, remaining, grants_subscription}
      branch: 'pack' | 'one_time' | 'subscription'
    """
    has_pack_pred = bool(re.search(r"isPack\s*=\s*productId\.startsWith\('pack_'\)", src))
    is_pack = product_id.startswith("pack_") and has_pack_pred

    ot_branch = _webhook_one_time_branch(src)
    is_one_time = (
        product_id == "unconscious_profile"
        and _webhook_defines_one_time(src)
        and ot_branch is not None
    )

    if is_pack:
        pack = _webhook_pack_branch(src) or ""
        m = re.search(r"remaining:\s*(\w+)", pack)
        return {
            "branch": "pack",
            "remaining": m.group(1) if m else None,
            "grants_subscription": False,
        }

    if is_one_time:
        m = re.search(r"remaining:\s*(\d+)", ot_branch)
        grants_sub = bool(
            re.search(r"type:\s*'subscription'", ot_branch)
            or re.search(r"subscription_tier", ot_branch)
        )
        return {
            "branch": "one_time",
            "remaining": int(m.group(1)) if m else None,
            "grants_subscription": grants_sub,
        }

    # 그 외 → 구독 else 분기
    return {"branch": "subscription", "remaining": None, "grants_subscription": True}


# ── 뮤테이션(옛 버그 재현) ────────────────────────────────────────

def mutate_webhook_remove_one_time(src: str) -> str:
    """옛 버그 재현(commit 3eed6af 되돌림): `} else if (isOneTime){...}` 분기를
    삭제해 unconscious_profile 이 구독 else 로 흘러가게 만든다(구독 오부여)."""
    mutated = re.sub(
        r"\}\s*else if \(isOneTime\)\s*\{.*?\}\s*else\s*\{",
        "} else {",
        src,
        count=1,
        flags=re.DOTALL,
    )
    assert mutated != src, "mutation no-op: isOneTime branch not found"
    return mutated


def mutate_checkout_drop_one_time_from_condition(src: str) -> str:
    """옛 버그 재현: payment 조건에서 `|| isOneTime` 제거 → 단건이 구독으로 샌다."""
    mutated = re.sub(r"if \(isPack \|\| isOneTime\)", "if (isPack)", src, count=1)
    assert mutated != src, "mutation no-op: payment condition not found"
    return mutated


# ═══════════════════════════════════════════════════════════════
# TESTS — create-checkout 라우팅
# ═══════════════════════════════════════════════════════════════

class TestCreateCheckoutRouting:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(CHECKOUT_TS)

    def test_resolve_sku_aliases_canonicalize(self):
        """레거시 tier 가 정본 SKU 로 별칭 해석된다."""
        assert resolve_sku(self.src, "pro") == "pro_monthly"
        assert resolve_sku(self.src, "plus") == "plus_monthly"
        assert resolve_sku(self.src, "premium") == "premium_monthly"
        assert resolve_sku(self.src, "starlight") == "plus_monthly"
        assert resolve_sku(self.src, "starlight_monthly") == "plus_monthly"
        # 이미 정본인 SKU 는 그대로
        assert resolve_sku(self.src, "pack_15") == "pack_15"
        assert resolve_sku(self.src, "unconscious_profile") == "unconscious_profile"

    def test_subscription_skus_use_subscription_mode(self):
        for raw in ["pro_monthly", "plus_monthly", "premium_monthly",
                    "pro", "plus", "premium", "starlight"]:
            assert checkout_mode(self.src, raw) == "subscription", raw

    def test_pack_skus_use_payment_mode(self):
        for raw in ["pack_1", "pack_5", "pack_15"]:
            assert checkout_mode(self.src, raw) == "payment", raw

    def test_unconscious_profile_uses_payment_not_subscription(self):
        """단건 무의식 프로파일은 1회 결제(payment) — 구독 모드 금지."""
        assert checkout_mode(self.src, "unconscious_profile") == "payment"


# ═══════════════════════════════════════════════════════════════
# TESTS — stripe-webhook 권한 부여 분기
# ═══════════════════════════════════════════════════════════════

class TestStripeWebhookRouting:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(WEBHOOK_TS)

    def test_subscription_product_grants_subscription(self):
        r = webhook_route(self.src, "pro_monthly")
        assert r["branch"] == "subscription"
        assert r["grants_subscription"] is True

    def test_pack_product_grants_pack_not_subscription(self):
        r = webhook_route(self.src, "pack_15")
        assert r["branch"] == "pack"
        assert r["grants_subscription"] is False
        assert r["remaining"] == "packCount"  # products.count 기반

    def test_unconscious_profile_grants_one_time_remaining_1(self):
        """핵심: unconscious_profile → one_time, remaining:1, 구독 오부여 없음."""
        r = webhook_route(self.src, "unconscious_profile")
        assert r["branch"] == "one_time"
        assert r["remaining"] == 1
        assert r["grants_subscription"] is False


# ═══════════════════════════════════════════════════════════════
# TESTS — 뮤테이션 입증 (변경 민감성)
# ═══════════════════════════════════════════════════════════════

class TestMutationProof:
    """옛 버그를 재현하면 위 단언들이 실제로 깨진다 = 이 테스트는 변경에 민감하다.
    (기존 test_business_logic.py 는 여기서 무감각 → passed 동일이었다)"""

    def test_webhook_mutation_changes_routing_to_subscription(self):
        src = _read(WEBHOOK_TS)
        mutated = mutate_webhook_remove_one_time(src)
        # 정상 소스: one_time
        assert webhook_route(src, "unconscious_profile")["branch"] == "one_time"
        # 버그 재현 소스: subscription (구독 오부여)
        assert webhook_route(mutated, "unconscious_profile")["branch"] == "subscription"

    def test_webhook_mutation_is_caught_by_correctness_assertion(self):
        """정상 기준 단언(one_time/remaining:1)이 버그 소스에선 반드시 FAIL."""
        mutated = mutate_webhook_remove_one_time(_read(WEBHOOK_TS))
        with pytest.raises(AssertionError):
            r = webhook_route(mutated, "unconscious_profile")
            assert r["branch"] == "one_time", "regression: unconscious_profile 가 더 이상 one_time 아님"
            assert r["remaining"] == 1
            assert r["grants_subscription"] is False

    def test_checkout_mutation_is_caught_by_payment_assertion(self):
        """create-checkout 조건에서 isOneTime 제거 시 단건이 구독으로 새고, 단언이 FAIL."""
        src = _read(CHECKOUT_TS)
        mutated = mutate_checkout_drop_one_time_from_condition(src)
        # 정상: payment
        assert checkout_mode(src, "unconscious_profile") == "payment"
        # 버그: subscription → 단언 깨짐
        assert checkout_mode(mutated, "unconscious_profile") == "subscription"
        with pytest.raises(AssertionError):
            assert checkout_mode(mutated, "unconscious_profile") == "payment"
