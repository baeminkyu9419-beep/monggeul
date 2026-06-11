"""임베딩 생성 + LRU 캐시 + 지수 백오프 재시도 (온글에서 이식)

고도화:
- 배치 임베딩 최적화
- 캐시 통계
- 유사도 계산 유틸
- 텍스트 청킹
"""

from __future__ import annotations

import hashlib
import math
import time
from typing import List, Optional, Sequence
from config.logger import get_logger

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"
MAX_INPUT_TOKENS = 8191
VECTOR_DIM = 3072  # text-embedding-3-large

_log = get_logger("embedding")

_cache: dict[str, list[float]] = {}
_CACHE_MAX = 5000
_cache_stats = {"hits": 0, "misses": 0}


def _cache_key(text: str, model: str) -> str:
    return hashlib.sha256(f"{model}::{text}".encode("utf-8")).hexdigest()


def _get_cached(text: str, model: str) -> list[float] | None:
    key = _cache_key(text, model)
    vec = _cache.get(key)
    if vec is not None:
        _cache_stats["hits"] += 1
    else:
        _cache_stats["misses"] += 1
    return vec


def _put_cache(text: str, model: str, vec: list[float]):
    if len(_cache) >= _CACHE_MAX:
        # LRU 근사: 가장 오래된 25% 제거
        keys = list(_cache.keys())
        for k in keys[:_CACHE_MAX // 4]:
            _cache.pop(k, None)
    _cache[_cache_key(text, model)] = vec


def clear_cache():
    _cache.clear()
    _cache_stats["hits"] = 0
    _cache_stats["misses"] = 0


def get_cache_stats() -> dict:
    """캐시 통계"""
    total = _cache_stats["hits"] + _cache_stats["misses"]
    hit_rate = (_cache_stats["hits"] / total * 100) if total > 0 else 0
    return {
        "size": len(_cache),
        "max_size": _CACHE_MAX,
        "hits": _cache_stats["hits"],
        "misses": _cache_stats["misses"],
        "hit_rate": round(hit_rate, 1),
    }


def _retry_call(fn, max_retries: int = 3, base_delay: float = 1.0):
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            if attempt == max_retries - 1:
                _log.error("임베딩 API 실패 (재시도 %d회 소진): %s", max_retries, e)
                raise
            delay = base_delay * (2 ** attempt)
            _log.warning("임베딩 API 재시도 %d/%d (%.1fs 후): %s",
                         attempt + 1, max_retries, delay, e)
            time.sleep(delay)


def _get_client():
    """OpenAI 클라이언트 lazy 생성"""
    try:
        from openai import OpenAI
        from config.settings import get_api_key
        api_key = get_api_key("OPENAI_API_KEY")
        if not api_key:
            return None
        return OpenAI(api_key=api_key)
    except ImportError:
        _log.warning("openai 패키지 미설치")
        return None


def create_embedding(text: str, client=None,
                     model: str = DEFAULT_EMBEDDING_MODEL) -> list[float]:
    """단일 텍스트 임베딩 생성"""
    text = (text or "").strip()
    if not text:
        return []

    model = model or DEFAULT_EMBEDDING_MODEL
    cached = _get_cached(text, model)
    if cached is not None:
        return cached

    if len(text) > MAX_INPUT_TOKENS * 2:
        text = text[:MAX_INPUT_TOKENS * 2]
        _log.warning("임베딩 입력 길이 초과 -- %d자로 절삭", len(text))

    if client is None:
        client = _get_client()
    if client is None:
        _log.warning("OpenAI 클라이언트 없음 -- 빈 벡터 반환")
        return []

    def _call():
        resp = client.embeddings.create(model=model, input=[text])
        return list(resp.data[0].embedding) if resp.data else []

    vec = _retry_call(_call)
    if vec:
        _put_cache(text, model, vec)
    return vec


def create_embeddings(texts: Sequence[str], client=None,
                      model: str = DEFAULT_EMBEDDING_MODEL) -> List[list[float]]:
    """배치 임베딩 생성 (캐시 활용)"""
    model = model or DEFAULT_EMBEDDING_MODEL
    cleaned = [str(t).strip() for t in texts if str(t).strip()]
    if not cleaned:
        return []

    if client is None:
        client = _get_client()
    if client is None:
        _log.warning("OpenAI 클라이언트 없음 -- 빈 벡터 반환")
        return [[] for _ in cleaned]

    results: dict[int, list[float]] = {}
    uncached_indices: list[int] = []
    uncached_texts: list[str] = []

    for i, t in enumerate(cleaned):
        cached = _get_cached(t, model)
        if cached is not None:
            results[i] = cached
        else:
            uncached_indices.append(i)
            uncached_texts.append(t)

    if uncached_texts:
        # 배치 크기 제한 (OpenAI 최대 2048개)
        batch_size = 256
        for batch_start in range(0, len(uncached_texts), batch_size):
            batch_texts = uncached_texts[batch_start:batch_start + batch_size]
            batch_indices = uncached_indices[batch_start:batch_start + batch_size]

            def _call():
                return client.embeddings.create(model=model, input=batch_texts)

            resp = _retry_call(_call)
            for j, item in enumerate(resp.data):
                vec = list(item.embedding)
                idx = batch_indices[j]
                results[idx] = vec
                _put_cache(batch_texts[j], model, vec)

    return [results.get(i, []) for i in range(len(cleaned))]


# ══════════════════════════════════════════════════════════════
# 유사도 계산 유틸
# ══════════════════════════════════════════════════════════════

def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """코사인 유사도 계산"""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0

    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))

    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def find_most_similar(query_vec: list[float], candidates: list[dict],
                      vec_key: str = "vector", top_k: int = 5) -> list[dict]:
    """가장 유사한 후보 찾기

    Args:
        query_vec: 쿼리 벡터
        candidates: [{"text": "...", "vector": [...], ...}, ...]
        vec_key: 벡터가 저장된 키
        top_k: 반환할 상위 개수

    Returns:
        유사도 순으로 정렬된 상위 후보
    """
    scored = []
    for c in candidates:
        vec = c.get(vec_key, [])
        if vec:
            sim = cosine_similarity(query_vec, vec)
            scored.append({**c, "similarity": round(sim, 4)})

    scored.sort(key=lambda x: -x.get("similarity", 0))
    return scored[:top_k]


# ══════════════════════════════════════════════════════════════
# 텍스트 청킹
# ══════════════════════════════════════════════════════════════

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """텍스트를 겹치는 청크로 분할

    Args:
        text: 원본 텍스트
        chunk_size: 청크 크기 (문자 수)
        overlap: 겹침 크기

    Returns:
        청크 리스트
    """
    if not text or len(text) <= chunk_size:
        return [text] if text else []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]

        # 문장 경계에서 자르기
        if end < len(text):
            last_period = chunk.rfind(".")
            last_newline = chunk.rfind("\n")
            cut_point = max(last_period, last_newline)
            if cut_point > chunk_size * 0.5:
                chunk = chunk[:cut_point + 1]
                end = start + cut_point + 1

        chunks.append(chunk.strip())
        start = end - overlap

    return [c for c in chunks if c]
