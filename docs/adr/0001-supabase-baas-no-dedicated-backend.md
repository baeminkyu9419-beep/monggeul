# ADR 0001 — Supabase BaaS 채택, 전용 백엔드 서버 미채택

- 상태: Accepted (사후 박제, 2026-06-19)
- 근거 코드: `src/services/auth.js`, `src/services/api.js`, `supabase/migrations/*`, `supabase/functions/*`, `render.yaml`/`vercel.json`/`netlify.toml`/`wrangler.toml`

## Context (맥락)

몽글몽글은 1인(민규) 운영 수익화 앱이다. 인증·데이터 저장·실시간 커뮤니티·결제 검증·LLM 키 보관·푸시가 모두 필요하지만, 상시 운영할 전담 백엔드 인력/예산이 없다. 클라이언트는 PWA + Capacitor 하이브리드(웹/Android/iOS)로 동일 코드베이스를 다중 플랫폼에 배포해야 한다. 비용은 무료·초저가 티어에서 출발해야 한다(아직 무수익).

## Decision (결정)

전용 백엔드 서버(Express/FastAPI 등)를 두지 않는다. **Supabase를 BaaS로 채택**한다:
- Postgres + Row Level Security로 데이터·권한을 DB 레이어에서 강제(20 마이그레이션, `own_*` 정책 + `security definer` RPC).
- Auth(소셜 OAuth + 익명 로그인)를 Supabase Auth에 위임(`auth.js`).
- 서버 로직이 필요한 지점(LLM 프록시·결제 webhook·푸시 스케줄)만 **Supabase Edge Functions(Deno) 12개**로 처리.
- 프론트엔드는 정적 빌드(Vite)로 산출해 정적 호스트(Cloudflare Pages/Vercel/Netlify/Render/GitHub Pages)에 올린다. 환경변수는 `gen-config.js`가 빌드 시 `dist/config.js`로 `window.*` 주입.

## Alternatives considered (검토한 대안)

1. **전용 백엔드(Node/Express 또는 FastAPI) + 자체 DB**: 완전한 통제권, 그러나 상시 운영·스케일·보안 패치 부담. 1인 무수익 단계엔 과투자.
2. **Firebase**: 유사 BaaS이나 NoSQL(Firestore)로 RLS 같은 관계형 권한·SQL 마이그레이션 부재, 결제/커뮤니티 관계 모델링이 불리. 벤더 락인도 더 강함.
3. **클라이언트 온리(localStorage만)**: 서버 비용 0이나 계정 동기화·커뮤니티·서버 권위 결제 불가 → 수익 모델(구독/팩) 성립 불가.

## Tradeoffs (트레이드오프)

- (+) 운영 부담 최소화, 무료 티어 출발, RLS로 보안을 DB에 강제, 멀티 플랫폼 단일 배포.
- (+) Edge Function이 LLM 키·시스템 프롬프트·결제 서명을 서버에 격리(ADR 0002 참조).
- (-) **벤더 락인**: 인증·DB·Realtime·Functions가 Supabase에 결합.
- (-) **무료 티어 자동 pause**: 7일 미사용 시 인스턴스 정지 → 사이트 백엔드 전멸(실측 ECONNREFUSED). keep-alive cron으로 완화하나 이미 pause되면 수동 unpause 필요.
- (-) **클라/서버 이중 진실**: offline-first 설계상 localStorage 낙관적 캐시와 서버 권위 RPC가 공존 → pending-sync 큐로 수렴(`subscription.js`).

## Consequences (결과)

- 운영 blocker가 "코드"가 아니라 "Supabase 콘솔 상태"(unpause·키 등록)에 집중된다 — `HANDOFF.md` blocker 대부분이 인간 영역.
- 보안 모델의 정본이 RLS 정책 + `security definer` RPC다. 클라 직접 UPDATE를 신뢰하지 않고 머니/카운터 경로를 RPC로만 강제(IDOR/lost-update 차단, `migrations/20260615_*`·`20260616_*`).
- 배포 타깃 교체가 자유롭다(정적 호스트 4종 설정 상비). base path만 `DEPLOY_BASE`로 분기.
- 인스턴스 가용성 모니터링(별도 ping/keep-alive)이 운영 필수 항목이 된다.
