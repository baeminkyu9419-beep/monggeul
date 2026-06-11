# MONGGEUL HANDOFF

## 현 상태 (2026-06-11)

- **LIVE 다운 원인**: repo private 전환(baeminkyu9419-beep/monggeul HTTP 404) + Supabase `mskwqlqpcsfvgvhhilma.supabase.co` pause — 인간 영역(민규 P0).
- **실 가용 LLM**: Mistral 1개만 LIVE (ping 실측: evidence/secrets_ping_matrix.json). OpenAI 401 / Gemini expired / DeepSeek 부재. providers.js 멀티LLM 정규화 코드 완성 — 키 충전 시 즉시 작동 (미검증).
- **코드 커밋 실측**: 멀티LLM 폴백(15226c5) / 키워드 버그 2건(6e7dffc) / paywall canUseDream() 배선(a780530) — git log 확인. 실행 E2E는 Supabase+키 복구 후 가능.
- **외부 blocker (민규 P0)**: Supabase unpause 1-click / repo public 또는 CDN 전환 / OpenAI·Gemini 키 충전 / AdSense·Play Store.

---

> **Gen107 Recovery Gen** — 2026-04-17 야간 자율 작성
> 세대 교체 시 덮어쓴다. 이전 갱신: Gen98 (2026-04-16 21:33).

## §0.1 본 세션 진입 (2026-05-19) — 15.3d 정체 끊음

- **정체 측정**: 마지막 MONGGEUL commit `7fe3b499f` (2026-05-04 12:51) 이후 **15.3d**. 본 세션 진입 (2026-05-19 20:25 KST).
- **SKU 불일치 발견 (민규 결정 P0)**:
  - `CLAUDE.md` 정본: Plus ₩3,900/월 / Premium ₩19,900/월 (계획) / pro_monthly ₩9,900 레거시 하위호환.
  - `src/components/paywall.js` L40/41/46/47/148/149/200/201: **레거시 ₩9,900 + pro_monthly action 만 노출**. 정본 Plus ₩3,900 미반영.
  - `src/services/growth.js` L240/260/261/331: 동일 ₩9,900 레거시만 표시.
  - `src/services/ads.js` L198 + `src/services/iap.js` L53~57: 정본 ₩3,900 + Plus/Premium 매핑 OK.
  - **불일치 의미**: paywall UI 가 실 사용자에게 레거시 가격만 노출. 정본 SKU 가격 변경은 실 비즈니스 임팩트 = 민규 결정 영역.
- **자율 가능 다음 step**: SKU 정정 commit 은 민규 승인 후. 그 전 자율 = 빌드 검증 / Edge Functions 정합성 / 보안 점검.
- **잔여 P0 (민규)**: AdSense pub-id / Google Play $25 / Apple p8 / Google service account JSON / SKU 가격 정정 승인.

## §0.2 본 세션 전수 마스터 감사 (2026-05-19 20:30 KST)

### 구조 실측
- src/ = **38 JS**, supabase/functions = **15**, supabase/migrations = **8 SQL**, dist = **4.5MB / 115 파일** (마지막 빌드 2026-04-20 22:29 = **29d stale**).
- 큰 파일 6+ (코드 품질 가이드 500 LOC 위반): my.js 2109 / dream.js 1848 / dream-data.js 1219 / dali.js 992 / dream-export.js 733 / community-bot.js 563 / community.js 547.

### 실 운영 TAB 4 + 1 placeholder
- src/app.js L128 `TABS=['community','chat','dream','room','log']` 실측.
- 실 4 TAB: community / chat(dali) / dream / log(my) — 모두 src/tabs/*.js 구현 + dist chunk 확증.
- room: TABS 배열 등록만, 구현 부재 (placeholder).
- CLAUDE.md "3대 축" 박제 → "4대 운영 축 + room placeholder" 본 세션 정정.

### Edge Functions 15 분류
- billing-apple-* (verify / notifications)
- billing-google-* (verify / rtdn)
- toss-* (5개: checkout / confirm / payment-confirm / payment-ready / payment-webhook / webhook) — **중복 가능성, 정리 필요**
- stripe-webhook / create-checkout / openai-proxy / push-scheduler / push-subscribe

### 기술 부채
- TODO/FIXME/HACK src/ 검색 = **0건** (코드 자체 clean).

### 자율 가능 영역 (민규 승인 불필요)
1. 큰 파일 분리 (dream.js / dream-data.js / my.js) — 작은 단위로 다음 turn 진입.
2. Edge Functions toss-* 5개 중복/정리 정합성 보고서.
3. dist/ 재빌드 검증 (29d stale, npm run build 작동 확증) — 환경 의존.

### 민규 P0 (자율 영역 외)
- AdSense pub-id / Google Play $25 / Apple p8 / Google service account JSON
- SKU 가격 정정 승인 (paywall ₩9,900 레거시 → 정본 ₩3,900)
- toss-* 5 Edge Functions 정리 방향 결정

## §0.4 Supabase 인스턴스 다운 — 추가 거짓 박제 정정 (2026-05-20)

직전 박제 (commit `6025e7e42`, `bc492905d`, `8280cf338`) 에서 "SUPABASE_URL/ANON_KEY 설정됨 ✅" 인용 = **stale**.

본 세션 직접 실측:
- `https://mskwqlqpcsfvgvhhilma.supabase.co` → **ECONNREFUSED** (curl exit 6 / WebFetch ECONNREFUSED)
- 모든 REST API endpoint 호출 = 연결 거부
- 의미: Supabase **무료 plan 7일 비활성 자동 pause** 또는 **프로젝트 삭제**

영향 (MONGGEUL Supabase 의존 기능 모두 실 동작 안 함):
- community posts/comments/reactions (community_posts 테이블)
- billing/payments (user_entitlements / payments 테이블)
- push_subscriptions
- user 데이터 동기화

로컬 fallback (localStorage) 기반 기능은 계속 작동:
- 꿈 기록 (mg_logs)
- XP/별가루 (mg_xp / mg_stardust)
- 출석 streak
- demoResult 해몽 (OpenAI 키 없을 때)

자비스 자율 권한 외 (민규 결정):
- Supabase Dashboard 접속 → 프로젝트 unpause (무료 plan 즉시 가능, 1 click)
- 또는 새 프로젝트 생성 + migration 8 SQL 재 실행 → config.js SUPABASE_URL/KEY 정정
- 또는 다른 hosting (Cloudflare D1 / Firebase / 자체 BaaS) 이전

추가 정정 commits 누계 3 (LIVE URL + 3대축 + Supabase).

## §0.3 본 세션 자기 검증 후 박제 정정 (2026-05-20)

### 거짓 자백
직전 자비스 보고서 (commit `c2ae02795` ~ `e8dbc9fc2`) 에 메모리 박제 stale 그대로 인용한 거짓 2건:

1. **LIVE URL "HTTP 200"** → **실측 HTTP 404 확증** (PC Chrome + iPhone Safari + 다양한 path 전수). 루트 `baeminkyu9419-beep.github.io` 만 HTTP 200 = 계정 살아있음, `/monggeul/` 경로만 다운. CLAUDE.md 본 commit 으로 정정.
2. **"3대 축 운영 안전 확증"** → **dream 만 직접 감사**. dali/my/community 본 세션 직접 미감사. 후속 표면 검증:
   - dali.js: innerHTML 13건, **대다수 정적 + L766/L815 esc() 거침 확증**. L836 `<img src="${data.data[0].url}" alt="${dreamTitle}">` = OpenAI URL + 사용자 dreamTitle (alt 속성 안 = XSS 어려움, LOW). L907 `<b>${intention}</b>` = 사용자 입력 가능 (LOW~MED, 확장 검증 권고).
   - community.js: L121 (post.map) + L215 (comments.map) = 사용자 데이터, `${esc(c.nick)}` 등 esc 적용 확증. critical 위반 0.
   - my.js: innerHTML 24건, 본 세션 직접 grep만 (개별 sanitize 적용 검증은 후속 plan).

### 정정된 등급
- 거짓 박제 위반: 1원칙 위반 + M-052 거짓말 금지 위반. 본 commit 으로 정정.
- 직전 22 commits 의 코드 변경/검증 자체는 유효 (본 세션 직접 실행).
- "운영 LIVE" 주장 = **무효**. 실제 = "PWA 배포 다운, 원인 미확정, 민규 결정 영역".

---

## 한 줄

**2026-04-14 삭제분 복구에서 `몽글몽글_상용화_로드맵_통합본.md`(W1/W2/W3 주차 단위 + 플랜 SKU 2단 + 서버 검증 엔드포인트 4개)를 프로젝트 루트에서 확인했고 [파일 존재만 확인], ROADMAP/MONGGEUL.md에서 Phase 0 Archive 97.8% → 스토어 제출(M12)까지 M1~M12 마일스톤으로 재정의하여 자체 가능한 M1(SKU 확정)+M2(Supabase 빌링 스키마)를 Gen108 자율 축으로 세웠습니다.**

---

## 1. 현재 상태 (2026-04-17, ROADMAP/MONGGEUL.md 기준)

### 1.1 Phase 선언 (Gen98 유지)

ROADMAP/MONGGEUL.md:5-21 근거.

| 항목 | 실측 값 | 증거 | 검증 상태 |
|------|--------|------|----------|
| Phase | Phase 0 Archive **97.8% (138/141)** | HANDOFF.md Gen98 | 보고됨 [미재검증] |
| dist/ 빌드 | 존재 (**4.5MB, 127 파일**, 2026-04-14) | HANDOFF.md | 보고됨 [미재검증] |
| node_modules | 설치됨, 38 JS 모듈 | HANDOFF.md | 보고됨 [미재검증] |
| Edge Functions | **15개 작성됨 (배포 대기)** | HANDOFF.md | 보고됨 [미재검증] |
| Phase 1 기능 | 꿈 입력/해몽/상징 사전/달리 메모리 코드 완성 | HANDOFF.md | 보고됨 [미재검증] |
| Stack | JavaScript + Vite 6 + Capacitor 8 (Android + iOS) | CLAUDE.md | 보고됨 [미재검증] |
| 주요 패키지 | @capacitor-community/admob, @supabase/supabase-js, html5-qrcode, jspdf, qrcode, Puppeteer, Sharp | CLAUDE.md | 보고됨 [미재검증] |
| Android/iOS | 네이티브 스캐폴딩 존재 | HANDOFF.md | 보고됨 [미재검증] |
| Commits | 137+ | EVOLUTION.md | 보고됨 [미재검증] |
| GitHub | baeminkyu9419-beep/monggeul (private) | EVOLUTION.md | 보고됨 [미재검증] |
| Deploy | GitHub Actions → Vite build → GitHub Pages (PWA 운영 중) | EVOLUTION.md | 보고됨 [미재검증] |
| Phase 0~2 | Done | EVOLUTION.md | 보고됨 [미재검증] |
| Phase 3 | Planned (서비스화 + BM) | EVOLUTION.md | 확정 (계획) |

### 1.2 정신건강 경계 원칙 (절대 규칙, 확정)

ROADMAP/MONGGEUL.md:23-29.

- 진단 단정 금지 ("우울증입니다" 등 절대 불가)
- 공포 마케팅 금지
- 탐색적 어조만 ("~일 수 있어요")
- 위기 감지 시 전문 상담 안내 우선
- 달이(AI)는 동반자, 치료사 아님

---

## 2. 복원된 자산 포인터 (RECOVERED/ + 프로젝트 루트)

### 2.1 DEV_MONGGEUL_.claude — RECOVERED/Dev2/DEV_MONGGEUL_.claude/

ANALYSIS/diff_recovered_vs_current.md:206-233 기준.

| 항목 | 값 |
|------|---|
| 크기 | 88 KB, 13 파일 (recovered) / 10 파일 (current) |
| 현재 counterpart | `projects/MONGGEUL/.claude/` |
| 동일 (hash match) | 7 |
| recovered 전용 | 3 (`.pyc` 파일) — MERGE_RECOVERED |
| 내용 차이 | 3 (`hooks/stop.sh`, `parallel.json`, `settings.local.json`) — REVIEW_BY_USER |

### 2.2 몽글몽글_상용화_로드맵_통합본.md (프로젝트 루트, **Gen107 핵심 발견**)

ROADMAP/MONGGEUL.md:35-45 근거. **파일 존재 확인, 내용 요약은 ROADMAP 인용 [이 세션 미재검증]**.

| 속성 | 값 |
|------|---|
| 경로 | `projects/MONGGEUL/몽글몽글_상용화_로드맵_통합본.md` |
| 가치 | **상용화 전환 마스터 로드맵** (결제 체계 + Supabase 스키마 + 개발자 계정 + 스토어 제출) |
| 핵심 내용 | W1/W2/W3 주차 단위 + 플랜 SKU + 스토어 제출 전략 + 서버 검증 엔드포인트 4개 |

### 2.3 프로젝트 자산 (실측, ROADMAP/MONGGEUL.md:35-43)

| 자산 | 경로 | 가치 |
|------|------|------|
| `AGENTS.md` / `CHANGELOG.md` / `DEPLOY_GUIDE.md` / `ROLLBACK.md` | 루트 | 전체 문서 세트 완비 |
| `ai_consultation_log.md` | 루트 | AI 상담 이력 |
| `android/` + `ios/` + `capacitor.config.json` | 존재 | 네이티브 빌드 준비 |
| `supabase/` | 존재 | 스키마 + Edge Functions 15개 |
| `landing.html` / `releases.html` | 존재 | 마케팅 페이지 |
| `dist/` (4.5MB, 127 파일, 2026-04-14) | 존재 | 빌드 산출물 실존 |
| `node_modules/` | 설치 완료 | 즉시 재빌드 가능 |
| `bots/` + `supabase/` + `tests/` | 존재 | 자동화 봇 + 테스트 |

**핵심 발견 (ROADMAP/MONGGEUL.md:45)**: **상용화 로드맵이 가장 구체적** (W1/W2/W3 주차 단위). `몽글몽글_상용화_로드맵_통합본.md`는 자체 가치가 높은 복구 자산.

---

## 3. 이번 세션 산출 (Gen107)

| 파일 | 경로 | 목적 |
|------|------|------|
| `ROADMAP/MONGGEUL.md` | `C:\JARVIS_NEW\ROADMAP\MONGGEUL.md` (140줄) | 상용화 로드맵 기반 M1~M12 마일스톤 + Free/Plus/Premium 플랜 + 외부 blocker 7건 |
| `ANALYSIS/diff_recovered_vs_current.md` (section 5) | DEV_MONGGEUL_.claude 파일 diff |
| `ANALYSIS/all_projects_docs.md` (section 3) | MONGGEUL 14 파일 현재 상태 감사 |

---

## 4. 마일스톤 (ROADMAP/MONGGEUL.md:62-76)

> 로드맵 통합본 기준 재구성. W = 주차.

| M | 이름 | 기간 | 자체 가능 | 조건 |
|---|------|------|----------|------|
| M1 | 구독 SKU 확정 (Plus / Premium 2단) + entitlement 스키마 설계 | 1일 | O | 상용화 로드맵 W1-① |
| M2 | Supabase 빌링 스키마 마이그레이션 (user_entitlements + billing_transactions + billing_events) | 1일 | O | 로드맵 W1-② SQL 준비됨 |
| M3 | 앱 아이콘 + 스플래시 생성 (1024x1024 원본 + @capacitor/assets) | 1일 | 부분 | 디자인 에셋 또는 AI 생성 |
| M4 | 개발자 계정 등록 (Apple $99/년 + Google $25 1회) | 1일 + 승인 대기 | X | 신용카드 + 본인 인증 |
| M5 | Apple/Google 스토어 상품 등록 (SKU 매핑) | 1일 | X | 계정 승인 후 |
| M6 | 서버 검증 엔드포인트 4개 (Stripe webhook / Apple Server Notifications / Google RTDN / 복원 API) | 2~3일 | 부분 | Toss 키 대기 중이지만 Stripe 먼저 가능 |
| M7 | 앱 IAP UI 연결 (paywall + 구매 + 복원) | 2일 | O | 코드 기반 |
| M8 | Capacitor 빌드 + 네이티브 테스트 (웹뷰 깨짐/Safe Area/키보드) | 1~2일 | O | Android 먼저 가능 |
| M9 | 스토어 에셋 (스크린샷 + 설명 3종 × A/B) | 1~2일 | 부분 | 디자인 도구 또는 AI |
| M10 | sandbox 테스트 전체 (구매/취소/만료/복원/환불) | 2일 | X | 계정 + 키 전부 필요 |
| M11 | TestFlight + 내부테스트 배포 | 1일 | X | 계정 필요 |
| M12 | 스토어 심사 제출 (iOS 24~48시간, Android 검토) | 제출 1일 + 대기 | X | 전체 PASS 후 |

---

## 5. BM (로드맵 통합본 기준, 확정 — ROADMAP/MONGGEUL.md:97-105)

| 플랜 | 기능 | 가격(추정) | 현실성 |
|------|------|-----------|--------|
| **Free** | 해몽 2회/일 + 기본 꿈 기록 + 커뮤니티 열람 + 달이 기본 대화 | 무료 + 광고 | HIGH |
| **Plus** | 해몽 사실상 무제한 + 달이 대화 확장 + 주간 리포트 + 광고/잠금 제거 | 월 구독 | HIGH |
| **Premium** | 반복꿈 패턴 분석 + 감정 변화 추적 + 장기 아카이브 + 고급 운세/꿈 사전/심볼 리포트 | 월 구독 (Plus보다 높음) | MEDIUM |

**주의**: 정서적 루틴 앱 → 3~4단 금지, 2단(Plus/Premium)만 + Free 광고. v1은 연간/가족/쿠폰 전부 제외.

### 추가 BM 후보

- AdMob 광고 (Free 플랜, `@capacitor-community/admob` 설치됨)
- 꿈 해몽 Pro (리추얼 시즌별 테마 — 향후 확장)

---

## 6. 다음 세대 (Gen108) 준비

### 6.1 자율 진행 가능

| 작업 | 산출물 | 우선순위 |
|------|--------|---------|
| M1: 구독 SKU 확정 (Plus / Premium 2단) | `docs/pricing/sku_spec.md` | P0 |
| M2: Supabase 빌링 스키마 SQL 실행 | `supabase/migrations/YYYYMMDD_billing.sql` | P0 |
| Phase 0 나머지 2.2% 완료 (138 → 141) | 3건 잔여 | P0 |
| HANDOFF.md Gen98 → Gen99 갱신 | 본 제안서 승인 후 반영 | P0 |
| M7: 앱 IAP UI 연결 (코드 기반) | paywall + 구매 + 복원 | P1 |
| M8: Capacitor 빌드 재검증 (Android 먼저) | 웹뷰/Safe Area/키보드 | P1 |

### 6.2 민규님 결정 대기

| 결정 포인트 | 영향 |
|-----------|------|
| 출시 플랫폼 우선순위 | Android 먼저 ($25) vs iOS 먼저 ($99/년) vs 동시 |
| Toss vs Stripe | 한국 Play Billing은 Toss 불필요 (Play Billing 직접), 웹은 Stripe |
| Free 플랜 광고 전략 | AdMob 즉시 활성 vs Premium 전환 유도 강화 |
| v1 런칭 타겟일 | 한국 Play Store 먼저 (승인 빠름) → 1~2개월 내? |

---

## 7. Blocker 현황

### 7.1 자율 진전 가능 (민규님 승인 불필요)

- M1 SKU 확정 + M2 Supabase 빌링 스키마 (코드 + SQL 자체 가능)
- Phase 0 나머지 2.2% 완료
- M7 앱 IAP UI 연결 (코드 기반)
- M8 Capacitor Android 빌드 재검증

### 7.2 민규님 결정 대기 (Blocker, ROADMAP/MONGGEUL.md:81-88)

| Blocker | 필요 자원 | 민규님 액션 |
|---------|----------|------------|
| Toss Business Console | 사업자등록증 + 결제 심사 | Merchant ID + API 키 발급 (수일~주) |
| Apple Developer 계정 | $99/년 + 본인 인증 | 신청 + 1~2일 승인 |
| Google Play Console | $25 1회 결제 | 신청 + 즉시 |
| OAuth 앱 등록 (Google/Kakao/Naver) | 각 콘솔 | 각 계정 생성 + 앱 등록 + 키 발급 |
| Stripe 계정 (해외 결제용) | 결제 계정 심사 | Stripe 가입 + 사업자 심사 |
| 앱 아이콘 디자인 | 1024x1024 PNG | 디자이너 or AI 생성 |
| 스토어 스크린샷 | iPhone 6.7" + Android 다양 사이즈 | 자동 생성 도구 or 수동 |

### 7.3 리스크 (ROADMAP/MONGGEUL.md:49-57)

| 리스크 | 심각도 |
|--------|--------|
| Toss 결제 키 미설정 → Edge Functions 15개 배포 불가 | HIGH — 메인 blocker |
| OAuth 프로바이더 미등록 (Google/Kakao/Naver) | HIGH — 소셜 로그인 미작동 |
| 개발자 계정 미등록 (Apple/Google) | HIGH — 스토어 제출 불가 |
| 앱 아이콘 + 스플래시 미생성 | HIGH — 빌드 불완전 |
| 빌링 스키마 미마이그레이션 | HIGH — 권한 판정 source of truth |
| 한국 Google Play 결제 전략 미정 | MEDIUM — v1 Play Billing 단일 결정 필요 |
| 스토어 에셋 (스크린샷 + 설명 3종) 미작성 | MEDIUM — 전환율 직결 |

---

## 8. 필수 읽기 순서 (다음 세션)

1. `memory/PERMANENT_ANCHOR.md` (JARVIS_NEW 루트)
2. 이 HANDOFF (`projects/MONGGEUL/HANDOFF.md`)
3. `ROADMAP/MONGGEUL.md` ← **Gen107 신규. 상용화 M1~M12 마일스톤**
4. `CLAUDE.md` + `EVOLUTION.md`
5. `contracts/ssot/project_manifest.yaml`
6. `몽글몽글_상용화_로드맵_통합본.md` ← **Gen107 핵심 발견**
7. `AGENTS.md` + `CHANGELOG.md` + `DEPLOY_GUIDE.md` + `ROLLBACK.md`

---

## 9. 증거

- `dist/` 빌드 산출물 (2026-04-14, 4.5MB, 127 파일) [보고됨, 미재검증]
- `node_modules/` 의존성 설치됨 [보고됨, 미재검증]
- `android/`, `ios/` 네이티브 스캐폴딩 [보고됨, 미재검증]
- Gen107 ROADMAP: `ROADMAP/MONGGEUL.md` [검증됨, 이 세션 읽음]
- Gen107 ANALYSIS: `ANALYSIS/all_projects_docs.md` (section 3), `ANALYSIS/diff_recovered_vs_current.md` (section 5) [검증됨, 이 세션 읽음]

---

## 1원칙: 서로를 실망시키지 않는다.
