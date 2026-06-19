# ADR 0002 — LLM 프롬프트·키 서버 격리 게이트웨이 + 멀티 LLM 폴백

- 상태: Accepted (사후 박제, 2026-06-19)
- 근거 코드: `src/services/api.js`, `supabase/functions/openai-proxy/index.ts`, `supabase/functions/openai-proxy/prompts.ts`
- 관련 메모: `SECURITY_REDEPLOY.md`(R4 LLM 프롬프트 서버 격리)

## Context (맥락)

해몽 품질이 핵심 가치이고 그 가치는 (1) LLM API 키와 (2) 정교한 시스템 프롬프트(해석 IP)에 담겨 있다. 그러나 클라이언트는 정적 빌드되어 누구나 DevTools로 dist 번들을 열 수 있다. 과거(Gen113 이전) openai-proxy는 무인증이라 공격자가 무한 호출 가능했고(CRITICAL), 시스템 프롬프트가 클라 번들에 박혀 있으면 해석 노하우가 통째로 탈취된다. 동시에 운영 현실상 단일 LLM 키가 자주 죽는다(OpenAI 401 등) → 한 provider에 의존하면 서비스가 멈춘다.

## Decision (결정)

**LLM 호출을 단일 Edge Function 게이트웨이(`openai-proxy`)로 격리**한다:

1. **프롬프트 IP 서버 격리**: 클라는 시스템 프롬프트를 보내지 않는다. `task`(템플릿 이름) + `params`(사용자 데이터)만 전송 → `prompts.ts`가 서버에서 시스템 프롬프트를 조립해 LLM 호출(`api.js:54-61`). dist 번들에 프롬프트 문자열·LLM 키 부재.
2. **인증·남용 방지**: Supabase JWT(user/anon) 검증 + Origin/Referer CORS allowlist + user_id 기반 in-memory rate-limit(30 req/60s) + endpoint/payload 화이트리스트(16KB 상한).
3. **멀티 LLM 폴백 라우팅**: provider 배열(우선순위 = Mistral → Gemini → DeepSeek → OpenAI). 키가 있고 `enabled:true`인 provider만 활성. 무효 키는 `enabled:false`로 라우팅 제외(헛호출/401 차단). 무료=fallback 라우팅, 프리미엄=consensus 교차검증 모드.
4. **명시적 폴백 사유 태깅**: LLM 불가 시 클라가 추측하지 않는다. `no_supabase_url`/`invalid_anon_key`/`edge_function_not_found`/`rate_limited`/`offline`/`llm_provider_unavailable` 등 사유를 error에 박아 결과 객체까지 전달 → "왜 LLM이 아니라 키워드 demoResult인지" 절대 숨기지 않음(`api.js:21, 92-98`).

## Alternatives considered (검토한 대안)

1. **클라에서 LLM 직접 호출(키를 config에)**: 구현 간단하나 키·프롬프트가 번들에 노출 → 즉시 탈취·과금 폭탄. 기각.
2. **단일 LLM provider 고정**: 코드 단순하나 그 키가 죽으면 전 서비스 정지(실측 OpenAI 401 빈발). 가용성 위험.
3. **전용 백엔드 LLM 프록시 서버**: 통제권은 최대지만 상시 운영 부담(ADR 0001 결정과 충돌). Edge Function이 동일 격리를 운영 부담 없이 달성.
4. **무조건 키워드 매칭(LLM 미사용)**: 비용 0이나 해석 품질이 핵심 가치를 못 냄. 데모/폴백 용도로만 유지.

## Tradeoffs (트레이드오프)

- (+) 키·프롬프트 IP가 서버에만 존재 → 탈취·무인증 남용 차단.
- (+) provider 1개 죽어도 폴백으로 서비스 지속. 무효 키 헛호출 제거.
- (+) 폴백 사유 투명성 → 디버깅·정직 표시(데모 모드 칩) 가능.
- (-) LLM 호출이 Edge Function 1-hop 추가(레이턴시·콜드스타트).
- (-) rate-limit이 **in-memory** → Edge 인스턴스 재시작/멀티 인스턴스 시 카운터 리셋(분산 rate-limit 아님).
- (-) 운영 가용성이 "키 등록 상태"에 종속 — 실 가용 키 1개(Mistral)뿐이면 사실상 단일 의존(코드-현실 괴리, `PURPOSE.lock.yaml` C02).

## Consequences (결과)

- `prompts.ts`가 P0 보호 자산(해석 IP). 수정 시 영향 광범위.
- LLM 키 충전/교체는 코드가 아니라 Supabase Edge Function secret 등록(인간 영역 blocker).
- 폴백 사유 태깅이 계약이다 — `api.js`에 새 실패 경로 추가 시 사유 문자열을 반드시 부여(미태깅 시 `llm_call_failed`로 강등).
- 분산 rate-limit이 필요해질 만큼 트래픽이 늘면 Postgres/Redis 기반 카운터로 승격해야 한다(현재는 미해결 부채).
