// Phase 6: 이벤트 로그 (Supabase + GA4 듀얼)
import { store } from '../store.js';

let _getActiveExperiments = null;

export function setExperimentProvider(fn) {
  _getActiveExperiments = fn;
}

export function logEvent(event, properties = {}) {
  // A/B 실험 컨텍스트 자동 첨부
  if (_getActiveExperiments) {
    try { properties._ab = _getActiveExperiments(); } catch (_) {}
  }

  // Supabase 이벤트 저장
  if (store.supabase && store.currentUser) {
    store.supabase.from('events').insert({
      user_id: store.currentUser.id,
      event,
      properties,
    }).then(() => {}).catch(() => {});
  }
  // GA4 이벤트 전송
  if (typeof gtag === 'function') {
    gtag('event', event, properties);
  }
}

window.logEvent = logEvent;
