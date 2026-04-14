// 몽글몽글 — 퍼널 12단계 추적 유틸리티
import { logEvent } from '../services/analytics.js';

// ═══════════════════════════════════════
// 퍼널 12단계 정의
// ═══════════════════════════════════════

export const FUNNEL_STEPS = [
  { id: 'app_open',               label: '앱 진입',             order: 1 },
  { id: 'tab_dream',              label: '해몽 탭 진입',        order: 2 },
  { id: 'dream_input_start',      label: '꿈 입력 시작',        order: 3 },
  { id: 'dream_input_complete',   label: '꿈 입력 완료',        order: 4 },
  { id: 'interpretation_loading', label: '해몽 AI 대기',        order: 5 },
  { id: 'interpretation_viewed',  label: '해몽 결과 확인',      order: 6 },
  { id: 'detail_cta_shown',       label: '상세해몽 CTA 노출',   order: 7 },
  { id: 'paywall_shown',          label: '페이월 표시',          order: 8 },
  { id: 'checkout_started',       label: '결제 시작',            order: 9 },
  { id: 'checkout_completed',     label: '결제 완료',            order: 10 },
  { id: 'feature_used',           label: '유료 기능 사용',       order: 11 },
  { id: 'retention_action',       label: '재방문 행동',          order: 12 },
];

const STEP_IDS = FUNNEL_STEPS.map(s => s.id);

// ═══════════════════════════════════════
// 퍼널 스텝 기록
// ═══════════════════════════════════════

/**
 * 퍼널 단계를 기록한다.
 * - localStorage에 각 단계의 최초 도달 시각 저장
 * - 세션 내 단계별 횟수도 별도 추적 (반복 가능 단계 분석용)
 * @param {string} stepId - FUNNEL_STEPS의 id
 * @param {object} [meta] - 추가 메타데이터
 */
export function trackFunnelStep(stepId, meta = {}) {
  if (!STEP_IDS.includes(stepId)) return;

  const step = FUNNEL_STEPS.find(s => s.id === stepId);

  // 세션 내 횟수 추적 (반복 허용)
  const sessionKey = 'mg_funnel_session';
  const session = JSON.parse(sessionStorage.getItem(sessionKey) || '{}');
  session[stepId] = (session[stepId] || 0) + 1;
  sessionStorage.setItem(sessionKey, JSON.stringify(session));

  // 최초 도달 기록 (1회만)
  const funnel = JSON.parse(localStorage.getItem('mg_funnel') || '{}');
  const isFirst = !funnel[stepId];
  if (isFirst) {
    funnel[stepId] = new Date().toISOString();
    localStorage.setItem('mg_funnel', JSON.stringify(funnel));
  }

  // 이벤트 로깅
  logEvent('funnel_step', {
    step: stepId,
    order: step.order,
    first: isFirst,
    session_count: session[stepId],
    ...meta,
  });
}

// ═══════════════════════════════════════
// 퍼널 이탈률 분석
// ═══════════════════════════════════════

/**
 * 세션 내 퍼널 이탈 지점을 분석한다.
 * @returns {{ steps: Array<{id, label, order, reached, count}>, dropoffs: Array<{from, to, rate}>, deepest: string }}
 */
export function getFunnelDropoffs() {
  const session = JSON.parse(sessionStorage.getItem('mg_funnel_session') || '{}');
  const firstReach = JSON.parse(localStorage.getItem('mg_funnel') || '{}');

  const steps = FUNNEL_STEPS.map(s => ({
    id: s.id,
    label: s.label,
    order: s.order,
    reached: !!(session[s.id] || firstReach[s.id]),
    count: session[s.id] || 0,
  }));

  const dropoffs = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i];
    const to = steps[i + 1];
    if (from.count > 0 && to.count === 0) {
      dropoffs.push({
        from: from.id,
        to: to.id,
        rate: 100, // 100% 이탈
      });
    } else if (from.count > 0 && to.count > 0) {
      dropoffs.push({
        from: from.id,
        to: to.id,
        rate: Math.round((1 - to.count / from.count) * 100),
      });
    }
  }

  const deepest = [...steps].reverse().find(s => s.reached)?.id || 'none';

  return { steps, dropoffs, deepest };
}
