// Phase 3-1: A/B Test Framework
// userId hash 기반 결정적 variant 배정 + 이벤트 로깅
import { store } from '../store.js';
import { logEvent, setExperimentProvider } from './analytics.js';

// ── 실험 레지스트리 ──
const EXPERIMENTS = {
  paywall_cta_v1: {
    name: 'Paywall CTA 문구',
    variants: ['A', 'B'],
    weights: [50, 50],
  },
  premium_layout_v1: {
    name: '프리미엄 paywall 레이아웃',
    variants: ['A', 'B'],
    weights: [50, 50],
  },
  promo_tone_v1: {
    name: '프로모 문구 톤',
    variants: ['A', 'B'],
    weights: [50, 50],
  },
};

// ── 해시 함수 (MurmurHash3-like, 32-bit) ──
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── 유저 식별자 (로그인 userId 우선, 없으면 localStorage 익명 ID) ──
function getUserKey() {
  if (store.currentUser?.id) return store.currentUser.id;
  let anonId = localStorage.getItem('mg_ab_anon_id');
  if (!anonId) {
    anonId = 'anon_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('mg_ab_anon_id', anonId);
  }
  return anonId;
}

// ── variant 배정 (결정적) ──
export function getVariant(experimentId) {
  const exp = EXPERIMENTS[experimentId];
  if (!exp) return 'A';

  // 캐시 확인 (세션 내 일관성)
  const cacheKey = `mg_ab_${experimentId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached && exp.variants.includes(cached)) return cached;

  // 해시 기반 배정
  const key = getUserKey() + ':' + experimentId;
  const h = hash(key);
  const bucket = h % 100;

  let cumulative = 0;
  let assigned = exp.variants[0];
  for (let i = 0; i < exp.variants.length; i++) {
    cumulative += exp.weights[i];
    if (bucket < cumulative) {
      assigned = exp.variants[i];
      break;
    }
  }

  localStorage.setItem(cacheKey, assigned);
  return assigned;
}

// ── 노출 이벤트 (paywall 등에서 호출) ──
const _exposed = new Set();

export function trackExposure(experimentId) {
  if (_exposed.has(experimentId)) return;
  _exposed.add(experimentId);
  const variant = getVariant(experimentId);
  logEvent('ab_experiment_exposure', {
    experiment_id: experimentId,
    variant,
    name: EXPERIMENTS[experimentId]?.name || experimentId,
  });
}

// ── 전환 이벤트 (결제 완료 등에서 호출) ──
export function trackConversion(experimentId, meta = {}) {
  const variant = getVariant(experimentId);
  logEvent('ab_conversion', {
    experiment_id: experimentId,
    variant,
    ...meta,
  });
}

// ── 현재 활성 실험 목록 반환 (analytics context 주입용) ──
export function getActiveExperiments() {
  const result = {};
  for (const id of Object.keys(EXPERIMENTS)) {
    result[id] = getVariant(id);
  }
  return result;
}

// ── 실험 레지스트리 조회 (디버그용) ──
export function listExperiments() {
  return Object.entries(EXPERIMENTS).map(([id, exp]) => ({
    id,
    ...exp,
    currentVariant: getVariant(id),
  }));
}

// 자동 등록: analytics에 실험 컨텍스트 공급
setExperimentProvider(getActiveExperiments);

window._abTest = { getVariant, listExperiments, getActiveExperiments };
