"""
MONGGEUL — CHARACTERIZATION: 스마트 업셀 트리거 선택(전환 결정 트리) Node 런타임 핀

목적(이 wave = 커버리지 우선 안전 분해, 로직 변경 금지):
  growth.js checkSmartUpsell 안의 *순수 결정 트리*(어떤 업셀을 띄울지 = 전환·수익 직결)를
  services/upsell-trigger.js 로 추출(동작보존, 산식/조건/우선순위 무변경)했다.
  이 결정은 zero-coverage 였다(거짓완료 은신처). 우선순위(패턴 > 감정 > 행동 > 시간대)나
  임계(streak>=7, logs 3~5, totalChats>=10, hour 6~9/23~2)가 조용히 어긋나면
  엉뚱한 업셀이 뜨거나 안 떠서 전환 누수 — 행위 핀으로 봉인한다.

성격(characterization):
  - golden 은 추출 후 모듈 + 추출 전 동작(probe)로 실측(2026-06-16). 전/후 동일 확인 후 박제.
  - selectUpsellTrigger 는 순수(부작용/Date/DOM/localStorage 무의존) — 직접 호출로 핀.
  - cross-check: 동일 입력을 growth.checkSmartUpsell(고정 Date + stub setTimeout/gtag)에 흘려
    실제 발화 trigger_id 와 selectUpsellTrigger 결과가 같아야 한다(권위 분리 방지).

뮤테이션 정신:
  - classifyEmotion 키워드/우선순위(fear>sadness>joy) 변경 → ce/multi 어긋남 → FAIL
  - findRepeatedSymbol 임계(>=3)/윈도(20)/최소길이(3) 변경 → frs 어긋남 → FAIL
  - selectUpsellTrigger 우선순위/임계/시간대 경계 변경 → st 어긋남 → FAIL
  - daliOn 게이트 제거 → daliOff 어긋남 → FAIL
  - growth.js 가 자체 결정 사본 유지(import 안 함) → cross-check 어긋남 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
UT = ROOT / "src" / "services" / "upsell-trigger.js"
GROWTH = ROOT / "src" / "services" / "growth.js"


# ── SHIM: growth.js cross-check 용 — DOM/Date 고정 + setTimeout 즉시실행 + gtag 캡처 ──
_SHIM = r"""
const _ls = new Map(), _ss = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { getItem:k=>_ss.has(k)?_ss.get(k):null, setItem:(k,v)=>_ss.set(k,String(v)), removeItem:k=>_ss.delete(k), clear:()=>_ss.clear() };
globalThis.window = globalThis;
let _capTrigger = null;
globalThis.gtag = (t,e,p)=>{ if(e==='smart_upsell_shown') _capTrigger = p.trigger_id; };
globalThis.setTimeout = (fn)=>{ try{ fn(); }catch(_){ } return 0; };
globalThis.document = {
  getElementById:()=>null,
  createElement:()=>({ className:'', style:{cssText:''}, innerHTML:'',
    querySelector:()=>({ addEventListener:()=>{}, hasAttribute:()=>false }),
    addEventListener:()=>{}, remove:()=>{}, insertBefore:()=>{}, firstChild:null, appendChild:()=>{} }),
  body:{ appendChild:()=>{} },
};
// Date 고정 가능화(checkSmartUpsell 의 hour/day/today 결정론화)
const RealDate = Date;
let FROZEN = new RealDate('2026-06-17T10:00:00'); // Wed 10:00 (시간대 트리거 비발동)
globalThis.Date = class extends RealDate {
  constructor(...a){ if(a.length===0){ super(FROZEN.getTime()); } else { super(...a); } }
  static now(){ return FROZEN.getTime(); }
};
globalThis.__setFrozen = (iso)=>{ FROZEN = new RealDate(iso); };
globalThis.__getCap = ()=>_capTrigger;
globalThis.__resetCap = ()=>{ _capTrigger = null; };
"""

_RUNTIME = _SHIM + r"""
const m = await import(UT_URI);
const out = {};
out.exports = Object.keys(m).sort();

const base = { logs:[], totalChats:0, streak:0, hour:10, day:3, daliOn:true };
const S = (o)=> m.selectUpsellTrigger({ ...base, ...o });

out.ce = {
  fear: m.classifyEmotion(['😱 공포']),
  sad: m.classifyEmotion(['슬픔']),
  joy: m.classifyEmotion(['🎉 기쁨']),
  none: m.classifyEmotion(['중립단어']),
  empty: m.classifyEmotion([]),
  nullArg: m.classifyEmotion(null),
  multi: m.classifyEmotion(['기쁨','공포']),  // fear 우선
};
out.frs = {
  rep: m.findRepeatedSymbol([{badges:['뱀']},{badges:['뱀']},{badges:['뱀']}]),
  tooFew: m.findRepeatedSymbol([{badges:['뱀']},{badges:['뱀']}]),
  noRep: m.findRepeatedSymbol([{badges:['a']},{badges:['b']},{badges:['c']}]),
};
out.st = {
  fear: S({logs:[{emotions:['공포']},{emotions:['불안']}]}),
  sadness: S({logs:[{emotions:['슬픔']},{emotions:['기쁨']}]}),
  fearBeatsSymbol: S({logs:[{emotions:['공포'],badges:['뱀']},{emotions:['공포'],badges:['뱀']},{emotions:['공포'],badges:['뱀']}]}),
  patternSymbol: S({logs:[{badges:['뱀']},{badges:['뱀']},{badges:['뱀']}]}),
  patternRepeat: S({logs:[{title:'x'},{title:'x'}]}),
  pattern5: S({logs:[{},{},{},{},{}]}),
  joy: S({logs:[{emotions:['기쁨']}]}),
  dream3rd: S({logs:[{},{},{}]}),
  dream7day: S({logs:[{}],streak:7}),
  daliDeep: S({totalChats:10}),
  daliOff: S({totalChats:10,daliOn:false}),
  morning: S({hour:7}),
  night: S({hour:1}),
  night23: S({hour:23}),
  weekendSat: S({day:6}),
  weekendSun: S({day:0}),
  none: S({}),
  dream3rdBeats7day: S({logs:[{},{},{}],streak:7}),
};

// ── cross-check: growth.checkSmartUpsell 실제 발화 trigger_id == selectUpsellTrigger ──
const growth = await import(GROWTH_URI);
function liveTrigger(setup, iso){
  _ls.clear(); _ss.clear(); __resetCap();
  __setFrozen(iso || '2026-06-17T10:00:00');
  setup();
  growth.checkSmartUpsell();
  return __getCap();
}
out.live = {
  fear: liveTrigger(()=>_ls.set('mg_logs', JSON.stringify([{emotions:['공포']},{emotions:['불안']}]))),
  patternSymbol: liveTrigger(()=>_ls.set('mg_logs', JSON.stringify([{badges:['뱀']},{badges:['뱀']},{badges:['뱀']}]))),
  dream3rd: liveTrigger(()=>_ls.set('mg_logs', JSON.stringify([{},{},{}]))),
  morning: liveTrigger(()=>{}, '2026-06-17T07:00:00'),
  weekend: liveTrigger(()=>{}, '2026-06-20T10:00:00'),
  none: liveTrigger(()=>{}, '2026-06-17T10:00:00'),
};

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 업셀 트리거 런타임 핀 skip")
    script = (
        _RUNTIME
        .replace("UT_URI", json.dumps(UT.resolve().as_uri()))
        .replace("GROWTH_URI", json.dumps(GROWTH.resolve().as_uri()))
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


def test_module_exports(rt):
    assert rt["exports"] == ["classifyEmotion", "findRepeatedSymbol", "selectUpsellTrigger"], \
        f"upsell-trigger.js export 변경: {rt['exports']}"


def test_classify_emotion(rt):
    """감정 분류 + 우선순위(fear > sadness > joy) + 이모지 접두 제거."""
    ce = rt["ce"]
    assert ce["fear"] == "fear", f"공포 분류 어긋남: {ce['fear']}"
    assert ce["sad"] == "sadness", f"슬픔 분류 어긋남: {ce['sad']}"
    assert ce["joy"] == "joy", f"기쁨 분류 어긋남: {ce['joy']}"
    assert ce["none"] is None, f"중립 → None 어긋남: {ce['none']}"
    assert ce["empty"] is None and ce["nullArg"] is None, "빈/null 입력 → None 어긋남"
    assert ce["multi"] == "fear", f"복합 감정 우선순위(fear 우선) 어긋남: {ce['multi']}"


def test_find_repeated_symbol(rt):
    """반복 상징: 3회 이상 등장 배지, 최소 logs 3개, 윈도 20."""
    frs = rt["frs"]
    assert frs["rep"] == "뱀", f"반복 상징 검출 어긋남: {frs['rep']}"
    assert frs["tooFew"] is None, "logs<3 → None(현재 동작)"
    assert frs["noRep"] is None, "반복 없음 → None"


def test_select_upsell_trigger_full_matrix(rt):
    """★전환 결정 트리 전체 박제 — 우선순위/임계/시간대 경계."""
    st = rt["st"]
    expected = {
        "fear": "emotion_fear",
        "sadness": "emotion_sadness",
        "fearBeatsSymbol": "emotion_fear",      # 감정(패턴 내) 체크가 symbol 보다 먼저
        "patternSymbol": "pattern_symbol",
        "patternRepeat": "pattern_repeat",
        "pattern5": "pattern_5dreams",
        "joy": "emotion_joy",
        "dream3rd": "dream_3rd",
        "dream7day": "dream_7day",
        "daliDeep": "dali_deep",
        "daliOff": None,                        # daliOn=false 게이트 → dali_deep 차단
        "morning": "time_morning",
        "night": "time_night",                  # hour<=2
        "night23": "time_night",                # hour>=23
        "weekendSat": "time_weekend",
        "weekendSun": "time_weekend",
        "none": None,
        "dream3rdBeats7day": "dream_3rd",       # dream_3rd 가 dream_7day 보다 먼저
    }
    assert st == expected, f"업셀 트리거 결정 매트릭스 변경: {st}"


def test_dali_gate_blocks_when_off(rt):
    """daliOn=false 면 totalChats>=10 이어도 dali_deep 안 뜸(가역 기능 게이트)."""
    assert rt["st"]["daliOff"] is None, f"dali 게이트 미작동: {rt['st']['daliOff']}"


def test_priority_pattern_over_behavior_over_time(rt):
    """우선순위 보존: 같은 입력에서 더 높은 우선순위가 이긴다(dream_3rd > dream_7day 등)."""
    assert rt["st"]["dream3rdBeats7day"] == "dream_3rd"
    assert rt["st"]["fearBeatsSymbol"] == "emotion_fear"


def test_live_checkSmartUpsell_matches_pure_decision(rt):
    """★권위 분리 방지: growth.checkSmartUpsell 실제 발화 trigger_id 가
    selectUpsellTrigger 결정과 일치(growth 가 자체 사본 안 들고 import 하는지 검증)."""
    live = rt["live"]
    assert live["fear"] == "emotion_fear", f"live fear 불일치: {live['fear']}"
    assert live["patternSymbol"] == "pattern_symbol", f"live symbol 불일치: {live['patternSymbol']}"
    assert live["dream3rd"] == "dream_3rd", f"live dream_3rd 불일치: {live['dream3rd']}"
    assert live["morning"] == "time_morning", f"live morning 불일치: {live['morning']}"
    assert live["weekend"] == "time_weekend", f"live weekend 불일치: {live['weekend']}"
    assert live["none"] is None, f"live none 불일치(발화 안 해야 함): {live['none']}"
