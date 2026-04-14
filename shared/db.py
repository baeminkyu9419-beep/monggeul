"""Supabase DB 클라이언트 - 싱글턴

supabase 패키지가 설치되지 않았거나 import 실패 시
자동으로 인메모리 폴백(None 반환)으로 동작합니다.
"""

from config.settings import get_supabase_config
from config.logger import get_logger

_log = get_logger("db")
_client = None
_supabase_available = False

try:
    from supabase import create_client, Client  # type: ignore
    _supabase_available = True
except Exception:
    _log.warning("supabase 패키지 로드 실패 - 인메모리 모드로 동작합니다")
    create_client = None  # type: ignore
    Client = None  # type: ignore


def get_db():
    """Supabase 클라이언트 반환. 설정 없거나 패키지 미설치 시 None (인메모리 폴백)"""
    global _client
    if not _supabase_available:
        return None
    if _client:
        return _client
    cfg = get_supabase_config()
    if not cfg["url"] or not cfg["anon_key"]:
        _log.warning("Supabase 설정 없음 - 인메모리 모드")
        return None
    try:
        _client = create_client(cfg["url"], cfg["anon_key"])
        _log.info("Supabase 연결 성공")
        return _client
    except Exception as e:
        _log.error(f"Supabase 연결 실패: {e}")
        return None


def db_upsert(table: str, data: dict, on_conflict: str = "user_id") -> dict | None:
    """upsert 유틸 — DB 없으면 None 반환"""
    db = get_db()
    if not db:
        return None
    try:
        res = db.table(table).upsert(data, on_conflict=on_conflict).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        _log.error(f"upsert 실패 ({table}): {e}")
        return None


def db_select(table: str, user_id: str) -> dict | None:
    """user_id로 조회 — DB 없으면 None"""
    db = get_db()
    if not db:
        return None
    try:
        res = db.table(table).select("*").eq("user_id", user_id).order("created_at", desc=True).limit(1).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        _log.error(f"select 실패 ({table}): {e}")
        return None


def db_select_all(table: str, user_id: str, limit: int = 50) -> list[dict]:
    """user_id로 여러 행 조회"""
    db = get_db()
    if not db:
        return []
    try:
        res = db.table(table).select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
        return res.data or []
    except Exception as e:
        _log.error(f"select_all 실패 ({table}): {e}")
        return []


def db_insert(table: str, data: dict) -> dict | None:
    """insert 유틸"""
    db = get_db()
    if not db:
        return None
    try:
        res = db.table(table).insert(data).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        _log.error(f"insert 실패 ({table}): {e}")
        return None
