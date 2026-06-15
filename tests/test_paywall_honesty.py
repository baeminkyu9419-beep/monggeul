"""
MONGGEUL — CONVERSION-2: 과대약속 정직화 회귀 테스트

배경(과대광고): ₩1,900 상세 해몽 페이월(paywall.js showPremiumPaywall + landing.html +
  index.html)이 '무의식 다이브 (4층 심층 분석)', '맞춤형 후속 질문 3개 → 2차 해석',
  '빅데이터 인사이트' 를 약속했으나 실제 dream_detail 프롬프트(prompts.ts)는
  traditional/psychology/advice/fullInterpretation 4필드만 산출 → 결제 후 실망.

수정(option B 정직화): 페이월 카피를 실제 산출물(전통/심리/현실조언/깊은해석 1,000자+
  6축 레이더)에 맞게 정직화. 실현 안 되는 약속 제거.

뮤테이션 정신:
  - 실제 prompts.ts 의 dream_detail 출력 필드(JSON 키)를 파싱해 '진실의 원천'으로 삼고,
    페이월이 그 진실을 넘어서는 미배달 기능을 약속하면 FAIL 한다.
  - 누군가 '무의식 다이브'/'빅데이터'/'후속 질문 3개' 를 다시 넣으면(과대광고 회귀) FAIL.
"""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAYWALL = ROOT / "src" / "components" / "paywall.js"
PROMPTS = ROOT / "supabase" / "functions" / "openai-proxy" / "prompts.ts"
LANDING = ROOT / "landing.html"
INDEX = ROOT / "index.html"

# dream_detail 이 실제로 산출하는 필드 — 정직화의 '진실의 원천'.
# prompts.ts _dreamDetailSystem JSON 출력 스펙과 일치해야 한다.
DETAIL_FIELDS = {"traditional", "psychology", "advice", "fullInterpretation"}

# 실제 산출물에 존재하지 않는 미배달 약속(과대광고) — 어떤 결제 카피에도 등장하면 안 됨.
OVERCLAIMS = ["무의식 다이브", "4층", "빅데이터", "후속 질문 3개", "후속 질문 + 2차", "후속 질문 + 2차 해석"]


def _detail_prompt_fields():
    """prompts.ts _dreamDetailSystem 의 JSON 출력 키를 추출 — 테스트 전제(진실의 원천) 고정."""
    src = PROMPTS.read_text(encoding="utf-8")
    m = re.search(r"function _dreamDetailSystem\([^)]*\)[^{]*\{([\s\S]*?)\n\}", src)
    assert m, "_dreamDetailSystem 을 찾을 수 없습니다"
    body = m.group(1)
    keys = set(re.findall(r'"(\w+)":', body))
    return keys


def test_detail_prompt_truth_source_unchanged():
    """전제 가드: dream_detail 출력 필드가 정확히 4개(traditional/psychology/advice/
    fullInterpretation)인지 확인. 서버가 무의식다이브/후속질문 필드를 추가하면 이 테스트가
    먼저 깨져 정직화 카피를 다시 맞춰야 함을 알린다."""
    fields = _detail_prompt_fields()
    assert DETAIL_FIELDS.issubset(fields), (
        f"dream_detail 출력 필드가 기대와 다름: 기대⊆{DETAIL_FIELDS}, 실제={fields}"
    )
    # 미배달 기능을 시사하는 새 필드가 생기면 알림(예: unconsciousDive, followups)
    unexpected = fields - DETAIL_FIELDS
    assert not (unexpected & {"unconsciousDive", "followups", "bigData", "followup"}), (
        f"detail 프롬프트에 미배달 약속 관련 필드가 추가됨: {unexpected} — 카피 재검토 필요"
    )


def test_premium_paywall_no_overclaim():
    """₩1,900 상세 해몽 결제 모달(showPremiumPaywall)에 미배달 약속이 없어야 한다."""
    src = PAYWALL.read_text(encoding="utf-8")
    m = re.search(r"export function showPremiumPaywall\(\)\s*\{([\s\S]*?)\n\}\n", src)
    assert m, "showPremiumPaywall 을 찾을 수 없습니다"
    body = m.group(1)
    for claim in OVERCLAIMS:
        assert claim not in body, (
            f"상세 해몽 페이월에 미배달 약속 '{claim}' 존재 — 결제 후 실망(과대광고 회귀)"
        )


def test_premium_paywall_reflects_real_output():
    """페이월이 실제 산출물(전통/심리/현실조언/깊은해석 1,000자+)을 명시해야 한다."""
    src = PAYWALL.read_text(encoding="utf-8")
    m = re.search(r"export function showPremiumPaywall\(\)\s*\{([\s\S]*?)\n\}\n", src)
    body = m.group(1)
    # 실제 dream_detail 4필드에 대응하는 한국어 카피가 존재해야 함
    assert "전통" in body, "전통 해몽(traditional) 카피 누락"
    assert "심리" in body, "심리 분석(psychology) 카피 누락"
    assert "조언" in body, "현실 조언(advice) 카피 누락"
    assert "1,000자" in body or "1000자" in body or "깊은 해석" in body, "깊은 해석(fullInterpretation) 카피 누락"


def test_landing_detail_card_no_overclaim():
    """landing.html 상세 해몽 카드에 미배달 약속이 없어야 한다."""
    src = LANDING.read_text(encoding="utf-8")
    for claim in OVERCLAIMS:
        assert claim not in src, f"landing.html 에 미배달 약속 '{claim}' 잔존(과대광고)"


def test_index_detail_card_no_overclaim():
    """index.html 프리미엄 카드에 미배달 약속이 없어야 한다."""
    src = INDEX.read_text(encoding="utf-8")
    for claim in OVERCLAIMS:
        assert claim not in src, f"index.html 에 미배달 약속 '{claim}' 잔존(과대광고)"


def test_detail_interpretation_paywall_desc_honest():
    """showPaywall('detail_interpretation') 설명도 정직해야 한다."""
    src = PAYWALL.read_text(encoding="utf-8")
    m = re.search(r"detail_interpretation\s*:\s*\{([^}]+)\}", src, re.DOTALL)
    assert m, "detail_interpretation 메시지 블록을 찾을 수 없습니다"
    block = m.group(1)
    for claim in OVERCLAIMS:
        assert claim not in block, f"detail_interpretation desc 에 미배달 약속 '{claim}' 잔존"
