"""
MONGGEUL — 월간 리포트(monthly_report) 입력 grounding 게이트: 런타임 행위 테스트
================================================================================

배경 (제품 결함 — 유료 구독 기능의 '입력 무시'):
  monthly_report 는 Plus 구독 전용 유료 AI 월간 리포트다. 서버는 gpt-4o-mini 를
  temperature 0.8 + "탐색적이고 따뜻하게" 지시로 호출했고, 사용자의 이번 달 실제
  데이터(키워드/감정)를 반영하라는 강제가 없었다. 이 조합은 사용자의 진짜 소재(고래/
  할머니/시험 등)를 무시한 채 누구에게나 통하는 일반론("꿈은 마음의 거울이에요",
  "다양한 감정이 오갔던 한 달")을 쓰기 쉽다 → 구독료를 낸 사용자가 자기 달과 무관한
  generic 내러티브를 받는다(dream_quick/dream_detail 과 동일한 '팔지만 안 줌' 문제인데
  monthly_report 만 grounding 게이트 밖에 있었다).

수정 (서버측 grounding 게이트 — dream task 게이트 재사용):
  prompts.ts 에 순수 함수 추가:
    - _monthlyGroundTokens(params): 사용자 이번 달 keywords/emotions 에서 '구별되는'
      소재 토큰만 추출(titles 는 AI 시적 라벨이라 generic 정서어가 많아 제외, generic
      정서어 stopword 로 필터).
    - _monthlyRepairDirective(params): 재시도용 교정 지시(실제 소재 토큰 못 박음).
  buildChatPayload('monthly_report', {repair:true}) 가 교정 지시 주입 + temperature↓.
  index.ts 가 monthly_report 응답이 사용자 소재를 1개도 안 쓰면 repair 1회 재시도 →
  그래도 미반영이면 _ungrounded → 클라(my-monthly-report.js)가 데이터-grounded 로컬
  템플릿(renderMonthlyReport)으로 강등.

이 테스트는 Node 로 .ts 실제 함수를 실행(behavioral)해 단언한다:
  1) generic 일반론 내러티브가 사용자 소재 미반영으로 판정됨 → false
  2) 사용자 소재(키워드/감정)를 반영한 내러티브는 통과 → true
  3) titles 의 generic 정서어(마음/잔상/그리움)는 grounding 앵커에서 제외 → 일반론 오탐 0
  4) repair payload 가 교정 지시 주입 + temperature 낮춤
  5) 뮤테이션: 게이트 무력화(항상 true) 시 일반론이 통과 = 게이트 실효적
  6) 배선 가드: index.ts 가 monthly_report grounding 을 실제 호출, 클라가 _ungrounded 처리

Node 미설치 시 skip(다른 *_runtime.py 와 동일 전략).
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "supabase" / "functions" / "openai-proxy" / "prompts.ts"
INDEX_TS = ROOT / "supabase" / "functions" / "openai-proxy" / "index.ts"
CLIENT = ROOT / "src" / "tabs" / "my-monthly-report.js"


_RUNTIME = r"""
import * as m from PROMPTS_URI;
const out = {};
out.has = {
  tokens: typeof m._monthlyGroundTokens === 'function',
  repair: typeof m._monthlyRepairDirective === 'function',
  isGrounded: typeof m._isGrounded === 'function',
};

// 사용자 이번 달 실제 데이터
const P = {
  count: 7, good: 4, bad: 2,
  keywords: ['바다에서', '할머니가', '고래를'],
  emotions: ['그리움', '불안'],
  titles: ['💔 마음의 잔상', '🐋 그리움의 바다'],
};
const toks = m._monthlyGroundTokens(P);
out.tokens = toks;
const G = toks.join(' ');

// generic 일반론(사용자 소재 미반영) — '마음/그리움' 은 generic 정서어라 앵커 아님
const GENERIC = '이번 달은 다양한 감정이 오갔던 한 달이었어요. 꿈은 마음의 거울이에요. 앞으로도 좋은 흐름이 이어질 수 있어요. 그리움이 느껴지기도 했네요.';
// 사용자 소재 반영 정상 내러티브
const GROUNDED = '이번 달은 고래와 할머니가 나온 꿈들이 인상적이었어요. 바다가 마음의 깊이를 비추는 것 같아요.';

out.genGrounded = m._isGrounded(G, GENERIC);     // 기대 false
out.realGrounded = m._isGrounded(G, GROUNDED);   // 기대 true

// titles 의 generic 정서어가 앵커로 새지 않는가(마음/잔상/그리움이 토큰에 없어야)
out.tokenHasGenericMaeum = toks.includes('마음') || toks.includes('마음의');
out.tokenHasGenericJansang = toks.includes('잔상');
// keywords/emotions 의 진짜 소재는 들어가는가
out.tokenHasGorae = toks.includes('고래');
out.tokenHasHalmeoni = toks.includes('할머니');
out.tokenHasBulan = toks.includes('불안');

// 감정만 구별적인 경우(키워드 없음)도 grounding 동작
const P2 = { count: 4, keywords: [], emotions: ['설렘', '불안'], titles: ['🌙 깊은 밤'] };
const toks2 = m._monthlyGroundTokens(P2);
out.tokens2 = toks2;
out.emoGen = m._isGrounded(toks2.join(' '), GENERIC);                        // 기대 false
out.emoReal = m._isGrounded(toks2.join(' '), '이번 달은 설렘이 가득했어요.'); // 기대 true

// 소재가 generic 뿐인 빈약 데이터 → 토큰 0 → 다운스트림 보수적 통과(오탐 0)
out.sparseTokens = m._monthlyGroundTokens({ count: 3, keywords: [], emotions: [], titles: ['🌙 마음의 잔상'] });

// repair payload: 교정 지시 주입 + temperature 낮춤
const base = m.buildChatPayload('monthly_report', P);
const rep = m.buildChatPayload('monthly_report', { ...P, repair: true });
const userOf = (pp) => (pp.messages.find((x) => x.role === 'user') || {}).content || '';
out.baseTemp = base.temperature;
out.repairTemp = rep.temperature;
out.baseHasMandate = userOf(base).includes('[필수]');
out.baseHasNoDirective = !userOf(base).includes('교정 — 매우 중요');
out.repairInjectsDirective = userOf(rep).includes('교정') && userOf(rep).includes('고래');

console.log(JSON.stringify(out));
"""


def _run(script_body):
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — monthly_report grounding 런타임 핀 skip")
    script = script_body.replace("PROMPTS_URI", json.dumps(PROMPTS.resolve().as_uri()))
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


@pytest.fixture(scope="module")
def rt():
    return _run(_RUNTIME)


# ── (A) 함수 표면 ──────────────────────────────────────────────────────
def test_monthly_grounding_functions_exported(rt):
    for k in ("tokens", "repair", "isGrounded"):
        assert rt["has"][k] is True, f"{k} export 누락 — monthly grounding 게이트 미작동"


def test_monthly_tokens_from_real_material(rt):
    """grounding 토큰이 keywords/emotions 의 진짜 소재(고래/할머니/불안)를 포함한다."""
    assert rt["tokenHasGorae"] is True, f"고래 토큰 누락: {rt['tokens']}"
    assert rt["tokenHasHalmeoni"] is True, f"할머니 토큰 누락: {rt['tokens']}"
    assert rt["tokenHasBulan"] is True, f"불안(감정) 토큰 누락: {rt['tokens']}"


def test_monthly_generic_emotion_words_not_anchors(rt):
    """titles 의 generic 정서어(마음/잔상/그리움)는 grounding 앵커가 아니다(일반론 오탐 차단)."""
    assert rt["tokenHasGenericMaeum"] is False, "generic '마음' 이 grounding 토큰에 새어 들어감"
    assert rt["tokenHasGenericJansang"] is False, "generic '잔상' 이 grounding 토큰에 새어 들어감"


# ── (B) 핵심: 일반론 차단 / 정상 통과 ──────────────────────────────────
def test_generic_narrative_is_rejected(rt):
    """★사용자 소재를 안 쓴 일반론 내러티브('마음의 거울이에요')가 미반영으로 판정된다."""
    assert rt["genGrounded"] is False, (
        "사용자 이번 달 소재(고래/할머니/바다/불안)를 전혀 안 쓴 일반론이 grounded 로 통과됨 — 게이트 무력"
    )


def test_grounded_narrative_passes(rt):
    """사용자 소재를 반영한 정상 내러티브는 통과한다(오탐 없음)."""
    assert rt["realGrounded"] is True, "정상(소재 반영) 내러티브가 잘못 차단됨 — 오탐"


def test_emotion_only_material_grounds(rt):
    """키워드가 없고 감정만 구별적인 달도 grounding 이 동작한다."""
    assert rt["emoGen"] is False, "감정 미반영 일반론이 통과됨"
    assert rt["emoReal"] is True, "감정 반영 내러티브가 차단됨 — 오탐"


def test_sparse_material_yields_no_anchors(rt):
    """generic 제목뿐인 빈약 데이터는 앵커 0 → 다운스트림 보수적 통과(오탐 0)."""
    assert rt["sparseTokens"] == [], f"빈약 데이터에서 generic 토큰이 앵커로 남음: {rt['sparseTokens']}"


# ── (C) repair 재시도 경로 ─────────────────────────────────────────────
def test_monthly_base_has_data_mandate_and_no_directive(rt):
    """기본 호출엔 데이터 반영 [필수] 지시가 있고 교정 지시는 새지 않는다."""
    assert rt["baseHasMandate"] is True, "기본 monthly 프롬프트에 데이터 반영 [필수] 지시 누락"
    assert rt["baseHasNoDirective"] is True, "기본 호출에 교정 지시가 새어 들어감"


def test_monthly_repair_injects_directive_and_lowers_temp(rt):
    """repair=true 면 user 메시지에 교정 지시(실제 소재 나열) 주입 + temperature 낮춤."""
    assert rt["repairInjectsDirective"] is True, "repair 시 교정 지시(소재 나열)가 안 들어감"
    assert rt["repairTemp"] < rt["baseTemp"], (
        f"repair temperature({rt['repairTemp']}) 가 기본({rt['baseTemp']}) 보다 낮아야 함"
    )


# ── (D) 뮤테이션 입증: 게이트 무력화 시 일반론이 통과한다 ───────────────
_MUT = r"""
import * as m from PROMPTS_URI;
const P = { count:7, keywords:['바다에서','할머니가','고래를'], emotions:['그리움','불안'], titles:['💔 마음의 잔상'] };
const G = m._monthlyGroundTokens(P).join(' ');
const GENERIC = '이번 달은 다양한 감정이 오갔던 한 달이었어요. 꿈은 마음의 거울이에요. 좋은 흐름이 이어질 수 있어요.';
const real = m._isGrounded(G, GENERIC);  // 정상 게이트: 일반론=false
const stubbed = (() => true)(G, GENERIC); // 무력화 재현: 항상 true
console.log(JSON.stringify({ real, stubbed }));
"""


def test_mutation_disabling_gate_lets_generic_through():
    """grounding 을 항상-true 로 바꾸면 일반론이 통과 = 이 게이트가 실효적임을 입증."""
    res = _run(_MUT)
    assert res["real"] is False, "정상 게이트는 일반론을 차단해야 함"
    assert res["stubbed"] is True, "무력화 시 일반론이 통과 — 게이트가 변경에 민감(실효적)"


# ── (E) 배선 가드 ──────────────────────────────────────────────────────
def test_index_wires_monthly_grounding():
    """index.ts 가 _monthlyGroundTokens 를 import 하고 monthly_report 응답에 게이트를 적용한다."""
    src = INDEX_TS.read_text(encoding="utf-8")
    assert "_monthlyGroundTokens" in src, "_monthlyGroundTokens import/사용 누락"
    # monthly grounding 블록이 _isGrounded + repair 재시도 + _ungrounded 를 모두 쓰는가
    idx = src.index("task === 'monthly_report'")
    # 게이트는 LLM 호출(_chatFallback/_chatConsensus) 이후 응답을 검사해야 함
    tail = src[idx:]
    assert "_monthlyGroundTokens" in tail, "monthly_report 분기 이후 grounding 토큰 추출 미배선"
    assert "repair: true" in tail, "monthly grounding 실패 시 repair 재시도 미배선"
    assert "_ungrounded" in tail, "monthly _ungrounded 플래그(클라 폴백 트리거) 미배선"


def test_client_honors_monthly_ungrounded():
    """my-monthly-report.js 가 _ungrounded 응답을 데이터-grounded 로컬 템플릿으로 강등한다."""
    js = CLIENT.read_text(encoding="utf-8")
    assert "_ungrounded" in js, "클라가 monthly _ungrounded 플래그를 처리하지 않음"
    # 강등 분기: if(data._ungrounded ...) { renderMonthlyReport() } 가 실제 코드로 존재하는가.
    assert "data._ungrounded" in js, "클라가 응답의 _ungrounded 플래그를 분기 조건으로 검사하지 않음"
    cond_idx = js.index("if(data._ungrounded")
    assert "renderMonthlyReport()" in js[cond_idx: cond_idx + 200], (
        "ungrounded 시 데이터-grounded 로컬 템플릿(renderMonthlyReport) 폴백 미배선"
    )
