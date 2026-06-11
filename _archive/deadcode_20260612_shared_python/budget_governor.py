"""Budget Governor — API 비용 추정 + 예산 한도 관리 (Mother 공유)

프로젝트별 일일 API 예산을 설정하고, 초과 시 저비용 모드 자동 전환.

사용:
    from budget_governor import check_budget, log_api_cost, get_daily_summary

    # 비용 기록
    log_api_cost("ONGLE", "gpt-4.1-mini", input_tokens=2000, output_tokens=1000)

    # 예산 체크
    result = check_budget("ONGLE")
    if result["mode"] == "low_cost":
        model = "gpt-4.1-mini"  # 저비용 모드
"""

import json
from datetime import datetime, date
from pathlib import Path

from config.logger import get_logger

_log = get_logger("budget_governor")

BUDGET_DIR = Path("data/budget")

# 프로젝트별 일일 예산 (원)
DAILY_BUDGETS = {
    "ONGLE": 50000,
    "ARKIS": 80000,
    "WORKROOT": 20000,
    "NAEUM": 15000,
    "MONGGEUL": 15000,
    "MINIVERSE": 10000,
}

# 모델별 토큰당 비용 (원, 근사치)
TOKEN_COSTS = {
    "gpt-4.1": {"input": 0.0028, "output": 0.011},
    "gpt-4.1-mini": {"input": 0.00056, "output": 0.0022},
    "gpt-4o": {"input": 0.0035, "output": 0.014},
    "claude-sonnet-4-6": {"input": 0.0042, "output": 0.021},
    "claude-opus-4-6": {"input": 0.021, "output": 0.105},
    "claude-haiku-4-5": {"input": 0.0014, "output": 0.007},
}


def log_api_cost(project: str, model: str,
                 input_tokens: int = 0, output_tokens: int = 0):
    """API 호출 비용 기록."""
    BUDGET_DIR.mkdir(parents=True, exist_ok=True)

    costs = TOKEN_COSTS.get(model, TOKEN_COSTS.get("gpt-4.1-mini", {}))
    cost = (input_tokens * costs.get("input", 0.001) +
            output_tokens * costs.get("output", 0.004))

    today = date.today().isoformat()
    log_file = BUDGET_DIR / f"{project.lower()}_{today}.jsonl"

    entry = {
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_krw": round(cost, 2),
        "timestamp": datetime.now().isoformat(),
    }

    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def check_budget(project: str) -> dict:
    """예산 상태 확인. 80% 초과 시 low_cost 모드, 100% 초과 시 stop."""
    budget = DAILY_BUDGETS.get(project, 30000)
    today = date.today().isoformat()
    log_file = BUDGET_DIR / f"{project.lower()}_{today}.jsonl"

    spent = 0.0
    if log_file.exists():
        for line in log_file.read_text(encoding="utf-8").strip().split("\n"):
            try:
                entry = json.loads(line)
                spent += entry.get("cost_krw", 0)
            except json.JSONDecodeError:
                continue

    ratio = spent / max(budget, 1)

    if ratio >= 1.0:
        mode = "stop"
    elif ratio >= 0.8:
        mode = "low_cost"
    else:
        mode = "normal"

    return {
        "project": project,
        "budget": budget,
        "spent": round(spent, 2),
        "remaining": round(budget - spent, 2),
        "ratio": round(ratio, 3),
        "mode": mode,
    }


def get_daily_summary(project: str = "") -> dict:
    """일일 비용 요약."""
    today = date.today().isoformat()
    summary = {}

    projects = [project] if project else list(DAILY_BUDGETS.keys())
    for proj in projects:
        result = check_budget(proj)
        summary[proj] = result

    total_spent = sum(s["spent"] for s in summary.values())
    total_budget = sum(s["budget"] for s in summary.values())

    return {
        "date": today,
        "projects": summary,
        "total_spent": round(total_spent, 2),
        "total_budget": total_budget,
        "total_ratio": round(total_spent / max(total_budget, 1), 3),
    }
