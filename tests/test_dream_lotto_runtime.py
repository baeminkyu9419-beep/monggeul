"""
MONGGEUL — CHARACTERIZATION: 꿈 로또(재미용) 번호 생성 Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  dream.js 잔여 oversize 안의 로또 생성 클러스터(LOTTO_FREQ/SYMBOL_NUMBERS 테이블 +
  getEnergyWeights/dreamHash/seededRandom/weightedPick/ballRange/generateLottoNumbers)를
  *현재 동작 그대로* Node 런타임으로 박제한다. services/dream-lotto.js 로 추출할 때
  값/시드/가중치/번호열/분석문구가 한 톨이라도 바뀌면 FAIL 하게 만들어 안전화한다.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(golden 은 추출 전 원본 로직 probe 로 실측).
  - 소스 문자열 스캔이 아니라 실제 함수를 fake DOM/고정 Date 로 구동해 행위를 본다.
  - generateLottoNumbers 는 new Date() 로 '오늘'을 시드에 섞으므로 SHIM 에서 Date 를
    2026-06-16 으로 고정해 결정론적으로 박제한다(기존 동작 무변경, 시드 입력만 고정).
  - 추출 안전망:
      (1) dream.js 전체 import 가 깨지면(전이 의존 누락/순환) FAIL.
      (2) 추출 후 services/dream-lotto.js 가 존재하면 dream.js 재노출과 결과 동일해야 함
          (권위 분리 방지). 추출 전에는 모듈이 없어 cross 단언은 자동 skip.

뮤테이션 정신:
  - LOTTO_FREQ/SYMBOL_NUMBERS 값 변경 → 풀 가중치/상징 매칭 어긋남 → FAIL
  - getEnergyWeights 임계/가산 변경 → 가중치 합 어긋남 → FAIL
  - dreamHash/seededRandom 산식 변경 → 시드/난수열 어긋남 → FAIL
  - ballRange 경계 변경 → 색상 클래스 어긋남 → FAIL
  - generateLottoNumbers 픽 알고리즘/분석문구 변경 → 번호열/문구 어긋남 → FAIL
  - 추출 시 dream.js 가 자체 사본 유지(권위 분리) → cross 검증 어긋남 → FAIL
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DREAM = ROOT / "src" / "tabs" / "dream.js"
LOTTO = ROOT / "src" / "services" / "dream-lotto.js"


# ── 공용 브라우저 쉼(SHIM) — dream.js 의 큰 전이 의존 그래프 대비 ──
# Date 를 2026-06-16 으로 고정: generateLottoNumbers 의 new Date() 시드를 결정론화.
_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.sessionStorage = { _s:new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)}, clear(){this._s.clear()} };
const _cap = {};
function capEl(id){
  return {
    id, style:{cssText:'',display:''},
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(){}, getAttribute(){return null}, addEventListener(){},
    appendChild(){}, prepend(){}, insertBefore(){}, remove(){},
    querySelector(){return null}, querySelectorAll(){return []},
    getContext(){ return { fillRect(){},clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},save(){},restore(){},translate(){},rotate(){},fillText(){},measureText(){return {width:0}} }; },
    get innerHTML(){ return _cap[id]||''; }, set innerHTML(v){ _cap[id]=v; },
    textContent:'', value:'', offsetWidth:0, parentElement:null, dataset:{}, scrollIntoView(){},
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
globalThis.window.history = { replaceState(){}, pushState(){}, back(){} };
globalThis.addEventListener=()=>{};
globalThis.removeEventListener=()=>{};
globalThis.requestAnimationFrame=()=>{};
globalThis.gtag=()=>{};
try{ Object.defineProperty(globalThis,'navigator',{configurable:true,value:{ userAgent:'node-test', language:'ko', clipboard:{writeText:()=>Promise.resolve()} }}); }catch(_){ }
globalThis.fetch=()=>Promise.reject(new Error('no-net-in-test'));

// Date 고정: 시드의 '오늘' 입력을 2026-06-16 으로 결정론화(로직 무변경).
const _RealDate = Date;
const _FIXED = _RealDate.parse('2026-06-16T09:00:00Z');
class _FrozenDate extends _RealDate {
  constructor(...a){ if(a.length===0){ super(_FIXED); } else { super(...a); } }
  static now(){ return _FIXED; }
}
globalThis.Date = _FrozenDate;
"""

_RUNTIME = _SHIM + r"""
import fs from 'node:fs';
const dream = await import(DREAM_URI);
const out = {};

// ── (A) dream.js 공개 표면에 로또 함수들이 재노출되어 있다 ──
out.has = {
  generateLottoNumbers: typeof dream.generateLottoNumbers === 'function',
  ballRange: typeof dream.ballRange === 'function',
  dreamHash: typeof dream.dreamHash === 'function',
  seededRandom: typeof dream.seededRandom === 'function',
  weightedPick: typeof dream.weightedPick === 'function',
  getEnergyWeights: typeof dream.getEnergyWeights === 'function',
  LOTTO_FREQ: typeof dream.LOTTO_FREQ === 'object',
  SYMBOL_NUMBERS: typeof dream.SYMBOL_NUMBERS === 'object',
};

// ── (B) 결정론 동작 실측 박제 ──
out.ballRange = [1,5,10,11,20,21,30,31,40,41,45].map(dream.ballRange);
out.dreamHash = { empty: dream.dreamHash(''), abc: dream.dreamHash('abc'), kor: dream.dreamHash('꿈 해몽') };
const rng1 = dream.seededRandom(12345);
out.rngSeq = [rng1(), rng1(), rng1()].map(x=>x.toFixed(12));
out.energy = {
  all0: dream.getEnergyWeights({재물운:0,연애운:0,직관:0,활력:0,건강운:0,길흉:50}).slice(1).filter(x=>x!==1).length,
  rich34: dream.getEnergyWeights({재물운:80,연애운:0,직관:0,활력:0,건강운:0,길흉:50})[34],
};

const cases=[
  {stats:{재물운:80,연애운:50,직관:60,활력:40,건강운:30,길흉:85},inp:'뱀이 물에서 나오는 꿈을 꿨어요'},
  {stats:{재물운:30,연애운:75,직관:90,활력:80,건강운:72,길흉:35},inp:'돈과 돼지가 나왔어요'},
  {stats:{재물운:10,연애운:10,직관:10,활력:10,건강운:10,길흉:50},inp:'아무 상징 없는 평범한 꿈'},
  {stats:{재물운:100,연애운:100,직관:100,활력:100,건강운:100,길흉:100},inp:'사랑 죽음 거미 학교'},
];
out.cases = cases.map(c => dream.generateLottoNumbers(c.stats, c.inp));

// ── (C) 추출 안전망: services/dream-lotto.js 가 있으면 dream.js 재노출과 결과 동일 ──
out.lotto_module_exists = fs.existsSync(LOTTO_PATH);
if(out.lotto_module_exists){
  const lotto = await import(LOTTO_URI);
  out.lotto_exports = Object.keys(lotto).sort();
  out.lotto_matches_dream = cases.every(c =>
    JSON.stringify(lotto.generateLottoNumbers(c.stats, c.inp)) ===
    JSON.stringify(dream.generateLottoNumbers(c.stats, c.inp))
  ) && [1,10,11,45].every(n => lotto.ballRange(n) === dream.ballRange(n));
}

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 로또 런타임 핀 skip")
    script = (
        _RUNTIME
        .replace("DREAM_URI", json.dumps(DREAM.resolve().as_uri()))
        .replace("LOTTO_URI", json.dumps(LOTTO.resolve().as_uri()))
        .replace("LOTTO_PATH", json.dumps(str(LOTTO.resolve())))
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
def test_dream_reexports_lotto_surface(rt):
    """dream.js 가 로또 함수/테이블을 재노출한다(추출 후에도 표면 유지)."""
    has = rt["has"]
    for k in ("generateLottoNumbers", "ballRange", "dreamHash", "seededRandom",
              "weightedPick", "getEnergyWeights", "LOTTO_FREQ", "SYMBOL_NUMBERS"):
        assert has[k] is True, f"dream.js 에서 {k} 재노출이 사라짐(공개 표면 깨짐)"


# ── (B) 결정론 박제 ─────────────────────────────────────────────────────
def test_ballRange_boundaries(rt):
    """번호 색상 구간 경계: ≤10 r1, ≤20 r2, ≤30 r3, ≤40 r4, else r5."""
    assert rt["ballRange"] == [
        "range1", "range1", "range1", "range2", "range2",
        "range3", "range3", "range4", "range4", "range5", "range5",
    ], f"ballRange 경계 박제 어긋남: {rt['ballRange']}"


def test_dreamHash_exact(rt):
    """dreamHash 시드 산식 박제(빈/ascii/한글)."""
    assert rt["dreamHash"]["empty"] == 0
    assert rt["dreamHash"]["abc"] == 96354, f"dreamHash('abc') 박제 어긋남: {rt['dreamHash']['abc']}"
    assert rt["dreamHash"]["kor"] == 1342367521, f"dreamHash 한글 박제 어긋남: {rt['dreamHash']['kor']}"


def test_seededRandom_sequence(rt):
    """seededRandom LCG 난수열 박제(seed=12345 첫 3개)."""
    assert rt["rngSeq"] == ["0.096616528087", "0.833994627310", "0.947702497661"], \
        f"seededRandom 난수열 박제 어긋남: {rt['rngSeq']}"


def test_energy_weights(rt):
    """getEnergyWeights: 전부 낮으면 가중치 변화 0, 재물운≥70 이면 34번 +3=4."""
    assert rt["energy"]["all0"] == 0, "낮은 스탯에서 가중치가 변동됨(현재 동작 변경)"
    assert rt["energy"]["rich34"] == 4, f"재물운 가중치 박제 어긋남: {rt['energy']['rich34']}"


def test_generate_lotto_golden(rt):
    """generateLottoNumbers 6개 번호열 + 분석문구 + 매칭상징 골든 박제(Date 고정 2026-06-16)."""
    cs = rt["cases"]
    # case 0: 뱀/물 상징
    assert cs[0]["numbers"] == [7, 10, 27, 38, 43, 44], f"case0 번호열 어긋남: {cs[0]['numbers']}"
    assert cs[0]["foundSymbols"] == ["뱀", "물"]
    assert cs[0]["analysis"] == (
        '꿈 속 "뱀, 물" 상징에서 핵심 번호를 추출했어요. '
        '길흉(85점)이 가장 높아서 관련 번호에 가중치를 뒀어요. '
        '꿈 상징과 에너지를 반영한 재미용 번호예요 (당첨 보장 없음)'
    ), f"case0 분석문구 어긋남: {cs[0]['analysis']}"
    # case 1: 돈/돼지
    assert cs[1]["numbers"] == [1, 29, 31, 34, 37, 38], f"case1 번호열 어긋남: {cs[1]['numbers']}"
    assert cs[1]["foundSymbols"] == ["돈", "돼지"]
    # case 2: 상징 없음 → analysis 에 상징 프리픽스 없음
    assert cs[2]["numbers"] == [7, 17, 19, 32, 35, 38], f"case2 번호열 어긋남: {cs[2]['numbers']}"
    assert cs[2]["foundSymbols"] == []
    assert cs[2]["analysis"].startswith("길흉(50점)이 가장 높아서"), \
        f"case2 분석문구(상징없음) 어긋남: {cs[2]['analysis']}"
    # case 3: 다중 상징
    assert cs[3]["numbers"] == [13, 15, 18, 23, 40, 43], f"case3 번호열 어긋남: {cs[3]['numbers']}"
    assert cs[3]["foundSymbols"] == ["사랑", "죽음", "학교", "거미"]


def test_generate_always_six_unique_in_range(rt):
    """생성 번호는 항상 6개·중복없음·1~45 범위(불변식)."""
    for i, c in enumerate(rt["cases"]):
        nums = c["numbers"]
        assert len(nums) == 6, f"case{i} 번호 개수 != 6: {nums}"
        assert len(set(nums)) == 6, f"case{i} 번호 중복: {nums}"
        assert all(1 <= n <= 45 for n in nums), f"case{i} 번호 범위 이탈: {nums}"
        assert nums == sorted(nums), f"case{i} 번호 미정렬: {nums}"


# ── (C) 추출 안전망: 권위 분리 방지 ─────────────────────────────────────
def test_extracted_module_matches_dream_when_present(rt):
    """services/dream-lotto.js 가 존재하면 결과가 dream.js 재노출과 완전 동일해야 한다.

    추출 전에는 모듈이 없어 skip. 추출 후 dream.js 가 자체 사본을 유지하면(권위 분리)
    cross 검증이 깨져 FAIL → 안전망.
    """
    if not rt.get("lotto_module_exists"):
        pytest.skip("services/dream-lotto.js 미존재 — 추출 전(이 단언은 추출 후 활성)")
    exp = rt.get("lotto_exports", [])
    for k in ("generateLottoNumbers", "ballRange", "dreamHash", "seededRandom",
              "weightedPick", "getEnergyWeights", "LOTTO_FREQ", "SYMBOL_NUMBERS"):
        assert k in exp, f"dream-lotto.js 가 {k} 를 export 안 함: {exp}"
    assert rt.get("lotto_matches_dream") is True, \
        "추출 모듈이 dream.js 와 다른 값을 냄(권위 분리/로직 변경)"
