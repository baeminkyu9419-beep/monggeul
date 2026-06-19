"""
MONGGEUL 마이그레이션/스키마 정합성 — 회귀 단위 테스트 (2026-06-18)
=============================================================================

문제(실측): supabase/migrations 에 init 마이그레이션이 2개 공존하며 같은 테이블을
서로 다른 형(shape)으로 정의해 드리프트가 발생한다.

  - 0001_init_schema.sql            : 실 출시(live) 스키마. b32efb0 "실 출시 11테이블 +
    RLS + RPC (404 blocker 해결)". dreams.badges/emotions = jsonb,
    dali_memory.chat, user_entitlements/app_stats/dream_pattern_cache 포함.
    → 런타임 코드(src/services/auth.js)가 dali_memory.chat 컬럼을 사용 = 이 init 이 정본.
  - 20260320000000_init_schema.sql  : 옛 디자인. dreams.badges/emotions = text[],
    dali_memory.chat_history, users.subscription_tier 등. schema.sql 과 동일 계보(d987395).
    실 DB 미적용으로 추정(런타임이 .chat 을 쓰므로). 폐기 대상.

Deno/DB 미실행 환경 → .sql 소스 텍스트 파싱(money_path 테스트 패턴 동일).

검증 불변식:
  C1. init 마이그레이션은 정확히 1개만 활성(active)이어야 한다(중복 init 드리프트 차단).
  C2. 폐기된 옛 init(20260320000000)은 명시적으로 격리(DEPRECATED 마커)되어야 한다.
  C3. 정본 init(0001)과 schema.sql 의 핵심 테이블 형(dali_memory chat 컬럼)이 일치해야 한다.
  C4. schema.sql 은 live 누적 테이블(user_entitlements/app_stats/products/payments 등)을
      문서화해야 한다(8테이블 정본 ↔ 23테이블 누적 불일치 해소).
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
SCHEMA_SQL = ROOT / "supabase" / "schema.sql"

ACTIVE_INIT = MIGRATIONS / "0001_init_schema.sql"
DEPRECATED_INIT = MIGRATIONS / "20260320000000_init_schema.sql"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _create_table_names(sql: str) -> set:
    """create table [if not exists] [public.]NAME ( ... 의 테이블명 집합."""
    return {
        m.lower()
        for m in re.findall(
            r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)",
            sql,
            re.IGNORECASE,
        )
    }


# ══════════════════════════════════════════════════════════════════════
# C1 — init 마이그레이션 단일성(중복 init 드리프트 차단)
# ══════════════════════════════════════════════════════════════════════

class TestSingleActiveInit:
    """init 마이그레이션은 활성 1개만 — 두 init 의 users 테이블 정의 드리프트 차단."""

    def test_active_init_exists(self):
        assert ACTIVE_INIT.exists(), "정본 init 0001_init_schema.sql 이 없다"

    def test_no_two_active_init_migrations(self):
        """*_init_schema.sql 중 DEPRECATED 마커 없는 활성 init 은 정확히 1개."""
        init_files = sorted(MIGRATIONS.glob("*init_schema*.sql"))
        active = [
            p for p in init_files
            if "DEPRECATED" not in _read(p)[:600].upper()
        ]
        assert len(active) == 1, (
            f"활성 init 마이그레이션이 {len(active)}개 (중복 init 드리프트). "
            f"폐기본은 DEPRECATED 마커로 격리해야 함: "
            f"{[p.name for p in active]}"
        )

    def test_two_inits_define_users_incompatibly_is_resolved(self):
        """두 init 이 동시에 활성이면 users 정의가 충돌(드리프트). 해소 후엔 1개만 활성."""
        if not DEPRECATED_INIT.exists():
            return  # 폐기본이 제거됐다면(비파괴 정책상 비권장) 통과
        dep = _read(DEPRECATED_INIT)
        # 옛 init 만의 시그니처(subscription_tier) — 활성으로 남으면 안 됨
        if "subscription_tier" in dep:
            assert "DEPRECATED" in dep[:600].upper(), (
                "subscription_tier 를 정의하는 옛 init 이 격리되지 않았다 "
                "(0001 의 users 와 형 충돌 = 드리프트)"
            )


# ══════════════════════════════════════════════════════════════════════
# C2 — 폐기 init 명시적 격리
# ══════════════════════════════════════════════════════════════════════

class TestDeprecatedInitQuarantined:
    """옛 init 은 비파괴적으로 격리(DEPRECATED 마커 + 대체 지시)."""

    def test_deprecated_init_has_marker(self):
        if not DEPRECATED_INIT.exists():
            return
        head = _read(DEPRECATED_INIT)[:600].upper()
        assert "DEPRECATED" in head, (
            "20260320000000_init_schema.sql 이 폐기 마커(DEPRECATED) 없이 활성으로 남아있다"
        )

    def test_deprecated_init_points_to_canonical(self):
        if not DEPRECATED_INIT.exists():
            return
        head = _read(DEPRECATED_INIT)[:600]
        assert "0001_init_schema" in head, (
            "폐기 init 이 정본(0001_init_schema) 을 가리키지 않는다"
        )

    def test_deprecated_init_is_noop_when_quarantined(self):
        """격리된 폐기 init 은 실행돼도 무해해야 한다(create 문 비활성/주석화)."""
        if not DEPRECATED_INIT.exists():
            return
        sql = _read(DEPRECATED_INIT)
        if "DEPRECATED" not in sql[:600].upper():
            return
        # 활성(주석 아님) create table 문이 없어야 한다
        active_creates = [
            ln for ln in sql.splitlines()
            if re.match(r"\s*create\s+table", ln, re.IGNORECASE)
        ]
        assert not active_creates, (
            f"격리됐다는 폐기 init 에 실행되는 create table 문이 남아있다: {active_creates[:3]}"
        )


# ══════════════════════════════════════════════════════════════════════
# C3 — 정본 init ↔ schema.sql 핵심 형 일치
# ══════════════════════════════════════════════════════════════════════

class TestCanonicalShapeAlignment:
    """런타임이 쓰는 컬럼(dali_memory.chat)이 정본 init 과 schema.sql 양쪽에 존재."""

    def test_active_init_dali_memory_uses_chat(self):
        """auth.js 가 dali_memory.chat 을 upsert → 정본 init 에 chat 컬럼 존재."""
        sql = _read(ACTIVE_INIT)
        m = re.search(r"dali_memory\s*\((.*?)\)\s*;", sql, re.IGNORECASE | re.DOTALL)
        assert m, "정본 init 에 dali_memory create 문이 없다"
        assert re.search(r"\bchat\b", m.group(1)), (
            "정본 init dali_memory 에 chat 컬럼이 없다(런타임 auth.js 가 .chat 사용)"
        )

    def test_schema_sql_dali_memory_matches_runtime(self):
        """schema.sql 의 dali_memory 도 런타임이 쓰는 chat 컬럼을 문서화해야 한다."""
        sql = _read(SCHEMA_SQL)
        m = re.search(r"dali_memory\s*\((.*?)\)\s*;", sql, re.IGNORECASE | re.DOTALL)
        assert m, "schema.sql 에 dali_memory create 문이 없다"
        body = m.group(1)
        # 런타임 정합: chat 컬럼 존재(chat_history 단독은 드리프트)
        assert re.search(r"\bchat\b", body), (
            "schema.sql dali_memory 가 런타임(auth.js .chat)과 불일치 — chat 컬럼 누락"
        )


# ══════════════════════════════════════════════════════════════════════
# C4 — schema.sql 이 live 누적 테이블을 문서화(8↔23 불일치 해소)
# ══════════════════════════════════════════════════════════════════════

class TestSchemaSqlDocumentsAccumulatedTables:
    """schema.sql(정본 문서)은 후속 마이그레이션이 추가한 핵심 수익/권한 테이블을 포함."""

    REQUIRED = {
        "user_entitlements",  # 20260321_billing_schema (구독/크레딧 정본)
        "app_stats",          # 20260321_app_stats (카운터)
        "products",           # 20260324_payment_system (상품 카탈로그)
        "payments",           # 20260324_payment_system (결제 내역)
        "entitlements",       # 20260324_payment_system (v2 권한)
    }

    def test_schema_sql_includes_revenue_tables(self):
        tables = _create_table_names(_read(SCHEMA_SQL))
        missing = self.REQUIRED - tables
        assert not missing, (
            f"schema.sql 정본 문서에 live 누적 수익/권한 테이블 누락: {sorted(missing)} "
            f"(8테이블 정본 ↔ migrations 누적 불일치)"
        )
