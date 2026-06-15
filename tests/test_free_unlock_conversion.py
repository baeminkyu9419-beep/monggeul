"""
MONGGEUL — CONVERSION-1: 죽은 약속(무료 상세 해몽 5회) 배선 회귀 테스트

배경(버그): claimOnboarding() 이 mg_free_unlocks=5 를 세팅하지만 useFreeUnlock() 이
  코드 어디에서도 호출되지 않아(grep 0) 약속한 '상세 해몽 5회 무료'가 영영 소비되지
  않았다 → 가치 입증 실패 → 전환 손실.

수정: dream.js _renderDreamConversionGate 에서 credits===0 && getFreeUnlocks()>0 이면
  결제 없이 useFreeUnlock()+unlockDetail() 로 무료 소비, 6회차부터 페이월.

뮤테이션 정신:
  - 소스 문자열 스캔이 아니라 Node 런타임으로 실제 동작/차감/소진을 검증.
  - 무료 소비 분기를 제거하면(배선 전 코드) Case A 가 FAIL 해야 진짜 테스트.
  - 무료 소진 후에도 unlock 되면(페이월 우회 회귀) Case B 가 FAIL 해야 진짜.
"""

import json
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DREAM = ROOT / "src" / "tabs" / "dream.js"
MY = ROOT / "src" / "tabs" / "my.js"


# ─────────────────────────────────────────────────────────────
# Part 1: 소스 계약 — useFreeUnlock 이 실제로 게이트에 배선됨 (Node 불필요)
# ─────────────────────────────────────────────────────────────

def _gate_body():
    """_renderDreamConversionGate 함수 본문만 추출 — import 만 있고 미호출이면 잡아낸다."""
    src = DREAM.read_text(encoding="utf-8")
    m = re.search(
        r"function _renderDreamConversionGate\([^)]*\)\s*\{([\s\S]*?)\n\}",
        src,
    )
    assert m, "_renderDreamConversionGate 함수를 찾을 수 없습니다"
    return m.group(1)


def test_useFreeUnlock_imported_into_dream():
    """dream.js 가 my.js 의 useFreeUnlock/getFreeUnlocks 를 import 해야 한다."""
    src = DREAM.read_text(encoding="utf-8")
    m = re.search(r"import\s*\{([^}]*)\}\s*from\s*'\./my\.js'", src)
    assert m, "my.js import 구문을 찾을 수 없습니다"
    names = m.group(1)
    assert "getFreeUnlocks" in names, "getFreeUnlocks 가 import 되지 않음"
    assert "useFreeUnlock" in names, "useFreeUnlock 가 import 되지 않음"


def test_gate_consumes_free_unlock_when_no_credits():
    """전환 게이트가 credits===0 분기 안에서 useFreeUnlock()+unlockDetail() 을 호출해야 한다.

    배선 전 코드(import 만 있고 호출 없음)라면 본문에 useFreeUnlock 이 없어 FAIL.
    """
    body = _gate_body()
    assert "credits === 0" in body or "credits===0" in body, (
        "무료 소비는 결제수단(크레딧) 없는 사용자(credits===0)에 한해야 한다"
    )
    assert "getFreeUnlocks()" in body, "무료 잔여 횟수 확인(getFreeUnlocks) 누락"
    assert "useFreeUnlock()" in body, (
        "useFreeUnlock() 호출 누락 — 무료 횟수가 실제로 소비되지 않으면 약속 미이행(죽은 약속 회귀)"
    )
    assert "unlockDetail()" in body, "무료 소비 후 unlockDetail() 로 상세 해몽을 열어야 한다"


def test_credit_path_returns_before_free_path():
    """구독자(premium/plus) 자동 해제 분기가 무료 소비보다 먼저 return 해야 한다
    (구독자가 무료 횟수를 낭비하지 않도록)."""
    body = _gate_body()
    tier_idx = body.find("_tier === 'premium'")
    free_idx = body.find("getFreeUnlocks()")
    assert tier_idx != -1, "premium 분기를 찾을 수 없음"
    assert free_idx != -1, "무료 소비 분기를 찾을 수 없음"
    assert tier_idx < free_idx, "구독자 분기가 무료 소비 분기보다 뒤에 있음 — 구독자가 무료 횟수를 소비할 위험"
    # premium 분기 안에 return 이 있어야 무료 분기로 빠지지 않음
    tail = body[tier_idx:free_idx]
    assert "return" in tail, "premium 분기에서 return 하지 않아 무료 소비 분기까지 흘러감"


# ─────────────────────────────────────────────────────────────
# Part 2: 런타임 — 실제 게이트(showResult)를 fake DOM 으로 구동
# ─────────────────────────────────────────────────────────────

_RUNTIME = r"""
const _ls = new Map();
globalThis.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k,v) => _ls.set(k, String(v)),
  removeItem: k => _ls.delete(k),
  clear: () => _ls.clear(),
};
globalThis.sessionStorage = { _s:new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)}, clear(){this._s.clear()} };
const _els = {};
function mkEl(id){ return { id, style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}}, setAttribute(){}, getAttribute(){return null}, addEventListener(){}, appendChild(){}, prepend(){}, insertBefore(){}, querySelector(){return null}, querySelectorAll(){return []}, scrollIntoView(){}, focus(){}, blur(){}, remove(){}, getContext(){return {save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){},stroke(){},closePath(){},clearRect(){},fillRect(){},translate(){},rotate(){},scale(){},measureText(){return{width:0}},fillText(){},setLineDash(){},createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}}}}, getBoundingClientRect(){return{width:300,height:300,left:0,top:0}}, width:300, height:300, _ih:'', get innerHTML(){return this._ih}, set innerHTML(v){this._ih=v}, textContent:'' }; }
globalThis.document = {
  getElementById:(id)=>{ if(!_els[id]) _els[id]=mkEl(id); return _els[id]; },
  querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl('x'), createElementNS:()=>mkEl('svg'),
  addEventListener:()=>{}, body:mkEl('body'), activeElement:null
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => {};

const dream = await import(DREAM_URI);
const my = await import(MY_URI);
const out = {};
const detailData = { title:'테스트 꿈', badges:['길몽'], stats:{길흉:60}, emotions:['놀람'], preview:'미리보기', traditional:'전통'.repeat(60), psychology:'심리'.repeat(60), advice:'조언'.repeat(50), fullInterpretation:'깊은해석'.repeat(120) };

function display(id){ return _els[id] && _els[id].style.display; }

// Case A: 무료 5회 + 크레딧 0 → 무료 소비로 자동 unlock, 1회 차감
_ls.clear(); _ls.set('mg_premium_credits','0'); my.claimOnboarding();
out.A_before = my.getFreeUnlocks();
dream.showResult(detailData,'뱀 꿈');
out.A_detailFull = display('detailFull');
out.A_detailLock = display('detailLock');
out.A_after = my.getFreeUnlocks();

// Case A2: 5회 모두 소비하면 마지막엔 0, 그래도 매번 unlock
_ls.clear(); _ls.set('mg_premium_credits','0'); my.claimOnboarding();
let unlockedCount = 0;
for (let i=0;i<5;i++){
  _els['detailFull'] = mkEl('detailFull'); _els['detailLock'] = mkEl('detailLock');
  dream.showResult(detailData,'꿈'+i);
  if (display('detailFull')==='block') unlockedCount++;
}
out.A2_unlocked_in_5 = unlockedCount;       // 5 (5회 전부 무료 공개)
out.A2_remaining = my.getFreeUnlocks();      // 0

// Case B: 무료 소진(0) + 크레딧 0 → unlock 안 됨(페이월 유지)
_ls.clear(); _ls.set('mg_premium_credits','0'); _ls.set('mg_free_unlocks','0');
_els['detailFull'] = mkEl('detailFull'); _els['detailLock'] = mkEl('detailLock');
dream.showResult(detailData,'뱀 꿈');
out.B_detailFull = display('detailFull');
out.B_detailLock = display('detailLock');

// Case C: 크레딧 보유(>0) → 무료 횟수 보존(차감 X), 자동 unlock 안 함(클릭으로 크레딧 소비)
_ls.clear(); _ls.set('mg_premium_credits','3'); my.claimOnboarding();
out.C_before = my.getFreeUnlocks();
_els['detailFull'] = mkEl('detailFull'); _els['detailLock'] = mkEl('detailLock');
dream.showResult(detailData,'뱀 꿈');
out.C_after = my.getFreeUnlocks();
out.C_detailFull = display('detailFull');

console.log(JSON.stringify(out));
"""


def _run_runtime():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 무료 소비 런타임 검증 skip")
    script = (
        _RUNTIME
        .replace("DREAM_URI", json.dumps(DREAM.resolve().as_uri()))
        .replace("MY_URI", json.dumps(MY.resolve().as_uri()))
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


def test_runtime_free_unlock_consumed_and_detail_shown():
    """크레딧 0 + 무료 5회 보유 → 결제 없이 상세 해몽 공개 + 무료 1회 차감."""
    out = _run_runtime()
    assert out["A_before"] == 5, "온보딩 선물 5회가 세팅되지 않음"
    assert out["A_detailFull"] == "block", "무료 횟수가 있는데 상세 해몽이 열리지 않음(죽은 약속 회귀)"
    assert out["A_detailLock"] == "none", "상세 공개 시 잠금 화면이 숨겨져야 함"
    assert out["A_after"] == 4, "무료 횟수가 실제로 차감되지 않음(useFreeUnlock 미작동)"


def test_runtime_five_free_unlocks_all_consumable():
    """약속대로 5회 모두 무료로 소비되고 잔여 0 이 되어야 한다."""
    out = _run_runtime()
    assert out["A2_unlocked_in_5"] == 5, f"5회 무료 약속 미이행 — 실제 무료 공개 {out['A2_unlocked_in_5']}회"
    assert out["A2_remaining"] == 0, "5회 소비 후 잔여가 0 이 아님"


def test_runtime_paywall_after_exhaustion():
    """무료 소진(0) 후에는 결제 없이 unlock 되면 안 됨 — 페이월 우회 차단."""
    out = _run_runtime()
    assert out["B_detailFull"] == "none", "무료 소진 후 상세 해몽이 무료로 열림 — 페이월 우회 회귀"
    assert out["B_detailLock"] == "block", "무료 소진 후 잠금 화면이 노출돼야 함(결제 유도)"


def test_runtime_credits_present_preserves_free_unlocks():
    """크레딧 보유자는 무료 횟수를 낭비하지 않는다(자동 소비 X)."""
    out = _run_runtime()
    assert out["C_before"] == 5
    assert out["C_after"] == 5, "크레딧 보유 상태에서 무료 횟수가 임의로 차감됨"
    assert out["C_detailFull"] != "block", "크레딧 보유 시 자동 unlock 되면 안 됨(클릭으로 크레딧 소비)"
