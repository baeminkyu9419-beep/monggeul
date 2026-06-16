"""
MONGGEUL — CHARACTERIZATION: 달이 꿈 데이터 분석 (analyzeDreamData/getEmotionTrend/findStreakSymbol/
getTimeContext/getJoinDays) Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  tabs/dali.js 의 순수 분석 함수들은 sendChat 의 프리미엄 게이트(analysis.total/streakSymbol)와
  buildDariContext 의 프롬프트 데이터(historyBlock)에 그대로 들어간다. 그런데 기존 test_business_logic.py
  는 dali_src 문자열 스캔만 한다(런타임 행위 미검증). 여기서 *현재 동작*을 Node 로 실행해 박제한다.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(probe 로 실측). 없는 동작 단언 금지.
  - getTimeContext 는 시각 의존이라 Date.getHours 를 덮어 경계를 결정적으로 핀.
  - dali.js 는 로드 시 dali-chat/dali-ui import + restoreChatHistory() 사이드이펙트가 있어 DOM 쉼 필요.
    이 쉼이 깨지면(전이 의존 누락/순환) import 단계에서 FAIL → 추출 안전망.

뮤테이션 정신:
  - getTimeContext 시간 경계(5/9/17/21) 변경 → period 매핑 어긋남 → FAIL
  - getEmotionTrend 임계값(±0.2)/부정감정 목록 변경 → improving/worsening/stable 어긋남 → FAIL
  - findStreakSymbol 최소 길이(2)/슬라이스(1,3)/badges 포함 변경 → 연속심볼 어긋남 → FAIL
  - getJoinDays 의 +1/Math.max(1,...) 가드 변경 → 가입일수 어긋남 → FAIL
  - analyzeDreamData 의 주간 윈도(7d/14d)·repeats 임계(>=2)·길흉 비율 변경 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DALI = ROOT / "src" / "tabs" / "dali.js"


_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.__ls = _ls;
function capEl(id){
  return {
    id, style:{cssText:''},
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(){}, getAttribute(){return null}, addEventListener(){},
    appendChild(){}, prepend(){}, insertBefore(){}, remove(){},
    querySelector(){return null}, querySelectorAll(){return []},
    get innerHTML(){ return ''; }, set innerHTML(v){},
    textContent:'', offsetWidth:0, parentElement:null, dataset:{}, scrollTop:0, scrollHeight:0,
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
const RealDate = Date;
const m = await import(DALI_URI);
const out = {};
out.exports = Object.keys(m).sort();

// ── (A) getTimeContext 시간 경계 (Date.getHours 덮어쓰기) ──
function periodAt(hour){
  globalThis.Date = class extends RealDate { getHours(){ return hour; } };
  const r = m.getTimeContext();
  globalThis.Date = RealDate;
  return r.period;
}
out.periods = {};
for(const h of [4,5,8,9,16,17,20,21,23,0]) out.periods[h] = periodAt(h);
out.timeCtx_keys = Object.keys(m.getTimeContext()).sort();

// ── (B) getEmotionTrend 임계값(±0.2)/부정감정 목록 ──
const g = (r,p)=>m.getEmotionTrend(r,p);
out.trend = {
  empty_recent: g([], ['불안']),
  empty_prev: g(['불안'], []),
  improving: g(['기쁨','기쁨','기쁨','기쁨','기쁨'], ['불안','불안','불안','불안','불안']),
  worsening: g(['불안','불안','불안','불안','불안'], ['기쁨','기쁨','기쁨','기쁨','기쁨']),
  stable_equal: g(['불안','기쁨'], ['불안','기쁨']),
  // recent 0.3 neg, prev 1.0 neg → 0.3 < 0.8 → improving
  edge_improving: g(['불안','불안','불안','기쁨','기쁨','기쁨','기쁨','기쁨','기쁨','기쁨'], ['불안']),
};

// ── (C) findStreakSymbol 최소길이/슬라이스(1,3)/badges 포함 ──
const s = (arr)=>m.findStreakSymbol(arr);
out.streak = {
  too_few: s([{keywords:['뱀']}]),
  match3: s([{keywords:['뱀']},{keywords:['뱀']},{keywords:['뱀']}]),
  match2: s([{keywords:['뱀']},{keywords:['뱀']}]),
  badge_counts: s([{badges:['길몽']},{badges:['길몽']}]),
  no_streak: s([{keywords:['뱀']},{keywords:['용']}]),
};

// ── (D) getJoinDays +1/Math.max(1) 가드 ──
const day = 24*60*60*1000;
_ls.set('mg_join_date', String(RealDate.now() - 3*day));
out.joinDays_3ago = m.getJoinDays();
_ls.delete('mg_join_date');
out.joinDays_default = m.getJoinDays();

// ── (E) analyzeDreamData: 빈 → null, 고정 로그 집계 ──
_ls.set('mg_logs','[]');
out.analyze_empty = m.analyzeDreamData();

const now = RealDate.now();
const iso = (d)=> new RealDate(d).toISOString();
const logs = [
  {date: iso(now-1*day), keywords:['뱀'], badges:['길몽'], emotion:'기쁨'},
  {date: iso(now-2*day), keywords:['뱀'], badges:['길몽'], emotion:'기쁨'},
  {date: iso(now-3*day), keywords:['뱀'], badges:['흉몽'], emotion:'불안'},
  {date: iso(now-10*day), keywords:['물'], badges:['흉몽'], emotion:'불안'},
];
_ls.set('mg_logs', JSON.stringify(logs));
const a = m.analyzeDreamData();
out.analyze = {
  total:a.total, recent:a.recent, prevWeekCount:a.prevWeekCount,
  goodRatio:a.goodRatio, badRatio:a.badRatio,
  repeats:a.repeats, avgPerWeek:a.avgPerWeek, streakSymbol:a.streakSymbol,
  recentDreamsLen:a.recentDreams.length, lastDreamIsFirst:(a.lastDream.date===logs[0].date),
};

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 달이 분석 런타임 핀 skip")
    script = _RUNTIME.replace("DALI_URI", json.dumps(DALI.resolve().as_uri()))
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패(import/전이 의존 깨짐 가능):\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


@pytest.fixture(scope="module")
def rt():
    return _run()


# ── 공개 표면 / import 안전망 ──────────────────────────────────────────
def test_dali_module_loads_and_exports(rt):
    """dali.js 가 전이 의존(dali-chat/dali-ui) 포함 정상 로드되고 분석 표면을 export 한다."""
    for fn in ("analyzeDreamData", "getEmotionTrend", "findStreakSymbol", "getTimeContext", "getJoinDays"):
        assert fn in rt["exports"], f"dali.js 가 {fn} 을 export 안 함(표면 깨짐): {rt['exports']}"


# ── (A) 시간 경계 ──────────────────────────────────────────────────────
def test_time_context_boundaries(rt):
    """getTimeContext 경계: <5 night, 5~8 morning, 9~16 daytime, 17~20 evening, 21~ night."""
    p = rt["periods"]
    assert p["4"] == "night" and p["0"] == "night"
    assert p["5"] == "morning" and p["8"] == "morning", "morning 경계(5~8) 어긋남"
    assert p["9"] == "daytime" and p["16"] == "daytime", "daytime 경계(9~16) 어긋남"
    assert p["17"] == "evening" and p["20"] == "evening", "evening 경계(17~20) 어긋남"
    assert p["21"] == "night" and p["23"] == "night", "night 경계(21~) 어긋남"
    assert rt["timeCtx_keys"] == ["greeting", "period", "prompt"], "getTimeContext 반환 필드 변경"


# ── (B) 감정 트렌드 ────────────────────────────────────────────────────
def test_emotion_trend(rt):
    """빈 입력 → null, 부정감정 비율 ±0.2 임계로 improving/worsening/stable."""
    t = rt["trend"]
    assert t["empty_recent"] is None and t["empty_prev"] is None, "빈 입력에서 null 이 아님"
    assert t["improving"] == "improving"
    assert t["worsening"] == "worsening"
    assert t["stable_equal"] == "stable", "동일 비율인데 stable 이 아님(임계값 어긋남)"
    assert t["edge_improving"] == "improving", "0.3 vs 1.0 인데 improving 이 아님(임계 ±0.2 어긋남)"


# ── (C) 연속 심볼 ──────────────────────────────────────────────────────
def test_streak_symbol(rt):
    """최소 2개 필요, slice(1,3) 의 꿈에 첫 꿈 심볼이 다 들어있으면 그 심볼. badges 도 포함."""
    s = rt["streak"]
    assert s["too_few"] is None, "꿈 1개인데 연속 심볼이 잡힘(최소 길이 가드 깨짐)"
    assert s["match3"] == "뱀"
    assert s["match2"] == "뱀", "2개에서 연속 심볼이 안 잡힘(slice(1,3)/every 동작 변경)"
    assert s["badge_counts"] == "길몽", "badges 도 심볼 후보여야 함(badges 누락)"
    assert s["no_streak"] is None, "서로 다른 심볼인데 연속으로 잡힘"


# ── (D) 가입 일수 ──────────────────────────────────────────────────────
def test_join_days(rt):
    """3일 전 가입 → 4(경과+1), join_date 없으면 now 폴백 → 1(Math.max 가드)."""
    assert rt["joinDays_3ago"] == 4, f"3일 전 가입이 4 가 아님(+1 산식 어긋남): {rt['joinDays_3ago']}"
    assert rt["joinDays_default"] == 1, f"가입일 없을 때 1 이 아님(Math.max/폴백 어긋남): {rt['joinDays_default']}"


# ── (E) 꿈 데이터 집계 ─────────────────────────────────────────────────
def test_analyze_empty(rt):
    """로그 0개면 null 반환."""
    assert rt["analyze_empty"] is None, "빈 로그에서 null 이 아님"


def test_analyze_aggregation(rt):
    """고정 로그(최근7d 3개, 10일전 1개)의 집계 박제."""
    a = rt["analyze"]
    assert a["total"] == 4, "전체 개수 어긋남"
    assert a["recent"] == 3, "최근 7일 윈도 집계 어긋남"
    assert a["prevWeekCount"] == 1, "이전 주(7~14d) 윈도 집계 어긋남"
    assert a["goodRatio"] == 50 and a["badRatio"] == 50, "길흉 비율(%) 어긋남"
    # repeats: count>=2 만, 내림차순. 뱀=3, 길몽=2, 흉몽=2
    assert a["repeats"][0] == ["뱀", 3], f"반복 키워드 최상위 어긋남: {a['repeats']}"
    assert ["길몽", 2] in a["repeats"] and ["흉몽", 2] in a["repeats"], "count>=2 키워드 누락"
    assert a["avgPerWeek"] == 3, "주당 평균(recent 기반) 어긋남"
    assert a["streakSymbol"] == "뱀", "연속 심볼 통합 결과 어긋남"
    assert a["recentDreamsLen"] == 4, "recentDreams slice(0,5) 길이 어긋남"
    assert a["lastDreamIsFirst"] is True, "lastDream 이 logs[0] 이 아님"
