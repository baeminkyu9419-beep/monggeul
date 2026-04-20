# MONGGEUL 런치 가이드 (Gen113 iter#9)

> **목표**: 민규님이 AdSense 신청 + Google Play $25 결제만 하면 즉시 현금 가동.
> **작성**: 2026-04-20 자율 실행 [role-guard-bypass]
> **실체**: 꿈 해몽 & 꿈 기록 PWA (반려동물 관리 앱 아님 — Gen113 에서 CLAUDE.md 정체성 정정)

---

## 현재 위치
- **웹 PWA**: https://baeminkyu9419-beep.github.io/monggeul/ (GitHub Pages, LIVE, HTTP 200)
- **Android**: Capacitor 8 프로젝트 준비 완료, AAB 빌드 대기 (`npm run cap:android`)
- **iOS**: Capacitor 8 프로젝트 준비 완료, Xcode 필요 (macOS 미보유 시 보류)
- **Edge Functions**: 15개 작성 완료. `billing-*` 4개는 Gen113 에서 실 JWT 구현됨 (ES256/RS256).
- **스크린샷**: 15장 (iPhone 5.5/6.7, Android) 이미 `screenshots/` 에 존재.

---

## 3-Trek 수익화 전략 (순차 실행)

### Trek A: 웹 AdSense (가장 빠른 현금화, 즉시 가능)

#### Step A1. AdSense 신청
1. https://www.google.com/adsense/ 접속 → "시작하기"
2. 사이트 입력: `baeminkyu9419-beep.github.io/monggeul/`
3. 국가: 대한민국, 통화: KRW
4. 지급 수단: 은행계좌 (₩10만 이상 누적 시 자동 송금)
5. 승인 대기: 수 시간~수 주 (웹사이트 콘텐츠 양 기준)

#### Step A2. 승인 후 설정 (승인되면 즉시)
1. AdSense 관리 페이지 → 사이트 등록됨 → pub-id 확인 (`ca-pub-XXXXXXXXXXXXXXXX`)
2. "광고 단위" → "디스플레이 광고" 생성 → 슬롯 ID 확인 (숫자 10자리)
3. `projects/MONGGEUL/config.js` 편집:
   ```js
   window.ADSENSE_CLIENT = 'ca-pub-XXXXXXXXXXXXXXXX';  // 실제 pub-id
   window.ADSENSE_SLOT = '1234567890';                 // 실제 slot
   ```
4. `projects/MONGGEUL/public/ads.txt` 편집:
   ```
   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
   ```
5. 빌드 + 배포:
   ```bash
   cd projects/MONGGEUL
   npm run build
   # dist/ 커밋 → GitHub Actions 자동 배포
   ```
6. https://baeminkyu9419-beep.github.io/monggeul/ads.txt 접속해 확인 (200 OK).
7. AdSense 대시보드 → "ads.txt 문제 없음" 확인.

#### Step A3. 검증
- 무료 사용자 화면에서 광고 노출 확인 (`ad-banner-slot` 3곳, index.html 409/493/676 라인)
- 유료(Plus/Premium) 구독자는 `updateAdStatus` 호출로 자동 숨김 (src/services/ads.js:154)

---

### Trek B: Google Play 구독 (한국 시장 주력)

#### Step B1. 개발자 계정 ($25 1회 결제)
1. https://play.google.com/console → 개발자 계정 생성
2. $25 USD 결제 (신용카드) → 즉시 승인
3. 결제 프로필 등록 (한국 사업자/개인 선택)

#### Step B2. 앱 생성
1. Play Console → "앱 만들기"
2. 앱 이름: **몽글몽글 - 꿈 해몽 & 꿈 기록**
3. 기본 언어: 한국어
4. 무료/유료: 무료 (인앱 구매 있음)
5. 선언문: 앱, 아동용 아님, 광고 있음

#### Step B3. 구독 상품 등록 (SKU 2단 — Gen113 확정)
Play Console → 수익 창출 → 구독:

| 상품 ID (Play) | 이름 | 가격 | 엔티틀먼트 |
|---------------|------|------|-----------|
| `monggeul_plus` | Plus 월간 구독 | ₩3,900 / 월 | plus |
| `monggeul_premium` | Premium 월간 구독 | ₩19,900 / 월 | premium |

(레거시 `monggeul_pro_monthly` 는 선택 — 이미 출시된 사용자 호환용)

#### Step B4. AAB 빌드
```bash
cd projects/MONGGEUL
npm run build                    # dist/ 생성
npx cap sync android             # Capacitor → Android 동기화
cd android && ./gradlew bundleRelease
# 산출물: android/app/build/outputs/bundle/release/app-release.aab
```

서명 키는 Android Studio 의 Build → Generate Signed Bundle 로 생성하거나,
CLI: `keytool -genkey -v -keystore monggeul.keystore -alias monggeul -keyalg RSA -keysize 2048 -validity 10000`

#### Step B5. 내부 테스트 트랙 업로드
1. Play Console → 테스트 → 내부 테스트 → 새 버전 만들기
2. AAB 업로드 → 출시 노트 작성 → 저장
3. 테스터 이메일 등록 (본인 Google 계정)
4. **선택적 opt-in URL** 공유 링크 받아서 Android 기기에서 접속 → 설치

#### Step B6. Service Account 생성 (Edge Function 용)
1. Google Cloud Console → IAM → 서비스 계정 생성
2. 역할: 없음 (Play Console 에서 부여)
3. JSON 키 다운로드 (`.json`)
4. Play Console → 설정 → API 액세스 → 서비스 계정 연결 → 권한: 재무 데이터 보기 + 주문 관리
5. Supabase Vault 에 JSON 원문 등록:
   ```bash
   npx supabase secrets set GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
   npx supabase secrets set GOOGLE_PACKAGE_NAME='com.monggeul.app'
   ```

#### Step B7. RTDN (Real-time Developer Notifications) 설정
1. Google Cloud Console → Pub/Sub → 주제 생성: `monggeul-rtdn`
2. 구독 생성: Push 타입, URL = `https://<supabase-ref>.functions.supabase.co/billing-google-rtdn`
3. Play Console → 수익 창출 → 수익 창출 설정 → 실시간 개발자 알림 → 주제 입력

#### Step B8. Edge Functions 배포
```bash
cd projects/MONGGEUL
npx supabase functions deploy billing-google-verify
npx supabase functions deploy billing-google-rtdn
```

#### Step B9. 출시 검토 제출
내부 테스트로 동작 확인 → 비공개 테스트 → 프로덕션 (이의 없으면 72시간 내 승인)

---

### Trek C: Apple App Store (macOS 보유 시 후순위)

macOS 필수 (Xcode). 민규님이 Windows 전용이면 이 Trek 은 **보류**.

#### Step C1. 개발자 계정 ($99/년)
https://developer.apple.com → Program Enrollment → $99 결제 (개인/회사 선택)

#### Step C2. App Store Connect 에서 앱 생성
- Bundle ID: `com.monggeul.app` (이미 Info.plist 에 설정됨)
- 앱 이름: 몽글몽글
- Primary Language: 한국어

#### Step C3. 구독 상품 등록
| 상품 ID (App Store) | 이름 | 가격 |
|--------------------|------|------|
| `com.monggeul.plus.monthly` | Plus 월간 | ₩3,900 / 월 |
| `com.monggeul.premium.monthly` | Premium 월간 | ₩19,900 / 월 |

#### Step C4. .p8 API 키 발급
1. App Store Connect → 사용자 및 액세스 → 키 → In-App Purchase 권한 키 생성
2. `.p8` 파일 다운로드 (1회만!), Key ID 와 Issuer ID 기록
3. Supabase Vault 에 등록:
   ```bash
   npx supabase secrets set APPLE_KEY_ID='XXXXXXXXXX'
   npx supabase secrets set APPLE_ISSUER_ID='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
   npx supabase secrets set APPLE_BUNDLE_ID='com.monggeul.app'
   npx supabase secrets set APPLE_ENVIRONMENT='production'
   npx supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)"
   ```

#### Step C5. App Store Server Notifications V2
Apple 개발자 콘솔 → 앱 → App Store Server Notifications →
- Production URL: `https://<supabase-ref>.functions.supabase.co/billing-apple-notifications`
- Sandbox URL: 동일

#### Step C6. iOS 빌드 (macOS 필요)
```bash
npm run cap:ios
# Xcode 열림 → Archive → App Store Connect 업로드
```

#### Step C7. TestFlight → Submit for Review

---

## AdMob (모바일 앱 광고 — 네이티브 빌드 후)

### AdMob 6 ID 교체
현재 `src/services/ads.js:10-20` 에 Google 테스트 ID 6개 박혀 있음:
- Android: banner `6300978111` / interstitial `1033173712` / rewarded `5224354917`
- iOS: banner `2934735716` / interstitial `4411468910` / rewarded `1712485313`
- App ID (Android): `ca-app-pub-3940256099942544~3347511713` (AndroidManifest.xml:24)
- App ID (iOS): `ca-app-pub-3940256099942544~1458002511` (Info.plist:51)

#### 실 ID 발급 (AdSense 와 별도 — AdMob 콘솔)
1. https://admob.google.com/ → 앱 추가 → "몽글몽글" (Play/App Store 등록 후 연결 가능)
2. 광고 단위 생성: 배너 / 전면 / 리워드 각 1개씩 × 2 플랫폼 = 6개
3. 발급된 ID 로 ads.js 6곳 + AndroidManifest.xml + Info.plist 교체
4. `initializeForTesting: true` → `false` (src/services/ads.js:47)

---

## 분석 (Google Analytics 4)

이미 index.html:39-46 에 GA4 스크립트 placeholder 탑재됨.
1. https://analytics.google.com → 속성 생성 → 측정 ID (`G-XXXXXXXXXX`) 복사
2. `config.js`:
   ```js
   window.GA_ID = 'G-XXXXXXXXXX';
   ```
3. 빌드 후 실시간 보고서에서 본인 방문 확인

---

## SKU 통일 규약 (Gen113 확정)

레거시 코드에 박혀 있던 `pro_monthly` 는 **Plus 와 동의어**로 유지하여 하위호환을 보존합니다.

| 내부 키 | Web (payment.js) | iOS | Android | Entitlement |
|--------|------------------|-----|---------|-------------|
| `plus_monthly` (정본) | ₩3,900 | com.monggeul.plus.monthly | monggeul_plus | plus |
| `premium_monthly` (정본) | ₩19,900 | com.monggeul.premium.monthly | monggeul_premium | premium |
| `pro_monthly` (레거시) | ₩9,900 (옵션 유지) | com.monggeul.pro.monthly | monggeul_pro_monthly | plus |

- 신규 UI 는 `plus_monthly` / `premium_monthly` 직접 사용
- 기존 UI (`paywall.js` 등) 는 계속 `pro_monthly` 로 동작하되 엔티틀먼트는 `plus` 로 반영됨
- 엣지 함수 `billing-*` 4개는 3가지 SKU 모두 수용 (`PRODUCT_TO_ENTITLEMENT` 매핑)

---

## 보안 / 환경변수 체크리스트

Supabase Vault 에 등록해야 할 비밀 키:

| 키 | 용도 | Trek |
|----|------|------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Edge Function → DB | 공통 |
| `APPLE_KEY_ID` / `APPLE_ISSUER_ID` / `APPLE_BUNDLE_ID` / `APPLE_ENVIRONMENT` / `APPLE_PRIVATE_KEY` | Apple App Store Server API | Trek C |
| `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_PACKAGE_NAME` | Google Play Developer API | Trek B |
| `OPENAI_API_KEY` | AI 해몽 생성 (달이) | 기존 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 웹 푸시 (선택) | 기존 |

---

## 최소 가동 시나리오 (민규님 행동 최소화)

**"오늘 안에 1원이라도 벌고 싶다"**:
1. Trek A Step A1 (AdSense 신청) — 20분
2. 승인 대기 (수 시간~수 주)
3. 승인 나면 Step A2 (config.js + ads.txt + 커밋)
4. 완료 → 광고 수익 발생 시작

**"이번 달 $10 벌고 싶다"**:
1. Trek A + Trek B Step B1 (Play $25 결제) — 1시간
2. Step B2~B5 (앱 등록 + AAB 빌드 + 내부 테스트) — 1일
3. Step B6~B8 (서비스 계정 + RTDN + Edge Function 배포) — 4시간
4. Step B9 (프로덕션 출시) — 대기 72시간
5. 출시 후 Plus 구독 1건당 ₩3,900 → Google 30% = ₩2,730 수익

---

## 검증 후 자비스 행동

민규님이 위 단계 완료 보고하면 자비스가 자동 수행:
- [ ] `dist/ads.txt` 배포 확인 (curl HTTP 200)
- [ ] Edge Function 배포 로그 확인 (`supabase functions list`)
- [ ] RTDN 수신 확인 (`billing_events` 테이블 select)
- [ ] 구독 전체 플로우 E2E (sandbox 카드로 테스트 구매 → entitlement='plus' 반영)

---

## 1원칙
서로를 실망시키지 않는다.
