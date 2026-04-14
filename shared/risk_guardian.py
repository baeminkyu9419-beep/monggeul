"""Risk Guardian -- 액션 리스크 판정 + 자동 대응 에이전트 (Mother 공유)

모든 프로젝트에서 위험한 액션을 실행 전에 리스크 레벨을 판정하고,
레벨에 따라 자동진행/로그기록/알림/차단을 수행한다.

budget_governor.py와 연동하여 비용 리스크를 자동 판정한다.

사용:
    from risk_guardian import check_risk, get_risk_history

    # 리스크 판정
    result = check_risk(
        action="bulk_delete",
        project="ONGLE",
        confidence=0.7,
        context={"target": "output/blog/", "count": 50}
    )
    # result = {
    #     "level": "critical",
    #     "response": "blocked",
    #     "reason": "bulk_delete is a critical action (비가역적 대량 삭제)",
    #     "recommendation": "사전 승인 필요 -- ask_before 에스컬레이션"
    # }

    if result["response"] == "blocked":
        print("차단됨:", result["reason"])
    elif result["response"] == "alert":
        notify_admin(result)
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    from config.logger import get_logger
    _log = get_logger("risk_guardian")
except Exception:
    import logging
    _log = logging.getLogger("risk_guardian")

RISK_LOG_DIR = Path("data/risk_logs")

# ── 리스크 룰 정의 ──────────────────────────────────────────────

# 액션별 기본 리스크 레벨
ACTION_RISK_MAP = {
    # critical -- 차단, 사전 승인 필요
    "bulk_delete":        "critical",
    "schema_migration":   "critical",
    "api_key_change":     "critical",
    "pricing_change":     "critical",
    "security_sensitive": "critical",
    "force_push":         "critical",
    "db_drop":            "critical",

    # high -- 알림
    "strategy_pivot":     "high",
    "tier_upgrade":       "high",
    "brand_voice_change": "high",
    "external_api_add":   "high",
    "large_batch":        "high",
    "budget_overrun":     "high",

    # medium -- 로그 기록
    "new_keyword":        "medium",
    "strategy_update":    "medium",
    "config_change":      "medium",
    "algorithm_change":   "medium",
    "file_overwrite":     "medium",

    # low -- 자동 진행
    "content_generate":   "low",
    "seo_optimize":       "low",
    "dedup_check":        "low",
    "trend_collect":      "low",
    "hashtag_optimize":   "low",
    "schedule_publish":   "low",
}

# 리스크 레벨별 자동 대응
RISK_RESPONSES = {
    "low":      "proceed",    # 자동 진행
    "medium":   "log",        # 로그 기록 후 진행
    "high":     "alert",      # 알림 발송 후 진행
    "critical": "blocked",    # 차단, 사전 승인 필요
}

# 비용 리스크 임계값 (budget ratio)
COST_THRESHOLDS = {
    "low":      0.5,   # 50% 미만
    "medium":   0.8,   # 50~80%
    "high":     1.0,   # 80~100%
    "critical": 1.2,   # 100% 초과
}

# 품질 리스크 임계값 (confidence)
QUALITY_THRESHOLDS = {
    "low":      0.8,   # 80%+ 신뢰도
    "medium":   0.6,   # 60~80%
    "high":     0.4,   # 40~60%
    "critical": 0.2,   # 40% 미만
}


# ── 리스크 체크 룰 ──────────────────────────────────────────────

def _check_cost_risk(project: str) -> dict:
    """budget_governor 연동 -- 비용 리스크 판정."""
    try:
        from budget_governor import check_budget
        budget = check_budget(project)
    except ImportError:
        return {"category": "cost", "level": "low", "detail": "budget_governor 미연동"}

    ratio = budget.get("ratio", 0)
    if ratio >= COST_THRESHOLDS["critical"]:
        level = "critical"
    elif ratio >= COST_THRESHOLDS["high"]:
        level = "high"
    elif ratio >= COST_THRESHOLDS["medium"]:
        level = "medium"
    else:
        level = "low"

    return {
        "category": "cost",
        "level": level,
        "detail": f"예산 {budget.get('spent', 0):,.0f}/{budget.get('budget', 0):,.0f}원 "
                  f"({ratio:.0%} 사용)",
        "budget_data": budget,
    }


def _check_quality_risk(confidence: float) -> dict:
    """신뢰도 기반 품질 리스크 판정."""
    if confidence >= QUALITY_THRESHOLDS["low"]:
        level = "low"
    elif confidence >= QUALITY_THRESHOLDS["medium"]:
        level = "medium"
    elif confidence >= QUALITY_THRESHOLDS["high"]:
        level = "high"
    else:
        level = "critical"

    return {
        "category": "quality",
        "level": level,
        "detail": f"신뢰도 {confidence:.0%} "
                  f"({'양호' if level == 'low' else '주의' if level == 'medium' else '위험'})",
    }


def _check_security_risk(action: str, context: Optional[dict] = None) -> dict:
    """보안 위험 패턴 체크."""
    ctx = context or {}
    security_patterns = [
        "api_key", "password", "secret", "token", "credential",
        ".env", "private_key", "auth",
    ]

    target = str(ctx.get("target", "")) + str(ctx.get("file", ""))
    matched = [p for p in security_patterns if p in target.lower()]

    if matched:
        return {
            "category": "security",
            "level": "critical",
            "detail": f"보안 민감 패턴 감지: {', '.join(matched)}",
        }

    if action in ("api_key_change", "security_sensitive"):
        return {
            "category": "security",
            "level": "high",
            "detail": f"보안 관련 액션: {action}",
        }

    return {"category": "security", "level": "low", "detail": "보안 위험 없음"}


def _check_regulation_risk(action: str, context: Optional[dict] = None) -> dict:
    """규제 위반 가능성 체크 (개인정보, GDPR 등)."""
    ctx = context or {}
    pii_patterns = [
        "email", "phone", "주민번호", "계좌", "카드번호",
        "personal_data", "user_data", "gdpr",
    ]

    content = json.dumps(ctx, ensure_ascii=False).lower()
    matched = [p for p in pii_patterns if p in content]

    if matched:
        return {
            "category": "regulation",
            "level": "high",
            "detail": f"개인정보/규제 관련 패턴: {', '.join(matched)}",
        }

    return {"category": "regulation", "level": "low", "detail": "규제 위험 없음"}


# ── 메인 함수 ──────────────────────────────────────────────────

LEVEL_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def check_risk(
    action: str,
    project: str = "ONGLE",
    confidence: float = 0.9,
    context: Optional[dict] = None,
) -> dict:
    """액션의 리스크를 종합 판정하고 대응 방안을 반환한다.

    Args:
        action: 수행할 액션명 (ACTION_RISK_MAP 참조)
        project: 프로젝트명
        confidence: 결과 신뢰도 (0.0~1.0)
        context: 추가 컨텍스트 (target, file, count 등)

    Returns:
        {
            "level": "low|medium|high|critical",
            "response": "proceed|log|alert|blocked",
            "reason": "판정 근거",
            "recommendation": "권장 조치",
            "checks": [개별 리스크 체크 결과],
        }
    """
    ctx = context or {}

    # 4가지 리스크 차원 체크
    checks = [
        _check_cost_risk(project),
        _check_quality_risk(confidence),
        _check_security_risk(action, ctx),
        _check_regulation_risk(action, ctx),
    ]

    # 액션 자체의 기본 리스크
    action_level = ACTION_RISK_MAP.get(action, "medium")

    # 모든 체크 중 최고 레벨 선택
    all_levels = [action_level] + [c["level"] for c in checks]
    final_level = max(all_levels, key=lambda x: LEVEL_ORDER.get(x, 1))

    response = RISK_RESPONSES[final_level]

    # 최고 리스크 사유 추출
    high_checks = [c for c in checks if c["level"] == final_level]
    if high_checks:
        reason = f"{action}: {high_checks[0]['detail']}"
    elif LEVEL_ORDER.get(action_level, 0) >= LEVEL_ORDER.get(final_level, 0):
        reason = f"{action}은(는) {action_level} 레벨 액션"
    else:
        reason = f"{action}: 종합 판정 {final_level}"

    # 권장 조치
    recommendations = {
        "proceed":  "자동 진행 -- 추가 조치 불필요",
        "log":      "로그 기록 완료 -- 주기적 검토 권장",
        "alert":    "관리자 알림 발송 -- 확인 후 진행",
        "blocked":  "사전 승인 필요 -- ask_before 에스컬레이션",
    }

    result = {
        "level": final_level,
        "response": response,
        "reason": reason,
        "recommendation": recommendations[response],
        "action": action,
        "project": project,
        "checks": checks,
        "timestamp": datetime.now().isoformat(),
    }

    # 로그 기록 (medium 이상)
    if LEVEL_ORDER.get(final_level, 0) >= LEVEL_ORDER["medium"]:
        _log_risk(result)

    if final_level == "critical":
        _log.warning(f"[CRITICAL] {reason}")
    elif final_level == "high":
        _log.info(f"[HIGH] {reason}")

    return result


def _log_risk(result: dict):
    """리스크 판정 결과를 JSONL로 기록."""
    RISK_LOG_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = RISK_LOG_DIR / f"risk_{today}.jsonl"

    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(result, ensure_ascii=False) + "\n")


def get_risk_history(project: str = "", days: int = 7) -> list[dict]:
    """최근 N일간 리스크 판정 이력 조회.

    Args:
        project: 프로젝트 필터 (빈값이면 전체)
        days: 조회 일수 (기본 7일)

    Returns:
        리스크 판정 결과 리스트 (최신순)
    """
    from datetime import timedelta

    results = []
    today = datetime.now().date()

    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        log_file = RISK_LOG_DIR / f"risk_{d}.jsonl"
        if not log_file.exists():
            continue
        for line in log_file.read_text(encoding="utf-8").strip().split("\n"):
            if not line:
                continue
            try:
                entry = json.loads(line)
                if project and entry.get("project") != project:
                    continue
                results.append(entry)
            except json.JSONDecodeError:
                continue

    return sorted(results, key=lambda x: x.get("timestamp", ""), reverse=True)


def get_risk_summary(project: str = "", days: int = 7) -> dict:
    """리스크 이력 요약 통계.

    Returns:
        {
            "total": 42,
            "by_level": {"low": 30, "medium": 8, "high": 3, "critical": 1},
            "by_category": {"cost": 5, "quality": 3, ...},
            "blocked_actions": ["bulk_delete", ...],
        }
    """
    history = get_risk_history(project, days)

    by_level = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    by_category = {}
    blocked = []

    for entry in history:
        level = entry.get("level", "medium")
        by_level[level] = by_level.get(level, 0) + 1

        for check in entry.get("checks", []):
            cat = check.get("category", "unknown")
            if LEVEL_ORDER.get(check.get("level", "low"), 0) >= LEVEL_ORDER["medium"]:
                by_category[cat] = by_category.get(cat, 0) + 1

        if entry.get("response") == "blocked":
            blocked.append(entry.get("action", ""))

    return {
        "total": len(history),
        "days": days,
        "project": project or "all",
        "by_level": by_level,
        "by_category": by_category,
        "blocked_actions": list(set(blocked)),
    }
