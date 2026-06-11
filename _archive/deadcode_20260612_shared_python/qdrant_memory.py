"""Qdrant 벡터 DB 클라이언트 -- urllib 직접 구현 (온글에서 이식)

고도화:
- 3중 중복 방지 (해시 + 유사도 + 메타데이터)
- CRUD 완전 구현
- 컬렉션 관리
- 벡터 검색 + 필터링
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional
from config.logger import get_logger

_log = get_logger("qdrant")

_DEFAULT_TIMEOUT = 30
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0

# 중복 방지용 인메모리 해시 캐시
_dedup_cache: dict[str, set[str]] = {}  # collection -> set of content hashes
_DEDUP_CACHE_MAX = 10000


def _headers(api_key: str = "") -> dict:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    return headers


def _request(base_url: str, path: str, method: str = "GET",
             payload: Optional[dict] = None, api_key: str = "",
             timeout: int = _DEFAULT_TIMEOUT,
             retries: int = _MAX_RETRIES) -> dict:
    url = (base_url or "").rstrip("/") + path
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data,
                                         headers=_headers(api_key), method=method)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            status = e.code
            _log.warning("Qdrant HTTP %d (%s %s) -- 시도 %d/%d",
                         status, method, path, attempt + 1, retries)
            if 400 <= status < 500 and status != 409:
                body = e.read().decode("utf-8", errors="replace")[:200]
                _log.error("Qdrant 클라이언트 에러 %d: %s", status, body)
                return {"error": body, "status": status}
        except Exception as e:
            _log.warning("Qdrant 요청 실패 (%s %s): %s -- 시도 %d/%d",
                         method, path, e, attempt + 1, retries)

        if attempt < retries - 1:
            delay = _RETRY_BASE_DELAY * (2 ** attempt)
            time.sleep(delay)

    _log.error("Qdrant 요청 최종 실패: %s %s", method, path)
    return {"error": "max retries exceeded"}


# ══════════════════════════════════════════════════════════════
# 연결 / 컬렉션 관리
# ══════════════════════════════════════════════════════════════

def verify_connection(base_url: str, api_key: str = "") -> bool:
    if not base_url:
        return False
    try:
        result = _request(base_url, "/collections", api_key=api_key,
                          timeout=10, retries=1)
        return "error" not in result
    except Exception:
        return False


def list_collections(base_url: str, api_key: str = "") -> list[str]:
    """컬렉션 목록 조회"""
    result = _request(base_url, "/collections", api_key=api_key)
    collections = result.get("result", {}).get("collections", [])
    return [c.get("name", "") for c in collections]


def ensure_collection(base_url: str, collection_name: str,
                      vector_size: int, api_key: str = "") -> dict:
    coll = urllib.parse.quote(collection_name)
    try:
        existing = _request(base_url, f"/collections/{coll}", api_key=api_key)
        if existing.get("result"):
            return existing
    except Exception:
        pass
    payload = {"vectors": {"size": int(vector_size), "distance": "Cosine"}}
    return _request(base_url, f"/collections/{coll}",
                    method="PUT", payload=payload, api_key=api_key)


def delete_collection(base_url: str, collection_name: str, api_key: str = "") -> dict:
    """컬렉션 삭제"""
    coll = urllib.parse.quote(collection_name)
    result = _request(base_url, f"/collections/{coll}", method="DELETE", api_key=api_key)
    # 로컬 중복 캐시도 정리
    _dedup_cache.pop(collection_name, None)
    return result


def get_collection_info(base_url: str, collection_name: str, api_key: str = "") -> dict:
    """컬렉션 정보 조회"""
    coll = urllib.parse.quote(collection_name)
    return _request(base_url, f"/collections/{coll}", api_key=api_key)


# ══════════════════════════════════════════════════════════════
# 포인트 ID 생성 (안정적 해시)
# ══════════════════════════════════════════════════════════════

def stable_point_id(source: str, text: str) -> int:
    digest = hashlib.sha1(f"{source}::{text}".encode("utf-8")).hexdigest()[:15]
    return int(digest, 16)


def _content_hash(text: str) -> str:
    """콘텐츠 해시 (중복 방지용)"""
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:32]


# ══════════════════════════════════════════════════════════════
# 3중 중복 방지
# ══════════════════════════════════════════════════════════════

def _is_duplicate_by_hash(collection_name: str, text: str) -> bool:
    """1단계: 해시 기반 중복 확인 (인메모리)"""
    h = _content_hash(text)
    cache = _dedup_cache.get(collection_name, set())
    return h in cache


def _register_hash(collection_name: str, text: str):
    """해시 캐시에 등록"""
    if collection_name not in _dedup_cache:
        _dedup_cache[collection_name] = set()
    cache = _dedup_cache[collection_name]
    if len(cache) >= _DEDUP_CACHE_MAX:
        # 절반 정리 (LRU 근사)
        to_remove = list(cache)[:_DEDUP_CACHE_MAX // 2]
        for item in to_remove:
            cache.discard(item)
    cache.add(_content_hash(text))


def is_duplicate(base_url: str, collection_name: str,
                 text: str, vector: list[float],
                 api_key: str = "",
                 similarity_threshold: float = 0.95) -> dict:
    """3중 중복 확인

    1단계: 해시 기반 (인메모리, 즉시)
    2단계: 벡터 유사도 (Qdrant 검색)
    3단계: 메타데이터 비교

    Returns:
        {"is_duplicate": bool, "method": str, "details": dict}
    """
    # 1단계: 해시
    if _is_duplicate_by_hash(collection_name, text):
        return {"is_duplicate": True, "method": "hash", "details": {"hash": _content_hash(text)}}

    # 2단계: 벡터 유사도
    if vector:
        similar = search_similar_chunks(
            base_url, collection_name, vector, top_k=3, api_key=api_key
        )
        for s in similar:
            score = s.get("score", 0)
            if score >= similarity_threshold:
                return {
                    "is_duplicate": True,
                    "method": "vector_similarity",
                    "details": {"score": score, "matched_id": s.get("id")},
                }

            # 3단계: 메타데이터 비교
            payload_text = s.get("payload", {}).get("text", "")
            if payload_text and _content_hash(payload_text) == _content_hash(text):
                return {
                    "is_duplicate": True,
                    "method": "metadata",
                    "details": {"matched_id": s.get("id")},
                }

    return {"is_duplicate": False, "method": "none", "details": {}}


# ══════════════════════════════════════════════════════════════
# CRUD 연산
# ══════════════════════════════════════════════════════════════

def upsert_chunks(base_url: str, collection_name: str,
                  chunks: List[Dict[str, Any]], api_key: str = "",
                  dedup: bool = True) -> dict:
    """포인트 업서트 (중복 방지 옵션 포함)"""
    if dedup:
        filtered = []
        for chunk in chunks:
            text = chunk.get("payload", {}).get("text", "")
            if text and not _is_duplicate_by_hash(collection_name, text):
                filtered.append(chunk)
                _register_hash(collection_name, text)
            elif not text:
                filtered.append(chunk)
        chunks = filtered

    if not chunks:
        return {"status": "ok", "skipped": "all duplicates"}

    return _request(
        base_url,
        f"/collections/{urllib.parse.quote(collection_name)}/points?wait=true",
        method="PUT", payload={"points": chunks}, api_key=api_key,
    )


def get_point(base_url: str, collection_name: str,
              point_id: int, api_key: str = "") -> dict:
    """단일 포인트 조회"""
    coll = urllib.parse.quote(collection_name)
    return _request(base_url, f"/collections/{coll}/points/{point_id}", api_key=api_key)


def delete_points(base_url: str, collection_name: str,
                  point_ids: List[int], api_key: str = "") -> dict:
    """포인트 삭제"""
    coll = urllib.parse.quote(collection_name)
    payload = {"points": point_ids}
    return _request(
        base_url,
        f"/collections/{coll}/points/delete?wait=true",
        method="POST", payload=payload, api_key=api_key,
    )


def count_points(base_url: str, collection_name: str,
                 api_key: str = "", exact: bool = True) -> int:
    """컬렉션 포인트 수 조회"""
    coll = urllib.parse.quote(collection_name)
    payload = {"exact": exact}
    result = _request(base_url, f"/collections/{coll}/points/count",
                      method="POST", payload=payload, api_key=api_key)
    return result.get("result", {}).get("count", 0)


def scroll_points(base_url: str, collection_name: str,
                  limit: int = 100, offset: Optional[int] = None,
                  api_key: str = "",
                  filters: Optional[dict] = None) -> dict:
    """포인트 스크롤 (페이지네이션)"""
    coll = urllib.parse.quote(collection_name)
    payload: Dict[str, Any] = {
        "limit": limit,
        "with_payload": True,
        "with_vector": False,
    }
    if offset is not None:
        payload["offset"] = offset
    if filters:
        payload["filter"] = filters

    return _request(
        base_url, f"/collections/{coll}/points/scroll",
        method="POST", payload=payload, api_key=api_key,
    )


# ══════════════════════════════════════════════════════════════
# 검색
# ══════════════════════════════════════════════════════════════

def search_similar_chunks(base_url: str, collection_name: str,
                          query_vector: List[float], top_k: int = 8,
                          api_key: str = "",
                          filters: Optional[dict] = None,
                          score_threshold: Optional[float] = None) -> List[dict]:
    """유사 벡터 검색"""
    payload: Dict[str, Any] = {
        "vector": query_vector,
        "limit": int(top_k or 8),
        "with_payload": True,
    }
    if filters:
        payload["filter"] = filters
    if score_threshold is not None:
        payload["score_threshold"] = score_threshold

    res = _request(
        base_url,
        f"/collections/{urllib.parse.quote(collection_name)}/points/search",
        method="POST", payload=payload, api_key=api_key,
    )
    return res.get("result", []) or []


def search_with_filter(base_url: str, collection_name: str,
                       query_vector: List[float],
                       must: Optional[List[dict]] = None,
                       should: Optional[List[dict]] = None,
                       must_not: Optional[List[dict]] = None,
                       top_k: int = 8,
                       api_key: str = "") -> List[dict]:
    """필터 기반 벡터 검색

    Example filters:
        must=[{"key": "source", "match": {"value": "resume"}}]
    """
    filters = {}
    if must:
        filters["must"] = must
    if should:
        filters["should"] = should
    if must_not:
        filters["must_not"] = must_not

    return search_similar_chunks(
        base_url, collection_name, query_vector,
        top_k=top_k, api_key=api_key,
        filters=filters if filters else None,
    )
