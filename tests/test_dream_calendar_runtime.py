"""
MONGGEUL — CHARACTERIZATION: 꿈 달력 (renderCalendar/prevMonth/nextMonth) Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  services/dream-calendar.js 는 calYear/calMonth 모듈 상태를 공유하는 3 함수다. 월 경계
  롤오버(1월↔12월, 연도 ±)와 길몽/흉몽/중립 색상 분류가 핵심인데 런타임 검증이 없었다.
  *현재 동작*을 Node 로 실행해 박제한다(모듈 상태는 private 라 cal-title/클래스 산출물로 관찰).

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(probe 로 실측). 없는 동작 단언 금지.
  - "지금"을 2026-03-15 로 고정(Date 덮어쓰기)해 기본 월/오늘 표시를 결정적으로 핀.

뮤테이션 정신:
  - prevMonth/nextMonth 의 경계 처리(0→11 year--, 11→0 year++) 변경 → 롤오버 단언 FAIL
  - badge→색상 분류(흉몽 우선 → 길몽 → 중립) 변경 → cal-good/cal-bad 단언 FAIL
  - 날짜 문자열 포맷('YYYY. M. D.') 변경 → has-dream 매핑 어긋남 → FAIL
  - 요일 라벨/월 이름 테이블 변경 → 라벨/타이틀 단언 FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CAL = ROOT / "src" / "services" / "dream-calendar.js"


_RUNTIME = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
let _html = '';
const calEl = { id:'dreamCalendar', get innerHTML(){return _html;}, set innerHTML(v){_html=v;} };
globalThis.document = {
  getElementById:(id)=> id==='dreamCalendar' ? calEl : null,
  querySelector:()=>null, querySelectorAll:()=>[],
  createElement:()=>({}), addEventListener:()=>{},
};
globalThis.window = globalThis;

// "지금" 고정: 2026-03-15 12:00 (3월=월 인덱스 2). 2026-03-01 은 일요일.
const RealDate = Date;
const FIXED = new RealDate(2026,2,15,12,0,0).getTime();
class FD extends RealDate {
  constructor(...a){ if(a.length===0) super(FIXED); else super(...a); }
  static now(){ return FIXED; }
}
globalThis.Date = FD;

const m = await import(CAL_URI);
const out = {};
out.exports = Object.keys(m).sort();

function title(){ const mm=_html.match(/<span class="cal-title">(.*?)<\/span>/); return mm ? mm[1] : null; }

// 길몽/흉몽/중립 1건씩 seed
_ls.set('mg_logs', JSON.stringify([
  {date:'2026. 3. 15.', badges:['길몽']},
  {date:'2026. 3. 10.', badges:['흉몽']},
  {date:'2026. 3. 5.', badges:[]},
]));

m.renderCalendar();
out.initial_title = title();
out.has_good = /cal-day has-dream cal-good/.test(_html);
out.has_bad = /cal-day has-dream cal-bad/.test(_html);
out.has_neutral = /class="cal-day has-dream"/.test(_html);   // 중립: cal-good/cal-bad 없이 has-dream
out.today_marked = /today/.test(_html);
out.day_labels = (_html.match(/cal-day-label">([^<]*)<\/div>/g)||[]).map(s=>s.replace(/.*">([^<]*)<.*/,'$1'));
out.last_day_31 = />31<\/div>/.test(_html);                  // 3월 = 31일
out.other_month_count_initial = (_html.match(/cal-day other-month/g)||[]).length;  // 3/1=일 → 0

// 롤오버
m.prevMonth(); out.prev1 = title();   // 2월
m.prevMonth(); out.prev2 = title();   // 1월
m.prevMonth(); out.prev3 = title();   // 2025년 12월 (year--)
m.nextMonth(); out.next_back = title();// 2026년 1월
for(let i=0;i<11;i++) m.nextMonth();  // 1월→12월
out.dec2026 = title();
m.nextMonth(); out.jan2027 = title(); // 2027년 1월 (year++)

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 꿈 달력 런타임 핀 skip")
    script = _RUNTIME.replace("CAL_URI", json.dumps(CAL.resolve().as_uri()))
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


def test_exports(rt):
    """달력 3 함수 표면 유지."""
    assert rt["exports"] == ["nextMonth", "prevMonth", "renderCalendar"], f"표면 변경: {rt['exports']}"


def test_initial_render(rt):
    """2026-03-15 기준 기본 렌더: 타이틀 '2026년 3월', 31일, 3/1=일요일이라 선행 빈칸 0."""
    assert rt["initial_title"] == "2026년 3월", f"초기 타이틀 어긋남: {rt['initial_title']}"
    assert rt["last_day_31"] is True, "3월에 31일 칸이 없음(daysInMonth 산식 어긋남)"
    assert rt["other_month_count_initial"] == 0, "2026-03-01 일요일인데 선행 빈칸이 생김(firstDay 어긋남)"


def test_day_labels(rt):
    """요일 라벨 일~토 순서 고정."""
    assert rt["day_labels"] == ["일", "월", "화", "수", "목", "금", "토"], f"요일 라벨 어긋남: {rt['day_labels']}"


def test_badge_color_classification(rt):
    """길몽→cal-good, 흉몽→cal-bad, 배지 없음→중립 has-dream, 오늘→today."""
    assert rt["has_good"] is True, "길몽 날짜에 cal-good 클래스 없음"
    assert rt["has_bad"] is True, "흉몽 날짜에 cal-bad 클래스 없음"
    assert rt["has_neutral"] is True, "배지 없는 꿈에 중립 has-dream 클래스 없음"
    assert rt["today_marked"] is True, "오늘(15일) today 클래스 없음"


def test_prev_month_rollover(rt):
    """이전 달: 3월→2월→1월→(연도--)2025년 12월."""
    assert rt["prev1"] == "2026년 2월"
    assert rt["prev2"] == "2026년 1월"
    assert rt["prev3"] == "2025년 12월", "1월에서 이전으로 갈 때 연도 감소가 안 됨(롤오버 깨짐)"


def test_next_month_rollover(rt):
    """다음 달: 2025년 12월→2026년 1월, 그리고 2026년 12월→(연도++)2027년 1월."""
    assert rt["next_back"] == "2026년 1월", "12월에서 다음으로 갈 때 연도 증가가 안 됨"
    assert rt["dec2026"] == "2026년 12월"
    assert rt["jan2027"] == "2027년 1월", "12월→1월 전환 시 연도 증가가 안 됨(롤오버 깨짐)"
