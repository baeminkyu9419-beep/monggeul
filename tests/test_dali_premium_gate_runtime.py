"""
MONGGEUL — CHARACTERIZATION: 달리챗 프리미엄 추천 게이트 (detectSuggestionContext / pickSuggestionMessage) Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  utils/dali-premium-prompts.js 는 dali-chat.js 의 sendChat 안에서 호출되는 프리미엄 추천
  게이트의 두뇌다(어떤 카테고리를 언제 추천할지 결정 + 메시지/feature 매핑). 현재 코드의
  *우선순위·경계·매핑 동작을 그대로* Node 런타임으로 박제해, 한 톨이라도 바뀌면 FAIL 하게 한다.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(probe 로 실측). 없는 동작 단언 금지.
  - 소스 문자열 스캔이 아니라 실제 함수를 Node 로 구동해 행위를 본다(test_business_logic 는 src 텍스트 스캔뿐).
  - 게이트 우선순위(recurring > anxiety > sadness > growth > rich_data)와 임계값(total>=5)을 핀.

뮤테이션 정신:
  - 키워드 목록(ANXIETY/SADNESS/GROWTH/RECURRING_WORDS) 변경 → 분류 어긋남 → FAIL
  - 우선순위 순서 뒤바꿈(예: recurring 을 anxiety 뒤로) → recurring-우선 단언 FAIL
  - rich_data 임계값(total>=5) 변경 → 4/5 경계 단언 FAIL
  - userMsg+daliReply 결합/소문자화 제거 → reply-측 매칭 단언 FAIL
  - pickSuggestionMessage 의 feature 매핑/미지카테고리 null 처리 변경 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "utils" / "dali-premium-prompts.js"


_RUNTIME = r"""
const m = await import(SRC_URI);
const out = {};
out.exports = Object.keys(m).sort();

// ── (A) detectSuggestionContext: 우선순위/경계/결합 실측 ──
function det(u, r, a){ return m.detectSuggestionContext(u, r, a); }
out.detect = {
  recurring:        det('또 그 꿈을 꿨어', '', null),
  anxiety:          det('불안하고 무서워', '', null),
  sadness:          det('슬프고 외로워', '', null),
  growth:           det('행복하고 설레', '', null),
  none_no_analysis: det('그냥 평범한 하루', '', null),
  rich_data_5:      det('평범', '', {total:5}),
  rich_data_4:      det('평범', '', {total:4}),
  // 우선순위: recurring 은 다른 모든 키워드/데이터를 이긴다
  recurring_beats_anxiety: det('또 불안해', '', null),
  recurring_beats_all:     det('행복하고 또 꿨어', '', {total:10}),
  // 매칭은 userMsg + ' ' + daliReply 결합 후 소문자화
  reply_side: det('', '반복되는 꿈이네요', null),
};

// ── (B) pickSuggestionMessage: feature 매핑 + 메시지 풀 소속 + 미지 카테고리 ──
out.pick = {};
for(const cat of Object.keys(m.DALI_PREMIUM_SUGGESTIONS)){
  const p = m.pickSuggestionMessage(cat);
  out.pick[cat] = { feature: p.feature, inPool: m.DALI_PREMIUM_SUGGESTIONS[cat].messages.includes(p.message) };
}
out.pick_unknown = m.pickSuggestionMessage('nope_not_a_category');

// ── (C) 추천 테이블 구조(공포 마케팅 방지 — 어조는 코드 아닌 정책이라 구조만 핀) ──
out.suggestion_keys = Object.keys(m.DALI_PREMIUM_SUGGESTIONS).sort();
out.all_have_feature_and_messages = Object.values(m.DALI_PREMIUM_SUGGESTIONS)
  .every(e => typeof e.feature === 'string' && Array.isArray(e.messages) && e.messages.length > 0);

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 달리 프리미엄 게이트 런타임 핀 skip")
    script = _RUNTIME.replace("SRC_URI", json.dumps(SRC.resolve().as_uri()))
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


@pytest.fixture(scope="module")
def rt():
    return _run()


# ── (A) 공개 표면 ──────────────────────────────────────────────────────
def test_exports_intact(rt):
    """게이트 두뇌 3개 표면이 살아있다."""
    assert rt["exports"] == ["DALI_PREMIUM_SUGGESTIONS", "detectSuggestionContext", "pickSuggestionMessage"], \
        f"공개 표면 변경: {rt['exports']}"


# ── (B) 카테고리 분류 박제 ─────────────────────────────────────────────
def test_keyword_categories(rt):
    """각 키워드군이 자기 카테고리로 분류된다."""
    d = rt["detect"]
    assert d["recurring"] == "recurring"
    assert d["anxiety"] == "anxiety"
    assert d["sadness"] == "sadness"
    assert d["growth"] == "growth"


def test_no_match_returns_null(rt):
    """키워드 없고 데이터도 부족(<5)하면 추천 안 함(null)."""
    d = rt["detect"]
    assert d["none_no_analysis"] is None, "키워드/데이터 없는데 추천이 떴다(게이트 누수)"
    assert d["rich_data_4"] is None, "total=4 인데 rich_data 추천이 떴다(임계값 어긋남)"


def test_rich_data_threshold(rt):
    """rich_data 는 키워드 없을 때 total>=5 에서만 발동."""
    assert rt["detect"]["rich_data_5"] == "rich_data", "total=5 에서 rich_data 가 발동하지 않음"
    assert rt["detect"]["rich_data_4"] is None, "total=4 에서 rich_data 가 발동함(경계 어긋남)"


# ── (C) 우선순위 박제 (게이트 핵심) ────────────────────────────────────
def test_recurring_has_top_priority(rt):
    """반복꿈(recurring)이 최고 전환율 → anxiety/growth/rich_data 보다 우선."""
    d = rt["detect"]
    assert d["recurring_beats_anxiety"] == "recurring", "'또 불안해' 가 anxiety 로 빠짐(우선순위 뒤집힘)"
    assert d["recurring_beats_all"] == "recurring", "recurring 이 growth+rich_data 를 못 이김(우선순위 뒤집힘)"


def test_reply_side_is_matched(rt):
    """매칭은 userMsg 와 daliReply 를 결합해서 본다(응답 측 키워드도 잡힘)."""
    assert rt["detect"]["reply_side"] == "recurring", "달이 응답 쪽 '반복' 키워드가 무시됨(결합 매칭 깨짐)"


# ── (D) 메시지/feature 매핑 박제 ───────────────────────────────────────
def test_feature_mapping(rt):
    """각 카테고리가 약속된 feature 로 매핑되고, 뽑힌 메시지는 풀 소속이다."""
    p = rt["pick"]
    assert p["anxiety"]["feature"] == "unconscious_profile"
    assert p["recurring"]["feature"] == "detail_interpretation"
    assert p["growth"]["feature"] == "weekly_report"
    assert p["sadness"]["feature"] == "detail_interpretation"
    assert p["rich_data"]["feature"] == "unconscious_profile"
    assert p["deep_conversation"]["feature"] == "pro"
    for cat, v in p.items():
        assert v["inPool"] is True, f"{cat} 가 풀에 없는 메시지를 반환(랜덤 선택 깨짐)"


def test_pick_unknown_category_null(rt):
    """미지 카테고리는 null 반환(방어)."""
    assert rt["pick_unknown"] is None, "미지 카테고리에서 null 이 아닌 값 반환(방어 깨짐)"


def test_suggestion_table_shape(rt):
    """추천 테이블 6 카테고리 + 각 항목 feature/messages 구조 유지."""
    assert rt["suggestion_keys"] == ["anxiety", "deep_conversation", "growth", "recurring", "rich_data", "sadness"], \
        f"추천 카테고리 집합 변경: {rt['suggestion_keys']}"
    assert rt["all_have_feature_and_messages"] is True, "추천 항목 중 feature/messages 구조가 깨진 게 있음"
