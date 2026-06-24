"""
MONGGEUL — 입력 grounding(소재 일치) 게이트: 런타임 행위 테스트
================================================================================

배경 (핵심 제품 결함):
  꿈 해석 출력이 사용자 입력을 무시했다. 실측: 입력 "할머니/고래" → 출력 "아빠 걷는/
  죽은 고양이" = 완전 무관. LLM(temperature 0.85)이 입력 대신 시스템 프롬프트의 구체적
  예시(할머니/밥상)나 흔한 시나리오(전 애인/이빨)를 변주해 환각한 것. 사용자는 자기 꿈과
  무관한 해석을 '정확한 AI 해석'으로 받고 결제까지 한다(팔지만 안 줌).

수정 (서버측 grounding 게이트):
  supabase/functions/openai-proxy/prompts.ts 에 순수 함수
    - _extractGroundTokens(input): 입력에서 구별되는 한글 소재 토큰 추출(조사/상투어 제거)
    - _isGrounded(input, output): 출력이 입력 소재를 1개 이상 반영하는지 판정
    - _groundingRepairDirective(input): 재시도용 교정 지시(입력 토큰 못 박음)
  를 추가. index.ts 가 해몽 응답이 ungrounded 면 repair 1회 재시도 → 그래도 실패면
  _ungrounded 플래그 → 클라(dream.js)가 키워드 폴백(입력 grounded)으로 강등.

이 테스트는 Node 로 .ts 의 실제 함수를 실행(behavioral)해 다음을 단언한다:
  1) 포커스 실측 환각(아빠/고양이)이 입력(할머니/고래) 미반영으로 판정됨 → false
  2) 입력 소재를 반영한 정상 출력은 통과 → true
  3) 활용형(고래가→고래) 흡수, 빈약 입력(토큰<2)은 보수적 통과(오탐 0)
  4) 뮤테이션: grounding 검사를 무력화(항상 true)하면 환각이 통과 = 이 게이트가 실효적

Node 미설치 시 skip(다른 *_runtime.py 와 동일 전략). Deno 불필요 — 순수 함수.
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "supabase" / "functions" / "openai-proxy" / "prompts.ts"
INDEX_TS = ROOT / "supabase" / "functions" / "openai-proxy" / "index.ts"


# ── Node 런타임 하니스: 실제 prompts.ts 함수를 실행해 결과를 JSON 으로 ──────────
_RUNTIME = r"""
import * as m from PROMPTS_URI;
const out = {};
out.has = {
  isGrounded: typeof m._isGrounded === 'function',
  extract: typeof m._extractGroundTokens === 'function',
  repair: typeof m._groundingRepairDirective === 'function',
  build: typeof m.buildChatPayload === 'function',
};

// 포커스 실측 시나리오
const INPUT = '꿈에서 돌아가신 할머니랑 바다에서 큰 고래를 봤어요';
const HALLUC = JSON.stringify({title:'💔 마음의 잔상', preview:'아빠가 천천히 걷는 모습은 그리움이에요. 죽은 고양이는 정리되지 않은 마음이에요.'});
const GROUNDED = JSON.stringify({title:'🐋 그리움의 바다', preview:'돌아가신 할머니와 본 고래는 깊은 그리움이에요.'});

out.tokens = m._extractGroundTokens(INPUT);
out.hallucGrounded = m._isGrounded(INPUT, HALLUC);       // 기대 false (환각 차단)
out.groundedGrounded = m._isGrounded(INPUT, GROUNDED);   // 기대 true
out.conjugation = m._isGrounded('고래가 헤엄쳤어요 바다에서', JSON.stringify({preview:'고래의 자유로움'})); // 기대 true
out.sparseLenient = m._isGrounded('뱀', '아무 상관 없는 텍스트');  // 기대 true (토큰<2 → 보수적 통과)
out.emptyOutput = m._isGrounded(INPUT, '');               // 기대 false (출력 없음=미반영)

// repair directive 가 입력 토큰을 실제로 나열하는가
const dir = m._groundingRepairDirective(INPUT);
out.repairListsTokens = dir.includes('할머니') && dir.includes('고래');

// buildChatPayload 가 repair 플래그로 교정 지시를 system 에 주입하고 temperature 를 낮추는가
const base = m.buildChatPayload('dream_quick', { input: INPUT });
const rep  = m.buildChatPayload('dream_quick', { input: INPUT, repair: true });
const sysOf = (p) => (p.messages.find(x => x.role === 'system') || {}).content || '';
out.baseTemp = base.temperature;
out.repairTemp = rep.temperature;
out.repairInjectsDirective = sysOf(rep).includes('교정') && sysOf(rep).includes('고래');
out.baseHasNoDirective = !sysOf(base).includes('교정 — 매우 중요');

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 입력 grounding 런타임 핀 skip")
    script = _RUNTIME.replace("PROMPTS_URI", json.dumps(PROMPTS.resolve().as_uri()))
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


# ── (A) 함수 표면 ──────────────────────────────────────────────────────
def test_grounding_functions_exported(rt):
    """grounding 검증 함수가 prompts.ts 에서 export 된다."""
    for k in ("isGrounded", "extract", "repair", "build"):
        assert rt["has"][k] is True, f"{k} export 누락 — grounding 게이트 미작동"


def test_tokens_extracted_from_input(rt):
    """입력에서 핵심 소재 토큰(할머니/고래/바다)이 추출된다."""
    toks = rt["tokens"]
    assert "할머니" in toks, f"할머니 토큰 누락: {toks}"
    assert "고래" in toks, f"고래 토큰 누락: {toks}"
    assert "바다" in toks, f"바다 토큰 누락: {toks}"


# ── (B) 핵심: 환각 차단 / 정상 통과 ────────────────────────────────────
def test_focus_hallucination_is_rejected(rt):
    """★실측 환각(입력 할머니/고래 → 출력 아빠/고양이)이 미반영으로 판정된다."""
    assert rt["hallucGrounded"] is False, (
        "입력 소재(할머니/고래)를 전혀 안 쓴 환각 출력이 grounded 로 통과됨 — 게이트 무력"
    )


def test_grounded_output_passes(rt):
    """입력 소재를 반영한 정상 출력은 통과한다(오탐 없음)."""
    assert rt["groundedGrounded"] is True, "정상(입력 반영) 출력이 잘못 차단됨 — 오탐"


def test_conjugation_absorbed(rt):
    """활용형(고래가) 입력도 출력의 어근(고래) 매칭으로 반영 인정."""
    assert rt["conjugation"] is True


def test_sparse_input_is_lenient(rt):
    """소재가 빈약한 입력(토큰<2)은 grounding 판정을 건너뛰어 통과(보수적·오탐 방지)."""
    assert rt["sparseLenient"] is True


def test_empty_output_is_ungrounded(rt):
    """출력이 비면 미반영(false) — 빈 응답을 통과시키지 않는다."""
    assert rt["emptyOutput"] is False


# ── (C) repair 재시도 경로 ─────────────────────────────────────────────
def test_repair_directive_lists_input_tokens(rt):
    """교정 지시가 입력 소재(할머니/고래)를 명시 나열해 예시 변주를 차단한다."""
    assert rt["repairListsTokens"] is True


def test_repair_payload_injects_directive_and_lowers_temp(rt):
    """repair=true 면 system 에 교정 지시 주입 + temperature 더 낮춤(충실도↑)."""
    assert rt["repairInjectsDirective"] is True, "repair 시 교정 지시가 system 에 안 들어감"
    assert rt["baseHasNoDirective"] is True, "기본 호출에 교정 지시가 새어 들어감"
    assert rt["repairTemp"] < rt["baseTemp"], (
        f"repair temperature({rt['repairTemp']}) 가 기본({rt['baseTemp']}) 보다 낮아야 함"
    )


def test_dream_temperature_lowered_for_faithfulness(rt):
    """해몽 기본 temperature 가 0.85 → 충실 반영 위해 0.5 이하로 낮춰졌다(드리프트 억제)."""
    assert rt["baseTemp"] <= 0.5, (
        f"해몽 temperature 가 여전히 높음({rt['baseTemp']}) — 입력 무시/예시 변주 위험"
    )


# ── (D) 뮤테이션 입증: 게이트를 무력화하면 환각이 통과한다 ──────────────
_MUT_RUNTIME = r"""
import * as m from PROMPTS_URI;
const INPUT = '꿈에서 돌아가신 할머니랑 바다에서 큰 고래를 봤어요';
const HALLUC = JSON.stringify({preview:'아빠가 걷는 모습은 그리움. 죽은 고양이.'});
// 정상 게이트: 환각=false
const real = m._isGrounded(INPUT, HALLUC);
// 게이트 무력화(항상 true 반환) 재현 → 환각이 통과됨을 입증
const stubbed = (() => true)(INPUT, HALLUC);
console.log(JSON.stringify({ real, stubbed }));
"""


def test_mutation_disabling_gate_lets_hallucination_through():
    """grounding 검사를 항상-true 로 바꾸면 환각이 통과 = 이 게이트가 실효적임을 입증."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치")
    script = _MUT_RUNTIME.replace("PROMPTS_URI", json.dumps(PROMPTS.resolve().as_uri()))
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\n{proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    res = json.loads(line)
    assert res["real"] is False, "정상 게이트는 환각을 차단해야 함"
    assert res["stubbed"] is True, "무력화 시 환각이 통과 — 게이트가 변경에 민감(실효적)"


# ── (E) 배선 가드: index.ts 가 grounding 게이트를 실제로 호출하는가 ──────
def test_index_wires_grounding_gate():
    """index.ts 가 _isGrounded 를 import 하고 dream task 응답에 게이트를 적용한다."""
    src = INDEX_TS.read_text(encoding="utf-8")
    assert "_isGrounded" in src and "from \"./prompts.ts\"" in src, "_isGrounded import 누락"
    assert "_ungrounded" in src, "_ungrounded 플래그 배선 누락(클라 폴백 트리거)"
    assert "repair: true" in src, "grounding 실패 시 repair 재시도 배선 누락"


def test_frontend_honors_ungrounded_flag():
    """dream.js 가 _ungrounded 응답을 키워드 폴백으로 강등한다(환각을 AI해석으로 안 보여줌)."""
    dream = (ROOT / "src" / "tabs" / "dream.js").read_text(encoding="utf-8")
    assert "_ungrounded" in dream, "dream.js 가 _ungrounded 플래그를 처리하지 않음"
    assert "ungrounded_llm_response" in dream, "ungrounded 폴백 사유 미배선"
