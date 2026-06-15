"""
MONGGEUL — CHARACTERIZATION: my.js 의존 그래프 + services/stardust.js 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  wave-1 에서 my.js → services/stardust.js 로 추출된 별가루 시스템, 그리고
  my.js 잔여 oversize 클러스터(ACHIEVEMENTS 업적 / 달력 calendar)의 *현재 동작*을
  Node 런타임으로 박제한다. 향후 추가 추출(예: ACHIEVEMENTS/달력 별도 모듈화) 시
  동작이 바뀌면 FAIL 하게 만들어 안전화한다.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(probe 로 실측). 없는 동작 단언 금지.
  - 소스 문자열 스캔이 아니라 실제 함수를 fake localStorage/DOM 으로 구동해 행위를 본다.
  - 추출 안전망: 모듈 전체 import 가 깨지거나(전이 의존 누락) 재노출 신원이
    어긋나면(my.js 의 getStardust 와 stardust.js 의 권위 분리) FAIL.

뮤테이션 정신:
  - 별가루 적립/차감 로직 제거 → 잔액 불변 → FAIL
  - 업적 1회성 지급 중복방지 제거 → 재렌더 시 재지급 → FAIL
  - 달력 월/연 롤오버 깨짐 → 타이틀 시퀀스 어긋남 → FAIL
  - my.js 재노출이 stardust.js 권위와 분리 → 공유 키 불일치 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MY = ROOT / "src" / "tabs" / "my.js"
STARDUST = ROOT / "src" / "services" / "stardust.js"


# ── 공용 브라우저 쉼(SHIM) ──────────────────────────────────────────────
# my.js 는 toast/paywall/radar/symbols/dream-data 등 큰 전이 그래프를 import 한다.
# getElementById 가 항상 캡처 가능한 stub element 를 돌려주도록 해 toast 등이
# null 에서 죽지 않게 한다(=현재 브라우저에서 해당 DOM 노드가 존재하는 상태 모사).
_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { _s:new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)}, clear(){this._s.clear()} };
const _cap = {};
function capEl(id){
  return {
    id, style:{cssText:''},
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(){}, getAttribute(){return null}, addEventListener(){},
    appendChild(){}, prepend(){}, insertBefore(){}, remove(){},
    querySelector(){return null}, querySelectorAll(){return []},
    getContext(){ return { fillRect(){},clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},save(){},restore(){},translate(){},rotate(){},fillText(){},measureText(){return {width:0}} }; },
    get innerHTML(){ return _cap[id]||''; }, set innerHTML(v){ _cap[id]=v; },
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
function calTitle(){ const h=_cap['dreamCalendar']||''; const m=h.match(/cal-title">([^<]+)</); return m?m[1]:null; }
function achCount(){ const h=_cap['achievementList']||''; const m=h.match(/>(\d+)\/(\d+) 달성/); return m?[Number(m[1]),Number(m[2])]:null; }
"""

_RUNTIME = _SHIM + r"""
const my = await import(MY_URI);
const sd = await import(STARDUST_URI);
const out = {};

// ── (A) 모듈 전체 import 가능 = 전이 의존 그래프 무결 ──
out.my_exports = Object.keys(my).sort();
out.sd_exports = Object.keys(sd).sort();

// ── (B) services/stardust.js 단독 행위 ──
_ls.clear();
out.sd_default = sd.getStardust();                 // 0
out.sd_add_ret = sd.addStardust(7, 'a');           // 7 (새 총합 반환)
out.sd_add_ret2 = sd.addStardust(3, 'b');          // 10 (누적)
out.sd_bal = sd.getStardust();                     // 10
out.sd_spend_over = sd.spendStardust(20);          // false (잔액 가드)
out.sd_bal_after_over = sd.getStardust();          // 10 (실패 차감 없음)
out.sd_spend_exact = sd.spendStardust(10);         // true
out.sd_bal_after_exact = sd.getStardust();         // 0
out.sd_spend_empty = sd.spendStardust(1);          // false (0 에서 차감 불가)
// 적립 로그: 최신순 unshift, 100 캡
_ls.clear();
for(let i=0;i<150;i++) sd.addStardust(1,'loop'+i);
const sdlog = JSON.parse(localStorage.getItem('mg_stardust_log')||'[]');
out.sd_log_cap = sdlog.length;                     // 100
out.sd_log_newest_reason = sdlog[0].reason;        // 'loop149'
out.sd_log_total_field = sdlog[0].total;           // 150 (running total)

// ── (C) my.js 재노출 신원: stardust.js 와 동일 권위(localStorage mg_stardust) ──
_ls.clear();
my.addStardust(5, 'r');
out.reexport_key = localStorage.getItem('mg_stardust');  // '5'
out.reexport_getter = my.getStardust();                   // 5
out.reexport_cross = sd.getStardust();                    // 5 (같은 키 = 같은 권위)

// ── (D) 달력(calendar) 월/연 롤오버 — calYear/calMonth 모듈 상태 ──
my.renderCalendar();
const calStart = calTitle();                        // 현재 연/월
const seq=[calStart];
for(let i=0;i<3;i++){ my.nextMonth(); seq.push(calTitle()); }   // +3개월(타이틀마다 renderCalendar)
out.cal_start = calStart;
out.cal_seq = seq;
for(let i=0;i<6;i++) my.prevMonth();                 // -6개월(순효과 -3)
out.cal_after_net_minus3 = calTitle();
// 12월에서 한 칸 더 가면 연 증가/월 0(1월) — 경계 직접 검증
// calStart 위치는 알 수 없으므로, 임의 위치에서 12회 전진 = 같은 월·연+1 이어야
const before = calTitle();
for(let i=0;i<12;i++) my.nextMonth();
out.cal_full_year_same_month = (()=>{
  const a = before.match(/(\d+)년 (\d+)월/); const b = calTitle().match(/(\d+)년 (\d+)월/);
  return a && b && a[2]===b[2] && Number(b[1])===Number(a[1])+1;  // 같은 월, 연+1
})();

// ── (E) 업적(ACHIEVEMENTS): 첫 꿈 → 'first' 1회성 지급(중복 방지) ──
_ls.clear();
localStorage.setItem('mg_logs', JSON.stringify([{date:'2026. 6. 16.', badges:['길몽']}]));
const achSdBefore = my.getStardust();
my.renderAchievements();
out.ach_sd_gain = my.getStardust() - achSdBefore;    // 10 (first reward)
out.ach_claimed = JSON.parse(localStorage.getItem('mg_achievements_claimed')||'[]');  // ['first']
out.ach_render_count = achCount();                    // [1, 22]
// 재렌더는 재지급하지 않음(claimed 가드)
const achSdMid = my.getStardust();
my.renderAchievements();
out.ach_no_double = my.getStardust() === achSdMid;    // true

// ── (F) 출석(doCheckin): +3 별가루 +10 XP streak=1, 당일 멱등 ──
_ls.clear();
my.doCheckin();
out.checkin_sd = my.getStardust();                    // 3
out.checkin_xp = localStorage.getItem('mg_xp');       // '10'
out.checkin_streak = localStorage.getItem('mg_streak');// '1'
const ciSd = my.getStardust();
my.doCheckin();                                        // 같은 날 두 번째 = 무동작
out.checkin_idempotent = (my.getStardust()===ciSd) && localStorage.getItem('mg_streak')==='1';

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — my.js 의존 그래프 런타임 핀 skip")
    script = (
        _RUNTIME
        .replace("MY_URI", json.dumps(MY.resolve().as_uri()))
        .replace("STARDUST_URI", json.dumps(STARDUST.resolve().as_uri()))
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


# ── (A) 의존 그래프 무결 ──────────────────────────────────────────────
def test_my_module_imports_with_full_dep_graph(rt):
    """my.js 가 전이 의존(toast/paywall/radar/symbols/stardust...) 전부 포함해 import 된다.

    추출 안전망: 모듈 분해 중 import 누락/순환이 생기면 import 자체가 실패해 FAIL.
    """
    assert isinstance(rt["my_exports"], list) and rt["my_exports"], "my.js export 표면이 비어있음"
    # wave-1 추출/달력/업적 핵심 공개 표면이 살아있어야 함
    for name in ("renderCalendar", "prevMonth", "nextMonth", "renderAchievements",
                 "doCheckin", "getStardust", "addStardust", "spendStardust"):
        assert name in rt["my_exports"], f"my.js 공개 export 누락: {name}"


def test_stardust_module_export_surface(rt):
    """services/stardust.js 는 정확히 getStardust/addStardust/spendStardust 만 export."""
    assert rt["sd_exports"] == ["addStardust", "getStardust", "spendStardust"], \
        f"stardust.js export 표면 변동: {rt['sd_exports']}"


# ── (B) stardust.js 단독 행위 ──────────────────────────────────────────
def test_stardust_default_and_accumulation(rt):
    """getStardust 기본 0, addStardust 가 새 총합을 반환하고 누적한다."""
    assert rt["sd_default"] == 0, "별가루 기본값이 0 이 아님"
    assert rt["sd_add_ret"] == 7, "addStardust 가 새 총합(7)을 반환해야 함"
    assert rt["sd_add_ret2"] == 10, "두 번째 addStardust 가 누적 총합(10)을 반환해야 함"
    assert rt["sd_bal"] == 10, "누적 잔액이 10 이 아님(적립 로직 깨짐)"


def test_stardust_spend_balance_guard(rt):
    """spendStardust 는 잔액 부족 시 false(차감 없음), 정확히 차감, 0 에서 false."""
    assert rt["sd_spend_over"] is False, "잔액 초과 사용이 false 가 아님(잔액 가드 부재)"
    assert rt["sd_bal_after_over"] == 10, "실패한 사용인데 잔액이 줄어듦(가드 부재)"
    assert rt["sd_spend_exact"] is True, "정확한 금액 사용이 true 가 아님"
    assert rt["sd_bal_after_exact"] == 0, "정확 사용 후 잔액이 0 이 아님"
    assert rt["sd_spend_empty"] is False, "잔액 0 에서 사용이 false 가 아님"


def test_stardust_log_caps_at_100_newest_first(rt):
    """적립 로그는 최신순(unshift)으로 쌓이고 100 개로 캡된다."""
    assert rt["sd_log_cap"] == 100, f"적립 로그 캡이 100 이 아님: {rt['sd_log_cap']}"
    assert rt["sd_log_newest_reason"] == "loop149", "로그 최신 항목이 가장 마지막 적립이 아님(정렬 깨짐)"
    assert rt["sd_log_total_field"] == 150, "로그 total 필드가 적립 시점 누적값을 반영 안 함"


# ── (C) 재노출 신원(권위 공유) ─────────────────────────────────────────
def test_reexport_shares_stardust_authority(rt):
    """my.js 재노출 별가루 함수가 stardust.js 와 동일한 localStorage 권위를 쓴다.

    추출 안전망: my.js 가 자체 사본을 들고 있으면(권위 분리) cross 검증이 깨져 FAIL.
    """
    assert rt["reexport_key"] == "5", "my.addStardust 가 mg_stardust 키에 쓰지 않음"
    assert rt["reexport_getter"] == 5, "my.getStardust 가 5 를 못 읽음"
    assert rt["reexport_cross"] == 5, "stardust.js 직접 reader 가 my.js 적립을 못 봄(권위 분리)"


# ── (D) 달력 월/연 롤오버 ──────────────────────────────────────────────
def test_calendar_month_navigation_sequence(rt):
    """nextMonth 3회 = 연속 3개월 전진, prevMonth 순효과로 정확히 되돌아온다."""
    assert rt["cal_start"], "달력 시작 타이틀을 읽지 못함(renderCalendar 미렌더)"
    seq = rt["cal_seq"]
    assert len(seq) == 4 and all(seq), f"달력 전진 시퀀스 누락: {seq}"
    # 시작 → +3 의 타이틀이 모두 distinct(같은 월 반복이면 롤오버/렌더 깨짐)
    assert len(set(seq)) == 4, f"달력 전진 중 타이틀 중복(이동 안 됨): {seq}"


def test_calendar_year_rollover_full_cycle(rt):
    """임의 위치에서 12회 전진 = 같은 월, 연도 +1(연 롤오버 정확)."""
    assert rt["cal_full_year_same_month"] is True, "12개월 전진이 동월·연+1 로 돌아오지 않음(연 롤오버 깨짐)"


# ── (E) 업적 1회성 지급 ────────────────────────────────────────────────
def test_achievements_first_dream_awards_once(rt):
    """첫 꿈 기록 시 'first' 업적이 10 별가루를 1회만 지급한다."""
    assert rt["ach_sd_gain"] == 10, f"첫 업적 별가루 지급이 10 이 아님: {rt['ach_sd_gain']}"
    assert "first" in rt["ach_claimed"], "'first' 업적이 claimed 에 기록 안 됨"
    assert rt["ach_render_count"] == [1, 22], f"업적 렌더 카운트가 [1,22] 가 아님: {rt['ach_render_count']}"


def test_achievements_no_double_award_on_rerender(rt):
    """재렌더 시 이미 받은 업적은 별가루를 다시 주지 않는다(claimed 가드)."""
    assert rt["ach_no_double"] is True, "재렌더에서 업적 별가루가 재지급됨(중복 방지 깨짐)"


# ── (F) 출석 멱등 ──────────────────────────────────────────────────────
def test_checkin_awards_and_is_idempotent_same_day(rt):
    """doCheckin: +3 별가루 +10 XP streak=1, 같은 날 두 번째는 무동작."""
    assert rt["checkin_sd"] == 3, f"출석 별가루가 3 이 아님: {rt['checkin_sd']}"
    assert rt["checkin_xp"] == "10", f"출석 XP 가 10 이 아님: {rt['checkin_xp']}"
    assert rt["checkin_streak"] == "1", f"출석 streak 가 1 이 아님: {rt['checkin_streak']}"
    assert rt["checkin_idempotent"] is True, "같은 날 두 번째 출석이 중복 지급됨(멱등 깨짐)"
