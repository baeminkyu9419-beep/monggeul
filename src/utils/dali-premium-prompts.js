// 달이 프리미엄 추천 — 탐색적 어조 전용 (공포 마케팅 금지)

/**
 * 감정/맥락별 프리미엄 추천 템플릿
 * 모든 문구는 '~해볼 수 있어요', '~가 궁금하다면' 등 탐색적 어조만 사용
 */
export const DALI_PREMIUM_SUGGESTIONS = {
  // 불안/공포 → 무의식 프로파일
  anxiety: {
    feature: 'unconscious_profile',
    messages: [
      '혹시 이런 불안이 반복된다면, 무의식 프로파일로 깊이 살펴볼 수도 있어요 🌙',
      '마음속 패턴이 궁금하다면, 무의식 프로파일이 도움이 될 수 있어요',
    ],
  },
  // 반복꿈 → 상세 해몽
  recurring: {
    feature: 'detail_interpretation',
    messages: [
      '이 꿈이 자꾸 반복되는 이유, 상세 해몽으로 더 깊이 알아볼 수 있어요',
      '반복되는 꿈엔 숨은 메시지가 있을 수 있어요. 상세 해몽으로 살펴볼까요?',
    ],
  },
  // 성장/긍정 → 주간 리포트
  growth: {
    feature: 'weekly_report',
    messages: [
      '좋은 흐름이에요! 주간 리포트로 감정 변화를 한눈에 볼 수 있어요',
      '이런 긍정적인 변화, 주간 리포트에서 추이를 확인해볼 수 있어요 ✨',
    ],
  },
  // 슬픔/우울 → 상세 해몽
  sadness: {
    feature: 'detail_interpretation',
    messages: [
      '마음이 무거운 날엔, 상세 해몽으로 숨은 의미를 찾아볼 수도 있어요',
      '이 꿈이 전하는 메시지가 궁금하다면, 상세 해몽을 살펴보는 것도 좋아요',
    ],
  },
  // 많은 꿈 기록 → 무의식 프로파일
  rich_data: {
    feature: 'unconscious_profile',
    messages: [
      '꿈이 많이 쌓였네요! 무의식 프로파일로 나만의 패턴을 발견해볼 수 있어요',
      '기록이 풍부해질수록 무의식 분석이 정확해져요. 프로파일을 열어볼까요?',
    ],
  },
  // 대화 깊어짐 → 프로 구독
  deep_conversation: {
    feature: 'pro',
    messages: [
      '달이와 더 깊은 대화를 이어가고 싶다면, 프로에서 장기 기억이 확장돼요',
      '지금처럼 깊은 대화가 좋다면, 프로 구독으로 달이의 기억을 20회까지 늘릴 수 있어요',
    ],
  },
};

// 사용자 메시지 + 달이 응답에서 감정 맥락 감지
const ANXIETY_WORDS = ['불안', '무서', '두려', '공포', '악몽', '쫓기', '떨어지'];
const SADNESS_WORDS = ['슬프', '우울', '외로', '그리', '눈물', '상실', '이별'];
const GROWTH_WORDS = ['기쁘', '행복', '설레', '성장', '희망', '밝', '좋은 꿈'];
const RECURRING_WORDS = ['또', '반복', '자꾸', '매번', '계속', '다시', '같은 꿈'];

/**
 * 대화 맥락에서 추천 카테고리 결정
 * @param {string} userMsg - 사용자 메시지
 * @param {string} daliReply - 달이 응답
 * @param {object} analysis - analyzeDreamData() 결과
 * @returns {string|null} 추천 카테고리 키 또는 null
 */
export function detectSuggestionContext(userMsg, daliReply, analysis) {
  const combined = (userMsg + ' ' + daliReply).toLowerCase();

  // 반복꿈 언급이 가장 높은 전환율
  if (RECURRING_WORDS.some(w => combined.includes(w))) return 'recurring';

  // 불안/공포
  if (ANXIETY_WORDS.some(w => combined.includes(w))) return 'anxiety';

  // 슬픔
  if (SADNESS_WORDS.some(w => combined.includes(w))) return 'sadness';

  // 성장/긍정
  if (GROWTH_WORDS.some(w => combined.includes(w))) return 'growth';

  // 꿈 데이터 풍부 (5개 이상)
  if (analysis && analysis.total >= 5) return 'rich_data';

  return null;
}

/**
 * 랜덤 메시지 선택
 */
export function pickSuggestionMessage(category) {
  const entry = DALI_PREMIUM_SUGGESTIONS[category];
  if (!entry) return null;
  const idx = Math.floor(Math.random() * entry.messages.length);
  return { message: entry.messages[idx], feature: entry.feature };
}
