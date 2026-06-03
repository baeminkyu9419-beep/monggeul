# MONGGEUL Edge Functions 정합성 감사 (2026-05-20)

**plan**: closing plan `ec15dbb04` Task 3.
**핵심 발견**: toss-* 6개 = **v1 (legacy) + v2 (신규) 병존 패턴** (중복 아닌 버전 분기).

> **2026-06-03 정리 완료 (dedup)**: 클라이언트 source 전수 grep 결과 — `src/services/pg-toss.js` → `toss-checkout`, `src/services/payment.js` → `toss-confirm` 만 호출.
> v2 (`toss-payment-ready/confirm/webhook`) 는 **source/html/config 어디에서도 호출 없음 = dead code**. 따라서:
> 1. v2 의 schema-backed 우월 로직(구독 confirm 시 `users.subscription_tier` 갱신 · 취소 시 tier 초기화 · 빌링 갱신 시 `subscription_renewed` 이벤트)을 **v1 3개로 병합**.
> 2. v2 3개 함수 **삭제**. (단 v2 webhook 의 `BILLING_KEY_ISSUED` 핸들러는 `billing_keys` 테이블이 마이그레이션에 부재 → 병합 제외.)
> 3. 회귀 단위테스트 `tests/test_toss_routing.py` 추가 (라우팅 + dedup 불변식 + 뮤테이션 민감도).
> **결과: toss-* 6 → 3 (단일 결제 라우팅).** 본 §5 권고가 실행됨. 아래 §3·§5·§6 의 일부 옛 판정은 정정됨(§정정 참조).

## §정정 (2026-06-03)
- (§3·§36) "v1 webhook HMAC 본문 미확인" → 실측: v1 `toss-webhook` 도 **동일 상수시간 HMAC-SHA256 비교 보유**. v2 가 보안상 우월하다는 판정은 webhook 에 한해 **오류**.
- (§5·§62) "v1 toss-checkout 가격 서버 검증 부재" → 실측: v1 `toss-checkout` 은 `products` 테이블에서 **서버사이드 정본 가격 조회**(L66-80) = v2 의 하드코딩 `PRODUCT_PRICE_MAP` 보다 오히려 견고. 가격 조작 위험 판정은 **오류**.
- 결론 정정: v2 가 진정 우월한 부분은 confirm/webhook 의 `users` tier 동기화 + `subscription_renewed` 이벤트뿐 → 이것만 v1 으로 병합하고 v2 삭제.

## §1 전수 매핑 (15개)

| Function | 책임 | Group |
|----------|------|-------|
| billing-apple-verify | App Store Server API + ES256 JWT 영수증 검증 | Apple IAP |
| billing-apple-notifications | App Store Server Notifications V2 수신 | Apple IAP |
| billing-google-verify | Google Play Developer API + RS256 JWT 영수증 검증 | Google IAP |
| billing-google-rtdn | Real-time Developer Notifications 수신 | Google IAP |
| create-checkout | (스토어 외) 일반 checkout 진입 | Web |
| stripe-webhook | Stripe webhook 수신 | Web (Stripe) |
| openai-proxy | OpenAI API 프록시 (클라이언트 키 노출 방지) | AI |
| push-scheduler | 알림 발송 스케줄러 | Push |
| push-subscribe | 푸시 구독 등록 | Push |
| **toss-checkout** | 토스 결제 준비 (**v1**) | Toss v1 |
| **toss-confirm** | 토스 결제 승인 (**v1**) | Toss v1 |
| **toss-webhook** | 토스 webhook 수신 (**v1**) | Toss v1 |
| **toss-payment-ready** | 토스 결제 준비 (**v2 위젯**) — orderId + amount 서버 검증 | Toss v2 |
| **toss-payment-confirm** | 토스 결제 승인 (**v2**) — paymentKey + amount 검증 | Toss v2 |
| **toss-payment-webhook** | 토스 webhook (**v2**) — HMAC-SHA256 서명 검증 | Toss v2 |

## §2 toss-* 6개 v1/v2 매칭 표

| 책임 | v1 (legacy) | v2 (신규) | 차이 |
|------|-------------|-----------|------|
| 결제 준비 | `toss-checkout` (checkout_url 반환 방식) | `toss-payment-ready` (위젯 + orderId/amount 서버 검증 + pending DB) | v2 = 위젯 + 서버 가격 검증 추가 |
| 결제 승인 | `toss-confirm` | `toss-payment-confirm` (MID: gbaemiomhk / 사업자: 제과다움 명시) | v2 = MID 박제 + 권한 부여 흐름 명시 |
| Webhook | `toss-webhook` (Toss-Signature 검증) | `toss-payment-webhook` (HMAC-SHA256 + timing-attack-safe 상수 시간 비교) | v2 = 보안 강화 (상수 시간 비교 주석 명시) |

## §3 보안 차이

- **v1 webhook**: HMAC 검증 함수 본문 미확인 (head 30 line 범위 외).
- **v2 webhook**: 상수 시간 비교 명시 + TOSS_WEBHOOK_SECRET 환경 변수 강제.
- **v2 payment-ready**: 서버 사이드 `PRODUCT_PRICE_MAP` (pack_1=1900 / pack_5=7900 / pack_15=19900) 으로 클라이언트 가격 조작 방지.

## §4 환경 변수 의존

| Function | env vars |
|----------|----------|
| toss-checkout / confirm / webhook (v1) | `TOSS_SECRET_KEY` |
| toss-payment-confirm (v2) | `TOSS_SECRET_KEY` |
| toss-payment-ready (v2) | `TOSS_CLIENT_KEY` |
| toss-payment-webhook (v2) | `TOSS_WEBHOOK_SECRET` |
| toss-webhook (v1) | `TOSS_SECRET_KEY` + `TOSS_WEBHOOK_SECRET` |

## §5 평가 + 정리 권고

### v1/v2 병존 상태 = **마이그레이션 미완**
- v1 코드 보존됨 → 과거 결제 데이터 호환 또는 fallback 가능성
- v2 코드 = 위젯 방식 + 서버 가격 검증 + 보안 강화 = 진정한 운영 후보

### 자비스 자율 정리 권고 (민규 결정 영역)
1. **클라이언트 코드** (`src/services/payment.js` / `pg-toss.js`) 가 어느 endpoint 를 호출하는지 grep → 사용 패턴 확증.
2. v1 endpoint 호출 없음 확증 시 → **v1 3 함수 삭제 (deprecate)** + 환경 변수 정리.
3. v1 호출 잔존 시 → v2 로 마이그레이션 plan 작성 + 단계별 배포.

### 보안 차이로 인한 우선순위
- **v2 사용 강제** 권고: 서버 가격 검증 (pack_1/5/15 amount) = 클라이언트 SKU 조작 방지.
- v1 toss-checkout 는 가격 서버 검증 부재 → 가격 조작 공격 위험.

## §6 다른 결제 영역

- **Stripe (web)**: stripe-webhook 1개. 단순.
- **Apple IAP**: billing-apple-verify + billing-apple-notifications 2개. App Store Server API + ES256 JWT.
- **Google IAP**: billing-google-verify + billing-google-rtdn 2개. Google Play Developer API + RS256 JWT.
- 모두 v1/v2 분기 없음 = clean.

## §7 결론

- toss-* 6개 = **중복 아닌 v1/v2 마이그레이션 진행 중 상태**.
- 자비스 자율 정리 = 클라이언트 호출 패턴 grep 후 판단 (T3 후속).
- 민규 P0 결정: v1 deprecate 시점 + v2 단일 사용 확증.

## 출처

- 본 보고서 head grep = 2026-05-20 본 세션 직접 실행.
- 각 함수 entry: `projects/MONGGEUL/supabase/functions/toss-*/index.ts`.
