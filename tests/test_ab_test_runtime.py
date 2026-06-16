"""
MONGGEUL — CHARACTERIZATION: A/B 실험 variant 배정 Node 런타임 핀

목적(이 wave = 커버리지/무결성, 로직 변경 금지):
  src/services/ab-test.js 는 zero-coverage 머니/게이트 로직이다.
  paywall CTA 문구 / 프리미엄 paywall 레이아웃 / 프로모 톤 — 어떤 variant 를 보여줄지
  *결정적으로* 배정한다(userId 해시 → bucket → 누적 가중치). 이 배정이 조용히 깨지면
  (예: 해시 산식 바뀜 → 전원 A, 또는 누적 가중치 비교 어긋남) 전환 실험 전체가 무력화되는데
  지금까지 행위 테스트가 없어 '거짓완료 은신처'였다.

  이 wave 는 *현재 동작 그대로* Node 런타임으로 박제한다(추출/리팩터 아님 — 이미 별도 모듈).
  해시/버킷/누적가중치/캐시-끈끈함/익명ID 폴백/미지정실험 폴백이 한 톨이라도 바뀌면 FAIL.

성격(characterization):
  - 단언은 *현재 코드가 실제로 내는 값*만 고정한다(golden 은 본 모듈 probe 로 실측: 2026-06-16).
  - 소스 문자열 스캔이 아니라 실제 export 함수를 fake localStorage/store 로 구동해 행위를 본다.
  - DOM/Date/네트워크 무의존(getVariant 는 localStorage + store.currentUser 만 읽음).

뮤테이션 정신:
  - hash() FNV 상수/시프트 변경 → bucket 어긋남 → 고정 userId variant 어긋남 → FAIL
  - bucket = h % 100 / 누적 가중치 비교(<) 변경 → 배정 어긋남 → FAIL
  - 캐시 키/끈끈함(첫 배정이 세션 내 고정) 제거 → cacheSticky 어긋남 → FAIL
  - 미지정 실험 폴백('A') 변경 → unknown 어긋남 → FAIL
  - 익명 ID(mg_ab_anon_id) 폴백 규약 변경 → anon 어긋남 → FAIL
  - 1000 합성 uid 분포(A=503,B=497)는 해시 균형의 강한 핀 — 산식 1bit 만 틀어도 깨짐.
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
AB = ROOT / "src" / "services" / "ab-test.js"
STORE = ROOT / "src" / "store.js"


# ── 최소 SHIM: ab-test.js → store.js(localStorage) + analytics.js(store, gtag) ──
_SHIM = r"""
const _ls = new Map();
globalThis.localStorage = { getItem:k=>_ls.has(k)?_ls.get(k):null, setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.window = globalThis;
globalThis.gtag = ()=>{};
"""

_RUNTIME = _SHIM + r"""
const ab = await import(AB_URI);
const store = (await import(STORE_URI)).store;
const out = {};

function variantFor(uid, expId){
  _ls.clear();
  store.currentUser = { id: uid };
  return ab.getVariant(expId);
}

// (A) 고정 userId → 결정적 variant 배정 (해시·버킷·누적가중치 핀)
out.fixed = {
  'u1:paywall_cta_v1': variantFor('user-001', 'paywall_cta_v1'),
  'u1:premium_layout_v1': variantFor('user-001', 'premium_layout_v1'),
  'u1:promo_tone_v1': variantFor('user-001', 'promo_tone_v1'),
  'u2:paywall_cta_v1': variantFor('user-002', 'paywall_cta_v1'),
  'u3:paywall_cta_v1': variantFor('user-003', 'paywall_cta_v1'),
  'alice:paywall_cta_v1': variantFor('alice', 'paywall_cta_v1'),
  'bob:paywall_cta_v1': variantFor('bob', 'paywall_cta_v1'),
};

// (B) 미지정 실험 → 'A' 폴백
_ls.clear(); store.currentUser={id:'x'};
out.unknown = ab.getVariant('does_not_exist');

// (C) 캐시 끈끈함: 첫 배정이 세션(localStorage) 내 고정 — userId 가 바뀌어도 유지
_ls.clear();
store.currentUser = {id:'sticky-user'};
const first = ab.getVariant('paywall_cta_v1');
store.currentUser = {id:'totally-different'};
const second = ab.getVariant('paywall_cta_v1');
out.cacheSticky = { equal: first===second, first, second };

// (D) 유효 캐시 존중 / 무효 캐시 무시(재계산)
_ls.clear(); store.currentUser={id:'z'};
localStorage.setItem('mg_ab_paywall_cta_v1','B');
out.cachedRespected = ab.getVariant('paywall_cta_v1');     // 'B'
_ls.clear(); store.currentUser={id:'z'};
localStorage.setItem('mg_ab_paywall_cta_v1','ZZZ');
out.invalidCacheIgnored = ab.getVariant('paywall_cta_v1'); // 재계산(z → 'B')

// (E) getActiveExperiments: 전 실험 variant 맵 (고정 userId 핀)
_ls.clear(); store.currentUser={id:'audit-user-42'};
out.active42 = ab.getActiveExperiments();
out.active42_recheck = { paywall: ab.getVariant('paywall_cta_v1'), promo: ab.getVariant('promo_tone_v1') };
out.activeKeys = Object.keys(out.active42).sort();

// (F) listExperiments: 레지스트리 구조(이름/variants/weights) 박제
_ls.clear(); store.currentUser={id:'list-user'};
out.list = ab.listExperiments().map(e=>({id:e.id, name:e.name, variants:e.variants, weights:e.weights}));

// (G) 익명 ID 폴백: 비로그인 → mg_ab_anon_id 생성 + 안정(같은 ls 내 동일)
_ls.clear(); store.currentUser=null;
const va = ab.getVariant('paywall_cta_v1'); const anon1 = localStorage.getItem('mg_ab_anon_id');
const vb = ab.getVariant('premium_layout_v1'); const anon2 = localStorage.getItem('mg_ab_anon_id');
out.anon = { hasAnon: !!anon1, anonPrefix: anon1 ? anon1.slice(0,5) : null, stable: anon1===anon2 };

// (H) 1000 합성 uid 분포 — 해시 균형 강한 핀(산식 1bit 변경 시 깨짐)
let cntA=0, cntB=0;
for(let i=0;i<1000;i++){ const v=variantFor('uid-'+i,'paywall_cta_v1'); if(v==='A')cntA++; else cntB++; }
out.dist1000 = { A: cntA, B: cntB };

// (I) 추적 호출(trackExposure/trackConversion)은 supabase null 경로에서 throw 안 함
_ls.clear(); store.currentUser={id:'t'}; store.supabase=null;
let trackOk=true;
try{ ab.trackExposure('paywall_cta_v1'); ab.trackExposure('paywall_cta_v1'); ab.trackConversion('paywall_cta_v1',{amount:3900}); }
catch(_){ trackOk=false; }
out.trackOk = trackOk;

// (J) window._abTest 디버그 표면 노출
out.windowExposed = typeof window._abTest === 'object' && typeof window._abTest.getVariant === 'function';

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — A/B variant 런타임 핀 skip")
    script = (
        _RUNTIME
        .replace("AB_URI", json.dumps(AB.resolve().as_uri()))
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


# ── (A) 결정적 variant 배정 ────────────────────────────────────────────
def test_fixed_userid_variant_assignment(rt):
    """고정 userId → 결정적 variant(해시·버킷·누적가중치 산식 핀).
    이 값이 바뀌면 실험 배정이 달라진 것 = 전환 실험 데이터 단절."""
    f = rt["fixed"]
    assert f["u1:paywall_cta_v1"] == "B", f"user-001 cta 배정 변경: {f['u1:paywall_cta_v1']}"
    assert f["u1:premium_layout_v1"] == "B", f"user-001 layout 배정 변경: {f['u1:premium_layout_v1']}"
    assert f["u1:promo_tone_v1"] == "A", f"user-001 promo 배정 변경: {f['u1:promo_tone_v1']}"
    assert f["u2:paywall_cta_v1"] == "B", f"user-002 cta 배정 변경: {f['u2:paywall_cta_v1']}"
    assert f["u3:paywall_cta_v1"] == "B", f"user-003 cta 배정 변경: {f['u3:paywall_cta_v1']}"
    assert f["alice:paywall_cta_v1"] == "A", f"alice cta 배정 변경: {f['alice:paywall_cta_v1']}"
    assert f["bob:paywall_cta_v1"] == "B", f"bob cta 배정 변경: {f['bob:paywall_cta_v1']}"


# ── (B) 미지정 실험 폴백 ───────────────────────────────────────────────
def test_unknown_experiment_falls_back_to_A(rt):
    assert rt["unknown"] == "A", f"미지정 실험 폴백이 'A' 가 아님: {rt['unknown']}"


# ── (C) 캐시 끈끈함 ────────────────────────────────────────────────────
def test_variant_is_sticky_within_session(rt):
    """첫 배정이 localStorage 캐시로 세션 내 고정 — userId 가 바뀌어도 유지(현재 동작)."""
    cs = rt["cacheSticky"]
    assert cs["equal"] is True, f"캐시 끈끈함 깨짐: first={cs['first']} second={cs['second']}"


# ── (D) 캐시 유효성 게이트 ─────────────────────────────────────────────
def test_cached_value_respected_and_invalid_ignored(rt):
    assert rt["cachedRespected"] == "B", f"유효 캐시 'B' 미존중: {rt['cachedRespected']}"
    assert rt["invalidCacheIgnored"] == "B", \
        f"무효 캐시('ZZZ') 무시 후 재계산 변경: {rt['invalidCacheIgnored']}"


# ── (E) getActiveExperiments ───────────────────────────────────────────
def test_active_experiments_map(rt):
    """getActiveExperiments = 전 실험 variant 맵(고정 userId 핀)."""
    assert rt["activeKeys"] == ["paywall_cta_v1", "premium_layout_v1", "promo_tone_v1"], \
        f"활성 실험 키 집합 변경: {rt['activeKeys']}"
    a = rt["active42"]
    assert a == {
        "paywall_cta_v1": "A",
        "premium_layout_v1": "A",
        "promo_tone_v1": "B",
    }, f"audit-user-42 활성 실험 맵 변경: {a}"
    # getActiveExperiments 가 캐시를 써서 이후 getVariant 가 동일 값
    assert rt["active42_recheck"] == {"paywall": "A", "promo": "B"}, \
        f"getActiveExperiments 후 getVariant 불일치(캐시 미기록): {rt['active42_recheck']}"


# ── (F) 실험 레지스트리 구조 ───────────────────────────────────────────
def test_experiment_registry_shape(rt):
    """레지스트리(이름/variants/weights) 박제 — 실험 추가/삭제/가중치 변경 감지."""
    assert rt["list"] == [
        {"id": "paywall_cta_v1", "name": "Paywall CTA 문구",
         "variants": ["A", "B"], "weights": [50, 50]},
        {"id": "premium_layout_v1", "name": "프리미엄 paywall 레이아웃",
         "variants": ["A", "B"], "weights": [50, 50]},
        {"id": "promo_tone_v1", "name": "프로모 문구 톤",
         "variants": ["A", "B"], "weights": [50, 50]},
    ], f"실험 레지스트리 구조 변경: {rt['list']}"


# ── (G) 익명 ID 폴백 ───────────────────────────────────────────────────
def test_anonymous_id_fallback(rt):
    """비로그인 → mg_ab_anon_id 생성, anon_ 접두, 같은 ls 내 안정(재생성 안 함)."""
    a = rt["anon"]
    assert a["hasAnon"] is True, "비로그인 시 mg_ab_anon_id 가 생성되지 않음"
    assert a["anonPrefix"] == "anon_", f"익명 ID 접두 규약 변경: {a['anonPrefix']}"
    assert a["stable"] is True, "익명 ID 가 호출마다 재생성됨(불안정)"


# ── (H) 해시 균형 분포 ─────────────────────────────────────────────────
def test_hash_distribution_is_balanced_and_deterministic(rt):
    """1000 합성 uid → A=503,B=497 (현재 해시 산식의 결정적 분포).
    이 정확한 수치는 hash()/bucket/누적가중치 산식의 강한 핀(1bit 변경도 깨짐).
    합계는 항상 1000(전원 배정), variant 누락 없음."""
    d = rt["dist1000"]
    assert d["A"] + d["B"] == 1000, f"전원 배정 안 됨(누락 존재): {d}"
    assert d == {"A": 503, "B": 497}, f"해시 분포 변경(산식 어긋남): {d}"


# ── (I) 추적 안전성 ────────────────────────────────────────────────────
def test_track_calls_do_not_throw(rt):
    """trackExposure/trackConversion 는 supabase null(데모/로컬) 경로에서 throw 하지 않음."""
    assert rt["trackOk"] is True, "추적 호출이 supabase null 경로에서 throw 함"


# ── (J) 디버그 표면 ────────────────────────────────────────────────────
def test_window_abtest_surface_exposed(rt):
    assert rt["windowExposed"] is True, "window._abTest 디버그 표면이 사라짐"
