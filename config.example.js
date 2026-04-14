// 몽글몽글 — 로컬 개발용 설정 파일
// 사용법: 이 파일을 config.js로 복사한 뒤 값을 채워주세요
// cp config.example.js config.js

// Supabase (필수 — 해몽 API, 인증, 데이터 저장)
window.SUPABASE_URL = '';        // 예: 'https://xxxxx.supabase.co'
window.SUPABASE_ANON_KEY = '';   // Supabase 대시보드 → Settings → API → anon key

// Google Analytics 4 (선택 — 웹 트래픽 분석)
window.GA_ID = '';               // 예: 'G-XXXXXXXXXX'

// Web Push VAPID (선택 — 푸시 알림)
window.VAPID_PUBLIC_KEY = '';    // npx web-push generate-vapid-keys 로 생성

// Google AdSense (선택 — 웹 광고 수익화)
window.ADSENSE_CLIENT = '';      // 예: 'ca-pub-1234567890123456'
window.ADSENSE_SLOT = '';        // 예: '1234567890'

// 참고: 위 값이 비어 있어도 앱은 로컬 게스트 모드로 정상 작동합니다.
// Supabase 설정 없이도 데모 해몽, 꿈 기록(localStorage), 달이 대화가 가능해요.
