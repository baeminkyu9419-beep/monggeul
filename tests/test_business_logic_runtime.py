"""
MONGGEUL — TEST-STRENGTHEN: 결제/구독 핵심 로직 런타임 행위 검증

test_business_logic.py 의 TestPaymentFlow/TestSubscriptionSystem 일부 테스트가
소스 문자열 스캔/always-true OR 였던 것을 보강한다. 이 파일은 Node 런타임으로 실제
함수를 fake store/DOM 으로 구동해 '행위'를 검증한다(소스 존재가 아니라 동작).

뮤테이션 정신: 각 검증은 해당 보안/과금 로직을 망가뜨리면 FAIL 한다.
  - 로그인 가드 제거 → 비로그인 결제 시작됨 → FAIL
  - 크레딧 차감 제거 → 잔액 안 줄어듦 → FAIL
  - 구독 무제한 분기 제거 → remaining 유한 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUB = ROOT / "src" / "services" / "subscription.js"
PAY = ROOT / "src" / "services" / "payment.js"
STORE = ROOT / "src" / "store.js"


_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { _s:new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)}, clear(){this._s.clear()} };
const elStub=()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},addEventListener(){},appendChild(){},prepend(){},remove(){},querySelector(){return null},querySelectorAll(){return []},innerHTML:'',textContent:'',offsetWidth:0});
globalThis.document = { getElementById:()=>elStub(), querySelector:()=>null, querySelectorAll:()=>[], createElement:elStub, addEventListener:()=>{}, body:elStub() };
globalThis.window = globalThis;
globalThis.window.location = { search:'', pathname:'/', href:'/' };
globalThis.window.history = { replaceState(){} };
globalThis.requestAnimationFrame=()=>{};
globalThis.gtag=()=>{};
function fakeSupabase(){ return { from(){ return { insert(){ return { then(cb){ cb&&cb(); return { catch(){} }; } }; } }; }, rpc(){ return Promise.resolve({ data:null, error:{message:'no-rpc'} }); } }; }
"""

_RUNTIME = _SHIM + r"""
const sub = await import(SUB_URI);
const pay = await import(PAY_URI);
const { store } = await import(STORE_URI);
const out = {};

// ── 크레딧 차감(로컬/게스트 경로: supabase 없음) ──
_ls.clear(); store.supabase=null; store.currentUser=null;
_ls.set('mg_premium_credits','3'); sub.invalidateCreditCache && sub.invalidateCreditCache();
out.use_first = await sub.useCredit();       // true
out.after_first = sub.getCreditsLocal();      // 2
await sub.useCredit(); await sub.useCredit(); // 0
out.after_three = sub.getCreditsLocal();      // 0
out.use_when_zero = await sub.useCredit();    // false (잔액 가드)
out.after_zero = sub.getCreditsLocal();       // 0 (음수 차감 금지)

// ── 게스트 1회(백엔드 정상) ──
_ls.clear(); store.supabase=fakeSupabase(); store.currentUser=null;
out.guest_up_first_remaining = (await sub.canUseDream()).remaining;  // 1
await sub.incDreamCount();
const gUp = await sub.canUseDream();
out.guest_up_after_allowed = gUp.allowed;     // false
out.guest_up_after_reason = gUp.reason;        // guest_limit

// ── 게스트 3회(백엔드 다운/데모) ──
_ls.clear(); store.supabase=null; store.currentUser=null;
let demo=0; for(let i=0;i<6;i++){ const g=await sub.canUseDream(); if(g.allowed){ demo++; await sub.incDreamCount(); } }
out.guest_demo_allowed = demo;                 // 3

// ── getCachedTier 기본 free (구독 캐시 오염 전에 먼저 검증) ──
_ls.clear(); store.supabase=null; store.currentUser=null;
out.tier_default = sub.getCachedTier();        // 'free'
_ls.set('mg_dev_unlock','premium');
out.tier_dev = sub.getCachedTier();            // 'premium'
_ls.delete('mg_dev_unlock');

// ── 구독 무제한 (실제 getUserTier 구독 경로: check_entitlement RPC=plus) ──
// dev_unlock 이 아니라 서버 entitlement 기반 구독자(getUserTier()==='plus')가 무제한인지 검증.
// (이 블록은 모듈 _cachedSubscription 을 true 로 만드므로 getCachedTier 검증 뒤에 둔다.)
function subSupabase(tier){ return { from(){ return { insert(){ return { then(cb){ cb&&cb(); return { catch(){} }; } }; }, select(){ return this; }, eq(){ return this; }, maybeSingle(){ return Promise.resolve({ data:null }); } }; }, rpc(name){ if(name==='check_entitlement') return Promise.resolve({ data:{ has_subscription:true, entitlement_key:tier } }); return Promise.resolve({ data:null, error:{message:'no-rpc'} }); } }; }
_ls.clear(); store.supabase=subSupabase('plus'); store.currentUser={id:'sub-user'};
const sg = await sub.canUseDream();
out.sub_remaining_infinite = sg.remaining === Infinity;  // true
out.sub_allowed = sg.allowed;                  // true

// ── 로그인 가드: 비로그인은 결제 시작 안 함 ──
function funnelHas(step){ const f=JSON.parse(localStorage.getItem('mg_funnel')||'{}'); return !!f[step]; }
_ls.clear(); store.supabase=null; store.currentUser=null;
await pay.startPayment({productId:'pack_1',method:'card'});
out.pay_nouser_started = funnelHas('checkout_started');  // false (가드)
_ls.clear(); store.supabase=fakeSupabase(); store.currentUser={id:'u1'};
await pay.startPayment({productId:'pack_1',method:'card'});
out.pay_user_started = funnelHas('checkout_started');    // true (가드 통과)

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 결제/구독 런타임 검증 skip")
    script = (
        _RUNTIME
        .replace("SUB_URI", json.dumps(SUB.resolve().as_uri()))
        .replace("PAY_URI", json.dumps(PAY.resolve().as_uri()))
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


def test_runtime_credit_decrements_and_floors_at_zero(rt):
    """useCredit 이 실제로 잔액을 1씩 줄이고, 0 에서 더 줄지 않으며 false 를 반환."""
    assert rt["use_first"] is True, "크레딧 보유 시 차감 성공해야 함"
    assert rt["after_first"] == 2, "3→2 차감 안 됨(차감 로직 깨짐)"
    assert rt["after_three"] == 0, "연속 차감으로 0 에 도달해야 함"
    assert rt["use_when_zero"] is False, "잔액 0 에서 차감이 false 여야 함(잔액 가드)"
    assert rt["after_zero"] == 0, "잔액 0 에서 음수로 내려감(가드 부재)"


def test_runtime_guest_one_dream_when_backend_up(rt):
    """백엔드 정상 구간 게스트는 정확히 1회 + 소진 후 guest_limit."""
    assert rt["guest_up_first_remaining"] == 1, "정상 구간 게스트 첫 remaining 이 1 이 아님"
    assert rt["guest_up_after_allowed"] is False, "1회 소진 후에도 허용됨(체험 무제한 버그)"
    assert rt["guest_up_after_reason"] == "guest_limit", "소진 후 reason 이 guest_limit 아님"


def test_runtime_guest_three_dreams_when_backend_down(rt):
    """백엔드 다운(데모) 구간 게스트는 3회 무료(CONVERSION-3 완화)."""
    assert rt["guest_demo_allowed"] == 3, f"데모 게스트 무료 {rt['guest_demo_allowed']}회 (기대 3)"


def test_runtime_subscriber_unlimited(rt):
    """구독/언락 시 canUseDream remaining 이 Infinity(무제한)."""
    assert rt["sub_remaining_infinite"] is True, "구독자 remaining 이 Infinity 가 아님(무제한 깨짐)"
    assert rt["sub_allowed"] is True, "구독자 해몽 허용 안 됨"


def test_runtime_cached_tier_default_free(rt):
    """구독 없으면 'free', dev unlock 시 'premium'."""
    assert rt["tier_default"] == "free", "미구독 기본 tier 가 free 가 아님(페이월 우회 위험)"
    assert rt["tier_dev"] == "premium", "dev unlock 이 tier 에 반영 안 됨"


def test_runtime_login_gate_blocks_guest_payment(rt):
    """비로그인은 결제(checkout_started)를 시작하지 못하고, 로그인 시 통과한다."""
    assert rt["pay_nouser_started"] is False, "비로그인인데 결제 시작됨 — 로그인 가드 우회"
    assert rt["pay_user_started"] is True, "로그인했는데 결제 시작 안 됨 — 가드 과차단"
