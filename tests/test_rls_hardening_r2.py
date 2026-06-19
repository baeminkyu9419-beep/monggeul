"""
크로스-Supabase 보안 R2 — RLS/형 정합 회귀 테스트 (2026-06-19)
=============================================================================

본 라운드 2개 불변식(static SQL 파싱, Deno/DB 미실행 — money_path/idor 패턴 동일):

  R2-1. app_stats.value 형 불일치 해소.
        - 0001_init_schema.sql        : value bigint default 0
        - 20260321_app_stats.sql      : value text not null default '0'
        두 init 경로가 같은 테이블을 서로 다른 형으로 만든다(드리프트).
        increment_app_stat RPC 가 정수 증분(value+1)을 기대 → 정본은 bigint.
        후속 마이그레이션이 live 형을 명시 bigint 로 통일해야 한다(멱등 ALTER).

  R2-2. push_subscriptions "Anyone can insert subs" (with check (true)) 격리.
        ONGLE 결제테이블에서 발견된 노출 클래스와 동일: user_id 격리 없는
        permissive write. 클라이언트 write 정본 경로는 push-subscribe Edge
        Function(SERVICE_ROLE_KEY = RLS 우회)이므로, anon REST 직접 insert 를
        허용하는 with check (true) 정책은 불필요 + 위험(타인 user_id 위조 적재).
        → 본인(user_id = auth.uid()) 격리로 교체.

  R2-3. RLS 전수 — 잔존 permissive write(with check (true)) 가 결제/권한/개인
        데이터 테이블에 없어야 한다(노출 클래스 회귀 가드).
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
SCHEMA_SQL = ROOT / "supabase" / "schema.sql"

TYPE_FIX = MIGRATIONS / "20260619_unify_app_stats_value_type.sql"
PUSH_FIX = MIGRATIONS / "20260619_harden_push_subscriptions_insert.sql"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _all_migrations() -> str:
    return "\n".join(_read(f) for f in sorted(MIGRATIONS.glob("*.sql")))


# ══════════════════════════════════════════════════════════════════════
# R2-1 — app_stats.value 형 통일 (bigint)
# ══════════════════════════════════════════════════════════════════════

class TestAppStatsValueTypeUnified:
    """app_stats.value 형이 bigint 로 명시 통일된다(text↔bigint 드리프트 해소)."""

    def test_type_fix_migration_exists(self):
        assert TYPE_FIX.is_file(), (
            "app_stats.value 형 통일 마이그레이션(20260619_unify_app_stats_value_type.sql) 누락 — "
            "0001(bigint) vs 20260321(text) 드리프트 미해소"
        )

    def test_migration_alters_value_to_bigint_idempotently(self):
        """ALTER ... TYPE bigint USING value::bigint — text 상태에서도 안전 변환."""
        content = _read(TYPE_FIX)
        # 컬럼 형을 bigint 로 변경하는 ALTER 가 있어야 함
        assert re.search(
            r"alter\s+table\s+(?:public\.)?app_stats\s+alter\s+column\s+value\s+(?:set\s+data\s+)?type\s+bigint",
            content, re.IGNORECASE,
        ), "app_stats.value 를 bigint 로 변경하는 ALTER 문이 없음"
        # text→bigint 변환은 USING value::bigint 필요(없으면 text 상태에서 실패)
        assert re.search(r"using\s+value::bigint", content, re.IGNORECASE), (
            "USING value::bigint 없음 — value 가 text 상태면 ALTER 가 실패(드리프트 미해소)"
        )

    def test_migration_normalizes_default_to_integer(self):
        """default 도 정수('0' 문자열 아님)로 정렬 — 형 일관."""
        content = _read(TYPE_FIX)
        assert re.search(
            r"alter\s+column\s+value\s+set\s+default\s+0\b",
            content, re.IGNORECASE,
        ), "value default 를 정수 0 으로 정렬하지 않음"

    def test_schema_doc_marks_type_resolved(self):
        """schema.sql 정본 문서가 형 불일치를 '해소됨'으로 갱신(KNOWN ISSUE 잔존 금지)."""
        doc = _read(SCHEMA_SQL)
        assert "20260619_unify_app_stats_value_type" in doc, (
            "schema.sql 이 형 통일 마이그레이션을 색인하지 않음 — 문서-코드 괴리"
        )

    def test_increment_app_stat_expects_integer_arithmetic(self):
        """increment_app_stat RPC 가 정수 증분(value+1)을 사용 = bigint 정합 확인."""
        init = _read(MIGRATIONS / "0001_init_schema.sql")
        assert "value=app_stats.value+1" in init.replace(" ", ""), (
            "increment_app_stat 가 정수 증분(value+1)을 쓰지 않음 — bigint 통일 근거 약화"
        )


# ══════════════════════════════════════════════════════════════════════
# R2-2 — push_subscriptions permissive insert 격리
# ══════════════════════════════════════════════════════════════════════

class TestPushSubscriptionsInsertHardened:
    """push_subscriptions 의 with check (true) insert 정책을 user_id 격리로 교체."""

    def test_push_fix_migration_exists(self):
        assert PUSH_FIX.is_file(), (
            "push_subscriptions insert 하드닝 마이그레이션 누락 — "
            "with check (true) 노출(타인 user_id 위조 적재) 미차단"
        )

    def test_drops_permissive_anyone_insert_policy(self):
        """레거시 'Anyone can insert subs' (with check true) 를 드롭."""
        content = _read(PUSH_FIX)
        assert re.search(
            r'drop\s+policy\s+if\s+exists\s+"Anyone can insert subs"\s+on\s+(?:public\.)?push_subscriptions',
            content, re.IGNORECASE,
        ), "permissive 'Anyone can insert subs' 정책을 드롭하지 않음"

    def test_creates_owner_scoped_insert_policy(self):
        """본인(user_id = auth.uid()) 격리 insert 정책으로 교체."""
        content = _read(PUSH_FIX)
        # with check 에 auth.uid() 격리가 있어야 함
        assert "auth.uid()" in content and "user_id" in content, (
            "교체 정책이 user_id = auth.uid() 격리를 사용하지 않음"
        )
        # with check (true) 가 본 마이그레이션의 create policy 에서 재도입되면 안 됨.
        # (주석 설명 안의 'with check (true)' 문자열은 SQL 이 아니므로 제외 — 주석 라인 스트립 후 검사)
        sql_only = "\n".join(
            ln for ln in content.splitlines() if not ln.lstrip().startswith("--")
        )
        assert not re.search(r"with\s+check\s*\(\s*true\s*\)", sql_only, re.IGNORECASE), (
            "하드닝 마이그레이션이 with check (true) 정책을 재도입함 — 노출 회귀"
        )

    def test_owner_check_allows_edge_function_service_role(self):
        """service_role(Edge Function) 경로는 RLS 우회로 영향 없음을 문서화(주석)."""
        content = _read(PUSH_FIX)
        assert "service_role" in content.lower() or "service role" in content.lower(), (
            "service_role(Edge Function) 경로 무영향이 문서화되지 않음 — 기능 회귀 검토 누락"
        )


# ══════════════════════════════════════════════════════════════════════
# R2-3 — RLS 전수: 결제/권한/개인 테이블에 permissive write 잔존 없음
# ══════════════════════════════════════════════════════════════════════

class TestNoExposurePermissiveWrites:
    """노출 클래스(user_id 격리 없는 with check true) write 정책 회귀 가드."""

    # 공개 read(select using true)는 의도된 설계 → 제외. write(insert/update/all)만 검사.
    # events(ins_events with check true)는 익명 이벤트 적재 의도(20260613) → 화이트리스트.
    WHITELIST_PERMISSIVE_WRITE = {
        "events",  # 익명 텔레메트리 적재(읽기 불가, 교차 노출 없음)
    }

    def test_no_permissive_insert_on_sensitive_tables(self):
        """app_stats/push_subscriptions/community_*/user_entitlements 등에
        with check (true) insert/all 정책이 (최종 상태로) 남지 않아야 한다.

        '최종 상태' = 동일 정책명이 더 늦은 마이그레이션에서 drop 되면 무효로 간주.
        """
        combined = _all_migrations()
        # with check (true) 를 쓰는 insert/all 정책 라인 전수 수집
        offenders = []
        for m in re.finditer(
            r'create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?(\w+)\s+for\s+(insert|all)\b[^;]*?with\s+check\s*\(\s*true\s*\)',
            combined, re.IGNORECASE | re.DOTALL,
        ):
            policy_name, table = m.group(1), m.group(2).lower()
            if table in self.WHITELIST_PERMISSIVE_WRITE:
                continue
            # 이후 drop 되었는지 확인(최종 상태 무효화)
            dropped = re.search(
                rf'drop\s+policy\s+if\s+exists\s+"{re.escape(policy_name)}"\s+on\s+(?:public\.)?{table}',
                combined, re.IGNORECASE,
            )
            if not dropped:
                offenders.append(f"{table}:{policy_name}")
        assert not offenders, (
            f"노출 클래스 잔존(with check true, user_id 격리 없음): {offenders}\n"
            "→ user_id = auth.uid() 격리로 교체하거나 드롭해야 함."
        )
