# 몽글몽글 출시 체크리스트

> 독립 repo (C:/Dev/monggeul) 분리 완료 (2026-05-21). monorepo history 56 commits 보존.

## Phase A — 출시 (blocker 순)

### A1. Supabase 인스턴스 복구 [민규]
- [ ] Supabase Dashboard 로그인 → `mskwqlqpcsfvgvhhilma` 프로젝트 unpause (1 click, 무료)
- [ ] 또는 새 프로젝트 생성 → `supabase/migrations/` 8 SQL 재적용 → `config.js` URL/KEY 정정
- 현재: ECONNREFUSED (paused/삭제)
- 자비스 보조: unpause 후 `npx supabase db push` 또는 SQL Editor 수동 적용 가이드 / row count 검증

### A2. OpenAI 키 [민규]
- [ ] `config.js` `OPENAI_API_KEY = 'sk-...'` 입력
- [ ] 권장: Supabase Vault + `openai-proxy` Edge Function 경유 (클라이언트 노출 방지)
- 현재: 빈 문자열 → demoResult fallback (34 카테고리 + 196 EXTENDED_DICT)
- 자비스 보조: openai-proxy 배포 가이드 / 키 검증 스크립트

### A3. GitHub repo + hosting [민규 + 자비스]
- [ ] GitHub 새 repo 생성 (`monggeul`, public 권장 — Pages 무료)
- [ ] `git remote add origin <repo>` + `git push -u origin master`
- [ ] hosting 선택:
  - GitHub Pages: `base: '/monggeul/'` 유지
  - Cloudflare Pages: `base: '/'` 정정 + `_redirects` (이미 준비됨)
  - Vercel: `vercel.json` (이미 준비됨)
- 자비스 보조: base 정정 / SPA fallback (준비 완료) / deploy 가이드

### A4. SKU 가격 [민규 결정 → 자비스 정정]
- [ ] 민규 가격 확정 (정본 Plus ₩3,900 / Premium ₩19,900?)
- [ ] 승인 시 자비스가 `paywall.js` ₩9,900 레거시 → 정본 정정
- 현재: paywall ₩9,900 레거시 노출

### A5. 결제 키 [민규]
- [ ] AdSense pub-id 발급 → `config.js`
- [ ] Google Play $25 등록 + AAB 제출
- [ ] Apple p8 / Google service account JSON → Supabase Vault
- [ ] 토스 v1 deprecate 결정 (v2 단일화)

## 출시 후 (Phase 2 — 자비스 오케스트레이터)
- [ ] 6 프로젝트 독립 repo 분리 (MONGGEUL 패턴 적용)
- [ ] 자비스 Python 오케스트레이터 (read-only 상태 수집)
- [ ] reward-driven 우선순위 (프로젝트 성과 metric → 자비스 작업 결정)

## 자비스 자율 영역 (지금 가능, 민규 행동 무관)
- [x] 코드 분리 8 모듈 / 보안 9 라인 esc / 빌드 chunk 해소
- [x] dream 해석 34 카테고리 + 196 EXTENDED_DICT + 합성 + 동적 default
- [x] dali fallback 22 키워드
- [x] premium dev_unlock + 자동 detailFull
- [x] PWA sw.js v5 / hosting SPA fallback 3종
- [x] 독립 repo 분리 + build 검증

## 현재 작동 (로컬, 즉시)
- `cd C:/Dev/monggeul && npm run dev` → localhost:5173/monggeul/
- demoResult 34 카테고리 + localStorage 기반 모든 기능
