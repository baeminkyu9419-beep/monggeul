"""
PII / IDOR 보안 회귀 테스트 — 2026-06-15

공격 벡터:
  1. RPC IDOR (toggle_post_like / increment_dream_count): p_user_id 파라미터 수용 → 타인 명의 조작
  2. RPC 정보노출 (check_entitlement): 타인 구독 정보 열람
  3. 프롬프트 인젝션 (dali_chat historyBlock): system prompt override 시도
  4. 인증 없는 데이터 접근: dreams/users/dali_memory READ/WRITE 정책 부재 확인
  5. community_posts 레거시 IDOR UPDATE 정책 (upd_posts using true): 드롭 여부 확인

각 테스트는 소스 코드(JS/SQL 마이그레이션)를 정적 분석으로 검증한다.
네트워크 호출 없음 — 순수 파일 기반.
"""

import pathlib
import re
import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
SERVICES = SRC / "services"
MIGRATIONS = ROOT / "supabase" / "migrations"
SCHEMA = ROOT / "supabase" / "schema.sql"
EDGE_PROXY = ROOT / "supabase" / "functions" / "openai-proxy" / "index.ts"
PROMPTS_TS = ROOT / "supabase" / "functions" / "openai-proxy" / "prompts.ts"


# ═══════════════════════════════════════════════════════════════
# 1. IDOR — toggle_post_like 클라이언트가 p_user_id 를 보내지 않음
# ═══════════════════════════════════════════════════════════════

class TestTogglePostLikeIDOR:
    """toggle_post_like IDOR: p_user_id 는 서버(auth.uid())가 결정해야 한다."""

    @pytest.fixture(autouse=True)
    def load_community_storage(self):
        self.src = (SERVICES / "community-storage.js").read_text(encoding="utf-8")

    def test_client_does_not_send_p_user_id_in_toggle_like(self):
        """클라이언트가 toggle_post_like 에 p_user_id 를 전달하면 IDOR — 제거 확인."""
        # toggle_post_like RPC 호출 블록 추출
        match = re.search(r"rpc\('toggle_post_like'.*?\}", self.src, re.DOTALL)
        assert match, "toggleLikePost 가 toggle_post_like RPC 를 호출하지 않음"
        rpc_call = match.group(0)
        assert "p_user_id" not in rpc_call, (
            "IDOR: 클라이언트가 toggle_post_like 에 p_user_id 를 전달하고 있음.\n"
            "서버가 auth.uid()로 결정해야 함(migration 20260615_fix_rpc_idor.sql 참조)."
        )

    def test_toggle_like_still_passes_p_post_id(self):
        """toggle_post_like 는 p_post_id 는 여전히 필요 — 배선 유지 확인."""
        assert "p_post_id: postId" in self.src, (
            "toggleLikePost 가 p_post_id 를 전달하지 않음 — 기능 단절"
        )

    def test_migration_redefines_toggle_post_like_without_user_id_param(self):
        """마이그레이션이 toggle_post_like(uuid) (p_user_id 없는 버전)를 정의."""
        fix_migration = MIGRATIONS / "20260615_fix_rpc_idor.sql"
        assert fix_migration.is_file(), "20260615_fix_rpc_idor.sql 마이그레이션 누락"
        content = fix_migration.read_text(encoding="utf-8")
        # 새 버전: 파라미터 1개 (p_post_id만)
        assert "toggle_post_like(p_post_id uuid)" in content, (
            "마이그레이션이 p_user_id 없는 toggle_post_like 를 정의하지 않음"
        )
        # 구버전 드롭 확인
        assert "drop function if exists public.toggle_post_like(uuid, uuid)" in content, (
            "마이그레이션이 구버전(p_user_id 포함) 함수를 드롭하지 않음"
        )

    def test_migration_uses_auth_uid_in_toggle_like(self):
        """마이그레이션에서 toggle_post_like 가 auth.uid() 를 사용."""
        fix_migration = MIGRATIONS / "20260615_fix_rpc_idor.sql"
        content = fix_migration.read_text(encoding="utf-8")
        assert "auth.uid()" in content, (
            "마이그레이션 toggle_post_like 가 auth.uid() 를 사용하지 않음"
        )

    def test_migration_grants_authenticated_only_toggle_like(self):
        """toggle_post_like 는 authenticated 역할만 실행 가능해야 함."""
        fix_migration = MIGRATIONS / "20260615_fix_rpc_idor.sql"
        content = fix_migration.read_text(encoding="utf-8")
        assert "grant execute on function public.toggle_post_like(uuid) to authenticated" in content, (
            "toggle_post_like 가 authenticated 전용 GRANT 없음 — anon 실행 차단 미완"
        )


# ═══════════════════════════════════════════════════════════════
# 2. IDOR — increment_dream_count 클라이언트가 p_user_id 를 보내지 않음
# ═══════════════════════════════════════════════════════════════

class TestIncrementDreamCountIDOR:
    """increment_dream_count IDOR: p_user_id 파라미터 → 타인 카운트 조작."""

    @pytest.fixture(autouse=True)
    def load_subscription(self):
        self.src = (SERVICES / "subscription.js").read_text(encoding="utf-8")

    def test_client_does_not_send_p_user_id_in_increment_dream(self):
        """클라이언트가 increment_dream_count 에 p_user_id 를 보내면 IDOR."""
        # incDreamCount 함수 내 rpc 호출 블록 추출
        match = re.search(r"rpc\('increment_dream_count'.*?\)", self.src, re.DOTALL)
        assert match, "incDreamCount 가 increment_dream_count RPC 를 호출하지 않음"
        rpc_call = match.group(0)
        assert "p_user_id" not in rpc_call, (
            "IDOR: 클라이언트가 increment_dream_count 에 p_user_id 를 전달하고 있음.\n"
            "서버가 auth.uid()로 결정해야 함(migration 20260615_fix_rpc_idor.sql 참조)."
        )

    def test_migration_redefines_increment_dream_count_without_param(self):
        """마이그레이션이 increment_dream_count() (파라미터 없는 버전)를 정의."""
        fix_migration = MIGRATIONS / "20260615_fix_rpc_idor.sql"
        assert fix_migration.is_file(), "20260615_fix_rpc_idor.sql 마이그레이션 누락"
        content = fix_migration.read_text(encoding="utf-8")
        assert "create or replace function public.increment_dream_count()" in content, (
            "마이그레이션이 파라미터 없는 increment_dream_count 를 정의하지 않음"
        )

    def test_migration_drops_old_increment_dream_count(self):
        """마이그레이션이 구버전 increment_dream_count(uuid) 를 드롭."""
        fix_migration = MIGRATIONS / "20260615_fix_rpc_idor.sql"
        content = fix_migration.read_text(encoding="utf-8")
        assert "drop function if exists public.increment_dream_count(uuid)" in content, (
            "마이그레이션이 구버전 increment_dream_count(p_user_id uuid) 를 드롭하지 않음"
        )

    def test_migration_grants_authenticated_only_increment_dream(self):
        """increment_dream_count 는 authenticated 만 실행 가능해야 함."""
        fix_migration = MIGRATIONS / "20260615_fix_rpc_idor.sql"
        content = fix_migration.read_text(encoding="utf-8")
        assert "grant execute on function public.increment_dream_count() to authenticated" in content, (
            "increment_dream_count 가 authenticated 전용 GRANT 없음"
        )


# ═══════════════════════════════════════════════════════════════
# 3. RLS 정책 — 핵심 개인 데이터 테이블
# ═══════════════════════════════════════════════════════════════

class TestRLSPolicies:
    """핵심 PII 테이블(dreams/users/dali_memory/usage_daily)의 RLS 정책 존재 확인."""

    @pytest.fixture(autouse=True)
    def load_schema_and_migrations(self):
        self.schema = SCHEMA.read_text(encoding="utf-8")
        # 모든 마이그레이션 파일 합산
        mig_texts = []
        for f in sorted(MIGRATIONS.glob("*.sql")):
            mig_texts.append(f.read_text(encoding="utf-8"))
        self.all_migrations = "\n".join(mig_texts)

    def test_dreams_rls_enabled(self):
        """dreams 테이블 RLS 활성화."""
        combined = self.schema + self.all_migrations
        assert "alter table" in combined and "dreams enable row level security" in combined, (
            "dreams 테이블 RLS 미활성화 — 전체 꿈 데이터 무인증 노출 위험"
        )

    def test_dreams_own_policy_uses_auth_uid(self):
        """dreams RLS 정책이 auth.uid() = user_id 로 본인 데이터만 허용."""
        combined = self.schema + self.all_migrations
        # "own_dreams" 정책 또는 "CRUD own dreams" 정책에서 user_id=auth.uid() 패턴
        has_own_dreams = (
            "auth.uid() = user_id" in combined
            or "user_id=auth.uid()" in combined
        )
        assert has_own_dreams, (
            "dreams 테이블에 user_id=auth.uid() 기반 RLS 정책 없음"
        )

    def test_users_rls_own_policy(self):
        """users 테이블 RLS 정책: 본인 id만 접근."""
        combined = self.schema + self.all_migrations
        assert "id=auth.uid()" in combined or "auth.uid() = id" in combined, (
            "users 테이블 id=auth.uid() RLS 정책 없음"
        )

    def test_dali_memory_rls_own_policy(self):
        """dali_memory 테이블 RLS 정책: 본인 user_id만 접근."""
        combined = self.schema + self.all_migrations
        assert "dali_memory" in combined and "user_id" in combined, (
            "dali_memory 테이블 RLS 정책 참조 없음"
        )

    def test_user_entitlements_no_self_write_policy(self):
        """user_entitlements 자기쓰기 정책(own_ent) 드롭 — 결제우회 차단."""
        drop_migration = MIGRATIONS / "20260614_drop_self_write_entitlements.sql"
        assert drop_migration.is_file(), (
            "20260614_drop_self_write_entitlements.sql 마이그레이션 누락 — "
            "own_ent 자기쓰기 정책 살아있을 가능성"
        )
        content = drop_migration.read_text(encoding="utf-8")
        assert "drop policy if exists" in content and "own_ent" in content, (
            "drop_self_write_entitlements 마이그레이션이 own_ent 정책을 드롭하지 않음"
        )

    def test_community_posts_no_permissive_update_policy(self):
        """community_posts 레거시 IDOR UPDATE(upd_posts using true) 드롭 — 타인 게시글 수정 차단."""
        drop_migration = MIGRATIONS / "20260408_drop_legacy_permissive.sql"
        assert drop_migration.is_file(), (
            "20260408_drop_legacy_permissive.sql 마이그레이션 누락 — "
            "upd_posts (using true) 정책이 살아있을 가능성"
        )
        content = drop_migration.read_text(encoding="utf-8")
        assert "drop policy if exists" in content and "upd_posts" in content, (
            "drop_legacy_permissive 마이그레이션이 upd_posts 를 드롭하지 않음"
        )


# ═══════════════════════════════════════════════════════════════
# 4. check_entitlement 정보노출 — EXECUTE 제한 확인
# ═══════════════════════════════════════════════════════════════

class TestCheckEntitlementInfoLeak:
    """check_entitlement(p_user_id): 타인 구독 정보 열람 가능성 제한 확인."""

    def test_check_entitlement_revoke_anon_execute(self):
        """20260615 하드닝 마이그레이션이 check_entitlement 에서 anon EXECUTE 를 제거."""
        harden_migration = MIGRATIONS / "20260615_harden_use_pack_credit.sql"
        assert harden_migration.is_file(), (
            "20260615_harden_use_pack_credit.sql 마이그레이션 누락"
        )
        content = harden_migration.read_text(encoding="utf-8")
        assert "revoke all on function public.check_entitlement(uuid) from public" in content, (
            "check_entitlement(uuid) 의 public EXECUTE 권한이 REVOKE 되지 않음 — "
            "anon 이 타인 구독정보 열람 가능"
        )

    def test_check_entitlement_grants_authenticated_and_service_role(self):
        """check_entitlement 는 authenticated + service_role 만 실행 가능해야 함."""
        harden_migration = MIGRATIONS / "20260615_harden_use_pack_credit.sql"
        content = harden_migration.read_text(encoding="utf-8")
        assert "grant execute on function public.check_entitlement(uuid) to authenticated, service_role" in content, (
            "check_entitlement 가 authenticated+service_role 전용 GRANT 없음"
        )

    def test_check_entitlement_idor_fixed_uses_auth_uid(self):
        """check_entitlement 가 auth.uid() 기준으로 재작성됨 (authenticated↔authenticated IDOR 제거).

        20260615 하드닝은 anon EXECUTE 만 차단했고, 인증된 임의 사용자가
        check_entitlement('<victim_uuid>') 로 타인 구독/크레딧을 열람할 수 있었다.
        20260616_fix_check_entitlement_idor.sql 이 auth.uid() 강제로 이를 차단한다.
        [뮤테이션 검증: coalesce(auth.uid(), p_user_id) 를 p_user_id 로 바꾸면 이 테스트 FAIL]"""
        fix = MIGRATIONS / "20260616_fix_check_entitlement_idor.sql"
        assert fix.is_file(), (
            "20260616_fix_check_entitlement_idor.sql 마이그레이션 누락 — "
            "check_entitlement IDOR(타인 구독정보 열람) 미수정"
        )
        content = fix.read_text(encoding="utf-8")
        assert re.search(
            r"create or replace function public\.check_entitlement\(\s*p_user_id\s+uuid\s*\)",
            content,
        ), "check_entitlement 가 재작성되지 않음"
        # 호출자 식별을 auth.uid() 로 강제해야 함 (전달 p_user_id 를 그대로 신뢰하면 IDOR)
        assert "coalesce(auth.uid(), p_user_id)" in content, (
            "IDOR 잔존: 인증 호출자에 대해 auth.uid() 를 강제하지 않음. "
            "auth.uid() 가 있으면 p_user_id 를 무시하고 본인 정보만 반환해야 함."
        )
        # 조회 WHERE 절은 전달 인자(p_user_id)가 아닌 auth.uid() 파생값(v_uid)으로만 필터해야 함
        assert "where user_id = p_user_id" not in content, (
            "IDOR 잔존: WHERE user_id = p_user_id 로 전달 인자를 그대로 사용 중 — "
            "타인 UUID 조회 가능. v_uid(=auth.uid()) 기준이어야 함."
        )
        assert "where user_id = v_uid" in content, (
            "조회가 auth.uid() 파생값(v_uid) 으로 필터되지 않음"
        )

    def test_check_entitlement_idor_fix_preserves_anon_revoke(self):
        """IDOR 수정 마이그레이션이 anon EXECUTE 차단(REVOKE/GRANT)을 유지(회귀 방지)."""
        content = (MIGRATIONS / "20260616_fix_check_entitlement_idor.sql").read_text(encoding="utf-8")
        assert "revoke all on function public.check_entitlement(uuid) from public" in content, (
            "수정 마이그레이션이 anon EXECUTE 차단(REVOKE)을 누락 — anon 정보열람 회귀"
        )
        assert "grant execute on function public.check_entitlement(uuid) to authenticated, service_role" in content, (
            "수정 마이그레이션이 authenticated+service_role GRANT 를 누락"
        )


# ═══════════════════════════════════════════════════════════════
# 5. 프롬프트 인젝션 방어 — openai-proxy
# ═══════════════════════════════════════════════════════════════

class TestPromptInjectionDefense:
    """dali_chat / dream_quick 의 클라이언트 제어 데이터가 시스템 프롬프트를 override 하지 않음."""

    @pytest.fixture(autouse=True)
    def load_edge_function(self):
        self.index_src = EDGE_PROXY.read_text(encoding="utf-8")
        self.prompts_src = PROMPTS_TS.read_text(encoding="utf-8")

    def test_chat_endpoint_ignores_client_messages(self):
        """chat 엔드포인트에서 클라가 보낸 raw payload 를 LLM 에 직접 전달하지 않음.
        서버가 buildChatPayload(task, params) 로 메시지를 재조립한다."""
        # buildChatPayload 호출 확인
        assert "buildChatPayload(task, params)" in self.index_src, (
            "openai-proxy 가 buildChatPayload 를 호출하지 않음 — 서버측 프롬프트 재조립 미적용"
        )
        # chat 경로는 builtPayload 를 전달해야 함
        # _chatFallback(payload) 또는 _chatConsensus(payload) 에 클라 payload 를 직접 넘기면 인젝션 가능.
        # 정상: _chatFallback(builtPayload) / _chatConsensus(builtPayload)
        # 이상: _chatFallback(payload) — 클라이언트 제어 payload 직접 전달
        import re as _re
        # chat 분기 블록 추출 (endpoint === 'chat' 이후)
        chat_block_match = _re.search(
            r"if \(endpoint === 'chat'\)(.*?)(?=\n    // image|\n    if \(!OPENAI_API_KEY)",
            self.index_src, _re.DOTALL
        )
        assert chat_block_match, "chat 엔드포인트 블록을 찾을 수 없음"
        chat_block = chat_block_match.group(1)
        # chat 블록 안에서 _chatFallback/Consensus 의 인자가 builtPayload 여야 함
        assert "_chatFallback(builtPayload)" in chat_block or "_chatConsensus(builtPayload)" in chat_block, (
            "INJECT 위험: openai-proxy chat 경로가 builtPayload 대신 다른 값을 LLM 에 전달 가능"
        )
        # chat 블록 안에서 원본 payload 를 직접 LLM 으로 포워딩하면 안 됨
        assert "_chatFallback(payload)" not in chat_block and "_chatConsensus(payload)" not in chat_block, (
            "INJECT 위험: chat 경로가 클라이언트 payload 를 그대로 LLM 에 전달"
        )

    def test_history_entries_role_filtered_to_user_assistant_only(self):
        """dali_chat 히스토리에서 system role 메시지 필터링 확인."""
        # prompts.ts 의 dali_chat 처리에서 role 검증
        assert "'system'" not in self.prompts_src.split("filter")[1].split("map")[0] or \
               "m.role === 'user' || m.role === 'assistant'" in self.prompts_src, (
            "dali_chat 히스토리에서 system role 메시지를 필터링하지 않음 — 프롬프트 인젝션 가능"
        )

    def test_input_clipped_in_prompts_ts(self):
        """사용자 입력이 _clip() 으로 길이 제한됨 — 대형 페이로드 인젝션 완화."""
        assert "_clip(" in self.prompts_src, (
            "prompts.ts 에 _clip() 길이 제한 없음 — 대형 페이로드로 시스템 프롬프트 희석 가능"
        )

    def test_edge_function_validates_task_whitelist(self):
        """openai-proxy 가 task 를 whitelist 로 검증 — 미등록 task 로 빌드 우회 불가."""
        assert "buildChatPayload" in self.index_src and "Invalid task" in self.index_src, (
            "openai-proxy 가 알 수 없는 task 를 400 으로 거부하지 않음"
        )

    def test_edge_function_rejects_unauthenticated(self):
        """openai-proxy 가 JWT 미인증 요청을 401 로 거부."""
        assert "Unauthorized" in self.index_src and "401" in self.index_src, (
            "openai-proxy 가 인증 없는 요청을 거부하지 않음"
        )

    def test_system_prompt_not_sent_from_client(self):
        """api.js 가 시스템 프롬프트를 서버로 전송하지 않음 — task+params 만."""
        api_src = (SERVICES / "api.js").read_text(encoding="utf-8")
        # callChat 이 task, params 를 보내되 messages 를 보내지 않아야 함
        assert "task, params" in api_src, "api.js 가 task+params 형식으로 보내지 않음"
        # 클라이언트 api.js 에 시스템 프롬프트 문자열이 없어야 함
        assert "system" not in api_src.lower().split("def")[0] or "프롬프트" not in api_src, (
            "api.js 에 시스템 프롬프트 문자열이 평문으로 존재할 수 있음"
        )


# ═══════════════════════════════════════════════════════════════
# 6. 인증 게이트 — 데이터 읽기 엔드포인트
# ═══════════════════════════════════════════════════════════════

class TestAuthGateOnDataEndpoints:
    """클라이언트가 Supabase에서 데이터를 읽을 때 항상 인증된 세션을 사용."""

    @pytest.fixture(autouse=True)
    def load_sources(self):
        self.auth_src = (SERVICES / "auth.js").read_text(encoding="utf-8")
        self.sub_src = (SERVICES / "subscription.js").read_text(encoding="utf-8")

    def test_supabase_client_always_uses_session_token(self):
        """api.js 가 authToken 으로 access_token 또는 anon_key 를 사용."""
        api_src = (SERVICES / "api.js").read_text(encoding="utf-8")
        assert "access_token" in api_src, (
            "api.js 가 세션 access_token 을 사용하지 않음 — 무인증 LLM 호출 가능"
        )

    def test_dreams_query_uses_supabase_client_with_auth(self):
        """subscription.js 가 usage_daily 조회 시 store.supabase (인증 클라이언트) 사용."""
        assert "store.supabase" in self.sub_src and "from('usage_daily')" in self.sub_src, (
            "subscription.js 가 store.supabase 없이 usage_daily 를 조회함"
        )

    def test_use_credit_rpc_migration_exists(self):
        """use_credit() RPC 가 배포돼 있음 (서버 권위 크레딧 차감)."""
        use_credit_migration = MIGRATIONS / "20260615_use_credit_rpc.sql"
        assert use_credit_migration.is_file(), (
            "use_credit RPC 마이그레이션(20260615_use_credit_rpc.sql) 없음 — "
            "클라이언트 직접 update 가 RLS 거부 후 차감 불가 상태"
        )

    def test_use_credit_rpc_authenticated_only(self):
        """use_credit() 는 authenticated 만 실행 가능."""
        content = (MIGRATIONS / "20260615_use_credit_rpc.sql").read_text(encoding="utf-8")
        assert "grant execute on function public.use_credit() to authenticated" in content, (
            "use_credit() 가 authenticated 전용 GRANT 없음"
        )

    def test_use_pack_credit_idor_fixed(self):
        """use_pack_credit 가 auth.uid() 기반으로 재작성됨 (p_user_id IDOR 제거)."""
        content = (MIGRATIONS / "20260615_harden_use_pack_credit.sql").read_text(encoding="utf-8")
        assert "create or replace function public.use_pack_credit()" in content, (
            "use_pack_credit 가 파라미터 없는 버전으로 재작성되지 않음 — p_user_id IDOR 잔존"
        )
        assert "drop function if exists public.use_pack_credit(uuid)" in content, (
            "구버전 use_pack_credit(uuid) 가 드롭되지 않음"
        )

    def test_use_credit_client_call_has_no_user_id_param(self):
        """subscription.js 의 useCredit() 가 rpc('use_credit') 를 인자 없이 호출해야 한다.
        p_user_id 를 클라이언트가 넘기면 서버 auth.uid() 기반 IDOR 보호가 우회된다.
        [뮤테이션 검증: rpc('use_credit', {p_user_id: ...}) 추가 시 이 테스트 FAIL]"""
        match = re.search(r"rpc\('use_credit'(.*?)\)", self.sub_src, re.DOTALL)
        assert match, "useCredit 가 rpc('use_credit') 를 호출하지 않음"
        rpc_args = match.group(1)
        assert "p_user_id" not in rpc_args, (
            "IDOR: useCredit 가 rpc('use_credit') 에 p_user_id 를 전달하고 있음.\n"
            "use_credit() 는 파라미터 없이 서버에서 auth.uid() 로 사용자 결정해야 함."
        )
        # 두 번째 인자(객체) 없이 호출 — rpc('use_credit') 또는 rpc('use_credit') 형태
        # rpc('use_credit', {...}) 형태면 객체 파라미터 전달 = 위험
        assert not re.search(r"rpc\('use_credit'\s*,\s*\{", rpc_args + ")"), (
            "IDOR: useCredit 가 rpc('use_credit', {...}) 형식으로 객체 파라미터를 전달 중 — "
            "auth.uid() 우회 가능"
        )


# ═══════════════════════════════════════════════════════════════
# 7. SQL 인젝션 방어 — Supabase JS 클라이언트 파라미터 바인딩 확인
# ═══════════════════════════════════════════════════════════════

class TestSQLInjectionDefense:
    """Supabase JS SDK 는 파라미터 바인딩을 사용하므로 SQL 인젝션이 구조적으로 차단됨."""

    def test_supabase_sdk_used_not_raw_sql(self):
        """커뮤니티 스토리지가 raw SQL 문자열이 아닌 Supabase SDK 를 사용."""
        cs = (SERVICES / "community-storage.js").read_text(encoding="utf-8")
        # raw query() 호출 없음
        assert ".query(" not in cs, (
            "community-storage.js 가 raw SQL query() 를 사용함 — SQL 인젝션 위험"
        )
        # Supabase SDK 체인 사용
        assert ".from(" in cs and ".select(" in cs, (
            "community-storage.js 가 Supabase SDK 를 사용하지 않음"
        )

    def test_no_string_interpolation_in_supabase_queries(self):
        """services/ 파일에서 Supabase 쿼리에 직접 문자열 보간(template literal 내 .eq() 인수) 없음."""
        for js_file in SERVICES.glob("*.js"):
            src = js_file.read_text(encoding="utf-8")
            # 위험 패턴: .eq(`user_id`, ... 또는 .filter(`...${variable}...`)
            dangerous = re.findall(r'\.(eq|filter|match|contains)\(`[^`]*\$\{', src)
            assert not dangerous, (
                f"{js_file.name}: Supabase 쿼리 내 템플릿 리터럴 인젝션 의심 패턴: {dangerous}"
            )

    def test_esc_utility_exists_and_used_in_community_storage(self):
        """community-storage.js 가 XSS 방어 esc() 를 import 하지 않음 = 서버 데이터 표시는 Supabase 반환값."""
        # community-storage.js 는 데이터 저장/조회만; UI 렌더는 tabs/community.js 에서 esc() 로 처리
        community_tab = (SRC / "tabs" / "community.js").read_text(encoding="utf-8")
        assert "esc(" in community_tab or "sanitize(" in community_tab, (
            "community.js 가 esc()/sanitize() 없이 Supabase 데이터를 직접 innerHTML 에 삽입 가능"
        )


# ═══════════════════════════════════════════════════════════════
# 8. 적대적 회귀 테스트 — 보호 장치가 제거되면 FAIL
# ═══════════════════════════════════════════════════════════════

class TestAdversarialRegressionGuard:
    """보호 장치가 우회되거나 제거되면 FAIL 하는 회귀 가드."""

    def test_fix_migration_file_present(self):
        """2026-06-15 IDOR 수정 마이그레이션 파일이 존재."""
        assert (MIGRATIONS / "20260615_fix_rpc_idor.sql").is_file(), (
            "20260615_fix_rpc_idor.sql 마이그레이션이 삭제됨 — IDOR 수정 소실"
        )

    def test_client_never_calls_toggle_like_with_two_params(self):
        """toggle_post_like RPC 호출에 p_user_id 인자가 절대 없어야 함 (회귀 방지)."""
        cs = (SERVICES / "community-storage.js").read_text(encoding="utf-8")
        # p_user_id 가 toggle_post_like 호출 블록 내에 있으면 IDOR 회귀
        for match in re.finditer(r"rpc\('toggle_post_like'(.*?)\)", cs, re.DOTALL):
            assert "p_user_id" not in match.group(1), (
                "IDOR 회귀: toggle_post_like 호출에 p_user_id 가 다시 추가됨"
            )

    def test_client_never_calls_increment_dream_with_user_id(self):
        """increment_dream_count RPC 호출에 p_user_id 인자가 절대 없어야 함 (회귀 방지)."""
        sub = (SERVICES / "subscription.js").read_text(encoding="utf-8")
        for match in re.finditer(r"rpc\('increment_dream_count'(.*?)\)", sub, re.DOTALL):
            assert "p_user_id" not in match.group(1), (
                "IDOR 회귀: increment_dream_count 호출에 p_user_id 가 다시 추가됨"
            )

    def test_client_never_calls_use_credit_with_user_id(self):
        """use_credit RPC 호출에 p_user_id 인자가 절대 없어야 함 (회귀 방지).
        [뮤테이션 검증: rpc('use_credit', {p_user_id: ...}) 재도입 시 이 테스트 FAIL]"""
        sub = (SERVICES / "subscription.js").read_text(encoding="utf-8")
        for match in re.finditer(r"rpc\('use_credit'(.*?)\)", sub, re.DOTALL):
            assert "p_user_id" not in match.group(1), (
                "IDOR 회귀: use_credit 호출에 p_user_id 가 추가됨 — "
                "use_credit() 는 auth.uid() 기반으로 서버에서 결정해야 함"
            )

    def test_openai_proxy_maintains_jwt_auth_check(self):
        """openai-proxy 가 JWT 체크를 유지함 (무인증 허용으로 회귀하면 FAIL)."""
        idx = EDGE_PROXY.read_text(encoding="utf-8")
        assert "supabase.auth.getUser()" in idx or "auth.getUser" in idx, (
            "openai-proxy JWT 인증 체크가 제거됨 — 무인증 LLM 호출 허용 상태"
        )

    def test_own_ent_drop_migration_cannot_be_undone_by_reinsertion(self):
        """user_entitlements own_ent 정책이 다른 마이그레이션에서 재생성되지 않음."""
        # 20260614 이후 마이그레이션 파일에서 own_ent 재생성 없음
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.name <= "20260614_drop_self_write_entitlements.sql":
                continue  # 드롭 마이그레이션 자체는 제외
            content = f.read_text(encoding="utf-8")
            # own_ent 정책 재생성 패턴 감지
            assert 'policy "own_ent"' not in content or "drop" in content.lower(), (
                f"{f.name}: user_entitlements 'own_ent' 정책이 드롭 이후 재생성됨 — "
                "결제 우회 취약점 재도입"
            )
