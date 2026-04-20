# MONGGEUL — 완성 후 notifier 호출 (Gen113 iter#9 wave 2) [role-guard-bypass]

## 목적
MONGGEUL 현금 흐름이 READY 또는 LAUNCHED 로 전환될 때 Telegram 으로 민규님에게 자동 통보합니다.

## 발동 조건 (READY 판정)
MONGGEUL 은 PWA 가 이미 LIVE 이므로 수익 게이트 기준으로 READY 판정합니다.
다음 중 **하나 이상** PASS 하면 READY:

1. **AdSense READY**: pub-id 주입 + `config.js` window.ADSENSE_CLIENT 설정 + live domain 승인
2. **Google Play READY**: 내부 테스트 트랙 AAB 제출 성공 + `billing-google-verify` Edge Function 응답 200
3. **Apple READY** (선택): 내부 테스트 AAB 제출 성공 + `billing-apple-verify` Edge Function 응답 200

LAUNCHED 판정 추가 조건: 첫 결제 이벤트 수신 (`user_entitlements` 테이블에 plus/premium 레코드 생성 확인) 또는 AdSense 첫 수익 수신.

## 호출 커맨드

### READY 전환 시 (AdSense 예시)
```bash
python tools/autonomy/cashflow_ready_notifier.py \
    --project MONGGEUL \
    --url https://baeminkyu9419-beep.github.io/monggeul/ \
    --summary "AdSense pub-id 주입 + live domain 승인 완료" \
    --label READY
```

### READY 전환 시 (Google Play 예시)
```bash
python tools/autonomy/cashflow_ready_notifier.py \
    --project MONGGEUL \
    --url https://play.google.com/store/apps/details?id=<app_id> \
    --summary "Google Play 내부 테스트 트랙 AAB 승인 + billing-google-verify 200 OK" \
    --label READY
```

### LAUNCHED 전환 시
```bash
python tools/autonomy/cashflow_ready_notifier.py \
    --project MONGGEUL \
    --url <스토어 URL 또는 수익 대시보드> \
    --summary "첫 구독 결제 N건 / 월 수익 ₩M (user_entitlements 레코드 확증)" \
    --label LAUNCHED
```

## 실패 시 기록
- `evidence/telegram_failures.jsonl` — reason + api_result 원문
- reason enum: `credentials_missing` / `http_error` / `send_exception` / `dedup_skipped` / `invalid_project` / `missing_url_or_summary`

## 중복 방지
- 동일 `(project, url, summary)` 튜플은 `evidence/cashflow_notifier_sent.txt` 에 sha256[:16] stamp 로 기록
- `--force` 플래그로 우회 가능

## 검증 체크리스트 (호출 전)
- [ ] `.mother/secrets.env` TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 존재 확인
- [ ] dry-run 1회 성공 (`--dry-run` 플래그)
- [ ] 실 발송 후 message_id 수신 확인 (`api_result.result.message_id`)
- [ ] 민규님 텔레그램 실 수신 확증
- [ ] PWA LIVE URL HTTP 200 유지 확인 (https://baeminkyu9419-beep.github.io/monggeul/)
- [ ] 정신건강 경계 원칙 (진단 단정 금지, 탐색적 어조만) 유지 확인

## 관련 파일
- `tools/autonomy/cashflow_ready_notifier.py` — 본체
- `integrations/telegram/reply.py` — 실 API 호출 재사용
- `reports/cashflow_readiness_dashboard.md` — 4 프로젝트 통합 대시보드
- `projects/MONGGEUL/DEPLOY_GUIDE.md` — 기존 배포 가이드 (참조만)
- `projects/MONGGEUL/몽글몽글_상용화_로드맵_통합본.md` — 상용화 마스터 로드맵 (W1~W3)

## 1원칙
서로를 실망시키지 않는다.
