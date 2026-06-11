"""모델 라우팅 — 작업 유형별 최적 모델 자동 선택 (Mother 공유)

비용 통제와 품질 균형. budget_governor와 연동.

사용:
    from model_router import select_model
    model = select_model(task_type="generation", project="ONGLE")
    # 예산 여유 → "gpt-4.1-mini", 예산 부족 → "gpt-4.1-mini" (저비용)
"""

from config.logger import get_logger

_log = get_logger("model_router")

# 작업 유형별 기본 모델
TASK_MODELS = {
    "design": "claude-opus-4-6",       # 아키텍처, 판단, Phase 관리
    "generation": "gpt-4.1-mini",      # 콘텐츠 생성
    "review": "gpt-4.1-mini",          # 검수/리라이트
    "analysis": "gpt-4.1-mini",        # 분석/리서치
    "verification": "claude-haiku-4-5", # 테스트/검증
    "inspection": "claude-opus-4-6",   # Inspector 점검
    "simple": "claude-haiku-4-5",      # 단순 분류/태깅
}

# 저비용 모드 대체 모델
LOW_COST_MODELS = {
    "claude-opus-4-6": "claude-sonnet-4-6",
    "claude-sonnet-4-6": "claude-haiku-4-5",
    "gpt-4.1": "gpt-4.1-mini",
    "gpt-4.1-mini": "gpt-4.1-mini",  # 이미 저비용
    "gpt-4o": "gpt-4.1-mini",
}


def select_model(task_type: str = "generation", project: str = "",
                 force_model: str = "") -> str:
    """작업 유형 + 예산 상태 기반 최적 모델 선택."""
    if force_model:
        return force_model

    base_model = TASK_MODELS.get(task_type, "gpt-4.1-mini")

    # 예산 체크
    if project:
        try:
            from budget_governor import check_budget
            budget = check_budget(project)
            if budget["mode"] == "stop":
                _log.warning("예산 초과 (%s) — 생성 중단", project)
                return ""  # 빈 문자열 = 생성 중단
            elif budget["mode"] == "low_cost":
                base_model = LOW_COST_MODELS.get(base_model, base_model)
                _log.info("저비용 모드 (%s) → %s", project, base_model)
        except ImportError:
            pass

    return base_model


def get_model_cost_estimate(model: str, input_tokens: int = 2000,
                            output_tokens: int = 1000) -> float:
    """예상 비용 (원) 계산."""
    from budget_governor import TOKEN_COSTS
    costs = TOKEN_COSTS.get(model, {"input": 0.001, "output": 0.004})
    return round(input_tokens * costs["input"] + output_tokens * costs["output"], 2)
