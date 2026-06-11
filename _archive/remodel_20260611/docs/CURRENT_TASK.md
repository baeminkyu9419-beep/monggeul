# MONGGEUL — Current Task

> 현재 진행 중인 작업. 세션 중 갱신.

## Status: 자비스 자율 영역 마스터 종결 / 민규 P0 8건 대기

본 세션 (2026-05-19~20) 24 commits 마라톤 결과. 상세 = `docs/SESSION_MASTER_REPORT_20260520.md`.

## 자비스 자율 영역 (종결 ✅)
- 코드 분리 8 모듈 (dream.js -348 LOC / my.js -799 LOC)
- 보안 정정 (XSS critical 0, esc() 9 라인)
- 빌드 chunk warning 해소 (tab-my 535→484 kB)
- Playwright E2E 실 동작 확증 (해몽 "뱀" → "🐍 재물이 온다")
- Hosting 사전 준비 (`_redirects` / `vercel.json` / `netlify.toml`)
- Edge Functions 15 정합성 분석 (toss v1/v2 마이그레이션 미완 발견)
- 자기 정정 5건 박제

## 민규 P0 8건 (출시 trigger 순)
1. **Supabase Dashboard unpause** (1 click, 무료) ← 진짜 LIVE 첫 trigger
2. **GitHub repo public 복귀 OR Cloudflare/Vercel/Netlify 이전** (사전 준비 완료, 1 command deploy)
3. **`config.js` OPENAI_API_KEY 입력** (또는 Supabase Vault + `openai-proxy` Edge Function 권장)
4. **SKU 가격 정정 승인** (paywall.js ₩9,900 레거시 → 정본 Plus ₩3,900)
5. **AdSense pub-id** 발급 (`config.js` 주입)
6. **Google Play $25** 개발자 등록 + AAB 제출
7. **Apple p8 / Google service account JSON** (IAP 운영)
8. **토스 v1 deprecate** 결정 (3327c170e 분석 기반)

## Hosting 이전 시 추가 정정 (자비스 자율 가능, 결정 후)
- `vite.config.js` `base: '/monggeul/'` → `base: '/'`
- `manifest.json` `start_url`/`scope` `/monggeul/` → `/`
- 기존 GitHub Pages 유지 시 = 정정 불요

## Blockers (현재 실측)
- Supabase 인스턴스 ECONNREFUSED (paused/삭제) — community/billing/push 의존 모두 실 동작 X
- GitHub repo `baeminkyu9419-beep/monggeul` HTTP 404 (private 전환 + GitHub Free Pages 비활성)
- OpenAI API key 부재 = demoResult fallback 만 작동 (9 키워드 매칭)

## 로컬 작동 (즉시 가능)
- `cd projects/MONGGEUL && npm run dev` → localhost:5173/monggeul/
- `cd projects/MONGGEUL && npm run preview` → localhost:4173/monggeul/ (production 산출물 미리보기)
- localStorage 기반 = 꿈 기록 / XP / 별가루 / 출석 / 4 TAB 라우팅 / 캘린더 / 사전 / Flow / 감정 / 수면 모두 작동

## 다음 자비스 자율 후보 (LOW 우선순위)
- addEventListener 마이그레이션 (107 inline onclick)
- vitest 단위 테스트 인프라 도입 (CLAUDE.md "기능 추가 금지" 범위 = 민규 결정)
- community 탭 Supabase fallback graceful degradation 강화
