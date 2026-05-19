# 몽글몽글 — 꿈 해몽 & 꿈 기록

[![PWA](https://img.shields.io/badge/PWA-ready-purple)]() [![Capacitor](https://img.shields.io/badge/Capacitor-8.x-blue)]() [![Vite](https://img.shields.io/badge/Vite-6.x-yellow)]() [![Supabase](https://img.shields.io/badge/Supabase-realtime-green)]()

꿈을 입력하면 달이(AI 꿈 동반자)가 길몽·흉몽·연애운·재물운을 분석해주는 PWA. 웹 + Android + iOS 하이브리드.

## 작동 (로컬, 즉시)

```bash
cd projects/MONGGEUL
npm install
npm run dev      # localhost:5173/monggeul/ (Vite dev, hot reload)
# 또는
npm run build && npm run preview   # localhost:4173/monggeul/ (production-like)
```

> **현재 외부 LIVE = 다운** (GitHub repo private 전환 후 GitHub Pages 비활성, 2026-05-20 실측 HTTP 404). hosting 이전 또는 repo public 복귀 결정 = `docs/HOSTING_MIGRATION_PLAN_20260520.md` 참조.

## 운영 4 TAB + 1 placeholder

| TAB | 파일 | 역할 |
|-----|------|------|
| 해몽 (dream) | `src/tabs/dream.js` | 꿈 입력 → 달이 해석 → 결과 카드 (gpt-4o + 정신건강 톤) |
| 달이 (chat=dali) | `src/tabs/dali.js` | 꿈 동반자 AI 대화 + DALL-E 3 이미지 |
| 기록 (log=my) | `src/tabs/my.js` + my-monthly-report / my-flow / my-dict / my-emotion-sleep | 꿈 일기 + 패턴 리포트 + 캘린더 + 사전 + 수면 체크인 |
| 커뮤니티 | `src/tabs/community.js` | Supabase Realtime 피드 + 봇 |
| room (placeholder) | (미구현) | `src/app.js:128` TABS 등록만 |

## 핵심 기능 작동 조건

| 기능 | 필요 |
|------|------|
| 데모 해몽 (9 키워드: 뱀/똥/돼지/물/귀신/하늘/이빨/떨어지/쫓기) | 없음, 즉시 작동 |
| 실 gpt-4o 해몽 | `config.js` 의 `OPENAI_API_KEY` (Supabase Vault + openai-proxy Edge Function 권장) |
| 꿈 일기 / XP / 별가루 / 출석 streak | localStorage, 즉시 작동 |
| 커뮤니티 / 결제 / push 알림 | **Supabase 인스턴스** + migrations 8 SQL deploy + 결제 키 |
| Android / iOS 네이티브 | `npm run cap:android` / `cap:ios` + 결제 키 발급 |

## 기술 스택

- **Frontend**: Vanilla JS (ES modules) + Vite 6 + Capacitor 8
- **Backend**: Supabase (Postgres + Realtime + Edge Functions, Deno)
- **AI**: OpenAI gpt-4o (해몽) + DALL-E 3 (꿈 이미지)
- **결제**: 토스페이먼츠 v2 (위젯) + Stripe + Apple IAP + Google IAP
- **광고**: AdMob (네이티브) + AdSense (웹)
- **빌드**: vite manualChunks 12 chunk 분리, tab-my 484 kB / tab-dream 57 kB

## 정신건강 경계 (CLAUDE.md 절대 규칙)

- 진단 단정 금지 ("우울증입니다" 등 절대 불가)
- 공포 마케팅 금지
- 탐색적 어조만 ("~일 수 있어요")
- 위기 감지 시 전문 상담 안내 우선
- 달이(AI)는 동반자, 치료사 아님

## 보안

- **XSS**: `src/utils/sanitize.js` esc/sanitize 적용, dream/dali/my/community 4 TAB critical 0 (2026-05-20 감사)
- **Edge Functions**: toss-payment-webhook HMAC-SHA256 + 상수 시간 비교, IAP receipt 검증 (JWT)
- **Secrets**: `config.js` (.gitignored), Supabase Vault 권장

## 출시 장벽 (2026-05-20 실측)

1. ⏸ **Supabase 인스턴스 paused** (ECONNREFUSED) — Dashboard 1 click unpause
2. ⏸ **GitHub repo private + Pages 비활성** — public 복귀 또는 Cloudflare/Vercel 이전 (`netlify.toml` / `vercel.json` / `public/_redirects` 사전 준비 완료)
3. ⏸ **OpenAI API key 부재** — `config.js` 입력 또는 Vault
4. ⏸ **결제 키**: AdSense pub-id / Google Play $25 / Apple p8 / Google service account JSON
5. ⏸ **SKU 가격 통일** — paywall.js ₩9,900 레거시 → 정본 ₩3,900

## 디렉토리 구조

```
projects/MONGGEUL/
├── src/
│   ├── tabs/      # dream / dali / my / community + 8 sub-module
│   ├── components/
│   ├── services/
│   └── utils/
├── supabase/
│   ├── migrations/   # 8 SQL = 20 tables
│   └── functions/    # 15 Edge Functions
├── android/ ios/     # Capacitor 네이티브 스캐폴딩
├── docs/             # 본 세션 감사 보고서 + plan
├── dist/             # 빌드 산출물 (gitignored)
├── vite.config.js    # manualChunks 12
├── vercel.json / netlify.toml / public/_redirects   # hosting fallback
└── CLAUDE.md / HANDOFF.md
```

## 라이선스

비공개 (private), 소유: 민규.
