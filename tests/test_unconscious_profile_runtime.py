"""
MONGGEUL — BEHAVIOR: 무의식 상세 프로파일 생성기 (services/unconscious-profile.js) Node 런타임 핀

배경(SOLD_NOT_DELIVERED 수리, 2026-06-24):
  무의식 프로파일(₩2,900) 결제는 entitlement 만 부여하고 화면에는 누구나 보는 무료 3축
  미니렌더(욕구/불안/성장)만 떴다 = "팔지만 안 줌". paywall.js 가 약속한 4가지를 실제
  사용자 꿈 데이터로 산출하는 정본 = services/unconscious-profile.js.

이 테스트가 보장하는 것(약속 vs 실배달 1:1):
  ① 5축 심층분석(욕구/불안/성장/관계/자아) — computeAxes 가 5축 모두 산출.
  ② 누적 데이터 기반 성격 프로파일 — deriveArchetype 이 데이터(1·2위 축)로 결정(난수 아님).
  ③ "혹시 평소에 ~한 편 아닌가요?" 인사이트 — deriveInsights 가 1위 축 기반 인사이트 생성.
  ④ 시간에 따른 무의식 변화 추적 — deriveTrend 가 전반/후반 비교 delta 산출.

성격(behavior pin):
  - 소스 텍스트 스캔이 아니라 실제 함수를 Node 로 구동해 *행위*를 본다.
  - 난수 금지 검증: 같은 입력 → 같은 출력(결정성)을 핀.

뮤테이션 정신:
  - 5축 중 하나(관계/자아)를 빼면 axes 길이 단언 FAIL.
  - 아키타입을 난수/고정값으로 바꾸면 결정성/데이터의존 단언 FAIL.
  - 인사이트를 빈 배열로 만들면 "혹시 ~편 아닌가요?" 단언 FAIL.
  - trend 를 전반/후반 비교 아닌 더미로 바꾸면 delta 방향 단언 FAIL.
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "services" / "unconscious-profile.js"


_RUNTIME = r"""
const m = await import(SRC_URI);
const out = {};
out.exports = Object.keys(m).sort();

// 욕구 강한 로그(돈/성공/집/차)
const desireLogs = [
  { text: '돈이 가득한 집과 차 성공 승진 재물', title: '재물', badges: ['재물운'], ts: 1000 },
  { text: '부자가 되어 보석과 금을 받았다', title: '부자', ts: 2000 },
  { text: '선물을 받고 승진했다', title: '선물', ts: 3000 },
];
// 불안 강한 로그(추락/쫓김/시험/귀신)
const anxietyLogs = [
  { text: '추락하고 쫓기는 꿈 무서웠다', title: '추락', badges: ['흉몽'], ts: 1000 },
  { text: '시험에 늦어 도망쳤다 공포', title: '시험', ts: 2000 },
  { text: '귀신과 어둠 속에서 잃어버렸다', title: '귀신', ts: 3000 },
];
// 관계 강한 로그(친구/가족/연인)
const relationLogs = [
  { text: '친구와 가족과 함께 대화했다', title: '가족', ts: 1000 },
  { text: '연인과 결혼하는 꿈 엄마 아빠', title: '결혼', ts: 2000 },
  { text: '동료와 사람들과 함께 있었다', title: '동료', ts: 3000 },
];
// 자아 강한 로그(거울/나/얼굴/선택)
const selfLogs = [
  { text: '거울에 비친 내 얼굴 나는 누구', title: '거울', ts: 1000 },
  { text: '혼자 길에서 선택을 했다 문 앞', title: '길', ts: 2000 },
  { text: '변신하는 내 몸을 봤다 이름', title: '변신', ts: 3000 },
];
// 시간변화: 전반부 불안 → 후반부 욕구 (6개, ts 오름차순)
const trendLogs = [
  { text: '추락하고 쫓기는 무서운 꿈 공포', title: 'a', ts: 1000 },
  { text: '시험에 늦어 도망쳤다 귀신', title: 'b', ts: 2000 },
  { text: '어둠 속에서 잃어버렸다 죽음', title: 'c', ts: 3000 },
  { text: '돈과 집과 차 성공 재물', title: 'd', ts: 4000 },
  { text: '부자가 되어 보석 금 선물', title: 'e', ts: 5000 },
  { text: '승진하고 성공했다 재물', title: 'f', ts: 6000 },
];

// ── 5축 산출 ──
out.desireAxes = m.computeAxes(desireLogs);
out.anxietyAxes = m.computeAxes(anxietyLogs);
out.relationAxes = m.computeAxes(relationLogs);
out.selfAxes = m.computeAxes(selfLogs);
out.axisOrder = m.AXIS_ORDER;

// ── 전체 프로파일 ──
const desireProfile = m.buildUnconsciousProfile(desireLogs);
out.profileAxisCount = desireProfile.axes.length;
out.profileAxisNames = desireProfile.axes.map(a => a.name);
out.desireArchetype = desireProfile.archetype.title;
out.desireArchetypeAxis = desireProfile.archetype.axis;
out.desireInsights = desireProfile.insights;
out.desireDreamCount = desireProfile.dreamCount;

const anxietyProfile = m.buildUnconsciousProfile(anxietyLogs);
out.anxietyArchetypeAxis = anxietyProfile.archetype.axis;
out.relationArchetypeAxis = m.buildUnconsciousProfile(relationLogs).archetype.axis;
out.selfArchetypeAxis = m.buildUnconsciousProfile(selfLogs).archetype.axis;

// ── 결정성(난수 금지): 같은 입력 두 번 → 동일 ──
const p1 = m.buildUnconsciousProfile(desireLogs);
const p2 = m.buildUnconsciousProfile(desireLogs);
out.deterministic = JSON.stringify(p1) === JSON.stringify(p2);

// ── 시간변화 추적 ──
const trend = m.deriveTrend(trendLogs);
out.trendAvailable = trend.available;
out.trendDeltas = trend.deltas.map(d => ({ axis: d.axis, before: d.before, after: d.after, delta: d.delta }));
out.trendNarrative = trend.narrative;

// trend 데이터 부족(3개) → 불가
out.trendTooFew = m.deriveTrend(desireLogs).available;

// ── 빈 입력 방어 ──
const empty = m.buildUnconsciousProfile([]);
out.emptyAxisCount = empty.axes.length;
out.emptyArchetypeTitle = empty.archetype.title;
out.emptyTrendAvailable = empty.trend.available;
out.emptyDreamCount = empty.dreamCount;

// noDream 필터링
out.noDreamFiltered = m.buildUnconsciousProfile([
  { noDream: true, text: '돈 부자 성공' },
  { text: '추락 무서워 공포', ts: 1 },
]).dreamCount;

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 무의식 프로파일 런타임 핀 skip")
    script = _RUNTIME.replace("SRC_URI", json.dumps(SRC.resolve().as_uri()))
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


# ── 공개 표면 ──────────────────────────────────────────────────────────
def test_exports_intact(rt):
    """생성기 핵심 함수가 모두 export 된다(렌더가 의존)."""
    for fn in ["buildUnconsciousProfile", "computeAxes", "deriveArchetype", "deriveInsights", "deriveTrend"]:
        assert fn in rt["exports"], f"필수 export 누락: {fn} (실제={rt['exports']})"


# ── ① 5축 심층분석 (paywall 약속: 욕구/불안/성장/관계/자아) ──────────────
def test_five_axes_present(rt):
    """프로파일이 정확히 5축을 산출한다 — paywall '무의식 5축 심층 분석' 약속과 1:1."""
    assert rt["profileAxisCount"] == 5, f"축이 5개가 아님: {rt['profileAxisCount']}"
    assert rt["axisOrder"] == ["desire", "anxiety", "growth", "relation", "self"], \
        f"축 구성 변경: {rt['axisOrder']}"
    assert rt["profileAxisNames"] == ["욕구", "불안", "성장", "관계", "자아"], \
        f"축 이름(약속 카피)과 불일치: {rt['profileAxisNames']}"


def test_axes_data_driven(rt):
    """각 축은 실제 키워드 데이터에 반응한다(욕구 로그→욕구 최고, 불안 로그→불안 최고)."""
    da = rt["desireAxes"]
    assert da["desire"] >= max(da["anxiety"], da["growth"], da["relation"], da["self"]), \
        f"욕구 로그인데 욕구가 최고 아님: {da}"
    aa = rt["anxietyAxes"]
    assert aa["anxiety"] >= max(aa["desire"], aa["growth"], aa["relation"], aa["self"]), \
        f"불안 로그인데 불안이 최고 아님: {aa}"
    # 유료 전용 2축(관계/자아)이 실제로 작동
    assert rt["relationAxes"]["relation"] > 0, "관계 축이 관계 키워드에 반응 안 함(유료축 死)"
    assert rt["selfAxes"]["self"] > 0, "자아 축이 자아 키워드에 반응 안 함(유료축 死)"


# ── ② 누적 데이터 기반 성격 프로파일 (난수 아님) ─────────────────────────
def test_archetype_data_driven(rt):
    """아키타입은 1위 축으로 결정된다 — 입력이 다르면 결과가 다르다(데이터 의존)."""
    assert rt["desireArchetypeAxis"] == "desire", f"욕구 우세인데 아키타입 축이 desire 아님: {rt['desireArchetypeAxis']}"
    assert rt["anxietyArchetypeAxis"] == "anxiety", f"불안 우세 아키타입 축 불일치: {rt['anxietyArchetypeAxis']}"
    assert rt["relationArchetypeAxis"] == "relation", f"관계 우세 아키타입 축 불일치: {rt['relationArchetypeAxis']}"
    assert rt["selfArchetypeAxis"] == "self", f"자아 우세 아키타입 축 불일치: {rt['selfArchetypeAxis']}"
    # 4개 입력이 4개 다른 축을 낸다 = 고정값/난수 아님
    axes = {rt["desireArchetypeAxis"], rt["anxietyArchetypeAxis"], rt["relationArchetypeAxis"], rt["selfArchetypeAxis"]}
    assert len(axes) == 4, f"아키타입이 입력에 따라 안 변함(고정/난수 의심): {axes}"


def test_deterministic_no_randomness(rt):
    """같은 입력 → 항상 같은 출력. Math.random 같은 난수가 섞이면 FAIL(가짜 방지)."""
    assert rt["deterministic"] is True, "같은 입력에 다른 출력 — 난수 혼입(FAKE_FEATURE 회귀)"


# ── ③ 인사이트 ("혹시 평소에 ~한 편 아닌가요?") ──────────────────────────
def test_insights_generated(rt):
    """1위 축 기반 인사이트가 생성되고, paywall 약속 문구 패턴('혹시 ~ 아닌가요')을 따른다."""
    ins = rt["desireInsights"]
    assert isinstance(ins, list) and len(ins) >= 1, f"인사이트 미생성: {ins}"
    assert any("혹시" in s and "아닌가요" in s for s in ins), \
        f"'혹시 평소에 ~한 편 아닌가요' 인사이트 패턴 누락: {ins}"


# ── ④ 시간에 따른 무의식 변화 추적 ───────────────────────────────────────
def test_trend_tracks_change_over_time(rt):
    """전반부(불안) → 후반부(욕구) 흐름을 delta 로 잡아낸다."""
    assert rt["trendAvailable"] is True, "꿈 6개인데 변화추적 불가(임계값 어긋남)"
    deltas = {d["axis"]: d for d in rt["trendDeltas"]}
    # 전반부=불안 로그, 후반부=욕구 로그 → 불안은 감소(delta<0), 욕구는 증가(delta>0)
    assert deltas["anxiety"]["delta"] < 0, f"전반 불안→후반 욕구인데 불안이 안 줄어듦: {deltas['anxiety']}"
    assert deltas["desire"]["delta"] > 0, f"전반 불안→후반 욕구인데 욕구가 안 늘어남: {deltas['desire']}"
    assert isinstance(rt["trendNarrative"], str) and len(rt["trendNarrative"]) > 0, "변화 내러티브 누락"


def test_trend_needs_min_dreams(rt):
    """변화추적은 최소 4개 필요 — 3개면 불가(데이터 부족 정직 표시)."""
    assert rt["trendTooFew"] is False, "꿈 3개인데 변화추적이 떴다(억지 변화 = 가짜)"


# ── 방어/엣지 ────────────────────────────────────────────────────────────
def test_empty_input_safe(rt):
    """꿈 0개여도 5축 구조 유지 + 크래시 없음 + 변화추적은 정직하게 불가."""
    assert rt["emptyAxisCount"] == 5, "빈 입력에서 5축 구조 깨짐"
    assert rt["emptyDreamCount"] == 0
    assert rt["emptyTrendAvailable"] is False, "꿈 0개인데 변화추적 가능 표시(거짓)"
    assert isinstance(rt["emptyArchetypeTitle"], str) and len(rt["emptyArchetypeTitle"]) > 0


def test_nodream_logs_filtered(rt):
    """noDream(꿈 안 꾼 날) 로그는 분석에서 제외된다(미니렌더와 동일 규칙)."""
    assert rt["noDreamFiltered"] == 1, f"noDream 필터링 실패: {rt['noDreamFiltered']}"
