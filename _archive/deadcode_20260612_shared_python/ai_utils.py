"""공통 AI 호출 유틸리티 -- 모든 엔진에서 사용하는 AI 호출 + JSON 파싱 패턴

사용법:
    from services.ai_utils import analyze_with_ai

    result = analyze_with_ai(system, prompt, max_tokens=800)
    if result is None:
        # fallback 처리
"""

import json
import logging

# 동적 logger fallback — 프로젝트별 config.logger 경로가 다름
try:
    from config.logger import get_logger
except ImportError:
    def get_logger(name):
        return logging.getLogger(name)

_log = get_logger("ai_utils")

# ── import 캐시 (resolve once, reuse) ──
_anthropic_caller = None
_anthropic_resolved = False


def _resolve_anthropic_caller():
    """프로젝트별 cross_checker 경로를 1회 탐색, 결과 캐시"""
    global _anthropic_caller, _anthropic_resolved
    if _anthropic_resolved:
        return _anthropic_caller

    _anthropic_resolved = True

    search_paths = [
        "content.cross_checker",              # ONGLE
        "services.cross_checker",             # NAEUM, WORKROOT (PYTHONPATH에 backend/ 포함)
        "backend.services.cross_checker",     # NAEUM, WORKROOT (프로젝트 루트 기준)
    ]

    # 상대 import 시도 (같은 패키지 내 cross_checker — NAEUM/WORKROOT services/)
    try:
        from importlib import import_module
        mod = import_module(".cross_checker", package=__package__)
        fn = getattr(mod, "_call_anthropic", None)
        if fn:
            _anthropic_caller = fn
            _log.info("ai_utils import resolved: .cross_checker (relative)")
            return _anthropic_caller
    except (ImportError, AttributeError, TypeError):
        pass

    # 절대 import fallback 체인
    for mod_path in search_paths:
        try:
            mod = __import__(mod_path, fromlist=["_call_anthropic"])
            fn = getattr(mod, "_call_anthropic", None)
            if fn:
                _anthropic_caller = fn
                _log.info("ai_utils import resolved: %s", mod_path)
                return _anthropic_caller
        except (ImportError, AttributeError):
            continue

    _log.warning("cross_checker._call_anthropic을 찾을 수 없음 — AI 호출 불가")
    return None


def analyze_with_ai(system: str, prompt: str, max_tokens: int = 1500) -> dict | None:
    """AI 호출 시도 -- 성공 시 dict, 실패 시 None

    1. Anthropic API 호출 (동적 cross_checker 탐색, 1회 resolve + 캐시)
    2. 응답에서 JSON 추출
    3. 파싱 실패 또는 API 실패 시 None 반환 (caller가 fallback 처리)
    """
    call_anthropic = _resolve_anthropic_caller()
    if not call_anthropic:
        return None

    raw = call_anthropic(system, prompt, max_tokens=max_tokens)
    if not raw:
        _log.info("AI 응답 없음 -- fallback 사용")
        return None

    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        result = json.loads(raw[start:end])
        return result
    except (ValueError, json.JSONDecodeError) as e:
        _log.warning("AI 응답 JSON 파싱 실패: %s", e)
        return None
