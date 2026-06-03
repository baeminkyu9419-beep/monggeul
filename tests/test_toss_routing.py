"""
MONGGEUL 토스(Toss) Edge Function 라우팅 + dedup 불변식 — 회귀 단위 테스트
================================================================================

배경 (왜 이 파일이 존재하나):
  2026-06-03 dedup: toss-* Edge Function 6개(v1 3 + v2 3 병존)를 3개로 정리했다.
  - 클라이언트 source(`src/services/pg-toss.js` → toss-checkout,
    `src/services/payment.js` → toss-confirm)가 v1 만 호출 = v2 는 dead code.
  - v2 의 schema-backed 우월 로직(구독 confirm 시 users.subscription_tier 갱신 ·
    취소 시 tier 초기화 · 빌링 갱신 시 subscription_renewed 이벤트)을 v1 으로 병합 후
    v2 3개(toss-payment-ready/confirm/webhook) 삭제.

  이 테스트는 그 정리가 회귀(끊김/되돌림)하지 않도록 불변식을 코드로 고정한다:
    1) dedup 불변식:  v1 3개 존재 · v2 3개 부재 · 클라이언트 source 가 v1 만 참조.
    2) 라우팅 정합:   pg-toss → toss-checkout, payment.js → toss-confirm,
                      method→pg 매핑(kakaopay/naverpay/transfer/tosspay → toss).
    3) 병합 로직 보존: confirm 구독 분기 · webhook 취소/갱신 분기에서 users tier
                      동기화와 subscription_renewed 이벤트가 v1 에 살아있는지.
    4) 뮤테이션 민감도: 위 병합 로직을 제거하면 단언이 반드시 FAIL.

Deno 미설치 → .ts 를 실행하지 않고 소스 텍스트에서 라우팅/분기를 파싱한다.
분기가 사라지면 파싱 결과가 바뀌므로 .ts 변경에 결합된다. 순수 파일 기반.
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FUNCS = ROOT / "supabase" / "functions"
SERVICES = ROOT / "src" / "services"

CHECKOUT_TS = FUNCS / "toss-checkout" / "index.ts"
CONFIRM_TS = FUNCS / "toss-confirm" / "index.ts"
WEBHOOK_TS = FUNCS / "toss-webhook" / "index.ts"

PG_TOSS_JS = SERVICES / "pg-toss.js"
PAYMENT_JS = SERVICES / "payment.js"

# 정리로 삭제된 v2 dead-code 함수 (재생성/되돌림 금지)
V2_REMOVED = ("toss-payment-ready", "toss-payment-confirm", "toss-payment-webhook")
# 정본으로 유지되는 v1 함수
V1_CANONICAL = ("toss-checkout", "toss-confirm", "toss-webhook")


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# §1 dedup 불변식 — 6→3 단순화가 유지되는가
# ═══════════════════════════════════════════════════════════════

class TestDedupInvariant:
    def test_v1_canonical_functions_exist(self):
        for name in V1_CANONICAL:
            assert (FUNCS / name / "index.ts").is_file(), f"{name} 정본 함수가 사라졌다"

    def test_v2_duplicate_functions_removed(self):
        for name in V2_REMOVED:
            assert not (FUNCS / name).exists(), (
                f"{name} (v2 dead code) 가 다시 생겼다 — dedup 되돌림"
            )

    def test_exactly_three_toss_functions(self):
        toss_dirs = sorted(
            d.name for d in FUNCS.iterdir()
            if d.is_dir() and d.name.startswith("toss-")
        )
        assert toss_dirs == sorted(V1_CANONICAL), (
            f"toss-* 함수가 정확히 v1 3개여야 한다. 실제={toss_dirs}"
        )

    def test_client_source_references_only_v1(self):
        """src/ 의 어떤 파일도 v2 함수 endpoint 를 호출하지 않는다."""
        for js in SERVICES.glob("*.js"):
            src = _read(js)
            for name in V2_REMOVED:
                assert f"functions/v1/{name}" not in src, (
                    f"{js.name} 가 삭제된 v2 {name} 를 아직 호출한다"
                )

    def test_client_source_references_v1_endpoints(self):
        """클라이언트가 정본 v1 endpoint 를 실제로 호출하는지 (퍼널 결선 확인)."""
        assert "functions/v1/toss-checkout" in _read(PG_TOSS_JS), (
            "pg-toss.js 가 toss-checkout 을 호출하지 않는다 (결제 준비 끊김)"
        )
        assert "functions/v1/toss-confirm" in _read(PAYMENT_JS), (
            "payment.js 가 toss-confirm 을 호출하지 않는다 (결제 승인 끊김)"
        )


# ═══════════════════════════════════════════════════════════════
# §2 결제수단 → PG 라우팅 (payment.js METHOD_PG_MAP 소스 파싱)
# ═══════════════════════════════════════════════════════════════

def _parse_method_pg_map(src: str) -> dict:
    m = re.search(r"METHOD_PG_MAP\s*=\s*\{(.*?)\}", src, re.DOTALL)
    assert m, "METHOD_PG_MAP block not found in payment.js"
    mapping = {}
    for k, v in re.findall(r"([A-Za-z_]\w*)\s*:\s*'([^']+)'", m.group(1)):
        mapping[k] = v
    return mapping


class TestMethodRouting:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.mapping = _parse_method_pg_map(_read(PAYMENT_JS))

    def test_toss_methods_route_to_toss(self):
        for method in ("kakaopay", "naverpay", "transfer", "tosspay"):
            assert self.mapping.get(method) == "toss", method

    def test_card_routes_to_stripe(self):
        assert self.mapping.get("card") == "stripe"

    def test_no_method_routes_to_removed_v2(self):
        # PG 값은 'toss'/'stripe' 만 — endpoint 이름이 섞여 들어가지 않았는지
        assert set(self.mapping.values()) <= {"toss", "stripe"}


# ═══════════════════════════════════════════════════════════════
# §3 confirm 함수 — 구독 분기에 users tier 동기화 병합 보존
# ═══════════════════════════════════════════════════════════════

def _confirm_subscription_branch(src: str):
    """`} else if (product.type === 'subscription') { ... }` 본문 추출."""
    m = re.search(
        r"else if \(product\.type === 'subscription'\)\s*\{(.*?)\n\s*\}\s*\n",
        src,
        re.DOTALL,
    )
    return m.group(1) if m else None


class TestConfirmSubscriptionMerge:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(CONFIRM_TS)

    def test_subscription_branch_exists(self):
        assert _confirm_subscription_branch(self.src) is not None

    def test_subscription_grants_entitlement(self):
        branch = _confirm_subscription_branch(self.src)
        assert "from('entitlements')" in branch
        assert "type: 'subscription'" in branch

    def test_subscription_updates_users_tier(self):
        """v2 에서 병합된 users.subscription_tier 갱신이 살아있어야 한다."""
        branch = _confirm_subscription_branch(self.src)
        assert "from('users')" in branch, "구독 confirm 시 users 테이블 갱신 누락(v2 병합 유실)"
        assert "subscription_tier: 'pro'" in branch
        assert "subscription_expires_at" in branch

    def test_confirm_only_uses_one_confirm_endpoint(self):
        """승인 함수가 토스 confirm API 를 정확히 1회만 호출 (중복 승인 경로 없음)."""
        assert self.src.count("/v1/payments/confirm") == 1


# ═══════════════════════════════════════════════════════════════
# §4 webhook 함수 — 취소 tier 초기화 + 갱신 이벤트 병합 보존
# ═══════════════════════════════════════════════════════════════

class TestWebhookMerge:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(WEBHOOK_TS)

    def test_hmac_constant_time_compare_present(self):
        """위변조 방지: 상수시간 HMAC-SHA256 비교가 존재 (v1 도 보유)."""
        assert "verifyTossSignature" in self.src
        assert "crypto.subtle.sign('HMAC'" in self.src
        # 상수시간 비교 패턴
        assert "mismatch |=" in self.src

    def test_cancel_resets_pro_tier(self):
        """pro_monthly 취소 시 users tier 초기화 병합 보존."""
        assert "subscription_tier: 'free'" in self.src
        assert "product_id === 'pro_monthly'" in self.src

    def test_billing_renewal_updates_tier_and_emits_event(self):
        """빌링 갱신 시 users 갱신 + subscription_renewed 이벤트 병합 보존."""
        assert "subscription_renewed" in self.src
        assert "subscription_tier: 'pro'" in self.src

    def test_handles_core_event_types(self):
        for ev in ("PAYMENT_STATUS_CHANGED", "BILLING_PAYMENT_DONE"):
            assert ev in self.src, ev

    def test_billing_key_table_not_referenced(self):
        """billing_keys 테이블은 마이그레이션에 부재 → webhook 이 참조하면 런타임 실패."""
        assert "from('billing_keys')" not in self.src, (
            "billing_keys 테이블 참조 — 마이그레이션 부재로 실패함 (v2 핸들러 병합 제외 대상)"
        )


# ═══════════════════════════════════════════════════════════════
# §5 뮤테이션 입증 (변경 민감성) — 병합 로직 제거 시 단언이 깨진다
# ═══════════════════════════════════════════════════════════════

class TestMutationProof:
    def test_confirm_tier_merge_mutation_is_caught(self):
        src = _read(CONFIRM_TS)
        # 정상: 구독 분기에 users tier 갱신 존재
        branch = _confirm_subscription_branch(src)
        assert "subscription_tier: 'pro'" in branch
        # 옛 v1 으로 되돌림(users 갱신 삭제) 재현
        mutated = re.sub(
            r"\n\s*// users 테이블 tier 갱신.*?\.eq\('id', user\.id\)\n",
            "\n",
            src,
            count=1,
            flags=re.DOTALL,
        )
        assert mutated != src, "mutation no-op: confirm users-tier 병합 블록 미발견"
        mutated_branch = _confirm_subscription_branch(mutated)
        with pytest.raises(AssertionError):
            assert "subscription_tier: 'pro'" in mutated_branch

    def test_webhook_renewal_event_mutation_is_caught(self):
        src = _read(WEBHOOK_TS)
        assert "subscription_renewed" in src
        mutated = src.replace("subscription_renewed", "renamed_event", 1)
        assert mutated != src
        with pytest.raises(AssertionError):
            assert "subscription_renewed" in mutated
