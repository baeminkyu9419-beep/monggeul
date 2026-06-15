"""
MONGGEUL — Paywall 구독자 인식 회귀 테스트 (이중청구 방지)

결함(2026-06-16 적발):
  showPremiumPaywall() / showUnconsciousPaywall() 가 구독자 단락 체크를
  `tier === 'pro'` 하나만 했음. 그러나 getCachedTier() 는 normalizeEntitlement()
  를 통해 'pro' 를 'plus' 로 정규화하므로 실제 라이브 값은 'free' / 'plus' /
  'premium' 뿐 — 'pro' 는 절대 반환되지 않는다.
  → Plus/Premium 구독자가 paywall 모달을 다시 보고 재결제하는 이중청구 유도.

뮤테이션 정신: 구버전 코드(=`tier === 'pro'` 단독)라면 이 테스트는 FAIL,
수정 후(plus/premium 인식)면 PASS.
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


@pytest.fixture(scope="module")
def paywall_src():
    return (SRC / "components" / "paywall.js").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def sub_src():
    return (SRC / "services" / "subscription.js").read_text(encoding="utf-8")


def _func_body(src, name):
    """export function <name>() { ... } 본문을 최상위 닫는 중괄호까지 추출."""
    m = re.search(rf"export function {re.escape(name)}\(\)\s*\{{", src)
    assert m, f"{name} 함수를 찾을 수 없습니다"
    start = m.end() - 1  # '{' 위치
    depth = 0
    for i in range(start, len(src)):
        c = src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[start + 1 : i]
    raise AssertionError(f"{name} 본문 끝(중괄호)을 찾지 못했습니다")


# ─────────────────────────────────────────────────────────────────
# 0. 전제 핀: getCachedTier 는 'pro' 를 반환하지 않는다 (정규화됨)
# ─────────────────────────────────────────────────────────────────

class TestTierContract:
    def test_normalize_maps_pro_to_plus(self, sub_src):
        """normalizeEntitlement 가 'pro' 를 'plus' 로 매핑해야 한다 —
        따라서 getCachedTier() 의 라이브 반환값은 'pro' 가 아니다."""
        m = re.search(r"function normalizeEntitlement\(key\)\s*\{([\s\S]*?)\n\}", sub_src)
        assert m, "normalizeEntitlement 를 찾을 수 없습니다"
        body = m.group(1)
        assert "'pro'" in body and "'plus'" in body, \
            "normalizeEntitlement 가 pro→plus 정규화를 하지 않습니다"


# ─────────────────────────────────────────────────────────────────
# 1. showPremiumPaywall 구독자 단락 — plus/premium 인식 필수
# ─────────────────────────────────────────────────────────────────

class TestShowPremiumPaywallShortCircuit:
    def test_recognizes_plus_subscriber(self, paywall_src):
        """showPremiumPaywall 의 구독자 단락 가드가 'plus' 를 인식해야 한다."""
        body = _func_body(paywall_src, "showPremiumPaywall")
        assert "'plus'" in body, (
            "showPremiumPaywall 이 plus 구독자를 인식하지 못합니다 — "
            "getCachedTier()='plus' 인 구독자가 paywall 재노출 → 이중청구"
        )

    def test_recognizes_premium_subscriber(self, paywall_src):
        """showPremiumPaywall 의 구독자 단락 가드가 'premium' 을 인식해야 한다."""
        body = _func_body(paywall_src, "showPremiumPaywall")
        assert "'premium'" in body, (
            "showPremiumPaywall 이 premium 구독자를 인식하지 못합니다 — "
            "getCachedTier()='premium' 인 구독자가 paywall 재노출 → 이중청구"
        )

    def test_subscriber_guard_returns_early(self, paywall_src):
        """구독자 분기 안에서 return 으로 모달 생성을 막아야 한다."""
        body = _func_body(paywall_src, "showPremiumPaywall")
        m = re.search(r"if\s*\(\s*tier\s*===.*?\)\s*\{([\s\S]*?)\}", body)
        assert m, "showPremiumPaywall 에 tier 기반 가드 분기가 없습니다"
        assert "return" in m.group(1), \
            "구독자 가드 분기에서 early return 하지 않습니다 (모달 계속 생성됨)"


# ─────────────────────────────────────────────────────────────────
# 2. showUnconsciousPaywall 구독자 단락 — 동일 결함
# ─────────────────────────────────────────────────────────────────

class TestShowUnconsciousPaywallShortCircuit:
    def test_recognizes_plus_subscriber(self, paywall_src):
        body = _func_body(paywall_src, "showUnconsciousPaywall")
        assert "'plus'" in body, (
            "showUnconsciousPaywall 이 plus 구독자를 인식하지 못합니다 → 이중청구"
        )

    def test_recognizes_premium_subscriber(self, paywall_src):
        body = _func_body(paywall_src, "showUnconsciousPaywall")
        assert "'premium'" in body, (
            "showUnconsciousPaywall 이 premium 구독자를 인식하지 못합니다 → 이중청구"
        )
