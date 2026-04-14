# MONGGEUL — 반려동물 관리 하이브리드 앱

## 현재 상태
Phase 0 Archive (97.8%). Edge Functions 배포 대기 (토스 결제 키 필요).

## 기술 스택
- JavaScript + Vite 6
- Capacitor 8 (Android + iOS 하이브리드)
- @capacitor-community/admob (광고)
- @supabase/supabase-js (DB/인증)
- html5-qrcode, jspdf, qrcode
- Puppeteer (테스트), Sharp (이미지)

## 구조
```
MONGGEUL/
├── src/
│   ├── app.js           # 메인 진입점
│   ├── components/      # UI 컴포넌트
│   ├── services/        # 서비스 레이어
│   ├── store.js         # 상태 관리
│   ├── tabs/            # 탭 네비게이션
│   ├── styles/          # CSS
│   └── utils/           # 유틸리티
├── android/             # Android 네이티브
├── ios/                 # iOS 네이티브
├── dist/                # 빌드 산출물 (존재)
├── public/
├── assets/
├── landing.html         # 랜딩 페이지
├── index.html           # 메인 HTML (70KB)
└── capacitor.config.json
```

## 실행 명령어
```bash
# 웹 개발 서버
cd projects/MONGGEUL && npm run dev

# 빌드
npm run build

# Android
npm run cap:android

# iOS
npm run cap:ios
```

## 현재 blocker
- 토스 결제 키 미설정 → Edge Functions 배포 불가

## 다음 행동
1. Phase 0 나머지 2.2% 완료
2. 토스 결제 키 확인 후 Edge Functions 배포
3. Android/iOS 빌드 검증

## 증거 경로
- `dist/` — 빌드 산출물 (빌드 가능 증거)
- `node_modules/` — 의존성 설치됨
