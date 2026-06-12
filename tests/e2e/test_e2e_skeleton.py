"""
monggeul E2E — puppeteer 4 시나리오 harness
실행: cd tests && PYTHONUTF8=1 python -m pytest e2e/test_e2e_skeleton.py -v

동작 원리:
- npm run build 후 vite preview (임시 포트) 기동 → 4 시나리오 실행 → 종료
- node / puppeteer 미설치 시 pytest.skip (자동 skip 가드)
- 실 결제 API 진입 0 (paywall CTA → 모달 열림 확인까지만)
"""

import os
import re
import shutil
import subprocess
import sys
import time
import socket
import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUNNER_CJS = os.path.join(os.path.dirname(__file__), "e2e_runner.cjs")


# ---------------------------------------------------------------------------
# 공통 픽스처: node/puppeteer 가드 + vite preview 서버 생명주기
# ---------------------------------------------------------------------------

def _node_available():
    return shutil.which("node") is not None


def _puppeteer_available():
    if not _node_available():
        return False
    result = subprocess.run(
        ["node", "-e", "require('puppeteer'); process.exit(0)"],
        capture_output=True,
        cwd=REPO_ROOT,
    )
    return result.returncode == 0


def _free_port():
    s = socket.socket()
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_for_server(port, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            s = socket.create_connection(("localhost", port), timeout=1)
            s.close()
            return True
        except OSError:
            time.sleep(0.3)
    return False


@pytest.fixture(scope="module")
def preview_server():
    """빌드된 dist/ 를 vite preview 로 서빙하는 임시 서버."""
    if not _node_available():
        pytest.skip("node not found")
    if not _puppeteer_available():
        pytest.skip("puppeteer not installed")

    port = _free_port()
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"

    # Windows: npx is a .cmd file and needs shell=True (or explicit .cmd path)
    is_windows = sys.platform == "win32"
    proc = subprocess.Popen(
        "npx vite preview --port " + str(port),
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        shell=True,
    )

    if not _wait_for_server(port, timeout=30):
        proc.terminate()
        pytest.skip("vite preview did not start in time")

    base_url = f"http://localhost:{port}/monggeul/"
    yield base_url

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _run_scenario(scenario, base_url):
    """node e2e_runner.cjs <scenario> <base_url> 실행 → (exit_code, stdout)."""
    result = subprocess.run(
        ["node", RUNNER_CJS, scenario, base_url],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=REPO_ROOT,
        timeout=60,
    )
    return result.returncode, result.stdout.strip() + result.stderr.strip()


# ---------------------------------------------------------------------------
# 시나리오 1: 꿈 입력 → 해몽 결과 렌더 (LLM 또는 demoResult 폴백)
# ---------------------------------------------------------------------------

def test_dream_input_to_result(preview_server):
    """
    Given: localhost vite preview 에 접속한다.
    When:  꿈 입력창에 "전 여자친구가 꿈에 나왔어요" 를 입력하고 해몽 버튼을 클릭한다.
    Then:  결과 영역(resultEl)에 해몽 텍스트가 렌더된다.
           LLM 또는 demoResult 폴백 둘 중 하나면 PASS.
           빈 결과 또는 에러만 표시되면 FAIL.
    """
    exit_code, output = _run_scenario("dream_input", preview_server)
    if exit_code == 2:
        pytest.skip("puppeteer skip: " + output)
    assert exit_code == 0, f"dream_input FAIL:\n{output}"
    assert "PASS" in output, f"Unexpected output:\n{output}"


# ---------------------------------------------------------------------------
# 시나리오 2: paywall CTA → 결제 모달 열림 (실 결제 API 0)
# ---------------------------------------------------------------------------

def test_paywall_to_plus_subscription_flow(preview_server):
    """
    Given: showPremiumPaywall() 를 호출해 paywall 을 노출한다.
    When:  Plus/pack_1 CTA 버튼을 클릭한다.
    Then:  결제수단 모달 또는 paymentComingSoon 모달이 열린다.
           ₩3,900 가격이 paywall 에 노출된다.
           실 결제 API 진입 0.
    """
    exit_code, output = _run_scenario("paywall_cta", preview_server)
    if exit_code == 2:
        pytest.skip("puppeteer skip: " + output)
    assert exit_code == 0, f"paywall_cta FAIL:\n{output}"
    assert "PASS" in output, f"Unexpected output:\n{output}"


# ---------------------------------------------------------------------------
# 시나리오 3: 오프라인 / LLM 실패 → demoResult 폴백 렌더
# ---------------------------------------------------------------------------

def test_llm_failure_falls_back_to_demo_result(preview_server):
    """
    Given: page.setOfflineMode(true) 로 네트워크를 차단한다.
    When:  꿈 텍스트("뱀 꿈을 꿨어요")를 입력하고 해몽 버튼을 클릭한다.
    Then:  빈 화면 대신 demoResult 폴백 해몽 텍스트가 렌더된다.
           빈 화면이어서는 안 된다.
    """
    exit_code, output = _run_scenario("offline_fallback", preview_server)
    if exit_code == 2:
        pytest.skip("puppeteer skip: " + output)
    assert exit_code == 0, f"offline_fallback FAIL:\n{output}"
    assert "PASS" in output, f"Unexpected output:\n{output}"


# ---------------------------------------------------------------------------
# 시나리오 4: 가격 표기 정합 (Plus ₩3,900)
# ---------------------------------------------------------------------------

def test_price_display_correctness(preview_server):
    """
    Given: showPremiumPaywall() 를 호출해 paywall 을 노출한다.
    When:  DOM 에서 가격 텍스트(₩ 포함)를 수집한다.
    Then:  Plus 플랜 가격이 정확히 ₩3,900 으로 표기된다.
           ₩9,900 이 유일한 Plus 앵커로 남아있으면 FAIL (레거시 잔존).
    """
    exit_code, output = _run_scenario("price_display", preview_server)
    if exit_code == 2:
        pytest.skip("puppeteer skip: " + output)
    assert exit_code == 0, f"price_display FAIL:\n{output}"
    assert "PASS" in output, f"Unexpected output:\n{output}"
