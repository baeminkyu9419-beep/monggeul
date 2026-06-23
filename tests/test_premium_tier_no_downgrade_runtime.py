"""
MONGGEUL — REGRESSION (R3 brief #5): premium 구독자가 plus 로 강등되지 않는다.

문제(브리프 #5):
  check_entitlement(현 SQL, 20260616_fix_check_entitlement_idor.sql)은 반환 JSON 에
  entitlement_key/tier 를 포함하지 않는다(has_subscription/subscription_expires/
  pack_credits/can_use 만). 따라서 getUserTier 가 has_subscription:true 일 때
  data.entitlement_key=undefined → normalizeEntitlement('plus') 로 단정 →
  premium 구독자가 plus 로 강등(매출/혜택 사고). user_entitlements 폴백(정확 tier 보유)은
  has_subscription:true 면 도달하지 못했다.

수정:
  getUserTier 가 check_entitlement 응답에 명시 tier(entitlement_key/tier)가 없으면
  user_entitlements.entitlement_key 로 정확한 tier 를 확정한다. premium 이면 premium,
  그 외에는 최소 'plus' 보장(구독은 확인됐으므로 미인식 = 환불 유발 방지).

런타임 검증(소스 스캔 아님): Node 로 실제 getUserTier 를 fake store/supabase 로 구동.
  각 시나리오는 sub 모듈을 fresh import(?v=N)하여 _cachedSubscription 오염을 차단한다.

뮤테이션 정신:
  - 강등 회귀(entitlement_key 없을 때 무조건 'plus' 로 단정) → premium 케이스 FAIL.
  - user_entitlements 폴백 제거 → premium 미인식 → FAIL.
  - 구독 인식 자체 제거(plus 보장 깨짐) → has_sub 케이스 FAIL.
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUB = ROOT / "src" / "services" / "subscription.js"
STORE = ROOT / "src" / "store.js"


_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.window = globalThis;
globalThis.gtag = ()=>{};
const elStub=()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},textContent:'',innerHTML:'',offsetWidth:0});
globalThis.document = { getElementById:()=>elStub(), querySelector:()=>null, createElement:elStub };
"""

# fake supabase: check_entitlement 가 checkData 반환, user_entitlements.maybeSingle 이 ueData 반환.
_RUNTIME = _SHIM + r"""
const { store } = await import(STORE_URI);

function mkSupabase(checkData, ueData){
  return {
    from(){ return { select(){return this;}, eq(){return this;}, maybeSingle(){ return Promise.resolve({ data: ueData }); } }; },
    rpc(name){ if(name==='check_entitlement') return Promise.resolve({ data: checkData }); return Promise.resolve({ data:null, error:{message:'no-rpc'} }); }
  };
}

async function tierFor(tag, checkData, ueData){
  // fresh sub 모듈(모듈 캐시 _cachedSubscription 격리). store 는 공유 싱글톤이라 mutate 가 보임.
  const sub = await import(SUB_URI + '?v=' + tag);
  _ls.clear();
  store.supabase = mkSupabase(checkData, ueData);
  store.currentUser = { id: 'u1' };
  return await sub.getUserTier();
}

const out = {};
// 1) check_entitlement 가 명시 entitlement_key='premium' → premium (명시 경로)
out.explicit_premium = await tierFor('a', { has_subscription:true, entitlement_key:'premium' }, null);
// 2) ★버그 핵심: check_entitlement 에 tier 없음 + user_entitlements.entitlement_key='premium' → premium (강등 금지)
out.fallback_premium = await tierFor('b', { has_subscription:true, pack_credits:0, can_use:true }, { entitlement_key:'premium', status:'active' });
// 3) tier 없음 + user_entitlements 'plus' → plus
out.fallback_plus = await tierFor('c', { has_subscription:true, pack_credits:0, can_use:true }, { entitlement_key:'plus', status:'active' });
// 4) tier 없음 + user_entitlements 없음(폴백 실패) → 최소 plus 보장(구독 인식 유지)
out.fallback_none = await tierFor('d', { has_subscription:true, pack_credits:0, can_use:true }, null);
// 5) 구독 없음 → free
out.no_sub = await tierFor('e', { has_subscription:false, pack_credits:0, can_use:false }, null);

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — premium 강등 회귀 런타임 검증 skip")
    script = (
        _RUNTIME
        .replace("SUB_URI", json.dumps(SUB.resolve().as_uri()))
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


def test_explicit_premium_recognized(rt):
    """check_entitlement 가 명시 tier 를 주면 그대로 인식."""
    assert rt["explicit_premium"] == "premium"


def test_premium_not_downgraded_when_check_entitlement_lacks_tier(rt):
    """★핵심 회귀: check_entitlement 가 tier 를 안 주면(현 SQL) premium 구독자를
    plus 로 강등하지 않고 user_entitlements 로 정확한 tier(premium)를 확정한다."""
    assert rt["fallback_premium"] == "premium", (
        "premium 구독자가 plus 로 강등됨 — check_entitlement tier 미반환 시 "
        "user_entitlements 폴백으로 premium 을 확정해야 한다(매출/혜택 사고)"
    )


def test_plus_resolved_when_check_entitlement_lacks_tier(rt):
    """tier 미반환 + user_entitlements 'plus' → plus."""
    assert rt["fallback_plus"] == "plus"


def test_min_plus_guaranteed_when_fallback_empty(rt):
    """구독 확인됐으나 폴백 조회 실패 시에도 최소 plus 보장(미인식=환불 유발 방지)."""
    assert rt["fallback_none"] == "plus"


def test_no_subscription_is_free(rt):
    """구독 없으면 free(페이월 우회 방지)."""
    assert rt["no_sub"] == "free"
