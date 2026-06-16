"""
MONGGEUL — CHARACTERIZATION: 엔티틀먼트 정규화 + 상품 카탈로그 Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  subscription.js 의 normalizeEntitlement(구독자 인식 = 유료 인식의 정본)은 머니패스인데
  지금까지 *소스 문자열 스캔*(test_paywall_subscriber_recognition.py 의 regex)으로만 검증돼,
  실제 런타임 동작은 zero-coverage 였다(거짓완료 은신처 — 문자열은 맞아도 행위가 깨질 수 있음).
  pro/pro_active/plus_active → plus, premium_active → premium, falsy → free, 그 외 passthrough.
  PRODUCTS 가격/개수(1900/7900/19900/2900)와 SKU_MAP 도 함께 박제(가격 조용한 변경 = 매출 사고).

  이 wave 는 *현재 동작 그대로* Node 런타임으로 박제한다. normalizeEntitlement 는 순수라
  추출 대신 *export 가시성만 추가*(로직 byte-identical, 기존 regex 핀과 공존).

성격(characterization):
  - golden 은 본 모듈 probe 로 실측(2026-06-16). 실제 export 함수/상수 호출(문자열 스캔 아님).
  - subscription.js 는 store/analytics 등을 import 하나 모듈 로드는 fake localStorage/document 로 안전.

뮤테이션 정신:
  - normalizeEntitlement 분기 1개(예: pro→plus) 변경/누락 → norm 어긋남 → FAIL (구독자 미인식 = 환불 유발)
  - PRODUCTS 가격/개수 변경 → catalog 어긋남 → FAIL
  - SKU_MAP 항목 변경 → sku 어긋남 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUB = ROOT / "src" / "services" / "subscription.js"


_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.window = globalThis;
globalThis.gtag = ()=>{};
globalThis.document = { getElementById:()=>({ textContent:'', classList:{add(){},remove(){}}, offsetWidth:0, style:{} }) };
"""

_RUNTIME = _SHIM + r"""
const s = await import(SUB_URI);
const out = {};
out.hasNorm = typeof s.normalizeEntitlement === 'function';

const N = s.normalizeEntitlement;
out.norm = {
  'null': N(null), 'empty': N(''), undef: N(undefined),
  pro: N('pro'), pro_active: N('pro_active'), plus_active: N('plus_active'),
  premium_active: N('premium_active'),
  free: N('free'), plus: N('plus'), premium: N('premium'),
  grace: N('grace_or_hold'), unknown: N('something_else'),
};

out.SKU_MAP = s.SKU_MAP;
out.catalog = Object.fromEntries(Object.entries(s.PRODUCTS).map(([k,v])=>[k,{key:v.key, price:v.price, count:v.count ?? null}]));
out.catalogKeys = Object.keys(s.PRODUCTS).sort();
out.BETA_OPEN_ALL = s.BETA_OPEN_ALL;
out.FREE_STORAGE_LIMIT = s.FREE_STORAGE_LIMIT;

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 엔티틀먼트 정규화 런타임 핀 skip")
    script = _RUNTIME.replace("SUB_URI", json.dumps(SUB.resolve().as_uri()))
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


def test_normalize_entitlement_exported(rt):
    assert rt["hasNorm"] is True, "normalizeEntitlement export 가 사라짐(런타임 핀 불가)"


def test_normalize_entitlement_full_table(rt):
    """★구독자 인식 정규화 전체 표 박제(머니패스 — 미인식 = 환불 유발).
    pro/pro_active/plus_active → plus, premium_active → premium,
    falsy → free, 정규 키/미지정 키는 passthrough."""
    assert rt["norm"] == {
        "null": "free",
        "empty": "free",
        "undef": "free",
        "pro": "plus",
        "pro_active": "plus",
        "plus_active": "plus",
        "premium_active": "premium",
        "free": "free",
        "plus": "plus",
        "premium": "premium",
        "grace": "grace_or_hold",      # passthrough
        "unknown": "something_else",   # passthrough
    }, f"엔티틀먼트 정규화 표 변경: {rt['norm']}"


def test_legacy_pro_recognized_as_plus(rt):
    """★레거시 'pro' 구독자가 'plus' 로 인식돼야 한다(인식 실패 = 유료 차단 사고)."""
    assert rt["norm"]["pro"] == "plus"
    assert rt["norm"]["pro_active"] == "plus"


def test_product_catalog_prices(rt):
    """상품 가격/개수 박제 — 가격 조용한 변경 감지(매출/표기 사고)."""
    assert rt["catalogKeys"] == ["pack15", "pack5", "profile", "single"], \
        f"상품 키 집합 변경: {rt['catalogKeys']}"
    assert rt["catalog"] == {
        "single": {"key": "monggeul_single", "price": 1900, "count": 1},
        "pack5": {"key": "monggeul_pack5", "price": 7900, "count": 5},
        "pack15": {"key": "monggeul_pack15", "price": 19900, "count": 15},
        "profile": {"key": "monggeul_profile", "price": 2900, "count": None},
    }, f"상품 카탈로그(가격/개수) 변경: {rt['catalog']}"


def test_sku_map(rt):
    """플랫폼별 SKU_MAP 박제."""
    assert rt["SKU_MAP"] == {
        "ios": {
            "single": "com.monggeul.single", "pack5": "com.monggeul.pack5",
            "pack15": "com.monggeul.pack15", "profile": "com.monggeul.profile",
            "pro": "com.monggeul.pro.monthly",
        },
        "android": {
            "single": "monggeul_single", "pack5": "monggeul_pack5",
            "pack15": "monggeul_pack15", "profile": "monggeul_profile",
            "pro": "monggeul_pro_monthly",
        },
    }, f"SKU_MAP 변경: {rt['SKU_MAP']}"


def test_beta_open_all_is_false(rt):
    """BETA_OPEN_ALL=false (true 면 전원 premium → 결제 우회). 핀으로 실수 차단."""
    assert rt["BETA_OPEN_ALL"] is False, \
        "BETA_OPEN_ALL 가 true — 전 사용자 premium 무료 개방(결제 우회). 의도면 본 핀 갱신."


def test_free_storage_limit(rt):
    assert rt["FREE_STORAGE_LIMIT"] == 10, f"무료 저장 한도 변경: {rt['FREE_STORAGE_LIMIT']}"
