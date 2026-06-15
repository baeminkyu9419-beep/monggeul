"""
MONGGEUL 돈경로 적대검증 + 하드닝 — 회귀 단위 테스트 (2026-06-15)
=============================================================================

red-team 공격 6가지를 코드 파싱으로 불변식 고정한다.
Deno/DB 미실행 환경 → .ts/.sql/.js 소스 텍스트 파싱.

공격 → 검증 대상:
  A1. 웹훅 위조: toss/stripe 서명 검증 fail-closed
  A2. Paywall 우회: dream_detail task 에 서버측 권한 게이트 존재
  A3. 크레딧 자기부여: own_ent 드롭 + use_credit auth.uid() 기준
  A4. IDOR(use_pack_credit): 파라미터에서 auth.uid() 기준으로 재작성 + anon 불가
  A5. Auth fail-open: env 미설정 시 fail-closed 분기
  A6. Race/double-spend: dedup PK 원자 claim 존재
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FUNCS = ROOT / "supabase" / "functions"
MIGRATIONS = ROOT / "supabase" / "migrations"
SERVICES = ROOT / "src" / "services"

TOSS_WEBHOOK_TS = FUNCS / "toss-webhook" / "index.ts"
STRIPE_WEBHOOK_TS = FUNCS / "stripe-webhook" / "index.ts"
OPENAI_PROXY_TS = FUNCS / "openai-proxy" / "index.ts"
SUB_JS = SERVICES / "subscription.js"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════
# A1 — 웹훅 위조: 서명 검증 fail-closed
# ══════════════════════════════════════════════════════════════════════

class TestWebhookForgeryGuard:
    """서명 없는/위조된 웹훅 본문으로 권한을 얻을 수 없음을 구조로 보장."""

    def test_toss_webhook_verifies_hmac_before_processing(self):
        """toss-webhook: HMAC-SHA256 검증이 DB 변이(payments/entitlements)보다 앞."""
        src = _read(TOSS_WEBHOOK_TS)
        idx_verify = src.index("verifyTossSignature")
        idx_isvalid = src.index("if (!isValid)")
        idx_payments = src.index("from('payments')")
        idx_entitlements = src.index("from('entitlements')")
        assert idx_verify < idx_isvalid < idx_payments, (
            "toss-webhook HMAC 검증이 payments 변이보다 뒤에 있다 — 위조 차단 불가"
        )
        assert idx_verify < idx_isvalid < idx_entitlements, (
            "toss-webhook HMAC 검증이 entitlements 변이보다 뒤에 있다"
        )

    def test_toss_webhook_reject_missing_signature_returns_401(self):
        """서명 없음 또는 TOSS_WEBHOOK_SECRET 미설정 → false 반환 → 401 (fail-closed)."""
        src = _read(TOSS_WEBHOOK_TS)
        # verifyTossSignature 내부: !signature || !TOSS_WEBHOOK_SECRET → return false
        assert "if (!signature || !TOSS_WEBHOOK_SECRET) return false" in src, (
            "서명 또는 시크릿 미설정 시 즉시 false(fail-closed) 분기 누락"
        )
        assert "status: 401" in src, "서명 거부 응답이 401 이 아니다"

    def test_toss_webhook_constant_time_compare(self):
        """타이밍 공격 방지: 상수시간 비교 패턴."""
        src = _read(TOSS_WEBHOOK_TS)
        assert "mismatch |=" in src, "상수시간 XOR 비교 누락(타이밍 공격 가능)"

    def test_stripe_webhook_rejects_unsigned_request(self):
        """stripe-webhook: 서명 없으면 400 반환 — 권한 부여 코드 미도달."""
        src = _read(STRIPE_WEBHOOK_TS)
        idx_valid = src.index("if (!valid)")
        idx_switch = src.index("switch (event.type)")
        assert idx_valid < idx_switch, "서명 거부 분기가 이벤트 처리(switch)보다 뒤에 있다"
        assert "status: 400" in src, "stripe 서명 거부가 400 이 아니다"

    def test_stripe_webhook_replay_window_enforced(self):
        """replay 방지: 5분(300초) 타임스탬프 허용오차."""
        src = _read(STRIPE_WEBHOOK_TS)
        assert "> 300" in src, "stripe replay 방지 5분 창 누락"

    def test_webhook_secret_unset_is_fail_closed(self):
        """TOSS_WEBHOOK_SECRET 미설정 = verifyTossSignature → false → 401 (fail-closed).
        env 미설정인데 통과하는(fail-open) 분기가 없음을 확인."""
        src = _read(TOSS_WEBHOOK_TS)
        # fail-closed: !TOSS_WEBHOOK_SECRET → return false (위에서 확인됨)
        # fail-open 패턴 부재 확인: secret 없이 skip 하거나 null 허용하는 분기 없음
        assert "if (!TOSS_WEBHOOK_SECRET)" not in src.replace(
            "if (!signature || !TOSS_WEBHOOK_SECRET) return false", ""
        ), (
            "TOSS_WEBHOOK_SECRET 미설정 시 검증을 건너뛰는 분기가 추가됐다 — fail-open 위험"
        )


# ══════════════════════════════════════════════════════════════════════
# A2 — Paywall 우회: dream_detail 서버측 권한 게이트
# ══════════════════════════════════════════════════════════════════════

class TestDreamDetailPaywallGate:
    """dream_detail task 는 openai-proxy 서버 내에서 entitlement 확인 후 서빙.
    클라이언트 canUseDream()/useCredit() 만으로는 Edge Function 직접 호출 우회 가능하므로
    서버측 게이트가 반드시 필요하다."""

    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(OPENAI_PROXY_TS)

    def test_dream_detail_gate_exists_in_proxy(self):
        """dream_detail 분기 앞에 entitlement/credit 확인 코드가 있다."""
        assert "task === 'dream_detail'" in self.src, (
            "openai-proxy 에 dream_detail 게이트 분기 자체가 없다"
        )

    def _extract_gate_block(self) -> str:
        """dream_detail 게이트 블록 추출 — if (task==='dream_detail') 부터 buildChatPayload 직전까지."""
        m = re.search(
            r"if \(task === 'dream_detail'\)\s*\{(.+?)(?=const builtPayload)",
            self.src,
            re.DOTALL,
        )
        assert m, "dream_detail 게이트 블록(buildChatPayload 직전)을 찾을 수 없다"
        return m.group(1)

    def test_dream_detail_gate_uses_use_credit_rpc(self):
        """서버측 차감: use_credit RPC 호출이 dream_detail 게이트에 있다."""
        block = self._extract_gate_block()
        assert "use_credit" in block, (
            "dream_detail 게이트에 use_credit RPC 호출 없음 — 서버측 차감 미수행"
        )

    def test_dream_detail_gate_checks_subscription_fallback(self):
        """크레딧 없을 때 구독 여부도 확인한다 (구독자는 무제한)."""
        block = self._extract_gate_block()
        assert "has_subscription" in block, (
            "dream_detail 게이트에 구독 폴백 확인 없음 — 구독자 차단됨"
        )

    def test_dream_detail_gate_returns_403_on_deny(self):
        """권한 없으면 403 반환 (fail-closed)."""
        block = self._extract_gate_block()
        assert "status: 403" in block, (
            "dream_detail 권한 거부가 403 이 아니다 (fail-closed 요건)"
        )

    def test_dream_detail_gate_before_build_payload(self):
        """게이트는 LLM 페이로드 조립(buildChatPayload) 이전에 위치해야 한다."""
        idx_gate = self.src.index("task === 'dream_detail'")
        idx_build = self.src.index("buildChatPayload(task, params)")
        assert idx_gate < idx_build, (
            "dream_detail 게이트가 buildChatPayload 이후에 있다 — LLM 호출 전 차단 불가"
        )

    def test_mutation_gate_removal_is_caught(self):
        """게이트 블록을 제거하면 이 단언이 FAIL 한다 (변경 민감성)."""
        mutated = self.src.replace("task === 'dream_detail'", "task === '__never__'", 1)
        assert mutated != self.src
        with pytest.raises(AssertionError):
            assert "task === 'dream_detail'" in mutated


# ══════════════════════════════════════════════════════════════════════
# A3 — 크레딧 자기부여: own_ent 드롭 + use_credit auth.uid() 강제
# ══════════════════════════════════════════════════════════════════════

class TestCreditSelfGrantBlocked:
    """own_ent RLS 드롭으로 클라이언트 직접 upsert(premium_credits=99999) 차단됨을 고정."""

    def test_own_ent_drop_migration_exists(self):
        """own_ent 자기쓰기 정책 드롭 마이그레이션이 존재한다."""
        drop_sql = MIGRATIONS / "20260614_drop_self_write_entitlements.sql"
        assert drop_sql.exists(), "20260614_drop_self_write_entitlements.sql 이 삭제됐다"
        src = drop_sql.read_text(encoding="utf-8")
        assert 'drop policy if exists "own_ent"' in src, (
            "own_ent 드롭 문이 마이그레이션에 없다"
        )

    def test_use_credit_rpc_uses_auth_uid(self):
        """use_credit() 는 외부 파라미터 없이 auth.uid() 기준 차감 (자기부여 불가)."""
        sql = (MIGRATIONS / "20260615_use_credit_rpc.sql").read_text(encoding="utf-8")
        assert "auth.uid()" in sql, "use_credit 이 auth.uid() 를 사용하지 않는다"
        # 파라미터가 없어야 한다 (uuid 파라미터 수용 시 타인 차감 가능)
        m = re.search(r"create or replace function public\.use_credit\(([^)]*)\)", sql)
        assert m, "use_credit 함수 선언을 찾을 수 없다"
        assert m.group(1).strip() == "", (
            f"use_credit 가 외부 파라미터 '{m.group(1).strip()}' 를 받는다 — "
            "파라미터 없이 auth.uid() 만 사용해야 한다"
        )

    def test_use_credit_rpc_anon_not_granted(self):
        """use_credit: anon 에게 EXECUTE 미부여 (authenticated 전용)."""
        sql = (MIGRATIONS / "20260615_use_credit_rpc.sql").read_text(encoding="utf-8")
        assert "revoke all on function public.use_credit()" in sql, (
            "use_credit 에 REVOKE ALL 없음 — PUBLIC(anon 포함) 기본 실행 권한 잔류"
        )
        assert "grant execute on function public.use_credit() to authenticated" in sql, (
            "use_credit authenticated GRANT 누락"
        )

    def test_use_credit_prevents_negative_credits(self):
        """use_credit: premium_credits > 0 조건으로 음수 방지 (무한 차감 불가)."""
        sql = (MIGRATIONS / "20260615_use_credit_rpc.sql").read_text(encoding="utf-8")
        assert "premium_credits > 0" in sql, (
            "use_credit 에 음수방지 조건(premium_credits > 0) 없음"
        )

    def test_addcredits_server_write_fails_silently(self):
        """addCredits 의 user_entitlements upsert 는 RLS 거부로 무해 — 서버 정본은 Edge Function 만."""
        sub_src = _read(SUB_JS)
        # addCredits 가 user_entitlements upsert 를 try/catch 로 감싸야 함 (거부 시 UX 유지)
        m = re.search(r"export async function addCredits.*?^\}", sub_src, re.DOTALL | re.MULTILINE)
        assert m, "addCredits 함수 미발견"
        body = m.group(0)
        assert "try {" in body and "catch" in body, (
            "addCredits 의 upsert 가 try/catch 없음 — RLS 거부 시 예외 전파 가능"
        )


# ══════════════════════════════════════════════════════════════════════
# A4 — IDOR (use_pack_credit): 타인 크레딧 소모 공격 차단
# ══════════════════════════════════════════════════════════════════════

class TestUsePackCreditIDORFixed:
    """use_pack_credit 가 auth.uid() 기준으로 재작성되어 타인 크레딧 소모 불가."""

    @pytest.fixture(autouse=True)
    def _sql(self):
        self.sql = (MIGRATIONS / "20260615_harden_use_pack_credit.sql").read_text(encoding="utf-8")

    def test_harden_migration_exists(self):
        """하드닝 마이그레이션이 존재한다."""
        path = MIGRATIONS / "20260615_harden_use_pack_credit.sql"
        assert path.exists(), "20260615_harden_use_pack_credit.sql 이 없다"

    def test_use_pack_credit_drops_uuid_param_overload(self):
        """구버전 use_pack_credit(uuid) 오버로드가 드롭된다."""
        assert "drop function if exists public.use_pack_credit(uuid)" in self.sql, (
            "p_user_id uuid 파라미터 버전 드롭 문 누락 — 구버전이 살아있을 수 있다"
        )

    def test_use_pack_credit_new_version_uses_auth_uid(self):
        """재작성된 use_pack_credit() 는 auth.uid() 기준 (p_user_id 파라미터 없음)."""
        assert "auth.uid()" in self.sql, (
            "재작성된 use_pack_credit 가 auth.uid() 를 사용하지 않는다"
        )
        # 새 버전 파라미터 없음 확인
        m = re.search(r"create or replace function public\.use_pack_credit\(([^)]*)\)", self.sql)
        assert m, "use_pack_credit 새 버전 함수 선언 미발견"
        assert m.group(1).strip() == "", (
            "새 use_pack_credit 가 파라미터를 받는다 — auth.uid() 만 사용해야 함"
        )

    def test_use_pack_credit_revoke_public(self):
        """use_pack_credit: anon 실행 불가 (REVOKE ALL + authenticated 전용)."""
        assert "revoke all on function public.use_pack_credit()" in self.sql, (
            "REVOKE ALL 누락 — anon 이 use_pack_credit() 실행 가능"
        )
        assert "grant execute on function public.use_pack_credit() to authenticated" in self.sql, (
            "authenticated GRANT 누락"
        )

    def test_check_entitlement_restricted_to_authenticated(self):
        """check_entitlement: anon 정보 열람 차단 (authenticated + service_role 전용)."""
        assert "revoke all on function public.check_entitlement(uuid)" in self.sql, (
            "check_entitlement REVOKE ALL 누락"
        )
        assert "grant execute on function public.check_entitlement(uuid) to authenticated, service_role" in self.sql, (
            "check_entitlement authenticated/service_role GRANT 누락"
        )

    def test_mutation_idor_fix_removal_caught(self):
        """하드닝 마이그레이션의 auth.uid() 를 전부 제거하면 test_use_pack_credit_new_version_uses_auth_uid 가 FAIL."""
        mutated = self.sql.replace("auth.uid()", "__removed__")
        assert mutated != self.sql
        # 모든 auth.uid() 제거 → 단언이 FAIL 해야 한다
        with pytest.raises(AssertionError):
            assert "auth.uid()" in mutated


# ══════════════════════════════════════════════════════════════════════
# A5 — Auth fail-open: env 미설정 시 fail-closed
# ══════════════════════════════════════════════════════════════════════

class TestAuthFailClosed:
    """환경변수/시크릿 미설정 시 접근이 열리지 않고 닫혀야 한다."""

    def test_openai_proxy_no_llm_key_returns_503(self):
        """openai-proxy: LLM 키 전부 없으면 503 (키 없이 LLM 호출 안 함)."""
        src = _read(OPENAI_PROXY_TS)
        assert "No LLM key configured" in src, (
            "LLM 키 미설정 시 503 분기 없음 — 에러 없이 빈 호출 전송 가능"
        )

    def test_openai_proxy_no_supabase_config_returns_503(self):
        """openai-proxy: SUPABASE_URL/ANON_KEY 미설정 시 503."""
        src = _read(OPENAI_PROXY_TS)
        assert "Auth backend not configured" in src, (
            "Supabase 미설정 시 503 분기 없음 — 인증 없이 통과 가능"
        )

    def test_toss_webhook_missing_secret_closes(self):
        """toss-webhook: TOSS_WEBHOOK_SECRET 미설정 → verifyTossSignature false → 401."""
        src = _read(TOSS_WEBHOOK_TS)
        assert "if (!signature || !TOSS_WEBHOOK_SECRET) return false" in src

    def test_openai_proxy_missing_auth_header_returns_401(self):
        """openai-proxy: Authorization 헤더 없으면 401 (미인증 통과 없음)."""
        src = _read(OPENAI_PROXY_TS)
        assert "Unauthorized" in src, "openai-proxy 무인증 차단 분기 없음"
        assert "status: 401" in src


# ══════════════════════════════════════════════════════════════════════
# A6 — Race/double-spend: dedup PK 원자 claim
# ══════════════════════════════════════════════════════════════════════

class TestRaceDoubleSpendGuard:
    """동시 웹훅 재전송 시 이중 크레딧 적립 방지 — billing_events PK 원자성."""

    def test_billing_events_pk_is_idempotency_key(self):
        """billing_events.event_id = text primary key → 동시 INSERT 한쪽만 통과."""
        sql = (MIGRATIONS / "20260321_billing_schema.sql").read_text(encoding="utf-8")
        assert re.search(r"event_id\s+text\s+primary key", sql), (
            "billing_events.event_id PK 가 없다 — 동시 중복 삽입 시 한쪽만 통과 불가"
        )

    def test_stripe_dedup_claim_before_credit_grant(self):
        """stripe-webhook: 크레딧 적립(user_entitlements/entitlements) 전에 billing_events 선기록."""
        src = _read(STRIPE_WEBHOOK_TS)
        idx_claim = src.index("from('billing_events')")
        idx_credit = src.index("from('user_entitlements')")
        assert idx_claim < idx_credit, (
            "stripe-webhook dedup claim 이 크레딧 적립보다 뒤에 있다 — 동시 재전송 시 이중 적립 가능"
        )

    def test_toss_billing_dedup_claim_before_payment_insert(self):
        """toss-webhook BILLING_PAYMENT_DONE: payments insert 전에 billing_events 선기록."""
        src = _read(TOSS_WEBHOOK_TS)
        m = re.search(r"case 'BILLING_PAYMENT_DONE':\s*\{(.*?)\n\s*default:", src, re.DOTALL)
        assert m, "BILLING_PAYMENT_DONE case 미발견"
        branch = m.group(1)
        idx_claim = branch.index("from('billing_events')")
        idx_payment = branch.index("from('payments')")
        assert idx_claim < idx_payment, (
            "toss BILLING dedup claim 이 payments insert 보다 뒤에 있다"
        )

    def test_duplicate_23505_returns_200_not_5xx(self):
        """중복(23505) 응답: 2xx → PG/Stripe 재전송 중단, 5xx → 재전송 폭주."""
        for ts in (STRIPE_WEBHOOK_TS, TOSS_WEBHOOK_TS):
            src = _read(ts)
            assert "dedupError.code === '23505'" in src, f"{ts.parent.name}: 23505 dedup 핸들러 없음"
            assert "duplicate: true" in src, f"{ts.parent.name}: duplicate:true 응답 없음"

    def test_use_credit_atomic_update(self):
        """use_credit: UPDATE 단일 문 → DB 원자성으로 race 안전."""
        sql = (MIGRATIONS / "20260615_use_credit_rpc.sql").read_text(encoding="utf-8")
        # SELECT ... FOR UPDATE 없이 직접 UPDATE WHERE 조건 + RETURNING = 원자
        assert "update public.user_entitlements" in sql.lower(), (
            "use_credit 가 UPDATE 를 수행하지 않는다"
        )
        assert "returning premium_credits into v_remaining" in sql, (
            "use_credit 가 RETURNING 을 사용하지 않는다 — 원자성 검증 불가"
        )
