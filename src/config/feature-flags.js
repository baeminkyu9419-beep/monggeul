// 몽글몽글 — 기능 플래그 (가역적 숨김)
// [2026-05-23] 핵심 루프(꿈해몽→저장/공유→재방문) 집중을 위한 군더더기 숨김.
// 코드/모듈은 전부 보존. 진입점만 플래그로 제거. 민규 결정 시 false→true 한 줄로 복원.
//
// 숨김 근거:
//  - dali(달이 대화): LLM 비용(gpt-4o chat) + 비핵심
//  - fortune(오늘의 운세): 운세 ≠ 꿈해몽, 포지셔닝 이탈
//  - quiz(데일리 퀴즈): 한계 효용
// 의존성 처리: dali/quiz/fortune 관련 업적 5종도 같은 플래그로 숨김(영구 잠금 🔒 방지).
//
// 복원: 해당 값을 true 로 바꾸면 진입점·업적이 그대로 되살아남(코드 삭제 안 함).
export const FEATURES = {
  dali: false,     // 달이 대화 탭 + 진입 버튼들
  fortune: false,  // 오늘의 운세
  quiz: false,     // 데일리 퀴즈
};

// 헬퍼: window 노출(인라인 onclick/타 모듈에서 참조)
if (typeof window !== 'undefined') window.FEATURES = FEATURES;
