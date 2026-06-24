// 몽글몽글 — 무의식 상세 프로파일 생성기 (₩2,900 유료 산출물 정본)
//
// 배경(SOLD_NOT_DELIVERED 수리, 2026-06-24):
//   무의식 프로파일(₩2,900) 결제는 entitlement 만 부여하고, 화면에는 누구나 보는 무료
//   3축 미니렌더(욕구/불안/성장)만 떠 "팔지만 안 줌" 상태였다. paywall.js 가 약속한
//   ① 5축 심층분석(욕구/불안/성장/관계/자아) ② 누적 데이터 기반 성격 프로파일
//   ③ "혹시 평소에 ~한 편 아닌가요?" 인사이트 ④ 시간에 따른 무의식 변화 추적
//   — 이 4가지를 *실제로 사용자 꿈 데이터로* 산출하는 코드가 이 파일이다.
//
// 설계 원칙:
//   - 난수/템플릿 금지. 입력 = 사용자의 실제 꿈 로그(텍스트/제목/뱃지/타임스탬프).
//   - 순수 함수(DOM 의존 0) → Node 런타임 행위 테스트 가능.
//   - 무료 미니(my.js renderUnconsciousProfile)의 3축 계산과 *일관*된 축 산식을 쓰되
//     관계/자아 2축을 추가하고, 성격 아키타입·인사이트·시간변화를 더한다.

// ── 축 키워드 사전 (무료 미니 3축 + 유료 전용 2축) ──
// 무료 미니(my.js)와 동일 산식을 공유해야 "결제 전후 숫자 모순"이 없다.
export const AXIS_KEYWORDS = {
  desire:   ['돈', '부자', '집', '차', '성공', '승진', '선물', '보석', '금', '재물'],
  anxiety:  ['추락', '쫓기', '죽', '도망', '놓치', '늦', '시험', '잃어', '무서', '공포', '귀신', '어둠'],
  growth:   ['하늘', '날', '빛', '새', '꽃', '아기', '태양', '별', '산', '오르', '성장', '배우'],
  // 유료 전용 2축 (관계/자아)
  relation: ['친구', '가족', '엄마', '아빠', '부모', '연인', '애인', '결혼', '사람', '함께', '대화', '전애인', '동료'],
  self:     ['거울', '나', '내가', '얼굴', '몸', '벌거', '변신', '이름', '혼자', '선택', '길', '문'],
};

// 뱃지 → 축 가중 (무료 미니와 동일 규칙 + 관계/자아 확장)
const BADGE_AXIS = {
  '재물운': 'desire',
  '연애운': 'relation',  // 무료 미니는 연애운을 desire 에 넣었으나, 5축에서는 관계축으로 더 정확히 귀속
  '흉몽':   'anxiety',
  '길몽':   'growth',
  '태몽':   'growth',
};

const AXIS_META = {
  desire:   { name: '욕구', emoji: '✨', color: '#f8c94c' },
  anxiety:  { name: '불안', emoji: '🌊', color: '#e74c6f' },
  growth:   { name: '성장', emoji: '🌱', color: '#5bbfba' },
  relation: { name: '관계', emoji: '💕', color: '#f0a8c8' },
  self:     { name: '자아', emoji: '🪞', color: '#a67cef' },
};
export const AXIS_ORDER = ['desire', 'anxiety', 'growth', 'relation', 'self'];

// ── 한 묶음의 로그 → 5축 점수(0~100) ──
// 미니렌더 산식과 동일: count / (n*0.5 + 3) * 100, 상한 100. (결제 전후 욕구/불안/성장 동일)
export function computeAxes(logs) {
  const real = (logs || []).filter(l => l && !l.noDream);
  const n = real.length;
  const texts = real.map(l => (l.text || '') + ' ' + (l.title || '')).join(' ');
  const badges = real.flatMap(l => l.badges || []);

  const scores = {};
  for (const axis of AXIS_ORDER) {
    const kwHits = AXIS_KEYWORDS[axis].filter(w => texts.includes(w)).length;
    const badgeHits = badges.filter(b => BADGE_AXIS[b] === axis).length;
    const raw = kwHits + badgeHits;
    scores[axis] = Math.min(100, Math.round((raw / (n * 0.5 + 3)) * 100));
  }
  return scores;
}

// ── 성격 아키타입 (누적 데이터 기반 성격 프로파일) ──
// 5축 중 1·2위 조합으로 결정 — 난수 아님, 데이터 기반.
const ARCHETYPES = {
  desire:   { title: '열망의 추구자',   emoji: '🔥', trait: '목표 지향적이고 야망이 강한' },
  anxiety:  { title: '내면의 경계자',   emoji: '🌙', trait: '예민하고 신중하며 위험을 미리 감지하는' },
  growth:   { title: '확장하는 개척자', emoji: '🌟', trait: '변화를 두려워하지 않고 성장에 열려 있는' },
  relation: { title: '연결의 조율자',   emoji: '🤝', trait: '관계 속에서 의미를 찾고 타인에 민감한' },
  self:     { title: '성찰하는 탐구자', emoji: '🧭', trait: '자기 이해와 정체성 탐구에 깊이 몰입하는' },
};

export function deriveArchetype(scores) {
  const ranked = AXIS_ORDER
    .map(a => ({ axis: a, value: scores[a] }))
    .sort((x, y) => y.value - x.value);
  const top = ranked[0];
  const second = ranked[1];
  const base = ARCHETYPES[top.axis];

  // 모든 축이 0 (꿈 데이터가 키워드를 거의 안 맞춤) → 균형형 기본값
  if (top.value === 0) {
    return {
      axis: top.axis,
      title: '잠재된 탐험가',
      emoji: '🌫️',
      summary: '아직 무의식의 윤곽이 선명하지 않아요. 꿈을 더 기록할수록 당신만의 지도가 또렷해져요.',
    };
  }

  const secondPart = (second.value > 0 && second.value >= top.value * 0.6)
    ? ` 동시에 ${AXIS_META[second.axis].name}의 결도 뚜렷해, ${ARCHETYPES[second.axis].trait} 면모가 함께 드러나요.`
    : '';

  return {
    axis: top.axis,
    title: base.title,
    emoji: base.emoji,
    summary: `당신의 무의식은 ${AXIS_META[top.axis].name}을(를) 중심으로 움직여요. ${base.trait} 사람의 결이 꿈 전반에 흐르고 있어요.${secondPart}`,
  };
}

// ── 인사이트 ("혹시 평소에 ~한 편 아닌가요?") ──
// 1위 축 기반 — 데이터 기반 추론, 공포 마케팅 톤 금지.
const AXIS_INSIGHT = {
  desire:   '혹시 요즘 이루고 싶은 목표나 갖고 싶은 것이 분명한 편 아닌가요? 무의식이 강한 열망을 비추고 있어요.',
  anxiety:  '혹시 평소에 걱정이 많고 미리 대비하려는 편 아닌가요? 꿈이 아직 풀리지 않은 긴장을 흘려보내고 있어요.',
  growth:   '혹시 요즘 새로운 시작이나 변화를 앞두고 있나요? 무의식이 성장의 신호를 또렷하게 보내고 있어요.',
  relation: '혹시 사람들과의 관계에 마음을 많이 쓰는 편 아닌가요? 꿈이 곁의 인연들을 자주 불러오고 있어요.',
  self:     '혹시 "나는 어떤 사람인가"를 자주 곱씹는 편 아닌가요? 무의식이 자기 정체성을 탐구하는 중이에요.',
};

export function deriveInsights(scores) {
  const ranked = AXIS_ORDER
    .map(a => ({ axis: a, value: scores[a] }))
    .sort((x, y) => y.value - x.value);
  const out = [];
  // 1위 축 인사이트 (값 0 이면 건너뜀)
  if (ranked[0].value > 0) out.push(AXIS_INSIGHT[ranked[0].axis]);
  // 가장 낮은(억눌린) 축이 0 이고 다른 축이 살아있으면 "보완" 인사이트
  const lowest = ranked[ranked.length - 1];
  if (lowest.value === 0 && ranked[0].value > 0) {
    out.push(`반면 ${AXIS_META[lowest.axis].name}의 흔적은 거의 보이지 않아요 — 무의식이 지금은 그쪽에 에너지를 덜 두고 있다는 신호예요.`);
  }
  if (out.length === 0) {
    out.push('아직 무의식의 결이 선명하지 않아요. 꿈을 더 기록할수록 인사이트가 또렷해져요.');
  }
  return out;
}

// ── 시간에 따른 무의식 변화 추적 ──
// 로그를 시간순 정렬 후 전반부 vs 후반부로 나눠 축별 변화량(delta)을 낸다.
// ts(타임스탬프)가 있으면 우선, 없으면 배열 순서(최신순 저장 가정 → 역순=시간순) 사용.
export function deriveTrend(logs) {
  const real = (logs || []).filter(l => l && !l.noDream);
  if (real.length < 4) {
    return { available: false, reason: 'need_more', message: '변화 추적은 꿈 4개 이상부터 보여드려요.' };
  }

  // 시간순 정렬(오래된 → 최신). ts 가 있으면 사용, 없으면 입력 역순(저장이 최신-우선이라 가정).
  const hasTs = real.every(l => l.ts != null || l.date != null);
  let chrono;
  if (hasTs) {
    chrono = [...real].sort((a, b) => _toTime(a) - _toTime(b));
  } else {
    chrono = [...real].reverse();
  }

  const mid = Math.floor(chrono.length / 2);
  const firstHalf = chrono.slice(0, mid);
  const secondHalf = chrono.slice(mid);

  const before = computeAxes(firstHalf);
  const after = computeAxes(secondHalf);

  const deltas = AXIS_ORDER.map(axis => ({
    axis,
    name: AXIS_META[axis].name,
    emoji: AXIS_META[axis].emoji,
    before: before[axis],
    after: after[axis],
    delta: after[axis] - before[axis],
  }));

  // 가장 크게 변한 축 → 내러티브
  const biggest = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  let narrative;
  if (Math.abs(biggest.delta) < 5) {
    narrative = '최근 무의식의 결은 비교적 안정적으로 유지되고 있어요.';
  } else if (biggest.delta > 0) {
    narrative = `최근으로 올수록 ${biggest.name}의 결이 뚜렷하게 짙어지고 있어요 (${biggest.before}% → ${biggest.after}%).`;
  } else {
    narrative = `최근으로 올수록 ${biggest.name}의 결이 옅어지고 있어요 (${biggest.before}% → ${biggest.after}%).`;
  }

  return { available: true, before, after, deltas, narrative };
}

function _toTime(l) {
  if (l.ts != null) {
    const t = typeof l.ts === 'number' ? l.ts : Date.parse(l.ts);
    return Number.isFinite(t) ? t : 0;
  }
  if (l.date != null) {
    const t = Date.parse(l.date);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

// ── 전체 산출물 조립 (화면이 이걸 받아 렌더) ──
export function buildUnconsciousProfile(logs) {
  const real = (logs || []).filter(l => l && !l.noDream);
  const scores = computeAxes(real);
  return {
    dreamCount: real.length,
    axes: AXIS_ORDER.map(axis => ({
      axis,
      name: AXIS_META[axis].name,
      emoji: AXIS_META[axis].emoji,
      color: AXIS_META[axis].color,
      value: scores[axis],
    })),
    scores,
    archetype: deriveArchetype(scores),
    insights: deriveInsights(scores),
    trend: deriveTrend(real),
  };
}

// 메타 노출(렌더가 색/이름 참조)
export { AXIS_META };
