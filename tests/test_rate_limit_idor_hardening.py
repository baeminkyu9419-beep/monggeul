"""
check_rate_limit RPC IDOR/PUBLIC-EXECUTE 하드닝 — 회귀 테스트 (2026-06-23)
=============================================================================

문제(R2 brief [3]): 0003_rate_limit.sql 의 check_rate_limit(p_user_id, p_max) 가
  - REVOKE/GRANT 누락 → PostgreSQL 기본 PUBLIC EXECUTE(anon 포함)로 노출
  - 전달된 p_user_id 를 그대로 사용(auth.uid() 강제 없음) → 임의 UUID 로 피해자
    분당 카운터를 소진시키는 targeted rate-limit DoS 가능

해결: 20260623_harden_check_rate_limit_idor.sql 이 함수를 재정의해
  coalesce(auth.uid(), p_user_id) 로 인증 호출자는 본인 카운터만 증가하게 강제하고,
  PUBLIC EXECUTE 를 회수한 뒤 authenticated+service_role 에게만 부여한다.

Deno/DB 미실행 환경 → .sql 소스 텍스트 파싱(money_path/rls_hardening 패턴 동일).
이 테스트들은 하드닝 전 코드라면 FAIL, 후 PASS(뮤테이션 민감).
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
SCHEMA_SQL = ROOT / "supabase" / "schema.sql"

FIX = MIGRATIONS / "20260623_harden_check_rate_limit_idor.sql"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _all_migrations() -> str:
    return "\n".join(_read(f) for f in sorted(MIGRATIONS.glob("*.sql")))


def _strip_sql_comments(sql: str) -> str:
    """-- 주석 라인 제거(주석 안 설명 문자열이 SQL 검사를 오염시키지 않게)."""
    return "\n".join(
        ln for ln in sql.splitlines() if not ln.lstrip().startswith("--")
    )


class TestRateLimitIdorHardened:
    """check_rate_limit 가 auth.uid() 강제 + EXECUTE 제한으로 재정의된다."""

    def test_fix_migration_exists(self):
        assert FIX.is_file(), (
            "check_rate_limit 하드닝 마이그레이션(20260623_harden_check_rate_limit_idor.sql) 누락"
        )

    def test_redefines_check_rate_limit(self):
        sql = _strip_sql_comments(_read(FIX))
        assert re.search(
            r"create\s+or\s+replace\s+function\s+(?:public\.)?check_rate_limit\s*\(\s*p_user_id\s+uuid\s*,\s*p_max\s+int\s*\)",
            sql, re.IGNORECASE,
        ), "check_rate_limit(p_user_id uuid, p_max int) 를 재정의하지 않음 (시그니처 하위호환 유지 필요)"

    def test_forces_auth_uid_over_param(self):
        """coalesce(auth.uid(), p_user_id) — 인증 호출자는 본인 카운터만(IDOR/DoS 차단)."""
        sql = _strip_sql_comments(_read(FIX))
        assert re.search(
            r"coalesce\s*\(\s*auth\.uid\(\)\s*,\s*p_user_id\s*\)",
            sql, re.IGNORECASE,
        ), (
            "coalesce(auth.uid(), p_user_id) 패턴 없음 — 전달된 p_user_id 를 그대로 쓰면 "
            "타인 카운터 조작(rate-limit DoS) 가능"
        )

    def test_insert_uses_derived_uid_not_raw_param(self):
        """rate_limit insert 가 원시 p_user_id 가 아닌 강제된 uid(v_uid)를 써야 한다."""
        sql = _strip_sql_comments(_read(FIX))
        m = re.search(
            r"insert\s+into\s+rate_limit\s*\([^)]*\)\s*values\s*\(([^)]*)\)",
            sql, re.IGNORECASE | re.DOTALL,
        )
        assert m, "rate_limit insert 문을 찾을 수 없음"
        values = m.group(1)
        # 강제된 uid(v_uid)를 써야 하고, 원시 p_user_id 를 직접 쓰면 안 됨
        assert re.search(r"\bv_uid\b", values), (
            "insert 가 강제된 uid(v_uid)를 쓰지 않음 — auth.uid() 강제가 무력화됨"
        )
        assert not re.search(r"\bp_user_id\b", values), (
            "insert 가 여전히 원시 p_user_id 를 직접 사용 — IDOR 미차단"
        )

    def test_revokes_public_execute(self):
        sql = _strip_sql_comments(_read(FIX))
        assert re.search(
            r"revoke\s+all\s+on\s+function\s+(?:public\.)?check_rate_limit\s*\(\s*uuid\s*,\s*int\s*\)\s+from\s+public",
            sql, re.IGNORECASE,
        ), "PUBLIC EXECUTE 회수(revoke all ... from public) 없음 — anon 호출 잔존"

    def test_grants_only_authenticated_service_role(self):
        sql = _strip_sql_comments(_read(FIX))
        m = re.search(
            r"grant\s+execute\s+on\s+function\s+(?:public\.)?check_rate_limit\s*\(\s*uuid\s*,\s*int\s*\)\s+to\s+([^;]+);",
            sql, re.IGNORECASE,
        )
        assert m, "check_rate_limit EXECUTE GRANT 문이 없음"
        grantees = m.group(1).lower()
        assert "authenticated" in grantees and "service_role" in grantees, (
            f"GRANT 대상이 authenticated+service_role 이 아님: {grantees}"
        )
        assert "public" not in grantees, "GRANT 에 public 이 포함됨 — anon 재노출"

    def test_schema_doc_indexes_fix(self):
        """schema.sql §7 보안 색인이 본 마이그레이션을 참조(문서-코드 정합)."""
        doc = _read(SCHEMA_SQL)
        assert "20260623_harden_check_rate_limit_idor" in doc, (
            "schema.sql 이 check_rate_limit 하드닝 마이그레이션을 색인하지 않음"
        )

    def test_final_state_has_no_unrevoked_definition(self):
        """전체 마이그레이션 최종 상태: check_rate_limit 정의가 revoke from public 으로 마감된다.

        0003 의 grant 누락(=PUBLIC EXECUTE) 정의가 더 늦은 마이그레이션의 revoke 로
        무효화되는지 확인(최종 상태 검사)."""
        combined = _strip_sql_comments(_all_migrations())
        # 함수를 정의하는 마지막 위치
        defs = list(re.finditer(
            r"create\s+or\s+replace\s+function\s+(?:public\.)?check_rate_limit",
            combined, re.IGNORECASE,
        ))
        assert defs, "check_rate_limit 정의가 마이그레이션에 없음"
        last_def_idx = defs[-1].start()
        tail = combined[last_def_idx:]
        assert re.search(
            r"revoke\s+all\s+on\s+function\s+(?:public\.)?check_rate_limit\s*\(\s*uuid\s*,\s*int\s*\)\s+from\s+public",
            tail, re.IGNORECASE,
        ), "최종 check_rate_limit 정의 이후 PUBLIC EXECUTE 회수가 없음 — anon 노출이 최종 상태로 잔존"
