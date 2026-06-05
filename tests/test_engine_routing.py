"""
MONGGEUL 해몽 엔진 라우팅 분리 — LLM 경로 vs fallback 사전 경로 명시성 검증
================================================================================

배경 (2026-06-05):
  제품은 LLM 해몽인데 백엔드(Supabase Edge Function)가 죽으면 demoResult()
  (정규식 키워드 캐스케이드)로 떨어진다. 문제는 그 결과가 LLM 해석인지
  fallback 사전 해석인지 사용자/코드가 구분 못 한다는 것 → "AI 가 멍청하다"
  오해(실은 AI 가 안 돌고 있던 것).

  → 결과 객체에 engine:'llm'|'fallback_dictionary' + isFallback + fallbackReason
    을 부착하고, fallback 이 LLM 처럼 보이지 않게 분리. 이 테스트가 그 계약을
    소스+런타임 양쪽에서 잠근다. 목표는 demoResult 고도화가 아니라 경로 분리다.

Node 미설치 시 런타임 부분만 skip(파일 파싱 부분은 항상 실행).
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / "src" / "tabs" / "dream-demo.js"
VALIDATOR = ROOT / "src" / "utils" / "dream-validator.js"
DREAM = ROOT / "src" / "tabs" / "dream.js"
API = ROOT / "src" / "services" / "api.js"


# ─────────────────────────────────────────────────────────────
# Part 1: 소스 파싱 — 라우팅 분리 계약 (Node 불필요, 항상 실행)
# ─────────────────────────────────────────────────────────────

def test_demo_result_tags_fallback_engine():
    """demoResult 는 결과에 engine:'fallback_dictionary' + isFallback:true 를 부착해야 한다."""
    src = DEMO.read_text(encoding="utf-8")
    assert "engine: 'fallback_dictionary'" in src, "demoResult 가 fallback_dictionary 엔진 태그를 안 붙임"
    assert "isFallback: true" in src
    assert "fallbackReason" in src
    # 의미추론 엔진이 아님을 주석에 명시(격리)
    assert "의미 추론" in src and "매칭" in src, "폴백 엔진 성격(매칭/비추론) 주석 부재"


def test_llm_path_tagged_in_dream_js():
    """dream.js 는 LLM 성공 결과를 engine:'llm' 으로 태깅하고, 폴백엔 사유를 넘겨야 한다."""
    src = DREAM.read_text(encoding="utf-8")
    assert "engine='llm'" in src or "engine = 'llm'" in src, "LLM 결과에 engine:'llm' 태깅 부재"
    assert "isFallback=false" in src
    # 폴백 경로에 사유 명시 전달(추측 아님)
    assert "demoResult(inp,'invalid_llm_response')" in src
    assert "fallbackReason" in src, "catch 폴백에 사유 전달 부재"


def test_api_routing_does_not_silently_guess():
    """api.js 는 폴백 사유(fallbackReason)를 error 에 태깅해 '왜 폴백인지' 숨기지 않아야 한다."""
    src = API.read_text(encoding="utf-8")
    assert "fallbackReason" in src
    assert "no_supabase_url" in src, "SUPABASE_URL 미설정을 명시 사유로 태깅 안 함"
    assert "_fbErr" in src


# ─────────────────────────────────────────────────────────────
# Part 2: 런타임 — 실제 입력별 engine/category (Node 필요)
# ─────────────────────────────────────────────────────────────

def _run_node():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 엔진 라우팅 런타임 검증 skip")
    demo_uri = DEMO.resolve().as_uri()
    val_uri = VALIDATOR.resolve().as_uri()
    script = (
        f"import {{ demoResult }} from {json.dumps(demo_uri)};"
        f"import {{ isNonsenseInput }} from {json.dumps(val_uri)};"
        "const pick=r=>({engine:r.engine,isFallback:r.isFallback,title:r.title,badges:r.badges,fallbackReason:r.fallbackReason});"
        "const out={"
        "  exgf:pick(demoResult('전남친이 꿈에 나왔어요')),"
        "  exam:pick(demoResult('졸업했는데 다시 학교에서 시험을 못 치는 꿈을 꿨어요')),"
        "  rooftop:pick(demoResult('친구랑 옥상에서 별을 봤는데 갑자기 문이 잠겼어요')),"
        "  llm_reason:pick(demoResult('아무거나','invalid_llm_response')),"
        "  nonsense:isNonsenseInput('ㄱㄴㄷㄹ'),"
        "  empty:isNonsenseInput('')"
        "};"
        "console.log(JSON.stringify(out));"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    return json.loads(proc.stdout.strip())


def test_runtime_all_fallback_paths_tagged():
    """모든 demoResult 결과는 engine='fallback_dictionary', isFallback=true 로 명시돼야 한다."""
    out = _run_node()
    for key in ("exgf", "exam", "rooftop", "llm_reason"):
        r = out[key]
        assert r["engine"] == "fallback_dictionary", f"{key}: engine 미태깅 ({r['engine']})"
        assert r["isFallback"] is True, f"{key}: isFallback 미설정"


def test_runtime_exgf_breakup_not_romance():
    """'전남친' 은 이별 카테고리(연애운88 오매칭 X)로 first-match 돼야 한다."""
    out = _run_node()
    title = out["exgf"]["title"] or ""
    assert "마음의 흔들림" not in title, "전남친이 일반 연애('마음의 흔들림')로 오매칭됨"
    assert ("잔상" in title) or ("회복" in (out["exgf"].get("badges") or [])), f"이별 카테고리 아님: {title}"


def test_runtime_fallback_reason_passthrough():
    """호출부가 넘긴 fallbackReason(invalid_llm_response 등)이 결과에 보존돼야 한다."""
    out = _run_node()
    assert out["llm_reason"]["fallbackReason"] == "invalid_llm_response"
    # 사유 미지정 기본값
    assert out["exgf"]["fallbackReason"] == "no_backend"


def test_runtime_nonsense_and_empty_rejected():
    """난센스(ㄱㄴㄷㄹ)·빈값은 입력 검증에서 거부돼야 한다(엔진까지 가지 않음)."""
    out = _run_node()
    assert out["nonsense"] is True, "'ㄱㄴㄷㄹ' 난센스 미차단"
    assert out["empty"] is True, "빈값 미차단"
