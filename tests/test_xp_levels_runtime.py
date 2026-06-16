"""
MONGGEUL — CHARACTERIZATION: XP 레벨/칭호 시스템 (getLevel / LEVELS) Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  my.js 잔여 oversize 안의 XP 레벨 시스템(LEVELS 테이블 + 순수함수 getLevel)을
  *현재 동작 그대로* Node 런타임으로 박제한다. 이후 services/xp-levels.js 로 추출할 때
  값/경계/진행률이 한 톨이라도 바뀌면 FAIL 하게 만들어 안전화한다.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(probe 로 실측). 없는 동작 단언 금지.
  - 소스 문자열 스캔이 아니라 실제 getLevel 을 fake localStorage/DOM 으로 구동해 행위를 본다.
  - 추출 안전망:
      (1) my.js 전체 import 가 깨지면(전이 의존 누락/순환) FAIL.
      (2) 추출 후 services/xp-levels.js 가 존재하면 my.getLevel 과 동일 결과를 내야 함
          (권위 분리 방지). 추출 전에는 모듈이 없어 이 단언은 자동 skip.

뮤테이션 정신:
  - LEVELS 임계값(minXP) 변경 → 경계 레벨 어긋남 → FAIL
  - getLevel 진행률 산식(progress) 변경 → 경계 0/100 어긋남 → FAIL
  - 최고레벨 nextTitle=null / nextXP 고정 처리 제거 → FAIL
  - 추출 시 my.js 가 자체 사본 유지(권위 분리) → cross 검증 어긋남 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MY = ROOT / "src" / "tabs" / "my.js"
XP = ROOT / "src" / "services" / "xp-levels.js"


# ── 공용 브라우저 쉼(SHIM) — my.js 의 toast/paywall/radar 등 전이 그래프 대비 ──
_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { _s:new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)}, clear(){this._s.clear()} };
function capEl(id){
  return {
    id, style:{cssText:''},
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(){}, getAttribute(){return null}, addEventListener(){},
    appendChild(){}, prepend(){}, insertBefore(){}, remove(){},
    querySelector(){return null}, querySelectorAll(){return []},
    getContext(){ return { fillRect(){},clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},save(){},restore(){},translate(){},rotate(){},fillText(){},measureText(){return {width:0}} }; },
    get innerHTML(){ return ''; }, set innerHTML(v){},
    textContent:'', offsetWidth:0, parentElement:null, dataset:{},
  };
}
const _els = {};
globalThis.document = {
  getElementById:(id)=>{ _els[id]=_els[id]||capEl(id); return _els[id]; },
  querySelector:()=>null, querySelectorAll:()=>[],
  createElement:()=>capEl('_new'), addEventListener:()=>{},
  body:capEl('body'), documentElement:capEl('html'),
};
globalThis.window = globalThis;
globalThis.window.location = { search:'', pathname:'/', href:'/' };
globalThis.window.history = { replaceState(){} };
globalThis.requestAnimationFrame=()=>{};
globalThis.gtag=()=>{};
"""

_RUNTIME = _SHIM + r"""
import fs from 'node:fs';
const my = await import(MY_URI);
const out = {};

// getLevel 결과에서 박제할 핵심 필드만 추린다.
function slim(r){ return {lv:r.lv,title:r.title,emoji:r.emoji,minXP:r.minXP,xp:r.xp,nextXP:r.nextXP,progress:r.progress,nextTitle:r.nextTitle}; }

// ── (A) my.js 공개 표면에 getLevel 이 살아있다 ──
out.has_getLevel = typeof my.getLevel === 'function';

// ── (B) 경계/진행률/최고레벨 실측 박제 ──
const probe = [0,49,50,150,349,600,1499,1500,6000,99999,-5];
out.levels = {};
for(const xp of probe){ out.levels[xp] = slim(my.getLevel(xp)); }

// ── (C) 추출 안전망: services/xp-levels.js 가 있으면 my.getLevel 과 결과 동일 ──
out.xp_module_exists = fs.existsSync(XP_PATH);
if(out.xp_module_exists){
  const xp = await import(XP_URI);
  out.xp_exports = Object.keys(xp).sort();
  out.xp_matches_my = probe.every(v => JSON.stringify(slim(xp.getLevel(v))) === JSON.stringify(slim(my.getLevel(v))));
}

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — XP 레벨 런타임 핀 skip")
    script = (
        _RUNTIME
        .replace("MY_URI", json.dumps(MY.resolve().as_uri()))
        .replace("XP_URI", json.dumps(XP.resolve().as_uri()))
        .replace("XP_PATH", json.dumps(str(XP.resolve())))
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


# ── (A) 공개 표면 ──────────────────────────────────────────────────────
def test_my_exposes_getLevel(rt):
    """my.js 가 getLevel 을 export 한다(추출 후에도 re-export 로 유지되어야 함)."""
    assert rt["has_getLevel"] is True, "my.js 에서 getLevel 이 사라짐(공개 표면 깨짐)"


# ── (B) 레벨 경계/진행률 박제 ──────────────────────────────────────────
def test_level_boundaries_exact(rt):
    """LEVELS 임계값 경계: 49→Lv1, 50→Lv2, 349→Lv3, 600→Lv5, 1499→Lv6, 1500→Lv7."""
    lv = rt["levels"]
    assert lv["0"]["lv"] == 1 and lv["0"]["title"] == "꿈 초보자"
    assert lv["49"]["lv"] == 1, "49 XP 가 Lv1 경계를 벗어남"
    assert lv["50"]["lv"] == 2 and lv["50"]["title"] == "꿈 탐험가", "50 XP 가 Lv2 로 올라가지 않음"
    assert lv["150"]["lv"] == 3 and lv["150"]["title"] == "꿈 기록자"
    assert lv["349"]["lv"] == 3, "349 XP 가 Lv3 경계를 벗어남"
    assert lv["600"]["lv"] == 5 and lv["600"]["title"] == "꿈 해독자"
    assert lv["1499"]["lv"] == 6, "1499 XP 가 Lv6 경계를 벗어남"
    assert lv["1500"]["lv"] == 7 and lv["1500"]["title"] == "꿈 마스터"


def test_progress_and_next_fields(rt):
    """진행률/다음레벨 필드 산식 박제."""
    lv = rt["levels"]
    # Lv1 시작 0%, 49 XP 에서 98%
    assert lv["0"]["progress"] == 0 and lv["0"]["nextXP"] == 50 and lv["0"]["nextTitle"] == "꿈 탐험가"
    assert lv["49"]["progress"] == 98, f"49 XP 진행률 박제 어긋남: {lv['49']['progress']}"
    # 경계 직전(349) 진행률 100 (현재 산식 그대로)
    assert lv["349"]["progress"] == 100, f"349 XP 진행률 박제 어긋남: {lv['349']['progress']}"
    assert lv["1499"]["progress"] == 100, f"1499 XP 진행률 박제 어긋남: {lv['1499']['progress']}"


def test_max_level_caps(rt):
    """최고 레벨(Lv10): nextTitle=null, nextXP 는 lv.minXP(6000) 로 고정, progress=100."""
    lv = rt["levels"]
    for key in ("6000", "99999"):
        assert lv[key]["lv"] == 10 and lv[key]["title"] == "꿈의 현인"
        assert lv[key]["nextTitle"] is None, f"최고레벨 nextTitle 이 null 이 아님: {lv[key]['nextTitle']}"
        assert lv[key]["nextXP"] == 6000, f"최고레벨 nextXP 가 6000 으로 고정되지 않음: {lv[key]['nextXP']}"
        assert lv[key]["progress"] == 100, "최고레벨 진행률이 100 이 아님"
    # xp 필드는 입력 그대로 보존
    assert lv["99999"]["xp"] == 99999, "getLevel 이 입력 xp 를 결과에 보존하지 않음"


def test_negative_xp_current_behavior(rt):
    """음수 XP 현재 동작 박제(가드 없음): Lv1 유지, progress 음수."""
    lv = rt["levels"]
    assert lv["-5"]["lv"] == 1, "음수 XP 가 Lv1 로 떨어지지 않음(현재 동작 변경)"
    assert lv["-5"]["progress"] == -10, f"음수 XP 진행률 박제 어긋남(현재 동작): {lv['-5']['progress']}"


# ── (C) 추출 안전망: 권위 분리 방지 ─────────────────────────────────────
def test_extracted_module_matches_my_when_present(rt):
    """services/xp-levels.js 가 존재하면 getLevel 결과가 my.js 와 완전 동일해야 한다.

    추출 전에는 모듈이 없어 skip. 추출 후 my.js 가 자체 사본을 유지하면(권위 분리)
    cross 검증이 깨져 FAIL → 안전망.
    """
    if not rt.get("xp_module_exists"):
        pytest.skip("services/xp-levels.js 미존재 — 추출 전(이 단언은 추출 후 활성)")
    assert "getLevel" in rt.get("xp_exports", []), f"xp-levels.js 가 getLevel 을 export 안 함: {rt.get('xp_exports')}"
    assert rt.get("xp_matches_my") is True, "추출 모듈 getLevel 이 my.js 와 다른 값을 냄(권위 분리/로직 변경)"
