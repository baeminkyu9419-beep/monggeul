// Phase 6: 이벤트 로그 (Supabase + GA4 듀얼)
import { store } from '../store.js';

let _getActiveExperiments = null;

export function setExperimentProvider(fn) {
  _getActiveExperiments = fn;
}

// 익명 식별자 — ab-test.js 의 mg_ab_anon_id localStorage 규약 재사용 (새 키 발명 금지)
function getAnonId() {
  try {
    let anonId = localStorage.getItem('mg_ab_anon_id');
    if (!anonId) {
      anonId = 'anon_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('mg_ab_anon_id', anonId);
    }
    return anonId;
  } catch (_) {
    return 'anon_unknown';
  }
}

// events.user_id 는 users(id) FK + uuid 타입 — 실제 auth uuid 만 넣을 수 있다.
// 로컬 게스트 id('guest_...')를 넣으면 타입 오류로 insert 가 조용히 실패한다(기존 유실 경로 중 하나).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function logEvent(event, properties = {}) {
  // A/B 실험 컨텍스트 자동 첨부
  if (_getActiveExperiments) {
    try { properties._ab = _getActiveExperiments(); } catch (_) {}
  }

  // Supabase 이벤트 저장 — 비로그인도 적재 (P1-3, 2026-06-13 감사).
  // 기존: store.currentUser 없으면 전량 유실 — 부팅 직후(익명 세션 확립 전) js_error,
  // 정식 오픈 후 비로그인, 로컬 게스트가 전부 무음 드랍이었다.
  // 익명은 user_id null + properties.anon_id. RLS 는 익명 insert 를 js_error/js_rejection
  // 만 허용(20260613_anon_error_events.sql) — 그 외 익명 이벤트는 GA4 만 적재.
  if (store.supabase) {
    const uid = store.currentUser?.id;
    const isAuthUuid = typeof uid === 'string' && UUID_RE.test(uid);
    store.supabase.from('events').insert({
      user_id: isAuthUuid ? uid : null,
      event,
      properties: isAuthUuid ? properties : { ...properties, anon_id: getAnonId() },
    }).then(() => {}).catch(() => {});
  } else if (event === 'js_error' || event === 'js_rejection') {
    // Supabase 미설정(데모/로컬) — 에러 이벤트는 콘솔 폴백 (무음 전량 유실 금지)
    console.warn('[logEvent fallback]', event, properties);
  }
  // GA4 이벤트 전송
  if (typeof gtag === 'function') {
    gtag('event', event, properties);
  }
}

window.logEvent = logEvent;
