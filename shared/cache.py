"""나음 TTL 캐시 — 반복 API 호출 방지 (T13 고도화)

온글 saas/cache.py 이식 + 캐시 정책 세분화.

캐시 정책:
  pubmed: 1시간 (논문 검색 결과)
  riss: 1시간
  paper_summary: 24시간 (Claude 요약)
  meal_plan: 24시간 (식단)
  interpretation: 영구 (수치 해석 — 수치 불변)
  hyper_scan: 24시간

고도화:
  - 프리픽스별 TTL 자동 적용
  - 만료 캐시 자동 정리 (cleanup)
  - 캐시 히트율 추적
"""

import json
import hashlib
import time
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent / "runtime_cache"

# ── 프리픽스별 기본 TTL (초) ──

DEFAULT_TTL = {
    "pubmed": 3600,           # 1시간
    "riss": 3600,             # 1시간
    "paper_summary": 86400,   # 24시간
    "meal_plan": 86400,       # 24시간
    "interpretation": 604800, # 7일 (수치 기반 해석은 오래 유지)
    "hyper_scan": 86400,      # 24시간
    "embedding": 604800,      # 7일
}

# ── 히트율 추적 ──

_hit_count = 0
_miss_count = 0


def _cache_key(prefix: str, *args) -> str:
    raw = f"{prefix}:{'|'.join(str(a) for a in args)}"
    return hashlib.md5(raw.encode()).hexdigest()


def _get_ttl(prefix: str, ttl_seconds: int | None) -> int:
    """프리픽스별 기본 TTL 또는 명시적 TTL 사용."""
    if ttl_seconds is not None:
        return ttl_seconds
    return DEFAULT_TTL.get(prefix, 3600)


def get_cache(prefix: str, *args, ttl_seconds: int | None = None):
    """캐시 조회 (TTL 내이면 반환, 아니면 None)"""
    global _hit_count, _miss_count
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    ttl = _get_ttl(prefix, ttl_seconds)
    key = _cache_key(prefix, *args)
    cache_file = CACHE_DIR / f"{key}.json"

    if not cache_file.exists():
        _miss_count += 1
        return None

    try:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        if time.time() - data.get("_ts", 0) > ttl:
            cache_file.unlink(missing_ok=True)
            _miss_count += 1
            return None
        _hit_count += 1
        return data.get("value")
    except Exception:
        _miss_count += 1
        return None


def set_cache(prefix: str, *args, value, ttl_seconds: int | None = None):
    """캐시 저장"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ttl = _get_ttl(prefix, ttl_seconds)
    key = _cache_key(prefix, *args)
    cache_file = CACHE_DIR / f"{key}.json"

    data = {"_ts": time.time(), "_ttl": ttl, "_prefix": prefix, "value": value}
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def clear_cache(prefix: str | None = None):
    """캐시 삭제 (프리픽스 지정 시 해당 프리픽스만)"""
    if not CACHE_DIR.exists():
        return

    for f in CACHE_DIR.glob("*.json"):
        if prefix:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if data.get("_prefix") != prefix:
                    continue
            except Exception:
                pass
        f.unlink(missing_ok=True)


def cleanup_expired():
    """만료된 캐시 파일 자동 정리."""
    if not CACHE_DIR.exists():
        return 0

    cleaned = 0
    for f in CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            ttl = data.get("_ttl", 3600)
            if time.time() - data.get("_ts", 0) > ttl:
                f.unlink(missing_ok=True)
                cleaned += 1
        except Exception:
            f.unlink(missing_ok=True)
            cleaned += 1

    return cleaned


def cache_stats() -> dict:
    """캐시 현황 + 히트율"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    files = list(CACHE_DIR.glob("*.json"))
    total_size = sum(f.stat().st_size for f in files)

    valid = expired = 0
    by_prefix: dict[str, int] = {}

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            prefix = data.get("_prefix", "unknown")
            ttl = data.get("_ttl", 3600)
            if time.time() - data.get("_ts", 0) <= ttl:
                valid += 1
            else:
                expired += 1
            by_prefix[prefix] = by_prefix.get(prefix, 0) + 1
        except Exception:
            expired += 1

    total_requests = _hit_count + _miss_count
    hit_rate = round(_hit_count / total_requests * 100, 1) if total_requests > 0 else 0

    return {
        "total": len(files),
        "valid": valid,
        "expired": expired,
        "size_kb": round(total_size / 1024, 1),
        "by_prefix": by_prefix,
        "hit_count": _hit_count,
        "miss_count": _miss_count,
        "hit_rate_pct": hit_rate,
    }
