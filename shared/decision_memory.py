"""Decision Memory — 판단 근거 기록 시스템 (Mother 공유)

모든 프로젝트에서 "왜 그렇게 판단했는가"를 구조적으로 기록.
Fact Memory(무슨 일이 있었는가)와 분리.

사용:
    from decision_memory import log_decision
    log_decision("ONGLE", "Phase 1.3 품질 게이트 9차원 확정",
                 reason="헌장 요구사항 + 실데이터 부재로 1단계 차단 비활성",
                 alternatives=["6차원 유지", "LLM 평가만"],
                 chosen="9차원 로컬 패턴",
                 confidence="medium")
"""

import json
from datetime import datetime
from pathlib import Path

DECISION_LOG_DIR = Path("data/decision_log")


def log_decision(project: str, decision: str, reason: str = "",
                 alternatives: list[str] = None, chosen: str = "",
                 confidence: str = "medium", tags: list[str] = None):
    """판단 근거를 기록."""
    DECISION_LOG_DIR.mkdir(parents=True, exist_ok=True)

    entry = {
        "project": project,
        "decision": decision,
        "reason": reason,
        "alternatives": alternatives or [],
        "chosen": chosen,
        "confidence": confidence,
        "tags": tags or [],
        "timestamp": datetime.now().isoformat(),
    }

    # JSONL 형식으로 append
    log_file = DECISION_LOG_DIR / f"{project.lower()}_decisions.jsonl"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def get_recent_decisions(project: str, limit: int = 10) -> list[dict]:
    """최근 판단 기록 조회."""
    log_file = DECISION_LOG_DIR / f"{project.lower()}_decisions.jsonl"
    if not log_file.exists():
        return []

    decisions = []
    for line in log_file.read_text(encoding="utf-8").strip().split("\n"):
        try:
            decisions.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    return decisions[-limit:]


def search_decisions(project: str, keyword: str) -> list[dict]:
    """키워드로 과거 판단 검색."""
    all_decisions = get_recent_decisions(project, limit=100)
    return [d for d in all_decisions
            if keyword.lower() in d.get("decision", "").lower()
            or keyword.lower() in d.get("reason", "").lower()]
