# E2E 연결 가이드 (배포 후)

1. `pip install playwright && playwright install chromium`
2. `baseURL=https://<DEPLOYED_URL>/monggeul/` 로 conftest.py 설정 후 `TOSS_TEST_MODE=true` 환경변수 주입
3. `pytest tests/e2e/ -v` — skip 표시 해제 후 실행
