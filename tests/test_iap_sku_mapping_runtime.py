"""
MONGGEUL — CHARACTERIZATION: IAP 상품키→스토어 SKU 매핑 Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  src/services/iap.js 의 productKey → 스토어 SKU 매핑(getIosProductId/getAndroidProductId)은
  zero-coverage 머니패스였다. 사용자가 'plus' 를 사면 실제로 어떤 스토어 상품을 결제/검증하는지
  결정하는 표 — 조용히 어긋나면 사용자가 엉뚱한 상품을 사거나(과금 사고) 레거시 별칭이
  깨진다(pro_monthly → plus 동의어). 지금까지 행위 테스트가 없어 '거짓완료 은신처'였다.

  이 wave 에서 *현재 동작 그대로* 박제한다. SKU 함수는 순수(DOM/네트워크 무의존)라
  추출 대신 *export 가시성만 추가*(로직 무변경)해 핀 가능하게 했다.

성격(characterization):
  - golden 은 본 모듈 probe 로 실측(2026-06-16). 소스 문자열 스캔 아님 — 실제 export 함수 호출.
  - iap.js 는 toast.js(DOM)/funnel.js→analytics.js→store.js 를 import 하지만
    모두 호출 시점에만 DOM 을 만지므로 모듈 로드는 fake localStorage/document 로 안전.

뮤테이션 정신:
  - IOS_PRODUCTS/ANDROID_PRODUCTS 상수 또는 helper 분기 1개 변경 → 매핑표 어긋남 → FAIL
  - 레거시 별칭(pro_monthly → plus) 제거 → FAIL (하위호환 깨짐 = 과거 구독자 과금 사고)
  - 미지정 키 통과(passthrough) 동작 변경 → FAIL
  - isNative/currentPlatform 웹 기본값(false/'web') 변경 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
IAP = ROOT / "src" / "services" / "iap.js"


_SHIM = r"""
const _ls = new Map(), _ss = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { getItem:k=>_ss.has(k)?_ss.get(k):null, setItem:(k,v)=>_ss.set(k,String(v)), removeItem:k=>_ss.delete(k), clear:()=>_ss.clear() };
globalThis.window = globalThis;
globalThis.gtag = ()=>{};
globalThis.document = { getElementById:()=>({ textContent:'', classList:{add(){},remove(){}}, offsetWidth:0 }) };
"""

_RUNTIME = _SHIM + r"""
const iap = await import(IAP_URI);
const out = {};
out.exports = Object.keys(iap).sort();

const keys = ['plus','premium','plus_monthly','premium_monthly','pro_monthly','single','pack5','pack15','profile','unknown_key'];
out.ios = {}; out.android = {};
for(const k of keys){ out.ios[k] = iap.getIosProductId(k); out.android[k] = iap.getAndroidProductId(k); }

// 웹 환경(Capacitor 미정의) 기본값
out.isNative = iap.isNative();
out.currentPlatform = iap.currentPlatform();

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — IAP SKU 매핑 런타임 핀 skip")
    script = _RUNTIME.replace("IAP_URI", json.dumps(IAP.resolve().as_uri()))
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


def test_sku_helpers_exported(rt):
    """SKU 매핑 함수가 export 되어 핀 가능(가시성 추가, 로직 무변경)."""
    for k in ("getIosProductId", "getAndroidProductId"):
        assert k in rt["exports"], f"{k} export 가 사라짐(핀 불가): {rt['exports']}"


def test_ios_sku_mapping_table(rt):
    """iOS productKey → com.monggeul.* SKU 전체 표 박제(머니패스)."""
    assert rt["ios"] == {
        "plus": "com.monggeul.plus.monthly",
        "premium": "com.monggeul.premium.monthly",
        "plus_monthly": "com.monggeul.plus.monthly",
        "premium_monthly": "com.monggeul.premium.monthly",
        "pro_monthly": "com.monggeul.plus.monthly",   # 레거시 별칭 → plus 동의어
        "single": "com.monggeul.single",
        "pack5": "com.monggeul.pack5",
        "pack15": "com.monggeul.pack15",
        "profile": "com.monggeul.profile",
        "unknown_key": "unknown_key",                  # 미지정 키 통과(passthrough)
    }, f"iOS SKU 매핑표 변경: {rt['ios']}"


def test_android_sku_mapping_table(rt):
    """Android productKey → monggeul_* SKU 전체 표 박제(머니패스)."""
    assert rt["android"] == {
        "plus": "monggeul_plus",
        "premium": "monggeul_premium",
        "plus_monthly": "monggeul_plus",
        "premium_monthly": "monggeul_premium",
        "pro_monthly": "monggeul_plus",                # 레거시 별칭 → plus 동의어
        "single": "monggeul_single",
        "pack5": "monggeul_pack5",
        "pack15": "monggeul_pack15",
        "profile": "monggeul_profile",
        "unknown_key": "unknown_key",                  # 미지정 키 통과(passthrough)
    }, f"Android SKU 매핑표 변경: {rt['android']}"


def test_legacy_pro_monthly_aliases_to_plus(rt):
    """★레거시 하위호환 핀: pro_monthly 는 양 플랫폼에서 plus SKU 로 매핑.
    이 별칭이 깨지면 과거 pro 구독자가 엉뚱한/없는 상품으로 라우팅(과금 사고)."""
    assert rt["ios"]["pro_monthly"] == "com.monggeul.plus.monthly"
    assert rt["android"]["pro_monthly"] == "monggeul_plus"


def test_web_platform_defaults(rt):
    """웹 환경(Capacitor 미정의): isNative=false, currentPlatform='web'."""
    assert rt["isNative"] is False, f"웹에서 isNative 가 false 아님: {rt['isNative']}"
    assert rt["currentPlatform"] == "web", f"웹 기본 플랫폼 변경: {rt['currentPlatform']}"
