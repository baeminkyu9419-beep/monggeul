"""
MONGGEUL — REGRESSION (R3 brief #17): api.js _withRetry 가 복구 불가 응답(401/403/404/503)을
재시도하지 않는다(확정 실패에 ~4s 낭비 차단).

문제(브리프 #17):
  _withRetry 의 catch 블록은 AbortError 아니고 navigator.onLine 이면 attempt<MAX_RETRIES 일 때
  무조건 재시도했다. 401/403(invalid_anon_key)·404(edge_function_not_found)·503
  (llm_provider_unavailable)는 _fbErr 로 throw 되는데, 이 throw 가 같은 함수 catch 에 잡혀
  RETRY_DELAYS([1000,3000]) 동안 2회 더 재시도 → 사용자에게 ~4s 추가 지연(결과 동일).
  503 은 주석상 '즉시 throw' 라 했으나 실제론 catch 에서 재시도되고 있었다.

수정:
  _NON_RETRYABLE_REASONS = {invalid_anon_key, edge_function_not_found, llm_provider_unavailable}.
  catch 진입 시 e.fallbackReason 이 이 집합이면 즉시 throw(continue 건너뜀).
  rate_limited/llm_provider_error(5xx 일시 오류)/네트워크 무태깅은 재시도 유지.

런타임 검증(소스 스캔 아님): fake fetch 로 응답 status 를 제어하고 fetch 호출 횟수로 재시도를
  측정한다. callChat(=_proxyFetch→_withRetry) 를 실제로 구동.

뮤테이션 정신:
  - 401/404/503 즉시 throw 가드 제거 → fetch 3회 호출 → FAIL.
  - 500(일시) 재시도 제거 → fetch 1회 → FAIL(과잉수정 방지: 일시 오류는 재시도 유지).
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = ROOT / "src" / "services" / "api.js"
STORE = ROOT / "src" / "store.js"


_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.window = globalThis;
globalThis.window.SUPABASE_URL = 'https://x.supabase.co';
globalThis.window.SUPABASE_ANON_KEY = 'anon';
// navigator 는 Node 에서 read-only getter → defineProperty 로 덮어쓴다.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

let _calls = 0;
let _status = 200;
function _setStatus(s){ _status = s; }
// fake fetch — _status 에 따라 ok/에러 응답 반환. 호출 횟수 카운트(재시도 측정).
globalThis.fetch = async () => {
  _calls++;
  const ok = _status >= 200 && _status < 300;
  return { ok, status: _status, json: async () => ({ result: 'ok' }) };
};
globalThis.AbortController = class { constructor(){ this.signal = {}; } abort(){} };
globalThis.setTimeout = (fn) => { fn && fn(); return 0; };  // 지연 0(테스트 가속), 호출은 발생
globalThis.clearTimeout = () => {};
"""

_RUNTIME = _SHIM + r"""
const { store } = await import(STORE_URI);
store.supabase = null;  // auth.getSession 경로 회피(anon key 사용)
const api = await import(API_URI);

async function probe(status){
  _calls = 0; _setStatus(status);
  let threw = null, reason = null;
  try { await api.callChat('dream_quick', { dream: 'x' }); }
  catch (e) { threw = true; reason = e && e.fallbackReason; }
  return { calls: _calls, threw: !!threw, reason };
}

const out = {};
out.s401 = await probe(401);
out.s403 = await probe(403);
out.s404 = await probe(404);
out.s503 = await probe(503);
out.s500 = await probe(500);   // 일시 오류 — 재시도 유지(과잉수정 방지)
out.s429 = await probe(429);   // rate limit — 재시도 유지
console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — api 재시도 런타임 검증 skip")
    script = (
        _RUNTIME
        .replace("API_URI", json.dumps(API.resolve().as_uri()))
        .replace("STORE_URI", json.dumps(STORE.resolve().as_uri()))
    )
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


def test_401_not_retried(rt):
    """401(invalid_anon_key)은 1회만 호출(즉시 throw, 재시도 없음)."""
    assert rt["s401"]["calls"] == 1, f"401 재시도 발생: {rt['s401']['calls']}회 (1 기대)"
    assert rt["s401"]["threw"] is True
    assert rt["s401"]["reason"] == "invalid_anon_key"


def test_403_not_retried(rt):
    assert rt["s403"]["calls"] == 1, f"403 재시도 발생: {rt['s403']['calls']}회"
    assert rt["s403"]["reason"] == "invalid_anon_key"


def test_404_not_retried(rt):
    """404(edge_function_not_found)은 1회만 호출."""
    assert rt["s404"]["calls"] == 1, f"404 재시도 발생: {rt['s404']['calls']}회"
    assert rt["s404"]["reason"] == "edge_function_not_found"


def test_503_not_retried(rt):
    """503(llm_provider_unavailable=기능 비활성)은 1회만 호출(주석대로 즉시 throw)."""
    assert rt["s503"]["calls"] == 1, f"503 재시도 발생: {rt['s503']['calls']}회"
    assert rt["s503"]["reason"] == "llm_provider_unavailable"


def test_500_still_retried(rt):
    """★과잉수정 방지: 500(일시 서버오류)은 재시도 유지(3회 = 최초+MAX_RETRIES 2)."""
    assert rt["s500"]["calls"] == 3, f"500 재시도가 사라짐: {rt['s500']['calls']}회 (3 기대)"
    assert rt["s500"]["threw"] is True


def test_429_still_retried(rt):
    """rate limit(429)도 재시도 유지(일시 — 대기 후 재시도가 정상)."""
    assert rt["s429"]["calls"] == 3, f"429 재시도 변경: {rt['s429']['calls']}회 (3 기대)"
