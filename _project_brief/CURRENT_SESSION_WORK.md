# CURRENT_SESSION_WORK — 현재 세션에서 한 작업

## 이번 세션의 흐름(원래 목표 변화)
1. 시작: "여기가 `C:\Dev\monggeul`인가, `C:\JARVIS_NEW`와 뭐가 다른가" 질문 → 독립 repo 설명 + Stop hook 에러 수정.
2. "출시 마무리" → 30 에이전트 출시감사 워크플로 시도(동시 2개 워크플로로 **서버 레이트리밋** 유발해 실패) → 인라인 감사로 전환.
3. 결제매력도 분석 워크플로(0/4 페르소나 결제) → 근본원인 = 백엔드 죽어 데모 모드.
4. "엔진이 의도를 잘 파악하느냐" → 실제 Mistral로 프롬프트 실측 → 의도추론 강화.
5. "LLM/폴백 분리" 스펙 → engine 태깅 구현 + **로컬 프록시로 `engine:'llm'` end-to-end 증명**.
6. UX/UI 디자인(달이 캐릭터 디자인 시스템, 랜딩 목업).
7. 현재: **코딩 중단, 분석 문서화**(이 문서 묶음).

## 실제로 수정/검토한 파일 (제품 코드)
- `src/services/api.js` — 폴백 사유 태깅(`_fbErr`), `window.SUPABASE_URL` 추측 제거, HTTP 상태별 사유
- `src/tabs/dream.js` — LLM 성공 `engine:'llm'` 태깅, 폴백 사유 전달, 결과 화면 핵심 한줄/엔진 배지, mg_streak 자동증가
- `src/tabs/dream-demo.js` — `demoResult`에 `engine:'fallback_dictionary'` 태깅 + 격리 주석, '전남친' 이별 오매칭 수정
- `src/tabs/dali.js` — 해몽 카드 렌더 깨짐/잠복 XSS 수정, 위기 안전망 주입
- `src/tabs/my.js` — `reportAiText` raw innerHTML → `sanitize`
- `src/utils/crisis.js` (신규) — 위기 신호 정밀 감지 + 전문상담 안내
- `src/utils/symbols.js` — "불안장애와 연관" → 탐색적 어조
- `src/components/paywall.js` — 가격 `pro_monthly`(9900) 단일 → Plus 3900 + Premium 19900 2단
- `index.html`, `src/styles/main.css` — 위기 footer/CSS, 핵심 한줄·엔진 배지, manifest 상대경로, 날조 소셜프루프 제거, lock-teaser
- `manifest.json`/`public/manifest.json` — `/monggeul/` → 상대경로
- `package.json`, `render.yaml`, `scripts/gen-config.js`(신규) — 빌드시 `dist/config.js` 생성(404 방지)
- `supabase/functions/openai-proxy/prompts.ts` — 의도추론 규칙(성별/관계 보존·감정 grounding·few-shot·출력형식)
- `supabase/functions/openai-proxy/index.ts` — 모델 `mistral-small-latest` → `mistral-large-latest`
- `supabase/functions/stripe-webhook/index.ts` — 상수시간 비교 + replay 허용오차
- `supabase/migrations/20260408_drop_legacy_permissive.sql`(신규) — 커뮤니티 IDOR 수정 SQL
- `tests/test_engine_routing.py`(신규), `tests/test_demo_depth.py` — 엔진 라우팅 계약 테스트

## 완료된 작업 (빌드·테스트 통과, 커밋됨)
- LLM 경로 vs 데모 폴백 **명시 분리**(engine/isFallback/fallbackReason + UI 배지)
- 보안: 커뮤니티 IDOR 수정 SQL, stripe 하드닝, dali XSS, 번들 시크릿 0 확인
- 정신건강: 위기 안전망, 진단표현 완화
- 정직성: 날조 소셜프루프 전수 제거
- 의도추론 프롬프트 강화 + **Mistral 실측 검증**(2케이스 PASS)
- config 배포 404 차단(gen-config), manifest 경로, paywall 가격 정합, mg_streak
- 디자인: 달이 캐릭터 디자인 시스템 + 랜딩/결과 목업(`landing-full.html` 등, **목업 파일이며 라이브 앱 미적용**)

## 중간에 멈춘 / 미검증 작업
- **실 LLM 해몽 라이브 작동**: 로컬 프록시(`scripts/dev-proxy.mjs`)로만 `engine:'llm'` 증명. **프로덕션 미작동**(백엔드 부재).
- **IDOR 수정 마이그레이션**: 파일만 작성. **Supabase 라이브에 미적용·미검증**(인스턴스 삭제로 불가).
- **디자인 목업의 실제 앱 적용**: 목업(`landing-full.html`, `design-preview.html`)만. 라이브 `landing.html`/4탭 미반영.

## Claude가 하려던 다음 작업
- 디자인 목업을 실제 랜딩/앱에 적용(A안: `landing.html` 교체 / B안: 4탭 디자인 시스템 확장) — **사용자 사인 대기 중이었음.**

## 지금 끊기면 위험한 지점 / 오해 금지 맥락
- **"디자인이 완성됐다"고 오해 금지.** `landing-full.html` 등은 **독립 목업 파일**이고, 실제 앱(`index.html`/`src/tabs`)에는 미적용.
- **"LLM 해몽이 작동한다"고 오해 금지.** 로컬 프록시 증명일 뿐, 프로덕션은 데모 폴백.
- **"IDOR가 고쳐졌다"고 오해 금지.** SQL 파일만 있고 라이브 미적용.
- 미커밋 변경은 `git_status.txt`/`uncommitted_diff.patch` 참조.
