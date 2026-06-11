# PROJECT_OVERVIEW — 프로젝트 전체 정체

## 이 프로젝트가 만드는 것
**몽글몽글(MONGGEUL)** — 꿈 해몽 + 꿈 기록 PWA(모바일 웹앱). 사용자가 자연어로 꾼 꿈을 적으면 AI 동반자 **달이**가 그 꿈을 읽어 해석하고, 꿈을 일기처럼 쌓아 반복 패턴·무의식 프로파일로 자기 이해를 돕는 앱이다. Capacitor 8로 Android/iOS 네이티브 앱으로도 빌드 가능하지만, 1차 채널은 웹 PWA.

- `manifest.json` name = "몽글몽글 - 꿈 해몽 & 꿈 기록"
- 캐릭터 = **달이** (AI 꿈 해석 동반자)
- 정신건강 경계 = 진단 단정 금지, 탐색적 어조, 위기 감지 시 전문 상담 안내(코드에 `src/utils/crisis.js`로 반영됨)

## 기술 스택
- 프론트: **바닐라 JavaScript + Vite 6** (프레임워크 없음). 단일 `index.html` 기반 **SPA**, 탭 전환 방식. React/Next/Tailwind 아님.
- 네이티브: **Capacitor 8** (`android/`, `ios/`)
- 백엔드: **Supabase** (Edge Functions = Deno/TypeScript, Postgres + RLS)
- LLM 프록시: Supabase Edge Function `openai-proxy` (멀티 provider 라우팅, 현재 실가용 = Mistral)
- 결제: 토스페이먼츠 + Stripe(웹), Apple/Google IAP(모바일)
- 테스트: pytest(파일 파싱 + node 서브프로세스 방식, 237 PASS)

## 최종 제품 목적
무료(해몽 2회/일 + 광고) → Plus ₩3,900/월(무제한 + 광고 제거 + 주간 리포트) → Premium ₩19,900/월 구독 전환. 웹은 AdSense + 토스/Stripe, 모바일은 AdMob + IAP. 서버 권한은 `user_entitlements` 테이블로 통합.

## 현재 구현 수준 (솔직)
- **프론트(클라이언트): 완성도 높음.** 4대 탭 + 결제 UI + PWA + SEO + 빌드(`npm run build` PASS) + pytest 237 PASS.
- **백엔드: 연결 끊김.** 코드(Edge Functions 12개, 마이그레이션 13개)는 작성돼 있으나, **연결돼 있던 Supabase 인스턴스 `mskwqlqpcsfvgvhhilma`가 삭제됨(DNS "Could not resolve host" 실측)**. `config.js`의 `window.SUPABASE_URL`/`window.SUPABASE_ANON_KEY`도 공란.
- **결과: 현재 사용자는 100% 데모 모드.** 실 LLM 해몽이 아니라 `src/tabs/dream-demo.js`의 키워드 정규식 사전 해석을 받는다.

## 실제로 완성된 부분
- 4대 탭 UI: 해몽(`dream`), 달이 대화(`chat`), 기록(`log`), 커뮤니티(`community`) — 화면·인터랙션 동작
- LLM 호출 경로 코드(`src/services/api.js` → `openai-proxy`) + 프롬프트 IP 서버 격리
- 결제 Edge Functions(서명검증·금액검증 포함) — 코드 견고
- RLS 마이그레이션 13개, 데모 폴백 사전(고품질), 빌드 파이프라인, PWA manifest/SW

## 아직 부분 구현 / Mock / 가짜 로직
- **실 LLM 해몽**: 백엔드 부재로 미작동(코드만 존재). 항상 데모 폴백.
- **데모 해석(`dream-demo.js`)**: 정규식 키워드 first-match-wins 사전. 의미 추론 아님(현재 사용자가 받는 실제 결과).
- **무료/유료 게이트(`canUseDream`)**: 정의돼 있으나 `BETA_OPEN_ALL=true`(`src/services/subscription.js:32`)로 전 기능 무료 개방 + 호출 0건(죽은 코드) → paywall 미발동.
- **커뮤니티 봇 글(`community-bot.js`)**: 자동 생성 게시물(실 사용자 데이터 아님).
- **`consensus`(멀티 LLM 교차검증) 모드**: 클라가 요청하나 서버 2차 의견을 소비 안 함(현재 무효).
- **`room` 탭**: `TABS` 배열에 등록만, `src/tabs/room.js` 부재(미구현 placeholder).

## launch 관점 현재 위치
**코드측은 거의 준비, 인프라가 막혀 출시 불가.** 막는 것 = ① Supabase 프로젝트 재생성 + Edge Function 배포 + LLM 키 주입(=실 해몽 켜기) ② 호스팅/도메인(기존 GitHub Pages 404, 최근 Render Static Site로 이전) ③ 토스 가맹/키 ④ AdSense pub-id. 상세는 `LAUNCH_BLOCKERS.md`.

## Codex로 넘길 때 가장 조심할 점
1. **`src/tabs/dream-demo.js`(데모 폴백)를 "고도화"하지 말 것.** first-match-wins 카테고리 충돌은 끝없는 순서조정 함정. 진짜 품질은 LLM 경로에서 해결.
2. **`BETA_OPEN_ALL`을 함부로 `false`로 바꾸지 말 것.** 백엔드 없는 상태에서 끄면 결제도 데모도 다 막힘.
3. **`shared`는 `C:/JARVIS_NEW/shared` 공유 자산**(이 repo와 별개일 수 있음). 함부로 건드리지 말 것.
4. **결제/RLS/LLM 키 관련은 한 Task에서 여러 개 섞지 말 것**(작게 쪼개기).

## 사람이 먼저 이해해야 할 핵심 구조
- 진입 = `index.html` → `src/app.js`(부팅, `TABS` 탭 전환) → 각 `src/tabs/*.js`
- 해몽 핵심 흐름 = `dream.js:analyzeDream` → `api.js:callChat('dream_quick')` → `openai-proxy`(서버 프롬프트 조립) → LLM. 실패 시 `dream-demo.js:demoResult`.
- 백엔드 게이트 = `window.SUPABASE_URL` 유무 + 인스턴스 생존. 지금은 둘 다 막혀 데모.
