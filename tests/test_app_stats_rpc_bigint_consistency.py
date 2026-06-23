"""
MONGGEUL — REGRESSION (R3 brief #7): increment_app_stat RPC 형 정합(bigint 산술).

문제(브리프 #7):
  파일명 타임스탬프 순서상 마지막 create-or-replace 가 20260321_app_stats.sql 의
  `set value = (value::int + 1)::text, updated_at = now()` 버전으로 굳었는데,
  정본 app_stats(0001) = (key, value bigint) 이고 updated_at 컬럼이 없으며,
  20260619 가 value 를 bigint 로 확정했다. 따라서 live RPC 호출 시:
    (a) text 를 bigint 컬럼에 대입 → 형 오류, (b) 존재하지 않는 updated_at 참조 → 오류.
  → 카운터 증가가 깨진다(DB 미실행 테스트에선 미검출되던 잠재 버그).

수정:
  20260623_fix_increment_app_stat_bigint.sql 추가 —
    updated_at 컬럼 ADD COLUMN IF NOT EXISTS + increment_app_stat 을 bigint 산술
    (value = app_stats.value + 1)로 단일 재정의(text 캐스팅 제거). 타임스탬프상
    20260619 직후 정렬 → 최종 정의를 잡는다.

검증(SQL 소스 정합 — Deno/DB 미실행 환경, money_path/migration_consistency 패턴 동일):
  - 마지막(파일명순) increment_app_stat 정의가 text 캐스팅을 쓰지 않는다.
  - 마지막 정의가 bigint 산술(value + 1)을 쓴다.
  - updated_at 참조가 있으면 같은 마이그레이션이 컬럼을 보장(ADD COLUMN IF NOT EXISTS)한다.
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"

_FN_RE = re.compile(
    r"create\s+or\s+replace\s+function\s+(?:public\.)?increment_app_stat\s*\(",
    re.IGNORECASE,
)


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _last_increment_app_stat_def():
    """파일명(타임스탬프) 순서상 마지막으로 increment_app_stat 을 정의하는 (파일, 본문) 반환.

    실 DB 에 적용되는 최종 RPC = 마지막 create-or-replace 가 승(Postgres 동작).
    """
    defs = []
    for p in sorted(MIGRATIONS.glob("*.sql")):
        sql = _read(p)
        m = _FN_RE.search(sql)
        if m:
            # 함수 본문 추출: create or replace function ... 부터 다음 '$$ ... $$;' 또는 파일 끝까지.
            start = m.start()
            tail = sql[start:]
            # $$ ... $$ 본문 블록 추출(없으면 전체)
            body_m = re.search(r"\$\$(.*?)\$\$", tail, re.DOTALL)
            body = body_m.group(1) if body_m else tail
            defs.append((p, tail, body))
    assert defs, "increment_app_stat 정의를 가진 마이그레이션이 없다"
    # 파일명 순서상 마지막
    return defs[-1]


def test_last_increment_app_stat_is_in_latest_fix_migration():
    """마지막 정의가 R3 형정합 마이그레이션(20260623)에 있어야 한다(20260321 텍스트버전 override)."""
    p, _tail, _body = _last_increment_app_stat_def()
    assert p.name == "20260623_fix_increment_app_stat_bigint.sql", (
        f"increment_app_stat 최종 정의가 {p.name} — 20260623 형정합 마이그레이션이 마지막이어야 "
        f"text 캐스팅 버전(20260321)을 덮어쓴다"
    )


def test_last_def_has_no_text_cast():
    """최종 RPC 가 value 를 text 로 캐스팅하지 않는다(bigint 컬럼에 text 대입 = 형 오류)."""
    _p, _tail, body = _last_increment_app_stat_def()
    assert "::text" not in body, (
        "최종 increment_app_stat 이 ::text 캐스팅 사용 — bigint 컬럼에 text 대입 형 오류 재발"
    )
    assert "value::int" not in body, "최종 increment_app_stat 이 value::int 캐스팅 사용(형 드리프트)"


def test_last_def_uses_bigint_increment():
    """최종 RPC 가 bigint 산술(value + 1)로 증가한다."""
    _p, _tail, body = _last_increment_app_stat_def()
    assert re.search(r"app_stats\.value\s*\+\s*1", body) or re.search(r"value\s*=\s*[a-z_.]*value\s*\+\s*1", body), (
        "최종 increment_app_stat 이 bigint 산술(value + 1)을 쓰지 않는다"
    )


def test_updated_at_column_guaranteed_when_referenced():
    """최종 RPC 가 updated_at 을 참조하면 같은 마이그레이션이 컬럼을 보장한다(ADD COLUMN IF NOT EXISTS)."""
    p, _tail, body = _last_increment_app_stat_def()
    if "updated_at" in body:
        sql = _read(p)
        assert re.search(
            r"alter\s+table\s+(?:public\.)?app_stats\s+add\s+column\s+if\s+not\s+exists\s+updated_at",
            sql,
            re.IGNORECASE,
        ), (
            "최종 increment_app_stat 이 updated_at 을 참조하나 같은 마이그레이션이 컬럼을 "
            "ADD COLUMN IF NOT EXISTS 로 보장하지 않음(존재하지 않는 컬럼 참조 위험)"
        )


def test_fix_migration_orders_after_value_type_unify():
    """형정합 RPC 마이그레이션은 value 타입 통일(20260619) 이후 타임스탬프여야 최종 승."""
    fix = MIGRATIONS / "20260623_fix_increment_app_stat_bigint.sql"
    unify = MIGRATIONS / "20260619_unify_app_stats_value_type.sql"
    assert fix.exists(), "20260623_fix_increment_app_stat_bigint.sql 이 없다"
    assert unify.exists(), "20260619_unify_app_stats_value_type.sql 이 없다"
    assert fix.name > unify.name, "형정합 RPC 마이그레이션이 value 타입 통일보다 먼저 정렬됨"
