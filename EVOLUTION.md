# MONGGEUL Evolution Tracker

## Project Phase Snapshot
| Field | Value |
|---|---|
| current_phase | Phase 0 Archive — 상용화 준비 |
| owner_clevel | NV |
| primary_departments | CKO/Content Design, CTO/Infra, NV/Experiment |
| current_priority | 앱 UX 개선 |

### Active Cells
| Cell | Owner | Stage | Status | Next Action |
|---|---|---|---|---|
| 꿈 기록 UX 개선 | NV | Design | active | UI 프로토타입 완성 |

### Alignment Status
| Item | Status |
|---|---|
| project_manifest | done |
| skills_registry | done (8) |
| hooks_registry | done (6) |
| org_mapping | done |
| CLAUDE.md alignment | done |
| mcp_registry | pending |
| visualizer sync | partial |

### Next 3 Actions
1. ~~MCP registry 생성~~ — 완료 (meta/mcp_registry.json 확인 2026-04-10)
2. visualizer seed 동기화
3. 꿈 해석 → 문학화 E2E Cell 정의

---

## Project Charter

- **App name**: 몽글몽글 (MONGGEUL)
- **Mission**: 꿈 기록과 AI 해석을 통해 자기 이해를 돕는 꿈 동반자 서비스
- **Product pillars**: 꿈 해몽 / 달이(AI 동반자) / 꿈 기록(MY)
- **Architecture**: Vite + modular JS (20+ modules) / Supabase (Auth, Postgres, Edge Functions) / GitHub Pages PWA
- **Deploy**: GitHub Actions -> Vite build -> GitHub Pages
- **GitHub**: baeminkyu9419-beep/monggeul (private)
- **Commits**: 137+

### 정신건강 경계 원칙 (Mental Health Boundary)

이 서비스는 **자기 이해 도구**이지 의료/심리 진단 도구가 아니다.

1. **진단 단정 금지** -- "당신은 우울증입니다", "트라우마가 있습니다" 류의 단정적 표현 절대 불가
2. **공포 마케팅 금지** -- "이 꿈을 무시하면 위험합니다", "흉몽을 해석하지 않으면..." 류의 불안 유발 금지
3. **해석 톤 원칙** -- 모든 해몽은 탐색적 어조("~일 수 있어요", "~를 살펴볼 수 있어요")로 제공
4. **위기 감지 시 전문가 안내** -- 자해/자살/심각한 불안 키워드 감지 시 전문 상담 안내 메시지 우선 표시
5. **데이터 프레이밍** -- 패턴 분석 결과를 "경향"으로 표현, "진단"으로 표현하지 않음
6. **달이의 역할** -- 따뜻한 동반자이지 치료사가 아님. 조언은 하되 처방은 하지 않음

---

## 7-Lane Architecture

| Lane | 담당 영역 | 해당 모듈 |
|------|----------|----------|
| **Main** | 앱 오케스트레이션, 라우팅, 설정 | app.js, store.js, config |
| **Input** | 꿈 입력, 음성, 멀티모달, 초안 저장 | dream.js, web-push.js |
| **Logic** | 해몽 AI, 패턴 분석, 감정 엔진, 상징 사전 | dream-pattern.js, dream-context.js, utils/ |
| **Output** | 해몽 결과 표시, 리포트, 공유 카드, 갤러리 | components/ (radar-chart, share-card) |
| **Extend** | 달이 대화, 커뮤니티, 퀴즈, 운세 | dali.js, community.js, community-bot.js |
| **Verify** | 인증, 결제, 구독, 권한, 분석 | auth.js, payment.js, subscription.js, analytics.js, iap.js |
| **Inspector** | 품질, 보안, 성능, 접근성, SEO | Edge Functions, SW, CSP, sitemap |

---

## Phase Overview

| Phase | Name | Status | Lane |
|-------|------|--------|------|
| **Phase 0** | Foundation (RPG 정리 + 보안 + 인증 + 결제 + 모듈화) | Done | All |
| **Phase 1** | 꿈 기록 + 해석 엔진 | Done | Input/Logic/Output |
| **Phase 2** | 패턴 분석 + 커뮤니티 | Done | Logic/Extend |
| **Phase 3** | 서비스화 + BM | Planned | Verify/Inspector |

---

## Phase 0 -- Foundation (Done)

Phase 0~22까지의 기존 완료 작업을 통합. 세부 이력은 하단 Archive 참조.

**완료 요약:**
- RPG 잔재 제거 + BM 문구 정리
- API 키 은닉 (Supabase Edge Function 프록시)
- Auth 통합 (익명 + 소셜 로그인)
- 무료/유료 권한 분리 + 페이월
- 단일 HTML -> Vite 15개 모듈 분리
- Stripe + 토스페이먼츠 결제 코드 완료
- 분석 이벤트 30+ 로깅
- 커뮤니티 사례모음 25건
- 프로덕션 하드닝 (에러 핸들링, 오프라인 폴백)
- 꿈 패턴 엔진 (Markov 상태 머신)
- 웹퍼스트 전환 (PWA, AdSense, 웹 리워드)
- SEO 18페이지 + GA4 + 웹 푸시
- 꿈 대시보드 + 자동 저장 + 프로필 이미지 내보내기
- 제로 백엔드 레질리언스
- PC 반응형 레이아웃
- 결제 시스템 코드 완성 (Stripe + Toss, 수작업 배포 잔존)

**잔존 수작업 (Phase 0 미완):**
 [Cell: 꿈 기록 UX] [Stage: Launch] [Owner: CTO]  생성 + API key -> Supabase env
 [Cell: 꿈 기록 UX] [Stage: Launch] [Owner: CTO]  가맹점 등록 + API key -> Supabase env
- [x] Edge Functions 배포 (toss x6 + billing x4 + push x2 = 15 total, 2026-04-08)
- [ ] Supabase OAuth provider 활성화 (Google/Kakao/Naver)
 [Cell: 꿈 기록 UX] [Stage: Build] [Owner: CTO]  앱 등록 (provider별)

---

## Phase 1 -- 꿈 기록 + 해석 엔진

> **목표**: 꿈을 기록하고 해석받는 핵심 루프를 완성도 높게 다듬는다.
> **Lane**: Input / Logic / Output

### 1-1. 꿈 입력 고도화 [Input]
- [x] 해몽 전 감정 태그 5종 선택 (기쁨/공포/슬픔/혼란/평온, 프롬프트에 반영)
 [Cell: 꿈 기록 UX] [Stage: Build] [Owner: CKO]  후 사용자 확인 -> 해몽 정확도 향상
 [Cell: 꿈 기록 UX] [Stage: Build] [Owner: CTO] : Web Speech API로 음성 -> 텍스트 변환
- [x] 꿈 타임라인 UI: 최근 30일 꿈 기록을 시각적 타임라인으로 표시

### 1-2. 해석 엔진 강화 [Logic]
- [x] 상징사전 23개 -> 67개 확장 (12카테고리, 빈출 꿈 키워드 기반)
- [x] 상징 상세: 3탭 구조 (전통해몽 / 심리학적 해석 / 문화별 차이)
- [x] 해몽 결과에서 감지된 상징 자동 링크 (탭하면 사전으로 이동)
- [x] 감정엔진 규칙과 상징 매핑 (예: 뱀 -> 공포 30%, 재물 40%, 변화 20%)
- [x] CRM 데이터 기반 프롬프트 분기 (취준생/연애중/육아 등 lifeStage별)
- [x] 감정 강도에 따른 해석 톤 조절 (공포 강하면 -> 위로 모드)
- [x] 반복꿈 감지 시 "이전 해몽과 비교" 섹션 자동 추가

### 1-3. 결과 표현 강화 [Output]
- [x] 레이더 차트 비교 모드 (이번 꿈 vs 지난주 평균 오버레이)
- [x] 해몽 시 생성된 DALL-E 이미지 갤러리 저장 + MY탭 그리드 뷰
- [x] 이미지 탭하면 해당 해몽 상세로 이동
- [x] 두 개의 꿈 나란히 비교 (레이더 오버레이 + 키워드 유사도)

### 1-4. 달이 장기기억 [Extend]
- [x] 달이 메모리 10개 -> 50개 (카테고리별: 사실/감정/패턴/조언)
- [x] 대화에서 자동 추출한 CRM 데이터를 달이 컨텍스트에 주입
- [x] 달이 "기억 관리" UI (사용자가 달이의 기억을 보고 삭제 가능)
- [x] 달이 말투 선택: 친구 / 선생님 / 할머니 / 시적 (시스템 프롬프트 동적 조정)

### Phase 1 완료 기준
- [x] 상징사전 67개 + 자동 링크 동작
- [x] 감정 선택 -> 해석 톤 반영 E2E 확인
- [x] 달이 메모리 50개 + 카테고리 분류 동작
- [x] 레이더 비교 모드 동작

---

## Phase 2 -- 패턴 분석 + 커뮤니티

> **목표**: 꿈 데이터 축적에서 패턴을 발견하고, 사용자 간 연결을 만든다.
> **Lane**: Logic / Extend / Output

### 2-1. 패턴 분석 심화 [Logic]
- [x] 감정 흐름 그래프 (최근 30일, 5상태 색상 라인차트)
- [x] 반복꿈 타임라인 (특정 키워드 발생일을 점으로 표시)
- [x] 같은 상징이 시간에 따라 어떻게 변했는지 추적
- [x] 수면 체크인: 수면시간/카페인/운동/스트레스 기록
- [x] 아침 체크인: 수면 만족도(1~5), 꿈 기억 선명도
- [x] 수면 품질 <-> 꿈 감정 상관관계 차트

### 2-2. 리포트 자동화 [Output]
- [x] 주간 리포트: 꿈 횟수, 감정 분포, 반복 키워드, 다음주 예측
- [x] 월간 리포트: 감정 추이 그래프, 베스트/워스트 꿈, 성장 리뷰
- [x] GPT로 리포트 내러티브 생성 ("이번 달 당신의 꿈은...")
- [x] 공유 가능한 리포트 이미지 (캔버스 렌더링)
- [x] 달이가 주간 서머리를 자동 생성 (패턴 리포트 기반)

### 2-3. 커뮤니티 실시간화 [Extend]
- [x] 로컬 피드 -> Supabase posts + comments + reactions 테이블
- [x] 좋아요/댓글/스티커 실시간 반영 (Supabase Realtime)
- [x] 인기 게시물 알고리즘 (좋아요 x 시간 가중치)
- [x] 커뮤니티 봇 일일 포스트 DB 저장
- [x] "나와 비슷한 꿈" 매칭 (키워드 유사도 기반)

### 2-4. 콘텐츠 확장 [Extend]
- [x] 퀴즈 16개 -> 50개 확장 (상징/심리/문화 카테고리)
- [x] 데일리 퀴즈 (1일 1문제, 연속 정답 스트릭)
- [x] XP 보상 체계 확장 (레벨, 칭호: "꿈 초보자" -> "꿈 현자")
- [x] 업적 시스템 리빌드 (해몽 횟수, 연속기록, 퀴즈 정답률)
- [x] 오늘의 운세를 패턴 예측과 결합 + 달이 아침 인사에 포함

### Phase 2 완료 기준
- [x] 감정 흐름 30일 차트 렌더링
- [x] 주간 리포트 자동 생성 + 공유 이미지
- [x] 커뮤니티 Supabase Realtime 반영
- [x] 퀴즈 50개 + 데일리 퀴즈 동작

---

## Phase 3 -- 서비스화 + BM

> **목표**: 수익화 루프 완성, 성장 엔진, 성능 최적화, 서비스 안정성.
> **Lane**: Verify / Inspector / Main

### 3-1. 결제/수익화 [Verify]
- [x] 수작업 잔존: Edge Functions 15개 배포 완료 (2026-04-08), OAuth provider 활성화 대기
- [x] 업셀 트리거 3개 -> 12개 (감정별, 패턴별, 시간대별)
- [x] 달이가 자연스럽게 프리미엄 추천 (공포 마케팅 금지 -- 탐색적 어조만)
- [x] A/B 테스트 프레임워크 (paywall 디자인, 프로모 문구)
- [x] 퍼널 6단계 -> 12단계 세분화 + 이탈 지점 분석
- [x] Google AdSense 웹 광고 연동

### 3-2. SEO + 그로스 [Inspector]
- [x] 상징사전 60개 항목 -> 67개 SEO 페이지 자동 생성
- [x] 커뮤니티 인기 사례를 SEO 페이지에 삽입
- [x] sitemap.xml / feed.xml 자동 생성 스크립트 개선
- [x] FAQ 스키마를 사례 기반으로 동적 생성
- [x] ONGLE 연동: 꿈/운세 블로그 콘텐츠 자동 생성

### 3-3. 푸시 + 리텐션 [Main]
- [x] 아침 알림: "어젯밤 꿈 기록해보세요" (8~10시)
- [x] 패턴 알림: "반복꿈 주기가 다가왔어요" (반복클러스터 예측일)
- [x] 달이 알림: "달이가 이번 주 꿈 정리해뒀어요" (주간 리포트)
- [x] Edge Function으로 푸시 발송 스케줄러

### 3-4. 성능 + 접근성 [Inspector]
- [x] index.html 153KB -> 청크 분할 초기 로드 80KB 이하
- [x] 이미지 lazy loading + WebP 변환
- [x] 오프라인 SEO 페이지 SW 캐시 등록
- [x] WCAG 접근성: 키보드 내비게이션, 스크린리더, 고대비 모드
- [x] Core Web Vitals 최적화 (LCP < 2.5s, CLS < 0.1)

### 3-5. 데이터 내보내기 [Output]
- [x] 꿈 기록 내보내기: JSON / CSV / PDF 형식 선택
- [x] PDF 리포트: 월간 꿈 분석 + 차트 + 달이 코멘트 포함
- [x] 꿈 기록 가져오기 (다른 앱에서 마이그레이션)
- [x] QR 코드로 디바이스 간 데이터 이동

### Phase 3 완료 기준
- 결제 E2E 동작 (Stripe + Toss 실결제)
- SEO 페이지 60개 + sitemap 자동 생성
- 푸시 알림 3종 실제 발송
- LCP < 2.5s, 접근성 키보드 내비게이션

---

## Measurement -- 측정 지표

### Core Metrics (핵심)

| 지표 | 정의 | 목표 (Phase 3 완료 시) | 측정 방법 |
|------|------|----------------------|----------|
| DAU | 일간 활성 사용자 | 500+ | GA4 active_users |
| Dream/Day | 일간 꿈 기록 수 | 200+ | Supabase dreams 테이블 |
| Retention D7 | 7일 재방문율 | 30%+ | GA4 cohort |
| Conversion | 무료->유료 전환율 | 3%+ | checkout_completed / unique_users |
| MRR | 월간 반복 수익 | 100만원+ | Stripe + Toss 합산 |

### Engagement Metrics (참여)

| 지표 | 정의 | 목표 | 측정 방법 |
|------|------|------|----------|
| Dali Messages/User | 유저당 달이 대화 수 | 5+/주 | dali_message_sent 이벤트 |
| Report Views | 주간 리포트 조회 | 40% of active | report_opened 이벤트 |
| Community Posts | 커뮤니티 기여 게시물 | 10+/주 | Supabase posts 테이블 |
| Quiz Completion | 퀴즈 완료율 | 60%+ | quiz_completed 이벤트 |
| Share Rate | 공유 카드/프로필 생성 | 10%+ of dream | dream_shared 이벤트 |

### Health Metrics (서비스 건강)

| 지표 | 정의 | 임계값 | 대응 |
|------|------|--------|------|
| API Error Rate | Edge Function 오류율 | < 1% | 알림 + 자동 폴백 |
| LCP | 최대 콘텐츠 렌더 시간 | < 2.5s | 청크 분할 |
| Offline Fallback | 오프라인 해몽 성공률 | 100% | demoResult 확장 |
| Unhandled Rejection | 미처리 에러 비율 | 0 | 글로벌 핸들러 |

---

## Risk Register -- 리스크 레지스터

### R1. 정신건강 민감 콘텐츠 (Severity: Critical)

| 항목 | 내용 |
|------|------|
| **위험** | 해몽 결과가 사용자에게 불안/공포를 유발하거나, 진단으로 오해될 수 있음 |
| **영향** | 법적 리스크, 브랜드 신뢰 훼손, 사용자 피해 |
| **완화** | 탐색적 어조 강제, 위기 키워드 감지 -> 전문가 안내, 공포 마케팅 금지 원칙 |
| **모니터** | 해몽 프롬프트 정기 감사, 사용자 피드백 모니터링 |
| **상태** | 원칙 수립 완료, 프롬프트 감사 체계 미구축 |

### R2. 결제 시스템 미배포 (Severity: High)

| 항목 | 내용 |
|------|------|
| **위험** | 코드는 완성되었으나 Stripe/Toss 계정 미생성, Edge Function 미배포 |
| **영향** | 수익화 지연, BEP 도달 시점 밀림 |
| **완화** | 수작업 5건 우선 처리, 무결제 상태에서도 서비스 가동 가능 (제로 백엔드 레질리언스) |
| **모니터** | Phase 0 잔존 수작업 체크리스트 |
| **상태** | 코드 완성, 배포 대기 |

### R3. 단일 플랫폼 의존 (Severity: Medium)

| 항목 | 내용 |
|------|------|
| **위험** | GitHub Pages + Supabase 무료 티어에 전적으로 의존 |
| **영향** | 트래픽 증가 시 한계, Supabase 무료 제한 도달 |
| **완화** | 제로 백엔드 레질리언스 (오프라인 폴백), 데이터 내보내기 기능 |
| **모니터** | Supabase 사용량 대시보드, GitHub Pages bandwidth |
| **상태** | 폴백 구축 완료, 스케일링 계획 미수립 |

### R4. 개인정보 보호 (Severity: High)

| 항목 | 내용 |
|------|------|
| **위험** | 꿈 기록은 고도의 개인 심리 데이터. 유출 시 심각한 프라이버시 침해 |
| **영향** | 법적 제재, 사용자 이탈, 브랜드 파괴 |
| **완화** | Supabase RLS 적용, API 키 서버 은닉, CSP/XSS 방어 완료 |
| **모니터** | 보안 헤더 정기 점검, RLS 정책 감사 |
| **상태** | 기본 보안 완료, 침투 테스트 미실행 |

### R5. AI 해몽 품질 편차 (Severity: Medium)

| 항목 | 내용 |
|------|------|
| **위험** | GPT 응답의 품질이 불균일. 너무 일반적이거나 때로 부적절한 해석 |
| **영향** | 사용자 신뢰 하락, 리텐션 감소 |
| **완화** | 프롬프트 분기(lifeStage/감정), 응답 검증(validateDreamResult), 오프라인 데모 결과 |
| **모니터** | 해몽 만족도 피드백, dream_completed 이벤트 내 평점 |
| **상태** | 기본 검증 있음, 체계적 품질 평가 미구축 |

### R6. 경쟁 서비스 출현 (Severity: Low)

| 항목 | 내용 |
|------|------|
| **위험** | AI 해몽 앱의 진입 장벽이 낮아 경쟁자 출현 가능 |
| **영향** | 시장 점유율 분산 |
| **완화** | 달이 장기기억 + 패턴 분석 = 전환비용(switching cost) 창출, 커뮤니티 네트워크 효과 |
| **모니터** | 앱스토어/웹 경쟁 서비스 정기 스캔 |
| **상태** | 차별화 요소 설계 완료, 실행 중 |

---

## Cross-Project Synergy

| 소스 프로젝트 | 이식 가능 기술 | 적용 대상 Phase |
|-------------|--------------|----------------|
| NAEUM | 베이지안 예측, 마르코프 상태머신, PDCA 피드백 | Phase 2 (패턴 분석) |
| ONGLE | SEO 자동 생성, 콘텐츠 파이프라인, 트렌드 감지 | Phase 3 (SEO 확장) |
| WORKROOT | 음성 합성(TTS), 시뮬레이션 엔진 | Phase 1 (음성 입력) |
| ARKIS | 시계열 예측, 패턴 매칭 | Phase 2 (수면-꿈 상관분석) |

---

## Archive -- Phase 0 세부 이력

<details>
<summary>Phase 0-1: RPG Cleanup (Done)</summary>

- [x] Remove hidden cat-room tab block (display:none)
- [x] Replace MY tab stat cell with "총 해몽 횟수"
- [x] Delete RPG JS functions (levelUp, spawnCat, upgradeFacility, catRoom, etc.)
- [x] Delete RPG achievements
- [x] Delete RPG CSS classes
- [x] Replace fake subscription toast with "준비 중" modal
- [x] Unify free/paid boundary text
- [x] RPG asset deletion (74MB -> 1.9MB)
</details>

<details>
<summary>Phase 0-2: Security -- API Key Hiding (Done)</summary>

- [x] Supabase Edge Function /openai-proxy created
- [x] OPENAI_API_KEY moved to Supabase Vault
- [x] All client-side OpenAI calls replaced with Edge Function proxy
- [x] config.js contains only Supabase URL + anon key
- [x] XSS hardening: esc()/sanitize()/validateDreamResult()
- [x] CSP / X-Frame-Options / Referrer-Policy headers
</details>

<details>
<summary>Phase 0-3: Auth & User Identification (Done)</summary>

- [x] Supabase Auth integration (anonymous + social login ready)
- [x] Social login modal UI (Google / Apple / Kakao / Naver)
- [x] DB schema: users, dreams, usage_daily, dali_memory
- [x] localStorage -> Supabase migration logic
</details>

<details>
<summary>Phase 0-4: Free/Paid Gating (Done)</summary>

- [x] Dream usage daily limit logic (2/day free, unlimited pro)
- [x] Feature gating (detail, weekly report, repeat detection)
- [x] Paywall modal component
- [x] BM structure finalized
- [x] DB tables: user_entitlements, billing_transactions, billing_events
</details>

<details>
<summary>Phase 0-5: Modularization (Done)</summary>

- [x] Vite build pipeline configured
- [x] services/ separated (auth, api, storage, subscription, analytics)
- [x] utils/ separated (emotion, symbols, date)
- [x] components/ separated (paywall-modal, radar-chart, share-card, toast)
- [x] tabs/ separated (dream, dali, community, my)
- [x] Capacitor 8 iOS + Android build ready
</details>

<details>
<summary>Phase 0-6: Payment Integration (Done)</summary>

- [x] Supabase Edge Functions: create-checkout, stripe-webhook, billing x4
- [x] Stripe checkout flow
- [x] Ad system: banner + interstitial + rewarded
- [x] Referral sharing, web->app banner, smart upsell, timed promo
- [x] DB tables: referrals, funnel_events, ad_revenue
</details>

<details>
<summary>Phase 0-7: Analytics (Done)</summary>

- [x] 30+ granular events (dream, dali, report, paywall, checkout, login, ads, growth)
- [x] Supabase events table
- [x] GA4 dual logging
</details>

<details>
<summary>Phase 0-8: Community Archive (Done)</summary>

- [x] Tab renamed to "사례모음"
- [x] Symbol-based filter tabs (11종)
- [x] 25 curated dream cases
- [x] Sticker reactions, write functionality
- [x] Community bot daily post
</details>

<details>
<summary>Phase 0-9: Launch Readiness + Production Hardening (Done)</summary>

- [x] API resilience: retry with exponential backoff, 30s timeout
- [x] Vite build optimization: chunk split
- [x] Service Worker cache expanded
- [x] Fix analytics logEvent() silent rejection
- [x] Global unhandledrejection handler
- [x] Improved error toast UX
</details>

<details>
<summary>Phase 0-10: Cross-Project Engine Fusion (Done)</summary>

- [x] Dream pattern engine (Markov state machine from NAEUM)
- [x] 5-state emotion model + transition matrix
- [x] Recurring dream cluster detection
- [x] Dali insight panel + weekly report integration
</details>

<details>
<summary>Phase 0-11: Web-First + SEO (Done)</summary>

- [x] PWA install banner (replace app download)
- [x] AdSense-ready slot structure
- [x] 18 SEO dream pages + sitemap
- [x] GA4 + Web Push + analytics dual
- [x] Landing SEO + routing fix
- [x] Korean search optimization (Naver/Daum)
</details>

<details>
<summary>Phase 0-12: UX Polish (Done)</summary>

- [x] Dream pattern dashboard (emotion bars, prediction card, clusters)
- [x] Auto-save draft (debounced 500ms)
- [x] Dream profile image export (1080x1920 canvas)
- [x] Zero-backend resilience (9 offline demo results)
- [x] PC responsive layout (tablet/PC/wide 3-stage)
</details>

<details>
<summary>Phase 0-13: Korean Payment System (Code Done)</summary>

- [x] PG abstraction layer (payment.js)
- [x] Stripe card + Toss (Kakao/Naver/계좌이체)
- [x] Edge Functions: toss-checkout, toss-confirm, toss-webhook
- [x] Paywall v5 (feature-based + pro subscription)
- [x] canUseDream() daily limit (비로그인 1/로그인 2/프로 무제한)
- [x] 무의식 프로파일 상품 + MY탭 미니 프로파일
- [x] 요금제: 단건 1,900 / 5회팩 7,900 / 15회팩 19,900 / 프로 9,900/월
</details>

---

## Launch Strategy

**Web First, App Later** (2026-03-24 결정)
- 웹(GitHub Pages PWA)으로 먼저 런칭
- Stripe 웹결제로 수익화
- 웹 트래픽/수익 검증 후 앱스토어 배포 결정

---

*Last updated: 2026-04-08*
