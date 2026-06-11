"""Editor Log -- AI 생성물 편집 패턴 추적 (Mother 공유)

사용자가 AI 생성 콘텐츠를 수정할 때 어떤 문장을 고쳤는지 기록하고,
고침 패턴을 분석하여 AI 생성 품질을 점진적으로 개선한다.

data/editor_logs/ 에 프로젝트별 JSONL로 저장한다.

사용:
    from editor_log import log_edit, get_edit_patterns, get_edit_history

    # 편집 기록
    log_edit(
        project="ONGLE",
        file_path="output/blog/2026-03-25/ai-automation.md",
        edit_type="replace",
        old_text="이것은 매우 흥미로운 주제입니다.",
        new_text="AI 자동화가 업무 효율을 바꾸고 있다.",
        reason="AI 슬롭 표현 제거",
    )

    # 패턴 분석
    patterns = get_edit_patterns("ONGLE")
    # patterns = {
    #     "frequently_deleted": [
    #         {"text": "매우 흥미로운", "count": 12, "category": "ai_slop"},
    #         {"text": "다양한 관점에서", "count": 8, "category": "filler"},
    #     ],
    #     "frequently_added": [
    #         {"text": "구체적 수치/데이터", "count": 15, "category": "specificity"},
    #     ],
    #     "edit_type_ratio": {"replace": 0.6, "delete": 0.25, "insert": 0.15},
    #     "top_reasons": ["AI 슬롭 제거", "구체성 추가", "톤 조정"],
    # }
"""

import json
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    from config.logger import get_logger
    _log = get_logger("editor_log")
except Exception:
    import logging
    _log = logging.getLogger("editor_log")

EDITOR_LOG_DIR = Path("data/editor_logs")

# 편집 유형
EDIT_TYPES = ("replace", "delete", "insert", "reorder", "rewrite")

# AI 슬롭 패턴 (자주 삭제되는 표현 자동 분류용)
AI_SLOP_PATTERNS = [
    r"매우\s*(흥미로운|중요한|놀라운|인상적인)",
    r"다양한\s*(관점|측면|방면)에서",
    r"결론적으로\s*(말하자면|보면)",
    r"이\s*글에서는?\s*(살펴보|알아보|다루)",
    r"함께\s*(알아보|살펴보|확인해)",
    r"마지막으로",
    r"요약하자면",
    r"그렇다면\s*어떨까요",
    r"지금\s*바로",
    r"놓치지\s*마세요",
]


# ── 로깅 ──────────────────────────────────────────────────────

def log_edit(
    project: str,
    file_path: str,
    edit_type: str,
    old_text: str = "",
    new_text: str = "",
    reason: str = "",
    metadata: Optional[dict] = None,
) -> dict:
    """사용자의 AI 생성물 편집을 기록한다.

    Args:
        project: 프로젝트명 (ONGLE, ARKIS 등)
        file_path: 편집된 파일 경로
        edit_type: 편집 유형 (replace/delete/insert/reorder/rewrite)
        old_text: 원본 텍스트 (삭제/교체된 부분)
        new_text: 새 텍스트 (추가/교체된 부분)
        reason: 편집 사유 (선택)
        metadata: 추가 메타데이터 (선택)

    Returns:
        기록된 엔트리 dict
    """
    EDITOR_LOG_DIR.mkdir(parents=True, exist_ok=True)

    if edit_type not in EDIT_TYPES:
        edit_type = "replace"

    # 자동 분류
    categories = _classify_edit(edit_type, old_text, new_text)

    entry = {
        "project": project,
        "file_path": file_path,
        "edit_type": edit_type,
        "old_text": old_text[:500],   # 500자 제한
        "new_text": new_text[:500],
        "reason": reason,
        "categories": categories,
        "char_delta": len(new_text) - len(old_text),
        "timestamp": datetime.now().isoformat(),
    }
    if metadata:
        entry["metadata"] = metadata

    # 프로젝트별 JSONL 파일에 저장
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = EDITOR_LOG_DIR / f"{project.lower()}_{today}.jsonl"

    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    _log.info(f"[{project}] {edit_type}: {file_path} ({', '.join(categories)})")
    return entry


def _classify_edit(edit_type: str, old_text: str, new_text: str) -> list[str]:
    """편집 내용을 자동 분류한다."""
    categories = []

    # AI 슬롭 제거 감지
    if old_text:
        for pattern in AI_SLOP_PATTERNS:
            if re.search(pattern, old_text):
                categories.append("ai_slop_removal")
                break

    # 구체성 추가 (숫자/데이터 추가)
    old_nums = len(re.findall(r"\d+", old_text))
    new_nums = len(re.findall(r"\d+", new_text))
    if new_nums > old_nums:
        categories.append("specificity_added")

    # 길이 변화
    if edit_type == "delete" or (not new_text and old_text):
        categories.append("trimming")
    elif len(new_text) > len(old_text) * 1.5 and old_text:
        categories.append("expansion")
    elif old_text and new_text and len(new_text) < len(old_text) * 0.7:
        categories.append("condensing")

    # 톤 변화 (존댓말 <-> 반말)
    old_formal = bool(re.search(r"(습니다|입니다|세요|하세요)", old_text))
    new_formal = bool(re.search(r"(습니다|입니다|세요|하세요)", new_text))
    if old_formal != new_formal and old_text and new_text:
        categories.append("tone_change")

    if not categories:
        categories.append("general_edit")

    return categories


# ── 이력 조회 ──────────────────────────────────────────────────

def get_edit_history(
    project: str = "",
    days: int = 30,
    edit_type: str = "",
) -> list[dict]:
    """편집 이력 조회.

    Args:
        project: 프로젝트 필터 (빈값이면 전체)
        days: 조회 일수 (기본 30일)
        edit_type: 편집 유형 필터

    Returns:
        편집 이력 리스트 (최신순)
    """
    results = []
    today = datetime.now().date()

    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        pattern = f"{project.lower()}_{d}.jsonl" if project else f"*_{d}.jsonl"

        if project:
            files = [EDITOR_LOG_DIR / pattern]
        else:
            files = list(EDITOR_LOG_DIR.glob(f"*_{d}.jsonl"))

        for log_file in files:
            if not log_file.exists():
                continue
            for line in log_file.read_text(encoding="utf-8").strip().split("\n"):
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if edit_type and entry.get("edit_type") != edit_type:
                        continue
                    results.append(entry)
                except json.JSONDecodeError:
                    continue

    return sorted(results, key=lambda x: x.get("timestamp", ""), reverse=True)


# ── 패턴 분석 ──────────────────────────────────────────────────

def get_edit_patterns(project: str = "", days: int = 30) -> dict:
    """편집 패턴 분석 -- 자주 삭제/추가되는 표현, 편집 유형 비율.

    Args:
        project: 프로젝트 필터
        days: 분석 기간 (기본 30일)

    Returns:
        {
            "frequently_deleted": [...],
            "frequently_added": [...],
            "edit_type_ratio": {...},
            "top_reasons": [...],
            "top_categories": [...],
            "total_edits": int,
            "avg_char_delta": float,
        }
    """
    history = get_edit_history(project, days)
    if not history:
        return {
            "frequently_deleted": [],
            "frequently_added": [],
            "edit_type_ratio": {},
            "top_reasons": [],
            "top_categories": [],
            "total_edits": 0,
            "avg_char_delta": 0,
        }

    # 삭제된 표현 (old_text에서 추출, 3어절 이상 n-gram)
    deleted_phrases = Counter()
    added_phrases = Counter()
    edit_types = Counter()
    reasons = Counter()
    categories = Counter()
    char_deltas = []

    for entry in history:
        edit_types[entry.get("edit_type", "replace")] += 1

        if entry.get("reason"):
            reasons[entry["reason"]] += 1

        for cat in entry.get("categories", []):
            categories[cat] += 1

        char_deltas.append(entry.get("char_delta", 0))

        # n-gram 추출 (3~5어절)
        old = entry.get("old_text", "")
        new = entry.get("new_text", "")

        if old:
            for phrase in _extract_phrases(old):
                deleted_phrases[phrase] += 1

        if new:
            for phrase in _extract_phrases(new):
                added_phrases[phrase] += 1

    total = len(history)

    # 편집 유형 비율
    type_ratio = {k: round(v / total, 3) for k, v in edit_types.most_common()}

    # 자주 삭제되는 표현 (2회 이상)
    freq_deleted = []
    for text, count in deleted_phrases.most_common(20):
        if count < 2:
            break
        cat = "ai_slop" if any(re.search(p, text) for p in AI_SLOP_PATTERNS) else "filler"
        freq_deleted.append({"text": text, "count": count, "category": cat})

    # 자주 추가되는 표현 (2회 이상)
    freq_added = []
    for text, count in added_phrases.most_common(20):
        if count < 2:
            break
        freq_added.append({"text": text, "count": count, "category": "user_preferred"})

    return {
        "frequently_deleted": freq_deleted[:15],
        "frequently_added": freq_added[:15],
        "edit_type_ratio": type_ratio,
        "top_reasons": [r for r, _ in reasons.most_common(10)],
        "top_categories": [
            {"category": cat, "count": cnt}
            for cat, cnt in categories.most_common(10)
        ],
        "total_edits": total,
        "avg_char_delta": round(sum(char_deltas) / max(len(char_deltas), 1), 1),
    }


def _extract_phrases(text: str, min_words: int = 3, max_words: int = 5) -> list[str]:
    """텍스트에서 3~5어절 n-gram 추출."""
    words = text.split()
    phrases = []
    for n in range(min_words, min(max_words + 1, len(words) + 1)):
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i:i + n])
            if len(phrase) >= 6:  # 최소 6자
                phrases.append(phrase)
    return phrases


def get_suppression_list(project: str = "", days: int = 30, min_count: int = 3) -> list[str]:
    """AI 생성 시 억제해야 할 표현 목록 반환.

    자주 삭제되는 표현을 추출하여 프롬프트에 "사용 금지 표현"으로 주입할 수 있다.

    Args:
        project: 프로젝트 필터
        days: 분석 기간
        min_count: 최소 삭제 횟수

    Returns:
        억제 대상 표현 리스트
    """
    patterns = get_edit_patterns(project, days)
    return [
        item["text"]
        for item in patterns["frequently_deleted"]
        if item["count"] >= min_count
    ]
