// 몽글몽글 — 위기 신호 최소 안전망 (정신건강 절대규칙: "위기 감지 시 전문 상담 안내 우선")
// 설계 원칙(민규 우려 반영 — 정상 해몽 가로채기 0):
//   · 달이(chat)에서 사용자가 1인칭으로 자기 위해/자살 사고를 표현할 때만 감지한다.
//   · 꿈 해몽 탭(analyzeDream)에는 적용하지 않는다 — 죽음/추락/쫓김은 정상 꿈 상징.
//   · 채팅이라도 꿈 서술 맥락("꿈에서…")이면 감지하지 않는다 — 오탐 방지.

// 직접적 자기 위해 / 자살 사고 (1인칭·의지·현재)
const CRISIS_PATTERNS = [
  /죽고\s*싶/, /죽어\s*버리고\s*싶/, /죽는\s*게\s*(낫|나아|나을)/,
  /자살/, /목숨을?\s*끊/, /생을?\s*마감/,
  /자해/, /손목을?\s*긋/, /칼로\s*긋/,
  /살기\s*싫/, /살고\s*싶지\s*않/, /더\s*(이상)?\s*못\s*살/, /살\s*이유가?\s*없/,
  /사라지고\s*싶/, /없어지고\s*싶/, /뛰어내리고\s*싶/,
];

// 꿈 서술 맥락 — 있으면 꿈 내용(상징)으로 간주, 감지하지 않음
const DREAM_CONTEXT = /꿈에서|꿈\s*속|꿈을?\s*꿨|꿈\s*내용|꿈이었|악몽/;

export function detectCrisis(text){
  if(!text || typeof text !== 'string') return false;
  if(DREAM_CONTEXT.test(text)) return false;   // 꿈 서술 → 상징, 감지 안 함
  return CRISIS_PATTERNS.some(re => re.test(text));
}

// 위기 감지 시 채팅에 우선 노출하는 안내 카드 (전화 링크 포함)
export const CRISIS_HTML = `<div class="crisis-card" role="alert">
  <div class="crisis-title">🫂 잠깐, 지금 많이 힘든가요?</div>
  <div class="crisis-body">달이는 마음을 나누는 동반자예요. 하지만 지금처럼 힘든 순간엔 전문가의 도움이 가장 안전해요. 혼자 견디지 않아도 괜찮아요.</div>
  <ul class="crisis-lines">
    <li><b>자살예방 상담</b> <a href="tel:109">109</a> · <a href="tel:1393">1393</a> <span>(24시간)</span></li>
    <li><b>정신건강 상담</b> <a href="tel:15770199">1577-0199</a></li>
    <li><b>청소년 상담</b> <a href="tel:1388">1388</a></li>
  </ul>
  <div class="crisis-foot">지금 위험하다면 망설이지 말고 <a href="tel:119">119</a></div>
</div>`;
