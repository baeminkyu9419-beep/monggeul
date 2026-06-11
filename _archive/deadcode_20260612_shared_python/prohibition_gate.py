"""금지 목록 코드 강제 (Prohibition Gate) — Mother 공유

CLAUDE.md 텍스트가 아닌 코드 레벨에서 금지 항목 차단.
콘텐츠 생성, 전략 실행, 데이터 처리 전에 호출.

사용:
    from prohibition_gate import check_prohibition
    result = check_prohibition(text, project="ONGLE")
    if result["blocked"]:
        print(f"차단: {result['violations']}")
"""

import re
from config.logger import get_logger

_log = get_logger("prohibition_gate")

# 전 프로젝트 공통 금지
GLOBAL_PROHIBITIONS = [
    {"pattern": r"시장\s*조작|프런트러닝|스푸핑|불공정\s*거래", "category": "시장 조작", "severity": "critical"},
    {"pattern": r"다크웹|불법\s*데이터|해킹\s*도구", "category": "불법 소스", "severity": "critical"},
    {"pattern": r"무단\s*결제|승인\s*없는\s*집행", "category": "무단 결제", "severity": "critical"},
    {"pattern": r"규제\s*회피|법\s*우회", "category": "규제 회피", "severity": "critical"},
]

# 프로젝트별 금지
PROJECT_PROHIBITIONS = {
    "ONGLE": [
        {"pattern": r"100%\s*수익|무조건\s*오릅니다|원금\s*보장", "category": "금융 과장", "severity": "high"},
        {"pattern": r"완치|특효|암을?\s*예방|의사가\s*숨기는", "category": "의료 위험", "severity": "high"},
        {"pattern": r"저작권\s*무시|복사해서\s*쓰", "category": "저작권 침해", "severity": "high"},
    ],
    "ARKIS": [
        {"pattern": r"레버리지\s*100배|전재산\s*올인|빚\s*내서\s*투자", "category": "극단적 위험", "severity": "critical"},
        {"pattern": r"내부\s*정보|미공개\s*정보", "category": "내부자 거래", "severity": "critical"},
    ],
    "NAEUM": [
        {"pattern": r"진단합니다|확실히\s*~입니다|반드시\s*낫습니다", "category": "의료 진단 단정", "severity": "critical"},
        {"pattern": r"약을?\s*중단|처방\s*무시", "category": "위험한 의료 조언", "severity": "critical"},
    ],
    "MONGGEUL": [
        {"pattern": r"정신\s*질환\s*확실|우울증\s*진단|자해", "category": "정신건강 진단 단정", "severity": "critical"},
    ],
}


def check_prohibition(text: str, project: str = "") -> dict:
    """텍스트에서 금지 항목 검사.

    Returns:
        {"blocked": bool, "violations": [{"category", "severity", "matched"}], "safe": bool}
    """
    violations = []

    # 글로벌 금지
    for rule in GLOBAL_PROHIBITIONS:
        matches = re.findall(rule["pattern"], text, re.IGNORECASE)
        if matches:
            violations.append({
                "category": rule["category"],
                "severity": rule["severity"],
                "matched": matches[:3],
            })

    # 프로젝트별 금지
    project_rules = PROJECT_PROHIBITIONS.get(project, [])
    for rule in project_rules:
        matches = re.findall(rule["pattern"], text, re.IGNORECASE)
        if matches:
            violations.append({
                "category": rule["category"],
                "severity": rule["severity"],
                "matched": matches[:3],
            })

    blocked = any(v["severity"] == "critical" for v in violations)
    warned = len(violations) > 0 and not blocked

    if violations:
        _log.warning("금지 항목 감지 (%s): %d건, blocked=%s",
                     project, len(violations), blocked)

    return {
        "blocked": blocked,
        "warned": warned,
        "safe": len(violations) == 0,
        "violations": violations,
        "project": project,
    }
