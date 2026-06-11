"""교차 AI 검증 -- GPT-4.1 / Claude Sonnet / Gemini 2.0 교차 검증 파이프라인

워크루트 용도:
- 자소서/면접 답변의 AI 냄새 탐지, 자연스러움 점수화
- 다중 AI 교차 검증으로 결과 신뢰도 향상
- GPT + Claude + Gemini 병렬 파이프라인

고도화:
- 3 AI 병렬 호출 (threading)
- 교차 검증 파이프라인 (합의/불일치 분석)
- 신뢰도 점수 산출
- AI Slop 감지 강화
- 자소서 교차 분석
"""

import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from config.settings import get_api_key
from config.logger import get_logger

_log = get_logger("cross_check")


# ══════════════════════════════════════════════════════════════
# Provider 건강 추적 (일시 실패 시 자동 스킵)
# ══════════════════════════════════════════════════════════════

_provider_health: dict[str, dict] = {}
_CIRCUIT_BREAKER_THRESHOLD = 3   # 연속 실패 횟수
_CIRCUIT_BREAKER_COOLDOWN = 300  # 쿨다운 5분 (초)


def _record_success(provider: str):
    _provider_health[provider] = {"failures": 0, "last_failure": 0}


def _record_failure(provider: str):
    h = _provider_health.setdefault(provider, {"failures": 0, "last_failure": 0})
    h["failures"] += 1
    h["last_failure"] = time.time()


def _is_provider_healthy(provider: str) -> bool:
    h = _provider_health.get(provider)
    if not h:
        return True
    if h["failures"] < _CIRCUIT_BREAKER_THRESHOLD:
        return True
    # 쿨다운 경과 시 리셋
    if time.time() - h["last_failure"] > _CIRCUIT_BREAKER_COOLDOWN:
        h["failures"] = 0
        return True
    return False


def get_provider_health() -> dict:
    """외부에서 프로바이더 상태 조회"""
    return {p: {**h, "healthy": _is_provider_healthy(p)} for p, h in _provider_health.items()}


# ══════════════════════════════════════════════════════════════
# AI Provider 호출 함수
# ══════════════════════════════════════════════════════════════

def _call_anthropic(system: str, user: str, model: str = "claude-sonnet-4-20250514",
                    max_tokens: int = 1500) -> str:
    api_key = get_api_key("ANTHROPIC_API_KEY")
    if not api_key:
        return ""

    payload = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload, method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result = data.get("content", [{}])[0].get("text", "")
            usage = data.get("usage", {})
            if result:
                _record_success("anthropic")
            try:
                import sys; sys.path.insert(0, "C:/JARVIS_NEW")
                from shared.api_cost_tracker import tracked_call
                tracked_call("anthropic", model, usage.get("input_tokens", 0), usage.get("output_tokens", 0), os.environ.get("CURRENT_PROJECT", ""), "cross_checker._call_anthropic")
            except Exception:
                pass
            return result
    except Exception as e:
        _log.warning("Anthropic API 실패: %s", e)
        _record_failure("anthropic")
        return ""


def _call_gemini(prompt: str, model: str = "gemini-2.0-flash") -> str:
    api_key = get_api_key("GEMINI_API_KEY")
    if not api_key:
        return ""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 1500},
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, method="POST",
                                headers={"content-type": "application/json",
                                         "x-goog-api-key": api_key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            usage = data.get("usageMetadata", {})
            if result:
                _record_success("gemini")
            try:
                import sys; sys.path.insert(0, "C:/JARVIS_NEW")
                from shared.api_cost_tracker import tracked_call
                tracked_call("gemini", model, usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0), os.environ.get("CURRENT_PROJECT", ""), "cross_checker._call_gemini")
            except Exception:
                pass
            return result
    except Exception as e:
        _log.warning("Gemini API 실패: %s", e)
        _record_failure("gemini")
        return ""


def _call_openai(system: str, user: str, model: str = "gpt-4.1",
                 max_tokens: int = 1500) -> str:
    api_key = get_api_key("OPENAI_API_KEY")
    if not api_key:
        return ""

    payload = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload, method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            usage = data.get("usage", {})
            if result:
                _record_success("openai")
            try:
                import sys; sys.path.insert(0, "C:/JARVIS_NEW")
                from shared.api_cost_tracker import tracked_call
                tracked_call("openai", model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), os.environ.get("CURRENT_PROJECT", ""), "cross_checker._call_openai")
            except Exception:
                pass
            return result
    except Exception as e:
        _log.warning("OpenAI API 실패: %s", e)
        _record_failure("openai")
        return ""


# ══════════════════════════════════════════════════════════════
# 유틸리티
# ══════════════════════════════════════════════════════════════

def _parse_json_response(raw: str) -> dict | None:
    """AI 응답에서 JSON 추출"""
    try:
        s = raw.index("{")
        e = raw.rindex("}") + 1
        return json.loads(raw[s:e])
    except Exception:
        return None


def _timed_call(fn, *args) -> tuple[str, int]:
    """함수 호출 + 소요시간(ms) 측정"""
    start = time.time()
    result = fn(*args)
    latency = round((time.time() - start) * 1000)
    return result, latency


# ══════════════════════════════════════════════════════════════
# Provider 정보
# ══════════════════════════════════════════════════════════════

def get_available_providers() -> list[str]:
    """사용 가능한 AI 제공자 목록"""
    providers = []
    if get_api_key("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    if get_api_key("GEMINI_API_KEY"):
        providers.append("gemini")
    if get_api_key("OPENAI_API_KEY"):
        providers.append("openai")
    return providers


def get_available_provider() -> str:
    """첫 번째 사용 가능한 제공자"""
    providers = get_available_providers()
    return providers[0] if providers else "none"


MODEL_INFO = {
    "openai": {"name": "GPT-4.1", "provider": "OpenAI", "key_env": "OPENAI_API_KEY"},
    "anthropic": {"name": "Claude Sonnet", "provider": "Anthropic", "key_env": "ANTHROPIC_API_KEY"},
    "gemini": {"name": "Gemini 2.0", "provider": "Google", "key_env": "GEMINI_API_KEY"},
}


def get_models_status() -> list[dict]:
    """사용 가능 AI 모델 목록 + 상태"""
    result = []
    for key, info in MODEL_INFO.items():
        has_key = bool(get_api_key(info["key_env"]))
        result.append({
            "id": key,
            "name": info["name"],
            "provider": info["provider"],
            "available": has_key,
            "status": "ready" if has_key else "no_api_key",
        })
    return result


# ══════════════════════════════════════════════════════════════
# 3 AI 병렬 호출
# ══════════════════════════════════════════════════════════════

def _call_all_parallel(system: str, user_prompt: str) -> dict:
    """3개 AI에 동일 프롬프트를 병렬(threading)로 전송하고 결과 수집.
    건강하지 않은 프로바이더는 자동 스킵 (circuit breaker)."""
    providers = get_available_providers()
    results: dict[str, dict] = {}

    # 건강한 프로바이더만 호출
    healthy_providers = [p for p in providers if _is_provider_healthy(p)]
    skipped = [p for p in providers if not _is_provider_healthy(p)]
    if skipped:
        _log.warning("Circuit breaker — 스킵된 프로바이더: %s", skipped)

    def _do_openai():
        raw, ms = _timed_call(_call_openai, system, user_prompt)
        return "openai", raw, ms

    def _do_anthropic():
        raw, ms = _timed_call(_call_anthropic, system, user_prompt)
        return "anthropic", raw, ms

    def _do_gemini():
        full = f"System: {system}\n\nUser: {user_prompt}"
        raw, ms = _timed_call(_call_gemini, full)
        return "gemini", raw, ms

    task_map = {"openai": _do_openai, "anthropic": _do_anthropic, "gemini": _do_gemini}
    tasks = [task_map[p] for p in healthy_providers if p in task_map]

    if not tasks:
        return results

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(fn) for fn in tasks]
        for f in as_completed(futures):
            try:
                provider, raw, ms = f.result()
                results[provider] = {"raw": raw, "latency_ms": ms}
            except Exception as e:
                _log.warning("병렬 호출 실패: %s", e)

    return results


# ══════════════════════════════════════════════════════════════
# 교차 검증 파이프라인 (메인)
# ══════════════════════════════════════════════════════════════

def cross_validate(prompt: str, task_type: str = "general") -> dict:
    """3개 AI에 동일 프롬프트 → 병렬 호출 → 합의 분석

    Args:
        prompt: 분석할 프롬프트 전문
        task_type: "cfa" | "interview" | "general"

    Returns:
        교차 검증 결과 dict
    """
    system = _get_system_prompt(task_type)

    # 1. 3개 AI 병렬 호출
    raw_results = _call_all_parallel(system, prompt)

    if not raw_results:
        return _mock_cross_validation(prompt, task_type)

    # 2. 응답 파싱
    individual: dict[str, dict] = {}
    parsed_list: list[tuple[str, dict]] = []

    for provider, data in raw_results.items():
        raw = data.get("raw", "")
        latency = data.get("latency_ms", 0)
        parsed = _parse_json_response(raw) if raw else None

        individual[provider] = {
            "result": raw if raw else None,
            "parsed": parsed,
            "latency_ms": latency,
        }
        if parsed:
            parsed_list.append((provider, parsed))

    if not parsed_list:
        return _mock_cross_validation(prompt, task_type)

    # 3. 합의 분석
    agreement = _analyze_agreement(parsed_list, task_type)

    # 4. 최종 결과 선택 (다수결 또는 가장 상세한 응답)
    final_result = _select_final_result(parsed_list, individual)

    models_used = [MODEL_INFO.get(p, {}).get("name", p) for p in individual.keys()]

    # degraded 모드 판단
    total_available = len(get_available_providers())
    actual_responded = len([p for p in individual.values() if p.get("result")])
    mode = "full" if actual_responded >= 3 else ("degraded" if actual_responded >= 1 else "fallback")

    return {
        "final_result": final_result,
        "confidence": agreement["confidence"],
        "confidence_score": agreement["confidence_score"],
        "models_used": models_used,
        "individual_results": {
            p: {"result": d.get("result", ""), "latency_ms": d.get("latency_ms", 0)}
            for p, d in individual.items()
        },
        "agreement_matrix": agreement.get("matrix", {}),
        "divergence_points": agreement.get("divergence_points", []),
        "task_type": task_type,
        "provider_count": len(individual),
        "mode": mode,
        "providers_available": total_available,
        "providers_responded": actual_responded,
    }


def _get_system_prompt(task_type: str) -> str:
    prompts = {
        "cfa": (
            "자소서 분석 전문가. 채용공고와 자소서를 교차분석하여 "
            "정량적 점수와 구체적 피드백을 제공합니다. JSON으로만 응답하세요."
        ),
        "interview": (
            "면접 답변 평가 전문가. STAR 구조 분석과 "
            "데이터 기반 피드백을 제공합니다. JSON으로만 응답하세요."
        ),
        "general": (
            "텍스트 분석 전문가. 요청된 분석을 정확하게 수행하고 "
            "JSON으로만 응답하세요."
        ),
        "slop_check": (
            "AI 생성 텍스트 감지 전문가. 텍스트가 AI로 생성되었는지, "
            "클리셰가 과도한지 분석합니다. JSON으로만 응답."
        ),
        "quality_check": (
            "자소서/면접 답변 품질 평가 전문가. "
            "내용의 구체성, 논리성, 진정성을 평가합니다. JSON으로만 응답."
        ),
        "fact_check": (
            "사실 확인 전문가. 텍스트의 주장이 논리적으로 일관되는지, "
            "과장이나 모순이 없는지 분석합니다. JSON으로만 응답."
        ),
    }
    return prompts.get(task_type, prompts["general"])


def _analyze_agreement(parsed_list: list[tuple[str, dict]], task_type: str = "general") -> dict:
    """다중 AI 결과의 합의/불일치 분석 (task_type별 적응형 임계값)"""
    if len(parsed_list) < 2:
        return {
            "confidence": "medium",
            "confidence_score": 60,
            "matrix": {},
            "divergence_points": ["AI 1개만 응답하여 교차 검증 불가"],
        }

    # task_type별 합의 임계값 (엄격한 분석은 좁은 허용치)
    _THRESHOLDS = {
        "cfa": {"agree": 10, "high": 8, "med": 15, "low": 25},
        "interview": {"agree": 12, "high": 10, "med": 18, "low": 28},
        "slop_check": {"agree": 15, "high": 12, "med": 22, "low": 35},
        "general": {"agree": 15, "high": 10, "med": 20, "low": 30},
    }
    th = _THRESHOLDS.get(task_type, _THRESHOLDS["general"])

    # 점수 기반 합의 분석
    scores = []
    for provider, parsed in parsed_list:
        score = parsed.get("score") or parsed.get("total_score") or parsed.get("star_score")
        if score is not None:
            scores.append((provider, int(score)))

    # 판정 기반 합의 분석
    verdicts = []
    for provider, parsed in parsed_list:
        v = parsed.get("verdict") or parsed.get("grade") or ""
        if v:
            verdicts.append((provider, str(v).strip().lower()))

    # 합의 매트릭스 생성
    matrix: dict[str, dict] = {}
    divergence_points: list[str] = []

    if len(scores) >= 2:
        for i in range(len(scores)):
            for j in range(i + 1, len(scores)):
                p1, s1 = scores[i]
                p2, s2 = scores[j]
                diff = abs(s1 - s2)
                agreed = diff <= th["agree"]
                key = f"{p1}_vs_{p2}"
                matrix[key] = {"agreed": agreed, "score_diff": diff}
                if not agreed:
                    divergence_points.append(
                        f"{MODEL_INFO.get(p1, {}).get('name', p1)}({s1}점) vs "
                        f"{MODEL_INFO.get(p2, {}).get('name', p2)}({s2}점) — {diff}점 차이"
                    )

        # 점수 분산으로 confidence 결정
        score_values = [s for _, s in scores]
        spread = max(score_values) - min(score_values)

        if spread <= th["high"]:
            confidence = "high"
            confidence_score = 95
        elif spread <= th["med"]:
            confidence = "high"
            confidence_score = 85
        elif spread <= th["low"]:
            confidence = "medium"
            confidence_score = 70
        else:
            confidence = "low"
            confidence_score = max(30, 65 - spread)
    else:
        confidence = "medium"
        confidence_score = 65

    # 판정 합의 보너스/감점
    if len(verdicts) >= 2:
        unique_verdicts = set(v for _, v in verdicts)
        if len(unique_verdicts) == 1:
            # 모든 AI가 같은 판정 → 보너스
            confidence_score = min(99, confidence_score + 8)
        elif len(unique_verdicts) == len(verdicts):
            # 모두 다른 판정 → 감점
            confidence_score = max(20, confidence_score - 10)
            if "판정 불일치" not in str(divergence_points):
                divergence_points.append(f"판정 불일치: {', '.join(v for _, v in verdicts)}")

    # 3개 모두 응답 시 합의 수준 상향
    if len(parsed_list) >= 3 and confidence_score >= 70:
        confidence_score = min(99, confidence_score + 5)

    # confidence 라벨 재산정
    if confidence_score >= 85:
        confidence = "high"
    elif confidence_score >= 60:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "confidence": confidence,
        "confidence_score": confidence_score,
        "matrix": matrix,
        "divergence_points": divergence_points,
        "threshold_used": th,
    }


def _select_final_result(parsed_list: list[tuple[str, dict]], individual: dict) -> str:
    """최종 결과 선택 — 중앙값에 가장 가까운 응답 (편향 방지)"""
    # 점수가 있는 경우: 중앙값에 가장 가까운 응답 선택
    scores = []
    for provider, parsed in parsed_list:
        score = parsed.get("score") or parsed.get("total_score") or parsed.get("star_score")
        if score is not None:
            scores.append((provider, int(score)))

    if len(scores) >= 2:
        values = sorted([s for _, s in scores])
        median = values[len(values) // 2]
        # 중앙값에 가장 가까운 프로바이더
        best = min(scores, key=lambda x: abs(x[1] - median))
        best_provider = best[0]
        if best_provider in individual:
            return individual[best_provider].get("result", "")

    # 폴백: 가장 상세한 응답
    best_provider = ""
    best_len = 0
    for provider, data in individual.items():
        raw = data.get("result", "") or ""
        if len(raw) > best_len:
            best_len = len(raw)
            best_provider = provider

    if best_provider:
        return individual[best_provider].get("result", "")
    return ""


# ══════════════════════════════════════════════════════════════
# AI Slop 감지 강화 (3 AI 교차)
# ══════════════════════════════════════════════════════════════

_SLOP_PATTERNS = [
    r"끊임없는\s*노력",
    r"항상\s*최선을\s*다",
    r"열정적으로\s*임하",
    r"소통\s*능력이\s*뛰어",
    r"다양한\s*경험을\s*통해",
    r"주어진\s*업무에\s*충실",
    r"긍정적인\s*마인드",
    r"팀워크를?\s*중시",
    r"커뮤니케이션\s*역량",
    r"성장\s*가능성",
    r"새로운\s*도전",
    r"무한한?\s*가능성",
    r"혁신적인?\s*사고",
    r"리더십을?\s*발휘",
    r"적극적으로\s*참여",
    r"능동적으로\s*대처",
    r"시너지를?\s*창출",
    r"글로벌\s*역량",
    r"차별화된?\s*경쟁력",
    r"선도적인?\s*역할",
    r"핵심\s*인재",
    r"가치를?\s*창출",
    r"비전을?\s*제시",
    r"창의적인?\s*해결",
]


def detect_ai_writing(text: str) -> dict:
    """AI 작성 여부 3AI 교차 감지

    3 AI에게 동일 프롬프트로 AI 생성 여부 판별 요청.
    결과를 교차하여 human_score (사람다움 0~100) 산출.
    """
    # 로컬 패턴 기반 기초 분석
    found_slops = []
    for pattern in _SLOP_PATTERNS:
        matches = re.findall(pattern, text)
        if matches:
            found_slops.extend(matches)

    slop_density = len(found_slops) / max(len(text.split()), 1) * 100
    local_slop_score = min(100, round(slop_density * 20))

    # AI 교차 판별
    system = (
        "AI 생성 텍스트 감지 전문가. 텍스트가 AI(ChatGPT, Claude 등)로 생성되었는지 "
        "분석하세요. 클리셰, 구조적 패턴, 어휘 다양성, 자연스러움을 종합 판단합니다. "
        "JSON으로만 응답하세요."
    )
    prompt = f"""다음 텍스트가 AI가 작성한 것인지 분석하세요:

---
{text[:2000]}
---

JSON으로 응답:
{{
  "ai_probability": 0~100 (AI가 작성했을 확률),
  "human_probability": 0~100 (사람이 작성했을 확률),
  "verdict": "AI 작성 의심" 또는 "사람 작성 추정" 또는 "판단 어려움",
  "evidence": ["근거 1", "근거 2", "근거 3"],
  "suspicious_phrases": ["AI 특유 표현1", "표현2"],
  "naturalness_score": 0~100 (자연스러움 점수)
}}"""

    raw_results = _call_all_parallel(system, prompt)

    ai_scores: list[int] = []
    human_scores: list[int] = []
    all_evidence: list[str] = []
    all_suspicious: list[str] = []
    provider_verdicts: dict[str, dict] = {}

    for provider, data in raw_results.items():
        raw = data.get("raw", "")
        parsed = _parse_json_response(raw) if raw else None
        if parsed:
            ai_prob = parsed.get("ai_probability", 50)
            human_prob = parsed.get("human_probability", 50)
            ai_scores.append(int(ai_prob))
            human_scores.append(int(human_prob))
            all_evidence.extend(parsed.get("evidence", []))
            all_suspicious.extend(parsed.get("suspicious_phrases", []))
            provider_verdicts[provider] = {
                "ai_probability": ai_prob,
                "human_probability": human_prob,
                "verdict": parsed.get("verdict", ""),
                "latency_ms": data.get("latency_ms", 0),
            }

    # 교차 결과 합산
    if ai_scores:
        avg_ai = round(sum(ai_scores) / len(ai_scores))
        avg_human = round(sum(human_scores) / len(human_scores))
    else:
        # AI 호출 실패 시 로컬 분석만 사용
        avg_ai = local_slop_score
        avg_human = 100 - local_slop_score

    # 로컬 패턴과 AI 판단 합산 (7:3)
    final_human_score = max(0, min(100, round(avg_human * 0.7 + (100 - local_slop_score) * 0.3)))

    if final_human_score >= 70:
        risk = "low"
        advice = "사람이 작성한 것으로 판단됩니다. 자연스러운 문체입니다."
    elif final_human_score >= 40:
        risk = "medium"
        advice = "일부 AI 생성 의심 패턴이 있습니다. 구체적 경험과 수치를 추가하세요."
    else:
        risk = "high"
        advice = "AI 생성 의심이 높습니다. 자신만의 경험과 구체적 사례로 재작성하세요."

    return {
        "human_score": final_human_score,
        "ai_score": 100 - final_human_score,
        "risk_level": risk,
        "advice": advice,
        "local_analysis": {
            "slop_score": local_slop_score,
            "found_patterns": found_slops[:10],
            "pattern_count": len(found_slops),
        },
        "ai_analysis": {
            "providers_used": list(provider_verdicts.keys()),
            "provider_verdicts": provider_verdicts,
            "avg_ai_probability": avg_ai if ai_scores else None,
            "avg_human_probability": avg_human if human_scores else None,
        },
        "suspicious_phrases": list(set(all_suspicious))[:10],
        "evidence": list(set(all_evidence))[:10],
        "slop_patterns": _SLOP_PATTERNS,
    }


# ══════════════════════════════════════════════════════════════
# 자소서 교차 분석 (3 AI)
# ══════════════════════════════════════════════════════════════

def cross_analyze_essay(jd: str, essay: str) -> dict:
    """3 AI에게 동일한 CFA 분석 프롬프트 → 5축 점수 평균 + 의견 비교

    Args:
        jd: 채용공고 텍스트
        essay: 자소서 텍스트

    Returns:
        교차 분석 결과 dict
    """
    system = (
        "한국 취업 시장 자소서 분석 전문가. "
        "채용공고와 자소서를 교차분석하여 5개 축으로 정량 평가합니다. "
        "과장 없이 데이터 근거 평가. JSON으로만 응답하세요."
    )

    prompt = f"""채용공고와 자소서를 교차분석하세요.

=== 채용공고 (JD) ===
{jd[:3000]}

=== 자소서 ===
{essay[:3000]}

5개 축 점수를 산출하고 JSON으로 응답하세요:
{{
  "scores": {{
    "keyword_match": {{"score": 0, "max": 25, "detail": "키워드 매칭 분석"}},
    "competency_coverage": {{"score": 0, "max": 25, "detail": "역량 커버리지 분석"}},
    "experience_specificity": {{"score": 0, "max": 20, "detail": "경험 구체성 분석"}},
    "culture_fit": {{"score": 0, "max": 20, "detail": "문화 정합성 분석"}},
    "differentiation": {{"score": 0, "max": 10, "detail": "차별화 분석"}}
  }},
  "total_score": 0,
  "verdict": "종합 1줄 판정",
  "top_strength": "가장 큰 강점",
  "top_weakness": "가장 시급한 약점",
  "improvement": "핵심 개선 제안"
}}"""

    raw_results = _call_all_parallel(system, prompt)

    # 개별 결과 파싱
    individual: dict[str, dict] = {}
    all_scores: dict[str, list[int]] = {
        "keyword_match": [],
        "competency_coverage": [],
        "experience_specificity": [],
        "culture_fit": [],
        "differentiation": [],
    }
    total_scores: list[int] = []

    for provider, data in raw_results.items():
        raw = data.get("raw", "")
        parsed = _parse_json_response(raw) if raw else None
        individual[provider] = {
            "raw": raw,
            "parsed": parsed,
            "latency_ms": data.get("latency_ms", 0),
        }
        if parsed and "scores" in parsed:
            scores = parsed["scores"]
            for axis in all_scores:
                if axis in scores:
                    s = scores[axis]
                    val = s.get("score", 0) if isinstance(s, dict) else s
                    all_scores[axis].append(int(val))
            ts = parsed.get("total_score")
            if ts is not None:
                total_scores.append(int(ts))

    if not total_scores:
        return _mock_essay_analysis(jd, essay)

    # 5축 평균 산출
    avg_scores: dict[str, dict] = {}
    divergent_axes: list[str] = []
    axis_labels = {
        "keyword_match": "키워드 매칭",
        "competency_coverage": "역량 커버리지",
        "experience_specificity": "경험 구체성",
        "culture_fit": "문화 정합성",
        "differentiation": "차별화",
    }
    axis_max = {"keyword_match": 25, "competency_coverage": 25,
                "experience_specificity": 20, "culture_fit": 20, "differentiation": 10}

    for axis, values in all_scores.items():
        if values:
            avg = round(sum(values) / len(values), 1)
            spread = max(values) - min(values) if len(values) > 1 else 0
            avg_scores[axis] = {
                "avg_score": avg,
                "max": axis_max.get(axis, 25),
                "individual": values,
                "spread": spread,
                "divergent": spread > 5,
            }
            if spread > 5:
                divergent_axes.append(axis_labels.get(axis, axis))
        else:
            avg_scores[axis] = {
                "avg_score": 0,
                "max": axis_max.get(axis, 25),
                "individual": [],
                "spread": 0,
                "divergent": False,
            }

    avg_total = round(sum(total_scores) / len(total_scores), 1)
    total_spread = max(total_scores) - min(total_scores) if len(total_scores) > 1 else 0

    # confidence
    if total_spread <= 10:
        confidence = "high"
        confidence_score = 95
    elif total_spread <= 20:
        confidence = "medium"
        confidence_score = 78
    else:
        confidence = "low"
        confidence_score = max(30, 65 - total_spread)

    models_used = [MODEL_INFO.get(p, {}).get("name", p) for p in individual.keys()]

    return {
        "avg_total_score": avg_total,
        "confidence": confidence,
        "confidence_score": confidence_score,
        "models_used": models_used,
        "axis_scores": avg_scores,
        "divergent_axes": divergent_axes,
        "individual_results": {
            p: {
                "parsed": d.get("parsed"),
                "latency_ms": d.get("latency_ms", 0),
            }
            for p, d in individual.items()
        },
        "total_scores_by_provider": {
            p: d.get("parsed", {}).get("total_score")
            for p, d in individual.items()
            if d.get("parsed")
        },
        "provider_count": len(individual),
    }


# ══════════════════════════════════════════════════════════════
# (레거시 호환) 기존 cross_validate 인터페이스
# ══════════════════════════════════════════════════════════════

def _get_validation_system_prompt(vtype: str) -> str:
    return _get_system_prompt(vtype)


def _get_validation_prompt(text: str, vtype: str) -> str:
    return f"""다음 텍스트를 분석하세요:

{text[:2000]}

JSON으로 응답:
{{
  "score": 0~100 (높을수록 {"AI 생성 의심" if vtype == "slop_check" else "품질 높음"}),
  "verdict": "판정 결과 1줄",
  "evidence": ["근거 1", "근거 2", "근거 3"],
  "suggestion": "개선 제안 1줄"
}}"""


def _parse_validation_response(raw: str) -> dict | None:
    return _parse_json_response(raw)


def _analyze_consensus(results: dict) -> dict:
    """다중 AI 결과의 합의 분석 (레거시)"""
    scores = [r.get("score", 50) for r in results.values() if isinstance(r, dict)]
    if not scores:
        return {"consensus": "unknown", "confidence": 0}

    avg_score = sum(scores) / len(scores)
    score_spread = max(scores) - min(scores) if len(scores) > 1 else 0

    if score_spread <= 10:
        consensus_level = "strong"
        confidence = 90
    elif score_spread <= 20:
        consensus_level = "moderate"
        confidence = 70
    elif score_spread <= 35:
        consensus_level = "weak"
        confidence = 50
    else:
        consensus_level = "disagree"
        confidence = 30

    verdicts = [r.get("verdict", "") for r in results.values() if isinstance(r, dict)]

    return {
        "consensus_level": consensus_level,
        "avg_score": round(avg_score, 1),
        "score_range": {"min": min(scores), "max": max(scores), "spread": score_spread},
        "confidence": confidence,
        "verdicts_summary": verdicts,
    }


# ══════════════════════════════════════════════════════════════
# 목업 결과
# ══════════════════════════════════════════════════════════════

def _mock_cross_validation(text: str, vtype: str) -> dict:
    """목업 교차 검증 결과"""
    word_count = len(text.split())
    base_score = min(40 + word_count // 5, 75)

    return {
        "final_result": "AI 제공자 미설정으로 목업 결과입니다.",
        "confidence": "low",
        "confidence_score": 0,
        "models_used": ["mock"],
        "individual_results": {
            "mock": {"result": "API 키가 설정되지 않았습니다.", "latency_ms": 0},
        },
        "agreement_matrix": {},
        "divergence_points": ["API 키가 설정되지 않았습니다."],
        "task_type": vtype,
        "provider_count": 0,
    }


def _mock_essay_analysis(jd: str, essay: str) -> dict:
    """목업 자소서 교차 분석 결과"""
    cl_len = len(essay)
    base = min(55 + cl_len // 100, 75)

    return {
        "avg_total_score": base,
        "confidence": "low",
        "confidence_score": 0,
        "models_used": ["mock"],
        "axis_scores": {
            "keyword_match": {"avg_score": round(base * 0.25), "max": 25, "individual": [], "spread": 0, "divergent": False},
            "competency_coverage": {"avg_score": round(base * 0.24), "max": 25, "individual": [], "spread": 0, "divergent": False},
            "experience_specificity": {"avg_score": round(base * 0.19), "max": 20, "individual": [], "spread": 0, "divergent": False},
            "culture_fit": {"avg_score": round(base * 0.20), "max": 20, "individual": [], "spread": 0, "divergent": False},
            "differentiation": {"avg_score": round(base * 0.08), "max": 10, "individual": [], "spread": 0, "divergent": False},
        },
        "divergent_axes": [],
        "individual_results": {},
        "total_scores_by_provider": {},
        "provider_count": 0,
    }
