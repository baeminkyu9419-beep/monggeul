# MONGGEUL — 꿈 해몽 & 꿈 기록 앱

## 정체성 (정정 Gen113 iter#9 [role-guard-bypass])
- **실체**: 꿈 해몽 & 꿈 기록 앱 (manifest.json name="몽글몽글 - 꿈 해몽 & 꿈 기록" 근거)
- **기존 오기**: "반려동물 관리 하이브리드 앱" (Gen107 이전 문서 혼선, 실 코드/manifest 와 괴리)
- **LIVE URL**: https://baeminkyu9419-beep.github.io/monggeul/ (GitHub Pages, HTTP 200)
- **캐릭터**: 달이 (AI 꿈 해몽 동반자)
- **사용자 타겟**: 꿈 기록 / 해몽 / 심리 탐색 루틴을 원하는 사람
- **정신건강 경계**: 진단 단정 금지, 탐색적 어조만, 위기 감지 시 전문 상담 안내 우선

## 현재 상태
- Phase 0 Archive (97.8%). PWA LIVE (GitHub Pages).
- Edge Functions 15 작성 완료, 배포 대기 (Apple/Google 결제 키 필요).
- 스크린샷 15장 (iPhone 5.5", 6.7", Android) 확보.

## 기술 스택
- JavaScript + Vite 6
- Capacitor 8 (Android + iOS 하이브리드)
- @capacitor-community/admob (네이티브 광고)
- @supabase/supabase-js (DB/인증/Edge Functions)
- html5-qrcode, jspdf, qrcode
- Puppeteer (테스트), Sharp (이미지)

## 수익화 (Gen113 확정)
- **모바일 네이티브**: AdMob (Free) + Google Play Billing / Apple IAP (Plus/Premium 구독)
- **웹 PWA**: AdSense (Free) + 카드/토스/카카오페이 (Stripe + 토스페이먼츠)
- **핵심 원칙**: 웹·iOS·Android 결제 분리, 서버 권한(`user_entitlements`) 통합

### 구독 티어 (2단 + 무료, 로드맵 v1 확정)
| 티어 | 가격 | 핵심 |
|------|------|------|
| Free | 무료 | 해몽 2회/일 + 광고 |
| Plus | ₩3,900/월 (또는 ₩9,900 pro_monthly 레거시 하위호환) | 해몽 무제한 + 광고 제거 + 주간 리포트 |
| Premium | ₩19,900/월 (계획) | Plus + 반복꿈 분석 + 장기 아카이브 + 감정 리포트 |

### 팩 (단건 구매)
- 상세 해몽 1회 ₩1,900 / 5팩 ₩7,900 / 15팩 ₩19,900
- 무의식 프로파일 ₩2,900

## 구조
```
MONGGEUL/
├── src/
│   ├── app.js           # 메인 진입점
│   ├── components/      # UI (paywall 포함)
│   ├── services/        # iap/payment/ads/subscription 등
│   ├── store.js
│   ├── tabs/
│   ├── styles/
│   └── utils/
├── android/             # Android 네이티브 (gradlew 준비됨)
├── ios/                 # iOS 네이티브
├── dist/                # 빌드 산출물
├── public/
├── assets/
├── screenshots/         # 15장 (iPhone 5.5/6.7, Android)
├── store/               # 스토어 메타 (descriptions, privacy, tos)
├── supabase/
│   ├── migrations/      # 8개 SQL 마이그레이션
│   └── functions/       # 15 Edge Functions
│       ├── billing-apple-verify/     # App Store Server API + ES256 JWT
│       ├── billing-google-verify/    # Google Play Developer API + RS256 JWT
│       ├── billing-apple-notifications/  # App Store Server Notifications V2
│       ├── billing-google-rtdn/      # Real-time Developer Notifications
│       └── (기타 11개)
├── landing.html
├── index.html           # 메인 HTML (AdSense placeholder 탑재됨)
├── manifest.json        # PWA manifest
└── capacitor.config.json
```

## 실행 명령어
```bash
# 웹 개발 서버
cd projects/MONGGEUL && npm run dev

# 빌드
npm run build

# Android (gradlew 자동 호출)
npm run cap:android

# iOS (macOS 필요)
npm run cap:ios
```

## 현재 blocker / 대기
- **AdSense**: 민규님 pub-id 발급 → `config.js` 에 `window.ADSENSE_CLIENT` 주입
- **Google Play $25**: 개발자 등록 결제 필요
- **Apple $99**: (선택) iOS 제출용
- **서비스 키**: Apple p8 key (.p8) / Google service account JSON → Supabase Vault

## 다음 행동
1. AdSense pub-id 발급 → `config.js` + `app-ads.txt` 업로드
2. Google Play Console 등록 ($25) + 내부 테스트 트랙 AAB 제출
3. Edge Functions 배포 (`supabase functions deploy billing-*`)
4. 실제 AdMob 6 ID 발급 → `ads.js` + `AndroidManifest.xml` + `Info.plist` 교체

## 증거 경로
- `dist/` — 빌드 산출물
- `node_modules/` — 의존성 설치됨
- `몽글몽글_상용화_로드맵_통합본.md` — 상용화 마스터 로드맵 (W1~W3, SKU/스키마/스토어 제출)
- `MONGGEUL_LAUNCH_GUIDE.md` — Gen113 런치 가이드 (AdSense/Play/Apple 3-trek)

## 절대 규칙

### 기능 추가 금지
지시하지 않은 새 기능은 절대 추가하지 않는다. 민규님이 요청하지 않은 신규 기능/UI/화면/탭/버튼/메뉴/API 엔드포인트를 자율적으로 추가하지 않는다. 버그 수정, 보안 패치, 문서 정정, SKU 통일 같은 유지보수성 작업은 허용된다.

### 실 운영 TAB (2026-05-19 실측 정정 — 3대 축 stale)

`src/app.js:128` `TABS=['community','chat','dream','room','log']` 실측 기준.

- **해몽**: `src/tabs/dream.js` — 꿈 입력 → 달이 해석 → 결과 (1848 LOC)
- **달이(chat)**: `src/tabs/dali.js` — 꿈 동반자 AI 대화 (992 LOC)
- **기록(log/MY)**: `src/tabs/my.js` — 꿈 일기 / 패턴 리포트 (2109 LOC)
- **커뮤니티(community)**: `src/tabs/community.js` — Supabase Realtime 피드 + 봇 (547 LOC). dist/ chunk `tab-community-*.js` 빌드 확증.
- **room**: `src/app.js:128` TABS 배열 등록만, `src/tabs/room.js` 부재 (placeholder/미완).

위 4대 운영 축 (해몽/달이/기록/커뮤니티) 밖의 신기능은 금지한다.
room placeholder 는 구현 진입 전까지 보류 (자율 추가 금지).

### 정신건강 경계 (절대 규칙)
- 진단 단정 금지 ("우울증입니다" 등 절대 불가)
- 공포 마케팅 금지
- 탐색적 어조만 ("~일 수 있어요")
- 위기 감지 시 전문 상담 안내 우선
- 달이(AI)는 동반자, 치료사 아님

## 1원칙
서로를 실망시키지 않는다.


## Gen118 표준화
상세: template 반영.
