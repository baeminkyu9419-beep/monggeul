/**
 * MONGGEUL Bot 3 — 업셀 트리거
 * 사용자 행동 패턴 분석 → 프리미엄 전환 유도 (12개 트리거).
 * Phase 3-1에서 3→12개로 확장됨.
 */

const TRIGGERS = [
  { id: 'dream_count_5', condition: (u) => u.dreamCount >= 5, product: 'premium_interpretation' },
  { id: 'recurring_pattern', condition: (u) => u.recurringCount >= 3, product: 'pattern_analysis' },
  { id: 'emotion_negative', condition: (u) => u.dominantEmotion === 'anxiety', product: 'emotion_coaching' },
  { id: 'night_user', condition: (u) => u.lastActiveHour >= 23 || u.lastActiveHour <= 4, product: 'sleep_quality' },
  { id: 'symbol_curious', condition: (u) => u.symbolLookups >= 10, product: 'deep_symbol' },
  { id: 'share_intent', condition: (u) => u.shareAttempts >= 2, product: 'community_pro' },
];

function checkUpsell(userProfile) {
  if (userProfile.tier !== 'free') return null;
  for (const t of TRIGGERS) {
    try { if (t.condition(userProfile)) return t; } catch {}
  }
  return null;
}

module.exports = { checkUpsell, TRIGGERS };
