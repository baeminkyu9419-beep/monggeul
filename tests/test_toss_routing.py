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
        """v2 에서 병합된 users.subscription_tier 갱신이 살아있어야 한다.
        Fix(2026-06-15): 하드코딩 'pro' → 동적 entitlementKey(plus/premium) 로 변경됨.
        """
        branch = _confirm_subscription_branch(self.src)
        assert "from('users')" in branch, "구독 confirm 시 users 테이블 갱신 누락(v2 병합 유실)"
        # 동적 tier 결정: entitlementKey 변수 + subscription_tier 필드 모두 존재해야 함
        assert "entitlementKey" in branch, "동적 tier 변수(entitlementKey) 누락"
        assert "subscription_tier" in branch, "subscription_tier 갱신 필드 누락"
        assert "subscription_expires_at" in branch

    def test_confirm_only_uses_one_confirm_endpoint(self):
        """승인 함수가 토스 confirm API 를 정확히 1회만 호출 (중복 승인 경로 없음)."""
        assert self.src.count("/v1/payments/confirm") == 1


# ═══════════════════════════════════════════════════════════════
# §3.5 confirm 멱등성 — 동시요청 TOCTOU 로 1결제 N배 크레딧 방지
# ═══════════════════════════════════════════════════════════════

def _confirm_done_prefix(src: str) -> str:
    """toss-confirm 의 DONE 분기에서 entitlements 첫 부여 직전까지(= claim 구간)."""
    done_idx = src.index("tossData.status === 'DONE'")
    insert_idx = src.index("from('entitlements')", done_idx)
    return src[done_idx:insert_idx]


class TestConfirmIdempotencyClaim:
    """toss-confirm 은 동기 client-redirect 승인 경로(payment.js 직접 호출)다.
    동일 (orderId) 로 confirm 이 동시 2회 들어오면 entitlement 가 2번 부여돼
    1결제 N배 크레딧이 된다. webhook(billing_events) dedup 과 별개 경로이므로
    DONE 분기는 entitlement 부여 전 payments status='pending' compare-and-swap 으로
    원자적 claim 하고, claim 실패(rowCount=0) 시 재부여 없이 조기 반환해야 한다.
    """

    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(CONFIRM_TS)
        self.prefix = _confirm_done_prefix(self.src)

    def test_done_branch_has_compare_and_swap_claim(self):
        """entitlement 부여 전 status='pending' CAS UPDATE 가 존재."""
        assert ".eq('status', 'pending')" in self.prefix, (
            "toss-confirm DONE 분기에 status='pending' compare-and-swap claim 누락 "
            "→ 동시요청 멱등성 미보장(1결제 N배 적립)"
        )
        assert ".select('id')" in self.prefix, (
            "CAS UPDATE 가 영향 행을 반환(.select)하지 않으면 rowCount 판정 불가"
        )

    def test_claim_failure_returns_duplicate_without_regrant(self):
        """claim 실패(rowCount=0) → entitlement 재부여 없이 200 + duplicate:true."""
        assert "length === 0" in self.prefix, "rowCount=0 가드 누락"
        assert "duplicate: true" in self.prefix, (
            "중복 confirm 응답이 duplicate:true 규약(stripe/toss-webhook 동일) 미준수"
        )

    def test_claim_failure_is_fail_closed(self):
        """claim UPDATE 자체 오류 시 적립 없이 500 (fail-closed, 이중 적립 금지)."""
        assert "claimError" in self.prefix
        assert "status: 500" in self.prefix

    def test_claim_precedes_entitlement_grant(self):
        """CAS claim 이 entitlements 부여보다 코드상 앞(선기록)."""
        idx_claim = self.src.index(".eq('status', 'pending')", self.src.index("tossData.status === 'DONE'"))
        idx_grant = self.src.index("from('entitlements')")
        assert idx_claim < idx_grant, "claim 이 entitlement 부여보다 뒤 — 멱등 보장 실패"

    def test_mutation_removing_claim_is_caught(self):
        """뮤테이션: CAS claim(.eq('status','pending')+가드)을 plain update 로 되돌리면
        본 클래스 단언이 반드시 FAIL — 게이트 부재 검출."""
        mutated = re.sub(
            r"      // \[멱등성\] 원자적 claim.*?// 상품 정보 조회",
            "      // 결제 성공 → DB 업데이트\n"
            "      await supabaseAdmin.from('payments').update({\n"
            "        status: 'confirmed',\n"
            "      }).eq('id', payment.id)\n\n"
            "      // 상품 정보 조회",
            self.src,
            count=1,
            flags=re.DOTALL,
        )
        assert mutated != self.src, "mutation no-op: claim 블록 미발견"
        mutated_prefix = _confirm_done_prefix(mutated)
        assert ".eq('status', 'pending')" not in mutated_prefix
        assert "duplicate: true" not in mutated_prefix


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
        """구독 취소 시 users tier 초기화 병합 보존.
        Fix(2026-06-15): 단일 'pro_monthly' → 다중 플랜 includes([...]) 로 확장됨.
        """
        assert "subscription_tier: 'free'" in self.src
        # 다중 플랜 취소: includes(['pro_monthly', 'plus_monthly', 'premium_monthly'])
        assert "pro_monthly" in self.src, "pro_monthly 플랜 취소 처리 누락"
        assert "plus_monthly" in self.src, "plus_monthly 플랜 취소 처리 누락"
        assert "premium_monthly" in self.src, "premium_monthly 플랜 취소 처리 누락"

    def test_billing_renewal_updates_tier_and_emits_event(self):
        """빌링 갱신 시 users 갱신 + subscription_renewed 이벤트 병합 보존.
        Fix(2026-06-15): 하드코딩 'pro' → 동적 renewedTier(plus/premium) 로 변경됨.
        """
        assert "subscription_renewed" in self.src
        # 동적 tier: renewedTier 변수 + subscription_tier 필드
        assert "renewedTier" in self.src, "동적 갱신 tier 변수(renewedTier) 누락"
        assert "subscription_tier" in self.src

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
        # 정상: 구독 분기에 users tier 갱신 존재 (동적 entitlementKey 방식)
        branch = _confirm_subscription_branch(src)
        assert "entitlementKey" in branch, "동적 tier 변수(entitlementKey) 누락"
        assert "subscription_tier" in branch, "subscription_tier 갱신 필드 누락"
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
            assert "entitlementKey" in mutated_branch

    def test_webhook_renewal_event_mutation_is_caught(self):
        src = _read(WEBHOOK_TS)
        assert "subscription_renewed" in src
        mutated = src.replace("subscription_renewed", "renamed_event", 1)
        assert mutated != src
        with pytest.raises(AssertionError):
            assert "subscription_renewed" in mutated
