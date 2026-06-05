"""데모/오프라인 해몽이 잠금(paywall) 가치스택 약속을 실제로 지키는지 검증.

배경 (2026-06-03 야간):
  전환 잠금 가치스택은 "에세이처럼 읽히는 깊은 해석 1,000자+" 를 약속한다(dream.js).
  하지만 config 키가 비면 데모 해몽이 기본 경로이고(config.example.js 주석 명시),
  돈 내고 잠금을 푼 사용자가 실제로 보는 건 demoResult().fullInterpretation 이다.
  보강 전 36개 데모 분기는 277~661자에 그쳐 약속을 못 지켰다(= 환불·신뢰 직타).

  → src/tabs/dream-demo.js 에 enrichInterpretation() 을 추가해, 분기 응답이
    약속 분량에 못 미치면 그 꿈 자체의 신호(배지·스탯·감정)에서 도출한 실제
    해석 섹션을 덧붙여 1,000자 이상으로 채운다(무의미 패딩 아님, no-fabrication).

이 테스트가 존재하는 이유:
  다음 세션이 enrichInterpretation 을 무심코 제거/약화하거나, 가치스택 약속
  분량을 올리면(예: 2,000자) 이 단언이 FAIL 하도록 결합한다. 약속과 실제 산출물의
  괴리를 코드로 영구 차단한다.

Node 가 없는 환경에서는 skip(다른 테스트 파일과 동일한 portability 원칙).
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / "src" / "tabs" / "dream-demo.js"
DREAM = ROOT / "src" / "tabs" / "dream.js"

# dream.js 가치스택이 약속하는 최소 분량(코드 약속과 동기). 변경 시 이 상수도 같이 올려야 함.
PROMISED_MIN_CHARS = 1000

# 데모 분기를 폭넓게 커버하는 대표 입력(신규 23 + 기존 깊은 카테고리 + 합성 + 폴백).
SAMPLE_INPUTS = [
    "좋아하는 사람이 꿈에 나왔어", "엄마가 나왔다", "시험 보는 꿈", "운전하다 사고",
    "결혼하는 꿈", "면접 봤어", "돈을 주웠어", "싸우는 꿈", "교통사고 응급실",
    "지갑을 도둑맞았어", "바퀴벌레가 나옴", "밥을 먹었어", "옷을 벗는 꿈",
    "길을 잃었어", "숨었어", "시계가 멈춤", "거울을 봤어", "계단을 올라감",
    "비가 왔어", "꽃이 피었어", "촛불", "전쟁 나는 꿈", "어린 시절 꿈", "빨간 옷",
    "이별하는 꿈", "음식물쓰레기 지각 회사", "뱀이 나왔어", "절벽에서 떨어졌어",
    "쫓기는 꿈", "똥 꿈", "돼지가 집에 들어왔어", "바다에서 헤엄", "귀신이 나옴",
    "하늘을 날았어", "이빨이 빠졌어", "asdfqwer 알수없는입력",
    "호랑이와 용이 같이 나옴", "그냥 이상한 꿈", "",
]


def _node():
    return shutil.which("node")


def _run_demo(inputs):
    """Node 로 demoResult() 를 실제 실행해 각 입력의 fullInterpretation 길이를 반환."""
    node = _node()
    if not node:
        pytest.skip("node 미설치 — 런타임 데모 깊이 검증 skip")
    demo_url = DEMO.resolve().as_uri()
    payload = json.dumps(inputs)
    script = (
        f'import {{ demoResult, DEEP_MIN_LEN }} from {json.dumps(demo_url)};'
        f"const inputs = {payload};"
        "const out = inputs.map(i => {"
        "  const r = demoResult(i);"
        "  const f = (r && r.fullInterpretation) || '';"
        "  const lastHeaderIsMoon = f.lastIndexOf('\\u3010') === f.lastIndexOf('\\u3010\\ub2ec\\uc774\\uc758 \\ud55c\\ub9c8\\ub514\\u3011');"
        "  return { input: i, len: f.length, title: r && r.title, moonCloses: lastHeaderIsMoon };"
        "});"
        "console.log(JSON.stringify({ floor: DEEP_MIN_LEN, rows: out }));"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    return json.loads(proc.stdout.strip().splitlines()[-1])


class TestDemoInterpretationDepth:
    """데모 해몽 깊은 해석이 잠금 약속(1,000자+)을 실제로 충족하는지."""

    def test_value_stack_promise_is_explicit(self):
        """dream.js 가 '1,000자+' 분량을 명시적으로 약속하는지(약속 존재 자체)."""
        text = DREAM.read_text(encoding="utf-8")
        assert "1,000자" in text, "가치스택의 '1,000자+' 분량 약속이 사라짐 — 테스트 전제 붕괴"

    def test_enrich_function_wired(self):
        """enrichInterpretation 이 demoResult 의 단일 출구에 배선됐는지(소스 레벨)."""
        text = DEMO.read_text(encoding="utf-8")
        assert "export function enrichInterpretation" in text, "enrichInterpretation 누락"
        # (2026-06-05: 결과에 engine 태그 부착 위해 'const r = enrichInterpretation(...); return {...r,...}'
        #  형태로 래핑됨 — return 한 줄 형태에 의존하지 않고 호출 배선 자체를 잠근다. 런타임 1,000자
        #  검증은 test_every_demo_meets_promised_length 가 별도 보호.)
        assert "enrichInterpretation(_demoDispatch(i), i)" in text, (
            "demoResult 가 enrichInterpretation 으로 보강하지 않음 — 약속-산출물 괴리 위험"
        )

    def test_every_demo_meets_promised_length(self):
        """모든 대표 데모 분기가 약속한 1,000자 이상을 실제 산출(런타임 실행)."""
        result = _run_demo(SAMPLE_INPUTS)
        floor = result["floor"]
        assert floor >= PROMISED_MIN_CHARS, (
            f"DEEP_MIN_LEN({floor}) 이 약속({PROMISED_MIN_CHARS}자) 미만 — 보강 기준이 약속보다 낮음"
        )
        short = [(r["input"], r["len"], r["title"]) for r in result["rows"] if r["len"] < PROMISED_MIN_CHARS]
        assert not short, f"약속 분량({PROMISED_MIN_CHARS}자) 미달 데모: {short}"

    def test_moon_section_always_closes(self):
        """보강 후에도 【달이의 한마디】가 마지막 섹션으로 남는지(따뜻한 마무리 보존)."""
        result = _run_demo(SAMPLE_INPUTS)
        broken = [r["input"] for r in result["rows"] if not r["moonCloses"]]
        assert not broken, f"【달이의 한마디】가 마지막에 오지 않는 데모: {broken}"
