// 몽글몽글 — 공통 유틸리티

// ── localStorage 안전 접근 ──
export function getStore(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return JSON.parse(v);
  } catch { return fallback; }
}

export function setStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { /* localStorage full */ }
}

// ── 꿈 기록 접근 ──
export function getLogs() { return getStore('mg_logs', []); }
export function setLogs(logs) { setStore('mg_logs', logs.slice(0, 50)); }

// ── 배지 색상 매핑 (중복 제거) ──
export const BADGE_COLORS = {
  길몽: 'bl', 태몽: 'bl', 재물운: 'bl', 활력: 'bl',
  흉몽: 'bb', 연애운: 'bv', 건강운: 'bv', 직관: 'bl',
};

export function badgeHtml(badges) {
  return (badges || []).map(b =>
    `<span class="badge ${BADGE_COLORS[b] || 'bl'}">${b}</span>`
  ).join('');
}
