# MONGGEUL — ARCHITECTURE

> 영구 설계 문서. 모든 항목은 실제 코드/파일 근거. 추정은 `[추정]` 표기.
> 정본 보조: `PURPOSE.lock.yaml`(목적·보호분류), `AGENTS.md`(빌드/테스트/배포), `HANDOFF.md`(상태/blocker).
> 작성일 2026-06-19 · 기준 커밋 `6517c96` (master).

---

## 1. 제품 정체 (Product Identity)

꿈 해몽 & 꿈 기록 **PWA + Capacitor 하이브리드 앱**(웹/Android/iOS). 사용자가 꿈을 입력하면 "달이"(AI 꿈 동반자)가 길몽·흉몽·연애운·재물운을 해석하고, 꿈 일기/패턴 리포트/커뮤니티를 제공한다.

- **수익 모델**: Free(광고) / 단건·팩 결제(상세해몽 ₩1,900 / 5팩 ₩7,900 / 15팩 ₩19,900 / 무의식 프로파일 ₩2,900) / 구독(Plus ₩3,900·Premium ₩19,900). 근거: `src/services/payment.js:20-28` `PRODUCT_CATALOG`.
- **운영 탭**: 해몽(dream) · 달이 대화(dali/chat) · 기록(my/log) · 커뮤니티(community) + room placeholder. 근거: `src/app.js:65-70, 103`.
- **정신건강 경계 (절대 규칙)**: 진단 단정 금지·공포 마케팅 금지·탐색적 어조만·위기 감지 시 전문상담 안내 우선. 근거: `CLAUDE.md`, `src/utils/crisis.js`(P0 보호 자산).
- **소유**: 비공개(private), 민규.
- ★ SSOT 모순: `project_roles.yaml`이 "반려동물 관리 앱"으로 STALE 오기입 — 실 정체는 `manifest.json`/`CLAUDE.md` 기준 "꿈 해몽". `PURPOSE.lock.yaml` C01에 기재.

---

## 2. 실측 스택 (Verified Stack)

근거: `package.json`, `vite.config.js`, edge function import 문.

| 영역 | 기술 | 버전 (실측) |
|------|------|------|
| 프론트엔드 언어 | Vanilla JS (ES modules, `"type":"module"`) | — |
| 번들러 | Vite | `^6.0.0` |
| 네이티브 래퍼 | Capacitor (core/android/ios/cli) | `^8.2.0` |
| Capacitor 플러그인 | app / haptics / keyboard / splash-screen / status-bar | `^8.0.1` |
| 광고(네이티브) | @capacitor-community/admob | `^8.0.0` |
| 백엔드 SDK | @supabase/supabase-js | `^2.49.0` |
| 유틸 | html5-qrcode / jspdf / qrcode | `2.3.8` / `4.2.1` / `1.5.4` |
| 빌드 도구(dev) | puppeteer / sharp | `^24.40.0` / `^0.34.5` |
| Edge 런타임 | Deno (Supabase Edge Functions) | `std@0.168.0`, supabase-js esm@2 |
| DB | Supabase Postgres + RLS + Realtime | — |
| 테스트 | pytest (Python) + Node 런타임 브리지 | 517 tests collected |

- **빌드 파이프라인**: `npm run build` = `generate-seo-pages.js` → `vite build` → `gen-config.js`. 근거: `package.json:10`.
- **번들 분할**: `vite.config.js` `manualChunks` 18개 청크(supabase / tab-dream·dream-demo·dream-share·dream-voice / tab-my·my-monthly·my-flow·my-dict·my-emotion-sleep / tab-dali / tab-community / data-symbols·data-dreams / svc-community·svc-growth). 거대 my.js/dream.js 의 초기 로드 분산이 목적. 근거: `vite.config.js:28-48`.

---

## 3. 아키텍처 패턴 (Architecture Pattern)

**클라이언트-헤비 SPA + BaaS(Supabase) + Edge-Function 게이트웨이.** 전용 백엔드 서버 없음(static host + Supabase).

```
┌─────────────────────────────────────────────────────────────┐
│  브라우저 / Capacitor WebView (Vanilla JS SPA)               │
│  app.js (entry) → store.js (전역상태) → tabs/* services/*    │
│  config.js (window.* 환경변수 런타임 주입)                   │
└───────────────┬───────────────────────────┬──────────────────┘
                │ supabase-js               │ fetch (JWT bearer)
                ▼                           ▼
   ┌────────────────────────┐   ┌──────────────────────────────┐
   │ Supabase Postgres      │   │ Supabase Edge Functions(Deno) │
   │  20 tables + RLS + RPC │   │  openai-proxy (LLM 게이트웨이) │
   │  Realtime(커뮤니티)    │   │  toss/stripe/billing webhooks │
   └────────────────────────┘   │  push-scheduler/subscribe     │
                                 └───────────────┬───────────────┘
                                                 │ server-only keys
                                                 ▼
                          멀티 LLM (Mistral/Gemini/DeepSeek/OpenAI) · PG · IAP
```

핵심 패턴 4가지:

1. **로컬-우선 + 점진적 서버 동기화 (offline-first)**: 모든 핵심 기능(데모 해몽·꿈 일기·XP·별가루·출석)이 `localStorage`만으로 즉시 작동. 로그인/Supabase 연결 시 서버로 마이그레이션·동기화. `store.supabase`/`store.currentUser` 부재 = "데모 모드" 우아한 강등. 근거: `src/services/auth.js:90-121`(local guest), `subscription.js`(`*Local` vs `*Async` 이중 경로), `api.js:28-29`(no_supabase_url 태깅 폴백).

2. **LLM IP 서버 격리 게이트웨이**: 클라가 시스템 프롬프트를 절대 보내지 않음. `task`(템플릿 이름)+`params`(사용자 데이터)만 전송 → `openai-proxy/prompts.ts`가 서버에서 프롬프트 조립·LLM 호출. dist 번들에 프롬프트 문자열·LLM 키 부재. 근거: `src/services/api.js:54-61`, `supabase/functions/openai-proxy/`.

3. **명시적 폴백 사유 태깅**: LLM 실패 시 추측 금지 — `no_supabase_url`/`invalid_anon_key`/`edge_function_not_found`/`rate_limited`/`offline` 등 사유를 error에 박아 결과 객체까지 전달("왜 LLM이 아니라 키워드 폴백인지" 숨기지 않음). 근거: `src/services/api.js:21, 92-98`.

4. **window 전역 네임스페이스 = 모듈 간 느슨 IPC**: 동적 import된 탭 모듈이 로드 시 `window.*`에 함수를 등록하고, 다른 모듈은 `window.fn?.()` 옵셔널 호출로 참조. `src/` 전체 `window.` 참조 **428건** 실측. → 명시적 import 그래프가 아니라 런타임 전역 계약. (설계부채 §8-1)

---

## 4. 모듈 경계와 의존 방향 (Module Boundaries & Dependency Direction)

`src/` 59 파일, 6 레이어. 근거: `find src -type f`.

```
app.js (엔트리, 부팅 오케스트레이션)
  │  import (정적)              import (동적, 청크분리)
  ├─→ store.js ←──────────── (모두가 의존하는 전역 상태 허브)
  ├─→ services/  ←─ 비즈니스 로직 (auth, api, subscription, payment, pg-*, iap, growth, ads, analytics ...)
  ├─→ components/ ←─ UI 위젯 (paywall, toast, radar, emotion-chart, dream-export* ...)
  ├─→ utils/     ←─ 순수 유틸 (sanitize, crisis, emotion, symbols, dream-data, funnel ...)
  ├─→ config/    ←─ feature-flags.js (가역적 기능 숨김 플래그)
  └─→ tabs/ (동적 import)  ←─ dream / dali / community / my + 9 sub-module
```

의존 방향 규칙(실측):
- **단방향 하향 의존**: `tabs → services → store`, `tabs → components → store`. `store.js`는 무의존(leaf). 근거: `store.js`(import 0).
- **금액 정의 단일 출처**: `payment.js:PRODUCT_CATALOG`가 정본. `subscription.js:PRODUCTS`는 그로부터 **파생만**(금액 재정의 금지). 근거: `subscription.js:18-26`.
- **coverage-first 추출**: 거대 모듈(my.js/dream.js)의 순수 로직을 `services/`로 추출 중 — `xp-levels.js`, `achievements.js`, `dream-lotto.js`, `llm-json-parser.js`, `upsell-trigger.js` 등. 추출 시 characterization 테스트가 "값 1톨이라도 바뀌면 FAIL"로 동작 보존 강제. 근거: 최근 커밋 `06d0321`/`ba68eb2`/`b9472fc`/`29f8f6d`, `tests/test_xp_levels_runtime.py`.
- **순환 회피**: 탭 모듈은 `window` 전역으로 서로 호출(직접 import 아님) → 정적 순환 의존 회피하나 런타임 결합으로 전이. (설계부채 §8-1)

---

## 5. 데이터 모델 요약 (Data Model)

Postgres 20 마이그레이션. 핵심 테이블(`0001_init_schema.sql` + billing/growth/community 증분):

| 테이블 | 역할 | 키 |
|--------|------|-----|
| `users` | 사용자 프로필 | id=auth.uid() |
| `dreams` | 꿈 기록 (content/title/badges/emotions jsonb) | user_id |
| `dali_memory` | 달이 대화·기억 jsonb | user_id (PK) |
| `community_posts` / `_comments` / `_reactions` | 커뮤니티 피드 (public read) | id |
| `user_entitlements` | 구독 상태·팩 크레딧 | user_id (PK) |
| `usage_daily` | 일일 해몽 카운터 | (user_id, date) |
| `app_stats` | 전역 카운터 (public read) | key |
| `events` | 분석 이벤트 | id |
| `dream_pattern_cache` | 패턴 분석 캐시 jsonb | user_id (PK) |

보안·일관성 모델:
- **RLS 전 테이블 활성** + `own_*` 정책(`user_id=auth.uid()`). 커뮤니티만 public select. 근거: `0001_init_schema.sql:15-47`.
- **권위 RPC (`security definer`)**: 클라가 직접 UPDATE 불가한 머니/카운터 경로는 서버 RPC로만. `increment_dream_count()`(auth.uid 기준, p_user_id 제거=IDOR 차단), `use_credit()`(원자 차감, -1=없음), `add_credits(p_count)`(원자 증분, 덮어쓰기 아님=lost-update 방지), `check_entitlement()`. 근거: `subscription.js:103-162, 363-394`, `migrations/20260615_*`/`20260616_*`.
- **펜딩 동기화 큐**: 서버 적립 실패 시 `mg_credits_pending_sync`/`mg_dreams_pending_sync`(localStorage)에 delta 보관 → 다음 세션 원자 RPC 재시도. 근거: `subscription.js:54-71`, `auth.js:146`.
- **마이그레이션 파일명 2체계 혼재**: `0001_~0004_` (구) + `20260320~20260616_` (신 타임스탬프). 멱등(`IF NOT EXISTS`)이나 명명 일관성 없음. (설계부채 §8-4)

---

## 6. 배포 토폴로지 (Deployment Topology)

**정적 호스트(SPA) + Supabase(BaaS) 분리 배포.** 단일 백엔드 서버 없음.

| 타깃 | 설정 파일 | base path | 배포 명령 |
|------|-----------|-----------|-----------|
| GitHub Pages (기존) | — | `/monggeul/` (기본) | git push |
| Cloudflare Pages | `wrangler.toml` | `/` (DEPLOY_BASE) | `npm run deploy:cf` |
| Vercel | `vercel.json` | `/` | `npm run deploy:vercel` |
| Netlify | `netlify.toml` | `/` | `npm run deploy:netlify` |
| Render | `render.yaml` | `/` | (git 연동) |

- **base path 분기**: `DEPLOY_BASE=/` → 루트 도메인, 미지정 → `/monggeul/`(Pages 호환). 근거: `vite.config.js:10`.
- **SPA fallback**: 전 타깃 `/* → /index.html` rewrite. 멀티페이지 입력 = `index.html`(앱 SPA) + `landing.html`(마케팅). 근거: `vite.config.js:23-26`.
- **config.js 주입**: `.gitignore` 처리(`config.js`) → fresh clone 시 부재 → `gen-config.js`가 빌드마다 `dist/config.js` 생성, 배포 환경변수(SUPABASE_URL/ANON_KEY/GA/VAPID/ADSENSE) → `window.*` 주입. **공개값만**(LLM 키·시스템 프롬프트는 Edge Function 서버에만). 근거: `scripts/gen-config.js`.
- **네이티브**: `cap:android`/`cap:ios` = vite build → `cap sync` → IDE open. 근거: `package.json:16-18`.
- **Edge Functions**: Supabase 별도 배포(12개). webhook/RTDN URL을 PG·스토어 콘솔에 등록.

★ 운영 현실(blocker, `AGENTS.md`/`HANDOFF.md`): ① Supabase 인스턴스 paused(unpause=민규) ② LLM 키 — 실 가용 Mistral 1개뿐(OpenAI 401·`enabled:false`, openai-proxy 우선순위=Mistral→Gemini→DeepSeek→OpenAI) ③ repo public 또는 host 이전 ④ 결제 키(토스/스토어).

---

## 7. 테스트 전략 (Test Strategy)

**pytest 단일 러너 + Node 런타임 브리지 characterization.** 근거: `tests/`(34 파일, 517 collected).

- **러너**: `cd tests && python -m pytest`. 근거: `AGENTS.md:31`.
- **Windows 콘솔 차단 가드**: `conftest.py`가 모든 자식 프로세스에 `CREATE_NO_WINDOW` 주입(cmd 폭주 구조 차단). 근거: `tests/conftest.py:1-16`.
- **3 테스트 종류**:
  1. **Characterization 런타임 핀** (`*_runtime.py`): Python이 fake `localStorage`/DOM SHIM을 주입한 Node 스크립트를 spawn해 실제 JS 함수를 구동, 현재 동작값을 박제. 거대 모듈에서 순수 로직 추출 시 회귀 0 보장. 근거: `test_xp_levels_runtime.py`.
  2. **머니/게이트 회귀**: webhook 멱등(dedup)·SKU 매핑·paywall honesty·IDOR/PII 하드닝·entitlement 정규화. 근거: `test_webhook_dedup.py`, `test_iap_sku_mapping_runtime.py`, `test_pii_idor_hardening.py`.
  3. **뮤테이션 민감도**: 보호 블록(예: stripe dedup `if(event.id){...}`)을 제거하면 단언이 **반드시 FAIL**해야 함을 강제(약한 테스트 적발). 근거: `test_webhook_dedup.py:54-63`.
- **결제 보안 검증 실측**: toss-webhook = HMAC-SHA256 + 상수시간 비교 + `processed` 멱등 플래그. 근거: `supabase/functions/toss-webhook/index.ts:14-37, 130`.
- **E2E**: `tests/e2e/`(Puppeteer 기반, devDependency). Playwright는 미설치(`AGENTS.md:20`).
- **추가 .mjs 검증**: `verify_addcredits_sync.mjs`, `verify_storage_limit_gate.mjs`(독립 Node 검증).

---

## 8. 알려진 설계부채 (Known Design Debt — 솔직히)

증거 기반. 미화 없음.

1. **window 전역 결합 (428건)**: 모듈 간 호출이 명시적 import가 아니라 `window.fn?.()` 런타임 전역. 장점=동적 청크 순환 회피·옵셔널 안전. 단점=정적 의존 그래프 부재, 리네임/삭제 시 IDE 추적 불가, 로드 순서 의존(`?.` 없으면 부팅 타이밍 버그). 근거: `src/` `window.` grep 428.

2. **거대 모듈 (my.js 1,272줄 / dream.js 1,573줄)**: 보호 자산(P0)이라 통째 리팩터 불가. coverage-first 추출(순수 로직 → `services/`)이 진행 중이나 UI·DOM 조작 본체는 여전히 monolith. 근거: `wc -l`, `PURPOSE.lock.yaml` protected_assets.

3. **LLM 코드-현실 괴리**: 멀티 LLM 정규화(4 provider) 코드는 완성, 그러나 실 가용 키 1개(Mistral). OpenAI `enabled:false`·DALL-E `OPENAI_IMAGE_ENABLED=false`(무효 키 헛호출 차단). 코드가 "할 수 있다"와 운영 "지금 된다"가 다름. 근거: `openai-proxy/index.ts` PROVIDERS, `PURPOSE.lock.yaml` C02.

4. **마이그레이션 명명 2체계 혼재**: `0001_~0004_`(시퀀스) + `20260320~`(타임스탬프) 병존. 멱등이라 안전하나 적용 순서·정본 추적이 사람 판단 의존. 근거: `ls supabase/migrations/`(20 파일).

5. **결제 PG 3중 + IAP 2중 (5 결제 경로)**: Stripe(카드)·토스(카카오/네이버/이체)·Apple IAP·Google Play Billing. webhook/검증 함수 각각(`toss-*` 3, `stripe-webhook`, `billing-apple-*` 2, `billing-google-*` 2). 표면적이 넓어 멱등/서명/entitlement 동기화 사각이 늘 위험. 멱등·HMAC은 구현됐으나 5경로 entitlement 일관성은 회귀 테스트 의존. 근거: `supabase/functions/`, `payment.js:33-39`.

6. **클라 낙관적 캐시 vs 서버 권위 이중 진실**: 크레딧/티어/카운터가 localStorage 낙관적 + RPC 서버 권위 이중 보유. pending-sync 큐로 수렴 시도하나, RPC 실패 구간에 클라 캐시가 서버보다 앞서는 윈도우 존재(과금정확성 우선=낙관적 차감은 보류로 처리). 근거: `subscription.js:103-162`.

7. **room 탭 placeholder 미구현**: `TABS` 배열·스와이프에 `room` 등록되나 페이지 없음. 데드 슬롯. 근거: `app.js:163`(swipe TABS), README "(미구현)".

8. **`project_roles.yaml` STALE 오기입 (C01)**: 제품 정체가 SSOT 한 곳에서 "반려동물 앱"으로 잘못 박제됨. 임의 수정 금지(민규 결정 대기). 근거: `PURPOSE.lock.yaml` conflicts C01.

---

## 부록: 관련 결정 기록 (ADR)
- `docs/adr/0001-supabase-baas-no-dedicated-backend.md` — BaaS(Supabase) 선택, 전용 백엔드 미채택
- `docs/adr/0002-llm-server-side-prompt-isolation-gateway.md` — LLM 프롬프트 서버 격리 게이트웨이 + 멀티 LLM 폴백
