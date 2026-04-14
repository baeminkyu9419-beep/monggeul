# MONGGEUL — Rollback Procedures

## 롤백 원칙
1. 모든 변경은 되돌릴 수 있어야 한다
2. 롤백 전 현재 상태 스냅샷 필수
3. 롤백 후 검증 테스트 실행

## 롤백 방법
### Git 기반
```bash
git log --oneline -10
git revert <commit-hash>
```

### 파일 기반
원본은 C:\Dev2 에 보존되어 있음 (JARVIS_NEW 완성 전까지 삭제 금지)

## 롤백 이력
| 날짜 | 사유 | 방법 | 결과 |
|------|------|------|------|
| — | — | — | — |
