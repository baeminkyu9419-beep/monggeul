# MONGGEUL 출시 차단요인 (LAUNCH BLOCKERS)
_최종 갱신: 2026-06-05 — 자비스 출시 종료 작업 중_

빌드 PASS · pytest 230 PASS (기본기 건강). 아래는 "뜨는가"가 아니라 "출시 안전하게 닫혔는가" 기준.

## 코드-측 종료 (자비스)
| 워크스트림 | 항목 | 상태 | 근거 |
|---|---|---|---|
| W6 | PWA manifest 경로 | ✅ 닫힘 | `/monggeul/`(옛 Pages)→상대경로, dist 검증·빌드 PASS |
| W5 | 진단 표현 완화 | ✅ 닫힘 | symbols.js "불안장애와 연관"→"불안한 감정과 연관될 수 있어요" |
| W5 | 위기 안전망 | ✅ 닫힘 | crisis.js 정밀감지(위기6 발동/꿈6 미발동=12/12)+상시 푸터, 꿈해몽 무손상, pytest 230 PASS |
| W7/W3 | config 배포 404 | ✅ 코드 닫힘 | gen-config.js로 dist/config.js 항상 생성, env 주입 검증(값은 아래 민규 P0-2) |
| W1 | 결제 서명검증 | ✅ P0 깨끗 | toss-webhook HMAC+상수시간비교, toss-confirm 금액 서버재검증, stripe-webhook 서명검증. (P2: stripe `===` 비상수시간·replay 허용오차) |
| W2 | 시크릿 누출 | ✅ 닫힘 | dist 번들 service_role/sk- grep 0건 |
| W2 | RLS/IDOR | 🟠 P1 발견 | RLS 전반 활성+소유권 31정책 ✓. 단 레거시 `upd_posts using(true)`(0001:39)가 신 소유권 정책과 OR결합→**타인 커뮤니티 글 수정 IDOR**. 수정SQL 아래. 라이브 lineage 검증 대기(Supabase 일시중지) |
| W3 | LLM 실응답 라우팅 | ✅ 코드 OK | 프롬프트 IP 서버격리 확증·인증·재시도·graceful. Mistral 우선=서버측+회귀테스트. 실작동은 민규 P0(Supabase+Render env+openai-proxy 배포) |
| W4 | 4탭 XSS/버그 | ✅ 닫힘 | community/dream 결과 esc·sanitize ✓. my.js reportAiText raw→sanitize 수정. 빌드·pytest 230 PASS |

### W2 IDOR 수정 (Supabase unpause 후 적용·검증)
```sql
-- 20260408_drop_legacy_permissive.sql (community_realtime 이후 실행 보장)
-- 레거시 permissive UPDATE 정책 제거 — 소유권 정책("Users can update own posts")이 이미 존재
drop policy if exists "upd_posts" on community_posts;
```

## 외부 차단요인 (민규님만 가능)

### P0 — 출시 필수
1. **Supabase 인스턴스 활성화** — `mskwqlqpcsfvgvhhilma.supabase.co` (메모리상 ECONNREFUSED=일시중지 의심). 대시보드에서 unpause. 없으면 인증·해몽LLM·결제·커뮤니티 전부 무작동.
2. **Render 환경변수 입력** (Render 대시보드 → Environment) — 전부 공개값(시크릿 아님):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Supabase 대시보드 Settings→API)
   - → 빌드 시 `dist/config.js`로 자동 주입(코드측 완료). 입력만 하면 작동.
3. **토스페이먼츠 가맹 + 키** — 웹 결제(카드/토스/카카오페이). 가맹 후 시크릿 키를 Supabase Vault(edge function용)에 주입.

### P1 — 수익화
4. **AdSense pub-id** — 발급 후 Render env `ADSENSE_CLIENT`/`ADSENSE_SLOT` 입력. (`app-ads.txt`는 이미 존재)
5. **커스텀 도메인** — 현재 `*.onrender.com`. 도메인 연결 시 manifest 상대경로라 추가 수정 불필요.

### 모바일 (선택 — 웹 출시 후)
6. Google Play 개발자 등록 $25 + AAB 내부테스트 트랙
7. Apple Developer $99 + `.p8` key → Supabase Vault
8. Google service account JSON → Supabase Vault

## 검증 명령 (출시 게이트)
```bash
npm run build                  # 종료코드 0 + dist/config.js 생성
python -m pytest tests/        # 230 PASS
grep -rE "service_role|sk-" dist/   # 0건(시크릿 누출 없음)
```
