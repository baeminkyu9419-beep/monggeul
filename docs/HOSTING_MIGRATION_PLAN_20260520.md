# MONGGEUL Hosting 이전 Plan — GitHub Pages 다운 해소 (2026-05-20)

**배경**: `https://baeminkyu9419-beep.github.io/monggeul/` HTTP 404. GitHub repo private 전환으로 GitHub Free 계정 Pages 비활성. 외부 사용자 접속 불가.

**민규 결정 영역 — 3 옵션**:

## §1 옵션 A — GitHub repo public 복귀 (가장 간단)
- 작업: GitHub Settings → Visibility → Public.
- 위험: Gen113 iter#9.5 보안 사고 후속 4 repo Private 박제 (MEMORY.md) 와 충돌. 보안 키/secrets git history 점검 선행 필수.
- 비용: $0.
- 소요: 1분 + secret git filter (필요 시 1~3시간).
- 즉시 효과: `/monggeul/` Pages 자동 복귀.

## §2 옵션 B — Cloudflare Pages 이전 (권장)
- 작업:
  1. Cloudflare 계정 (무료) 생성
  2. Cloudflare Pages → Connect to GitHub → baeminkyu9419-beep/monggeul (private OK)
  3. Build command: `npm run build` / Output: `dist`
  4. 도메인 = `monggeul.pages.dev` 자동 부여 또는 custom domain 연결
- 위험: GitHub OAuth 권한 부여. (key/secret 노출 없음, GitHub Action 트리거 방식)
- 비용: $0 (무료 100k 요청/일).
- 소요: ~10분.
- 효과: private repo + 안정 hosting + global CDN + auto deploy on push.

## §3 옵션 C — Vercel 이전 (대안)
- Cloudflare Pages 와 유사. Vite 자동 인식. `monggeul.vercel.app` 도메인.
- Cloudflare 와 차이: Vercel free 100GB 대역폭/월 (Cloudflare 무제한). 
- 권장도: B > C (대역폭 무제한 + Cloudflare Workers 통합 잠재).

## §4 자비스 사전 준비 완료 (본 세션)
- ✅ `npm run build` 작동 (2.20s, chunk warning 해소)
- ✅ `dist/` 산출물 4.5M / 115+ files
- ✅ vite manualChunks 12 chunk 분리
- ✅ 보안 sanitize 적용 (XSS critical 0)
- ✅ `base: '/monggeul/'` (vite.config.js) — Cloudflare Pages 이전 시 `base: '/'` 로 변경 필요

## §5 이전 시 vite.config.js 정정 권고 (Cloudflare 선택 시)

```javascript
// 현재:
base: '/monggeul/',

// Cloudflare Pages (monggeul.pages.dev) 이전 시:
base: '/',
```

GitHub Pages 복귀 시 = 변경 불요 (`/monggeul/` 유지).

## §5.1 index.html stale URL 4건 (본 세션 발견)

현재 `index.html` 모든 SEO/OG 메타가 **HTTP 404 stale URL** 노출:

| line | 항목 | 현재 값 |
|------|------|---------|
| L8 | `<link rel="canonical">` | `https://baeminkyu9419-beep.github.io/monggeul/` (404) |
| L11 | `<meta property="og:image">` | `https://baeminkyu9419-beep.github.io/monggeul/og-image.png` |
| L12 | `<meta property="og:url">` | `https://baeminkyu9419-beep.github.io/monggeul/` (404) |
| L18 | JSON-LD `url` | `https://baeminkyu9419-beep.github.io/monggeul/` (404) |

영향:
- 소셜 미디어 공유 카드 깨짐 (Facebook/Twitter OG)
- 구글 SEO 색인 시 canonical URL 404 → 색인 페널티 가능성
- 검색엔진에 stale URL 노출

### Hosting 결정 후 정정 (자비스 자율 가능)
- 옵션 A (GitHub repo public 복귀): URL 유지, 정정 불요
- 옵션 B (Cloudflare): 4건 모두 `https://monggeul.pages.dev/` 로 정정 (또는 custom domain)
- 옵션 C (Vercel): `https://monggeul.vercel.app/` 등
- 옵션 D (Netlify): 동

또는 **build-time 변수화**: `vite-plugin-html` + env `VITE_PUBLIC_URL` 으로 build 시 자동 치환 (큰 변경, 별도 plan).

`manifest.json` `start_url`/`scope` 도 동일 영역 (§5 와 함께 정정).

## §6 자비스 권고
- **옵션 B (Cloudflare Pages)** = 보안 + 비용 + 성능 균형 최선.
- private repo 유지하면서도 외부 사용자 접속 가능 = 결제 키 발급 + SKU 정정 결정 전까지 stage 환경으로 활용 가능.

## §7 후속 자율 작업 (민규 결정 후)
- 옵션 A: `base: '/monggeul/'` 유지, 즉시 작동.
- 옵션 B: `base: '/'` 정정 + Cloudflare Pages config + `_redirects` 파일 (SPA fallback) 신설.
- 옵션 C: 옵션 B 와 유사 + `vercel.json` config.

## 출처
- HTTP 404 실측 = 2026-05-20 본 세션 (PC Chrome + iPhone Safari).
- GitHub repo 404 실측 = 2026-05-20 본 세션.
- MEMORY.md Gen113 iter#9.5 "4 Public repo→Private" 박제.
