# FOLDER_MAP — 폴더별 역할

> 상태: ACTIVE(현재 동작) / LEGACY(구버전) / CONFIG / TEST / GENERATED(빌드산출) / UNKNOWN

## 폴더 경로: `src/`
- 역할: 프론트엔드 소스 전체(바닐라 JS). 진입점 `src/app.js`, 전역상태 `src/store.js`.
- 포함된 주요 파일: `app.js`(부팅·탭전환), `store.js`(전역상태), `tabs/`, `services/`, `components/`, `utils/`, `styles/`, `config/`
- 연결된 기능: 모든 화면·로직
- 현재 상태: ACTIVE
- 수정 위험도: HIGH
- Codex가 건드려도 되는지: 가능하나 Task별로 파일 1~2개로 좁혀서만
- 주의사항: 단일 index.html SPA. `index.html`의 onclick이 `window.*` 함수를 직접 호출하므로 export 함수명 변경 금지

## 폴더 경로: `src/tabs/`
- 역할: 4대 운영 화면. `dream.js`(해몽), `dali.js`(달이 chat), `my.js`(기록 log), `community.js`(커뮤니티)
- 연결된 기능: 핵심 사용자 기능 전부
- 현재 상태: ACTIVE
- 수정 위험도: HIGH
- 주의사항: `room.js` 부재(=`TABS`의 'room'은 미구현). `dream-demo.js`는 데모 폴백 엔진(고도화 금지)

## 폴더 경로: `src/services/`
- 역할: 비-UI 로직 모듈(API/인증/결제/구독/광고/분석/푸시/커뮤니티 저장)
- 포함된 주요 파일: `api.js`(LLM 프록시 호출), `subscription.js`(권한/게이트), `payment.js`/`pg-toss.js`/`pg-stripe.js`/`checkout.js`/`iap.js`(결제), `auth.js`, `ads.js`, `analytics.js`, `notification-scheduler.js`/`web-push.js`, `community-bot.js`/`community-storage.js`, `dream-context.js`/`dream-pattern.js`, `growth.js`/`ab-test.js`
- 현재 상태: ACTIVE
- 수정 위험도: HIGH (결제/권한)
- 주의사항: `community-bot.js`는 자동 봇 글 생성(가짜 데이터). 결제 모듈은 Edge Function과 짝

## 폴더 경로: `src/components/`
- 역할: 재사용 UI. `paywall.js`(결제 모달), `radar.js`(레이더 차트), `emotion-chart.js`, `toast.js`, `dream-export.js`(PDF/이미지), `sleep-checkin.js`, `symbol-tracker.js`
- 현재 상태: ACTIVE / 수정 위험도: MEDIUM

## 폴더 경로: `src/utils/`
- 역할: 순수 유틸·데이터. `symbols.js`/`dream-data.js`(상징 사전 데이터), `sanitize.js`(esc/sanitize/validateDreamResult), `dream-validator.js`(isNonsenseInput), `crisis.js`(위기감지), `emotion.js`, `dali-premium-prompts.js`
- 현재 상태: ACTIVE / 수정 위험도: MEDIUM
- 주의사항: `sanitize.js`는 모듈 로드시 `window.esc=` 전역 참조(브라우저 전제)

## 폴더 경로: `src/config/`
- 역할: CONFIG. 클라이언트 설정 상수
- 현재 상태: CONFIG / 수정 위험도: MEDIUM

## 폴더 경로: `supabase/`
- 역할: 백엔드. `functions/`(Edge Functions 12개, Deno/TS), `migrations/`(SQL 13개, 테이블+RLS), `config.toml`, `.temp/`(링크 잔재 — 삭제된 인스턴스 `mskwqlqpcsfvgvhhilma` 참조)
- 연결된 기능: LLM 해몽(`openai-proxy`), 결제(`toss-*`/`stripe-webhook`/`billing-*`/`create-checkout`), 푸시(`push-*`)
- 현재 상태: ACTIVE(코드) / 단 연결 인스턴스 삭제됨 → 런타임 미작동
- 수정 위험도: HIGH
- Codex가 건드려도 되는지: 코드 검토 OK. 배포/마이그레이션 적용은 owner(계정 필요)
- 주의사항: 프롬프트 IP가 `openai-proxy/prompts.ts`에 집중. 결제 서명검증 로직 보존

## 폴더 경로: `public/`
- 역할: 정적 자산(vite가 dist로 복사). `manifest.json`, `robots.txt`, `sitemap.xml`, `app-ads.txt`, 아이콘, `dreams/`(SEO 정적 페이지)
- 현재 상태: ACTIVE / 수정 위험도: LOW
- 주의사항: `config.js`는 여기 없음(gitignore). 빌드시 `scripts/gen-config.js`가 `dist/config.js` 생성

## 폴더 경로: `scripts/`
- 역할: 빌드/도구 스크립트. `generate-seo-pages.js`, `gen-config.js`(env→dist/config.js), `dev-proxy.mjs`(로컬 LLM 프록시·증명용), `llm_live_test.mjs`, `shoot.mjs`(목업 렌더), `engine_test.mjs`
- 현재 상태: ACTIVE(빌드) / `dev-proxy`·`shoot` 등은 개발/증명 도구
- 수정 위험도: LOW

## 폴더 경로: `android/`, `ios/`
- 역할: Capacitor 네이티브 래퍼
- 현재 상태: ACTIVE(빌드 준비) / 수정 위험도: MEDIUM (네이티브 빌드 시만)

## 폴더 경로: `tests/`
- 역할: TEST. pytest(파일 파싱 + node 서브프로세스). `test_engine_routing.py`, `test_demo_depth.py`, `test_edge_llm_routing.py`, `test_toss_routing.py`, `test_edge_checkout_routing.py`, `test_business_logic.py`, `test_project_structure.py`
- 현재 상태: TEST / 수정 위험도: LOW
- 검증: `python -m pytest tests/ -q` (237 PASS)

## 폴더 경로: `docs/`
- 역할: 문서. `marketing/copy.md`(이번 세션 카피), 호스팅/마이그레이션 메모 등
- 현재 상태: ACTIVE(문서) / 수정 위험도: LOW

## 주변/불명 폴더 (건드리기 전 확인 필요)
- `shared/` — **`C:/JARVIS_NEW/shared` 공유 자산 가능성**(sys.path/절대경로). 상태: UNKNOWN / 위험도: HIGH / Codex 건드리지 말 것
- `store/`, `bots/`, `contracts/`, `meta/`, `ops/`, `resources/`, `assets/`, `data/`, `screenshots/` — 메타/운영/산출물. 상태: UNKNOWN~LEGACY / 위험도: LOW / 제품 런타임과 무관 추정(확인 전 수정 금지)
- `dist/` — GENERATED(빌드 산출). 직접 수정 금지
- `_project_brief/` — 이번 분석 문서(본 폴더)
