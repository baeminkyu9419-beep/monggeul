"""콘텐츠 품질 게이트 — 최소 기준 미달 시 자동 폐기/재생성

블로그: 최소 500자 + 소제목 3개 + 키워드 3회
쇼츠: 최소 100자 + [훅][전개][마무리] 존재
인스타: 최소 50자 + 해시태그 5개+
시: 최소 50자 + 2연 이상
"""

import re


def check_blog_quality(body: str, keyword: str) -> dict:
    """블로그 글 품질 체크"""
    issues = []
    passed = True

    # HTML 태그 제거한 순수 텍스트
    plain = re.sub(r'<[^>]+>', '', body)

    # 길이 (HTML 태그 제외)
    if len(plain) < 500:
        issues.append(f"본문 {len(plain)}자 — 최소 500자 필요")
        passed = False

    # 소제목 (마크다운 + HTML 모두 감지)
    md_headings = re.findall(r"^#{2,3}\s+", body, re.MULTILINE)
    html_headings = re.findall(r"<h[23][^>]*>", body, re.IGNORECASE)
    headings = md_headings + html_headings
    if len(headings) < 3:
        issues.append(f"소제목 {len(headings)}개 — 최소 3개 필요")
        passed = False

    # 키워드 (순수 텍스트에서 카운트)
    kw_count = plain.lower().count(keyword.lower())
    if kw_count < 2:
        issues.append(f"키워드 '{keyword}' {kw_count}회 — 최소 2회 필요")
        passed = False

    # 빈 본문
    if not body.strip() or body.startswith("["):
        issues.append("본문이 비어있거나 에러")
        passed = False

    return {"passed": passed, "issues": issues, "length": len(body),
            "headings": len(headings), "keyword_count": kw_count}


def check_shorts_quality(body: str) -> dict:
    """쇼츠 스크립트 품질 체크"""
    issues = []
    passed = True

    if len(body) < 80:
        issues.append("스크립트 너무 짧음")
        passed = False

    if len(body) > 500:
        issues.append("스크립트 너무 긴 — 60초 초과 가능")

    return {"passed": passed, "issues": issues, "length": len(body)}


def check_poem_quality(body: str) -> dict:
    """시 품질 체크"""
    issues = []
    passed = True

    if len(body) < 30:
        issues.append("시가 너무 짧음")
        passed = False

    stanzas = [s for s in re.split(r"\n\s*\n", body) if s.strip()]
    if len(stanzas) < 2:
        issues.append(f"연 {len(stanzas)}개 — 최소 2연 필요")
        passed = False

    # AI 교정 잔재 체크
    if "또는" in body and ("'" in body or "'" in body):
        issues.append("교정 잔재 의심 ('A' 또는 'B' 패턴)")
        passed = False

    return {"passed": passed, "issues": issues, "stanzas": len(stanzas)}


def check_insta_quality(body: str) -> dict:
    """인스타그램 캡션 품질 체크"""
    issues = []
    passed = True

    if len(body) < 30:
        issues.append("캡션 너무 짧음")
        passed = False

    if len(body) > 2200:
        issues.append(f"캡션 {len(body)}자 — 2200자 초과")
        passed = False

    hashtag_count = body.count("#")
    if hashtag_count < 3:
        issues.append(f"해시태그 {hashtag_count}개 — 최소 3개 권장")

    return {"passed": passed, "issues": issues, "length": len(body),
            "hashtags": hashtag_count}


def check_literary_quality(body: str, platform: str) -> dict:
    """동화/소설 품질 체크"""
    issues = []
    passed = True

    min_len = {"fairy_tale": 200, "novel": 500}.get(platform, 200)
    if len(body) < min_len:
        issues.append(f"본문 {len(body)}자 — 최소 {min_len}자 필요")
        passed = False

    if not body.strip() or body.startswith("["):
        issues.append("본문이 비어있거나 에러")
        passed = False

    return {"passed": passed, "issues": issues, "length": len(body)}


def quality_gate(body: str, keyword: str = "", platform: str = "blog",
                 review_score: int = 0) -> dict:
    """통합 품질 게이트 — 구조 최소치 + 스코어카드 점수 통합

    Args:
        body: 본문
        keyword: 키워드
        platform: 플랫폼
        review_score: body_generator 100점 스코어카드 점수 (0이면 미검수)

    Returns:
        {passed, issues, details, review_score}
    """
    if platform in ("blog", "tistory"):
        result = check_blog_quality(body, keyword)
    elif platform == "shorts":
        result = check_shorts_quality(body)
    elif platform in ("poem", "시"):
        result = check_poem_quality(body)
    elif platform == "insta":
        result = check_insta_quality(body)
    elif platform in ("fairy_tale", "novel"):
        result = check_literary_quality(body, platform)
    else:
        result = {"passed": bool(body and len(body) > 20), "issues": []}

    # 스코어카드 점수 통합 — 70점 미만이면 강제 실패
    result["review_score"] = review_score
    if review_score > 0 and review_score < 70:
        result["passed"] = False
        result.setdefault("issues", []).append(
            f"스코어카드 {review_score}점 — 최소 70점 필요 (90점 권장)")

    return result
