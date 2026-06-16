// 몽글몽글 — 스마트 업셀 트리거 선택(순수 결정 로직) — growth.js 에서 추출(2026-06-16, 동작보존).
//
// checkSmartUpsell 의 *결정 트리만* 분리: 입력(logs/totalChats/streak/hour/day/daliOn)
// → triggerId. 산식/조건/우선순위 무변경(원본 라인 순서 그대로 이동).
// localStorage/Date/DOM/setTimeout/이벤트로깅 등 부작용은 growth.js 에 남아 이 모듈을 import 한다.
// 단방향(이 모듈 → 무의존), 순환 無, 순수 함수(부작용 없음).
//
// 추출 이력: coverage-first wave-8. 안전망 = tests/test_upsell_trigger_runtime.py
//   (현재 동작 golden + growth.checkSmartUpsell 과 cross-check 로 권위 분리 방지).

// 감정 키워드 → 카테고리 매핑 (이모지 접두사 제거 후 비교)
const FEAR_KEYWORDS = ['공포', '불안', '두려움', '무서움', '긴장', '초조', '악몽'];
const JOY_KEYWORDS = ['기쁨', '행복', '설렘', '감동', '평화', '희망', '즐거움'];
const SAD_KEYWORDS = ['슬픔', '우울', '외로움', '그리움', '상실', '아쉬움'];

export function classifyEmotion(emotions) {
  if (!emotions || !emotions.length) return null;
  const flat = emotions.map(e => e.replace(/^[^\s]+\s/, '').trim());
  if (flat.some(e => FEAR_KEYWORDS.some(k => e.includes(k)))) return 'fear';
  if (flat.some(e => SAD_KEYWORDS.some(k => e.includes(k)))) return 'sadness';
  if (flat.some(e => JOY_KEYWORDS.some(k => e.includes(k)))) return 'joy';
  return null;
}

export function findRepeatedSymbol(logs) {
  if (logs.length < 3) return null;
  const freq = {};
  for (const l of logs.slice(0, 20)) {
    for (const b of (l.badges || [])) {
      freq[b] = (freq[b] || 0) + 1;
    }
  }
  return Object.entries(freq).find(([, c]) => c >= 3)?.[0] || null;
}

// 순수 결정: 행동/감정/패턴/시간대 입력 → triggerId(없으면 null).
// 우선순위(원본 그대로): 패턴 > 감정(기쁨) > 행동 > 시간대.
export function selectUpsellTrigger({ logs, totalChats, streak, hour, day, daliOn }) {
  let triggerId = null;

  // ── 패턴별 (우선순위 높음) ──
  const recentLogs = logs.slice(0, 5);
  const repeatedSymbol = findRepeatedSymbol(logs);

  if (recentLogs.length >= 2) {
    const last2Emotions = recentLogs.slice(0, 2).map(l => classifyEmotion(l.emotions));
    if (last2Emotions[0] === 'fear' && last2Emotions[1] === 'fear') {
      triggerId = 'emotion_fear';
    } else if (last2Emotions[0] === 'sadness') {
      triggerId = 'emotion_sadness';
    }
  }

  if (!triggerId && repeatedSymbol) triggerId = 'pattern_symbol';
  if (!triggerId && logs.length >= 2 && logs.slice(0, 5).some((l, i, a) =>
    i > 0 && l.title && a[i - 1].title && l.title === a[i - 1].title
  )) triggerId = 'pattern_repeat';
  if (!triggerId && logs.length >= 5 && logs.length < 8) triggerId = 'pattern_5dreams';

  // ── 감정별 (기쁨은 단독) ──
  if (!triggerId && recentLogs.length >= 1 && classifyEmotion(recentLogs[0].emotions) === 'joy') {
    triggerId = 'emotion_joy';
  }

  // ── 행동 기반 ──
  if (!triggerId && logs.length >= 3 && logs.length < 5) triggerId = 'dream_3rd';
  if (!triggerId && streak >= 7) triggerId = 'dream_7day';
  // [2026-05-23] dali_deep 업셀은 숨긴 달이 대화 기능 전제 → FEATURES.dali off면 스킵(가역). 기존 chat 이력 유저 오발동 방지.
  if (!triggerId && daliOn && totalChats >= 10) triggerId = 'dali_deep';

  // ── 시간대별 (가장 낮은 우선순위) ──
  if (!triggerId && hour >= 6 && hour <= 9) triggerId = 'time_morning';
  if (!triggerId && (hour >= 23 || hour <= 2)) triggerId = 'time_night';
  if (!triggerId && (day === 0 || day === 6)) triggerId = 'time_weekend';

  return triggerId;
}
