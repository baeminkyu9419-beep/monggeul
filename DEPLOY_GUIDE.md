# MONGGEUL 배포 가이드

## 1. 사전 준비

### 1-1. config.js 설정
```bash
# config.js가 이미 생성되어 있음 (placeholder 상태)
# 아래 값을 실제 키로 교체하세요:
#   - SUPABASE_URL
#   - SUPABASE_ANON_KEY
#   - OPENAI_API_KEY (Edge Function 환경변수 권장)
```

### 1-2. Supabase CLI 설치
```bash
npm install -g supabase
supabase login
```

### 1-3. Supabase 프로젝트 연결
```bash
cd C:\JARVIS_NEW\projects\MONGGEUL
supabase link --project-ref <YOUR_PROJECT_REF>
```

---

## 2. DB 마이그레이션 실행

### 2-1. 상품 카탈로그 정합 마이그레이션
기존 상품 데이터와 payment.js PRODUCT_CATALOG 사이에 불일치가 있었음.
`20260407_reconcile_products.sql` 마이그레이션이 CLAUDE.md 기준으로 통일함.

```bash
# 마이그레이션 전체 적용 (원격 DB)
supabase db push
```

적용 후 products 테이블에 아래 5개 상품이 존재해야 함:

| id | name | type | price | count |
|----|------|------|-------|-------|
| pack_1 | 상세 해몽 1회 | pack | 1900 | 1 |
| pack_5 | 상세 해몽 5회 팩 | pack | 7900 | 5 |
| pack_15 | 상세 해몽 15회 팩 | pack | 19900 | 15 |
| unconscious_profile | 무의식 프로파일 | one_time | 2900 | - |
| pro_monthly | 프로 월간 구독 | subscription | 9900 | - |

검증 쿼리 (Supabase SQL Editor에서 실행):
```sql
select id, name, type, price, count, is_active from products where is_active = true order by price;
```

---

## 3. Edge Functions 배포

### 함수 목록 (10개)
| 함수 | 설명 | index.ts |
|------|------|----------|
| billing-apple-notifications | Apple 결제 알림 수신 | OK |
| billing-apple-verify | Apple 영수증 검증 | OK |
| billing-google-rtdn | Google RTDN 알림 | OK |
| billing-google-verify | Google 영수증 검증 | OK |
| create-checkout | 결제 세션 생성 | OK |
| openai-proxy | OpenAI API 프록시 | OK |
| stripe-webhook | Stripe 웹훅 | OK |
| toss-checkout | 토스 결제 생성 | OK |
| toss-confirm | 토스 결제 확인 | OK |
| toss-webhook | 토스 웹훅 (HMAC-SHA256 서명 검증 포함) | OK |

### 토스 결제 함수만 배포 (최소)
```bash
supabase functions deploy toss-checkout --no-verify-jwt
supabase functions deploy toss-confirm --no-verify-jwt
supabase functions deploy toss-webhook --no-verify-jwt
```

> `--no-verify-jwt`: toss-webhook은 토스 서버에서 호출하므로 JWT 검증을 Edge Function 레벨에서 건너뜀.
> toss-checkout/toss-confirm은 코드 내부에서 Authorization 헤더로 인증 처리함.

### 전체 일괄 배포
```bash
supabase functions deploy
```

### Edge Function 환경변수 설정

Supabase Dashboard > Project Settings > Edge Functions > Environment Variables:

```
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
TOSS_SECRET_KEY=test_sk_... (테스트) 또는 live_sk_... (운영)
TOSS_WEBHOOK_SECRET=whsec_... (토스 개발자센터 > 웹훅 > 시크릿 키)
APPLE_SHARED_SECRET=...
GOOGLE_SERVICE_ACCOUNT_KEY=...
```

**토스 키 발급 절차:**
1. https://developers.tosspayments.com 접속
2. 내 개발정보 > API 키 확인
3. 시크릿 키를 `TOSS_SECRET_KEY`에 입력
4. 웹훅 설정 > 웹훅 URL: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/toss-webhook`
5. 웹훅 시크릿 키를 `TOSS_WEBHOOK_SECRET`에 입력

---

## 4. 토스 웹훅 등록

토스 개발자센터에서 웹훅 URL을 등록해야 결제 상태 변경(취소/환불) 알림을 받을 수 있음.

1. https://developers.tosspayments.com > 내 개발정보 > 웹훅
2. 엔드포인트 URL:
   ```
   https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/toss-webhook
   ```
3. 이벤트 선택: `PAYMENT_STATUS_CHANGED`, `BILLING_PAYMENT_DONE`
4. 시크릿 키 복사 → Supabase 환경변수 `TOSS_WEBHOOK_SECRET`에 저장

---

## 5. 토스 테스트 결제 검증

배포 후 테스트 모드(test_ 키)에서 결제 플로우 전체를 검증.

```bash
# 1. Edge Functions 로컬 실행 (선택 -- 원격 테스트도 가능)
supabase functions serve

# 2. 브라우저에서 앱 열기
npm run preview

# 3. 테스트 시나리오
# - 카카오페이로 상세 해몽 1회(1,900원) 결제 시작
# - 토스 테스트 결제 페이지에서 결제 완료
# - 리턴 URL로 돌아와 "결제가 완료됐어요!" 토스트 확인
# - Supabase > payments 테이블에 status='confirmed' 레코드 확인
# - Supabase > entitlements 테이블에 remaining=1 레코드 확인
```

---

## 6. 운영 전환 체크리스트

테스트 완료 후 운영 키로 전환:

- [ ] 토스 개발자센터에서 라이브 키 발급
- [ ] `TOSS_SECRET_KEY`를 `live_sk_...`로 교체
- [ ] 웹훅 URL을 운영 환경으로 변경
- [ ] `TOSS_WEBHOOK_SECRET`을 운영 시크릿으로 교체
- [ ] 테스트 결제 1건 실행 후 취소

---

## 7. PWA 빌드 및 배포

### 빌드
```bash
cd C:\JARVIS_NEW\projects\MONGGEUL
npm install
npm run build
```

빌드 산출물: `dist/` 디렉토리

### 배포 옵션

**GitHub Pages**
```bash
# gh-pages 브랜치에 dist/ 푸시
git subtree push --prefix dist origin gh-pages
```

**Vercel / Netlify**
- 빌드 커맨드: `npm run build`
- 출력 디렉토리: `dist`

---

## 8. 모바일 빌드 (Capacitor)

```bash
# Android
npm run cap:android

# iOS
npm run cap:ios

# sync만 (빌드 + 네이티브 동기화)
npm run cap:sync
```

---

## 9. 배포 전 최종 체크리스트

- [ ] config.js에 실제 Supabase URL/Key 입력
- [ ] `supabase db push` 마이그레이션 적용 완료
- [ ] products 테이블 5개 상품 가격/ID 확인 (위 검증 쿼리)
- [ ] Supabase Dashboard에서 Edge Function 환경변수 설정
- [ ] `TOSS_SECRET_KEY` 설정 완료
- [ ] `TOSS_WEBHOOK_SECRET` 설정 완료
- [ ] 토스 웹훅 URL 등록 완료
- [ ] `npm run build` 에러 없이 완료
- [ ] dist/index.html 로컬 테스트 (`npm run preview`)
- [ ] Edge Functions 개별 테스트 (`supabase functions serve`)
- [ ] 토스 테스트 결제 성공 확인
- [ ] Google OAuth redirect URL 설정 (Supabase Auth)
- [ ] CORS 설정 확인
