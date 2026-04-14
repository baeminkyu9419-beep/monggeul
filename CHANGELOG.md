# Changelog

모든 주요 변경사항을 기록합니다. 최신 버전이 상단에 위치합니다.

---

## v0.22.0 — 2026-03-25 (진행 중)

### :sparkles: New Features
- 한국형 결제 시스템 DB 스키마 설계 (Stripe + 토스페이먼츠 이중 PG 통합)
  - `subscriptions`, `payments`, `payment_methods` 테이블 구조
  - 구독 + 팩 공존 모델 지원

---

## v0.21.0 — 2026-03-24

### :sparkles: New Features
- PC 반응형 레이아웃 전면 구현 — 1920px 기준 가독성 대폭 개선
  - 탭별 max-width, 카드 그리드, 타이포 사이즈 PC 최적화
  - 태블릿(641~959px) / 소형 PC(960~1199px) / 대형 PC(1200px+) 3단 분기

### :memo: Docs
- Phase 23~40 로드맵 추가 — EVOLUTION.md 업데이트

---

## v0.20.0 — 2026-03-24

### :sparkles: New Features
- 한국 검색 최적화 (Phase 20) — 네이버/다음 SEO 메타 태그, 네이버 서치어드바이저 연동
- SEO 확장 (Phase 18~19) — 18개 꿈 해몽 SEO 페이지 + 리치 오프라인 데모 7개 추가
- Phase 17 제로 백엔드 복원력 — Supabase 없이도 앱 정상 작동 (localStorage 폴백)
- Phase 16 꿈 프로필 이미지 내보내기 — Canvas 기반 공유용 이미지 생성
- Phase 15 꿈 자동 임시저장 — 입력 중 데이터 손실 방지
- Phase 14 꿈 패턴 대시보드 — MY 탭에 상징/감정/빈도 시각화

### :wrench: Improvements
- GA4 애널리틱스 연동 + 웹 푸시 알림 (Phase 13)
- SEO 콘텐츠 11개 꿈 해석 페이지 + sitemap.xml (Phase 11~12)
- 랜딩 페이지 SEO 강화 + 404 라우팅 수정
- 웹 퍼스트 전환 — PWA 설치 배너, AdSense 준비, 웹 리워드 (Phase 10)
- Markov 체인 기반 꿈 패턴 예측 엔진 (Phase 9, 크로스 프로젝트 엔진 융합)

### :bug: Bug Fixes
- Phase 8 프로덕션 하드닝 — 3건 버그 수정
- API 재시도 로직, 번들 스플릿, 비동기 폰트 로딩 (Phase 7)

---

## v0.9.0 — 2026-03-24

### :sparkles: New Features
- Phase 6 완료 — 이벤트 로그, 커뮤니티 재편, GitHub Secrets로 시크릿 이관
- Phase 3~6 통합 구현 — 구독 검증, Vite 모듈 분리, Stripe 결제 구조, 이벤트 로그

### :wrench: Improvements
- EVOLUTION.md 전략 분석 업데이트 — 인프라, 수익화, 크로스셀
- 개인정보처리방침/이용약관, 스토어 설명 업데이트 완료

---

## v0.8.0 — 2026-03-22

### :sparkles: New Features
- 꿈 로또 행운 번호 생성기 — 해몽 결과에서 행운 번호 추출
- 커뮤니티 봇 페르소나 대폭 확장 — 다양한 캐릭터 응답 패턴

### :wrench: Improvements
- 달이 채팅 렌더링 안정화 + 사례모음 문장/페르소나 개선
- 음성 입력(STT) 버튼 강화 — 인식률/UX 개선

### :bug: Bug Fixes
- 달이 대화창 크기 오류 근본 수정 — overflow, display:flex, min-height, CSS 셀렉터 4단계 수정
  - `overflow:hidden` → `overflow-y:hidden`
  - JS 레벨 `display:flex` 보장
  - `#page-chat` ID 셀렉터 + `min-height:0`
  - `.page.chat-pg.active` 예외 처리

---

## v0.7.0 — 2026-03-21~22

### :sparkles: New Features
- 소셜 로그인 구현 — Google/Apple/카카오/네이버 + 게스트 모드
- Service Worker + PWA 설치 + 딥링크 + 평가 유도 + 햅틱 피드백
- 꿈 상징 데이터 대폭 확장 — 14개→62개→120+→170+→200+ 상징, 42→1000+ 상황 해석
- 흉몽 12개 추가 + CRM 맞춤형 해몽 시스템
- 업적 시스템 + 꿈 흐름 실데이터 연동 + 스트릭 리셋
- 별가루 포인트 시스템 — 상점 BM 연결 준비
- 꿈 성격 프로필 + 실시간 카운터 + XP 플로트 + 공유 CTA
- 카운터 Supabase DB 연결 + `app_stats` 테이블

### :wrench: Improvements
- 해몽 결과에 상징 매칭 카드 UI 추가 (197상징 915상황)
- 레이더 차트 리디자인 — 더 크고 직관적으로
- 전체 비주얼 고도화 — 글로우/글래스/시머/그라데이션 효과
- BI/CI 브랜드 가이드 + 브랜드 페이지 생성 (기업 수준 리디자인)
- 스토어 스크린샷 15장 자동 생성
- 리텐션 5대 핵심 개선 (연속기록, 알림, 공유, 커뮤니티, 보상)
- 전방위 UX 고도화 — 삭제/캘린더/입력/랜딩/인기순
- 길몽/흉몽 뱃지 설명 추가
- 달이 첫 인사 고도화 — 시간대별 멘트 (아침/오후/저녁/심야 4분기)
- 사이트 푸터 추가 — 이용약관, 개인정보처리방침, 고객센터, 광고문의
- SEO + PWA + 로딩 UX + 네트워크 감지
- 사용자 여정 고도화 — 반복꿈 감지, 다음 행동 유도, CRM 달이 연동
- UX 고도화 — 접근성, 모바일 최적화, 안정성 강화
- AI 느낌 완전 제거 — 모든 텍스트 인간적 톤으로 리라이트

### :bug: Bug Fixes
- XSS 방어 — MY탭 꿈사전/꿈기록, 꿈 저장 감정 데이터 소스 전체 적용
- 첫 방문 로그인 모달 미표시 수정 + 스와이프 애니메이션 안정성
- 모달 충돌 + z-index 정리
- 페이지/푸터 겹침 근본 수정
- 커뮤니티 채택/스티커 버그, 레벨 제거, 태그 노출, OG 이미지
- 입력 필터 정확도 100% — 오차단/미감지 모두 수정
- 댓글 뱅크 5개→12개로 확장 (중복률 63%→10% 이하)
- 카운터 리디자인 — 자연스러운 증가 + 해몽 시 연동
- 유저 피드백 반영 — 카운터/스트릭/아바타/공유/포커스
- 꿈 성격 태그에서 # 제거
- 출시 차단 이슈 전부 해결
- 빌드 에러 수정 — 템플릿 리터럴 이스케이프 충돌
- deploy.yml config.js 공백 정리 + store/ 폴더 dist에 복사
- 전체 섹션 간격 넓힘 + 회귀 점검

### :balance_scale: Legal
- 법적 컴플라이언스 전면 보강

### :zap: Performance
- RPG 에셋 65MB 삭제 + 메모리 누수 수정 + 코드 품질 개선

---

## v0.6.0 — 2026-03-21

### :sparkles: New Features
- Phase 2: Supabase Auth 익명 로그인 + DB 스키마 (`users`, `dreams`, `usage_daily`, `dali_memory`) + localStorage → Supabase 마이그레이션
- Phase 3~6 통합: 구독 검증, Vite 모듈 분리, Stripe 결제 구조, 이벤트 로그
- 상용화 전환: BM 재설계, 보안 강화, Capacitor 앱 빌드, 커뮤니티 봇, 광고 시스템

### :wrench: Improvements
- Phase 1: API 프록시 구조 — `callOpenAI` 통합, Edge Function 준비, 직접 호출 0개로
- Phase 0-2/0-3: 가짜 BM → 결제 안내 모달, 해몽 2회/일 제한, paywall UI, 문구 통일

### :wastebasket: Removed
- Phase 0-1: RPG 잔재 전체 제거 — 78함수/1,288줄/70KB 삭감 (게임 CSS/HTML/JS 완전 제거)

### :bug: Bug Fixes
- GitHub Actions 빌드 + dist 배포 수정
- 초기화 try-catch 격리, dream.js 누락 import 수정

---

## v0.5.0 — 2026-03-20

### :sparkles: New Features
- 대전환: RPG 제거, 해몽 특화앱 리빌드 — 4탭(해몽/달이/커뮤니티/MY) 구조
- UI 리빌드: 별/달/스플래시 제거, 히어로 4요소, 타이포 위계, 섹션 정리
- UX 개선: 카드 대비 강화, 실시간 카운터, 달이 메모리+상담 깊이, 인기 해몽 사전

---

## v0.4.0 — 2026-03-20

### :sparkles: New Features
- 음성 입력 (Web Speech API SpeechRecognition)
- 감정 태그 시스템 + 75개 감정 키워드
- 알림 배지, 닉네임 설정, 동적 제목
- 꿈 내보내기 (텍스트/이미지)
- 꿈 인사이트 + 가입일 표시
- 달이 운세 인사 + 해몽 바로가기 연동
- 꿈 기록 검색 기능
- 행운 메시지 시스템
- 데이터 초기화 기능

### :wrench: Improvements
- 키워드 태그, 꽃잎 파티클, 감정 컨텍스트
- 공유 보상, HUD 냥이수 통계, 주석 정리
- 글자수 표시, 생산 통계, 로딩 메시지 확장
- 해석 슬라이드 전환, 타이핑 속도 최적화, 탭 전환 개선

### :bug: Bug Fixes
- 에러 바운더리 추가 — null 참조 수정, 중복 함수 제거
- 스크롤 위치 기억, 스탯바 카운트업 수정
- 해금 배너 정리, 대화 초기화 안정성

---

## v0.3.0 — 2026-03-20

### :sparkles: New Features
- 해몽 공유카드 — Canvas 이미지 생성, 스탯바+별배경+워터마크, Web Share API
- 업적 12종 + 7일 출석 보상 — 목표 시스템, 연속 보상 캘린더
- 구독 3티어 (달빛/별빛/은하수) 모달 UI
- 달빛석 상점 4종 패키지 (1,100~22,000원)
- 해몽 횟수 카운터 + 무료 해금 남은 횟수 표시
- 운세 공유 버튼
- 대화 저장/복원 + 연속 기록 뱃지
- PWA manifest + 홈화면 추가

### :wrench: Improvements
- HUD 생산률 표시
- 재해몽 버튼, 진동 피드백, 유사꿈 개선
- UX 폴리싱: 키보드 닫기, 빠른 질문, 폰트 최적화
- 스플래시 화면, config 폴백
- OG 메타 태그 + 커뮤니티 문구 개선
- 터치 반응성 + 건물 빛남 효과

### :bug: Bug Fixes
- console.log 주석으로 인한 return 누락 수정
- 안정성: 중복 함수 제거, null 참조 수정, 코드 정리

---

## v0.2.0 — 2026-03-20

### :sparkles: New Features
- 프레스티지: 꿈각성 시스템 (영구 배율 +25%, 시설 리셋+보상, HUD 표시)
- 코스튬 시스템: 8종 잠옷/모자/악세서리, 상점 UI
- 시즌패스: 달빛여행패스 UI, 일일 미션 5개, 보상 트랙 10단계
- 달이 게임 상태 인지 — 냥이수/시설레벨/각성단계 대화 반영
- 해몽→게임 연동: 해몽 완료 시 30분 생산 2배 버프
- 건물 일러스트 6개 (DALL-E 생성), 꿈나라 테마 완성

### :wrench: Improvements
- 자원 생산 시각 피드백 (+3 텍스트 떠오르기)
- BM 강화: 레벨 무제한 + 지수 비용 곡선
- 방치 보상 시간 표시, 인기꿈 섹션 개선

### :bug: Bug Fixes
- 시즌패스 템플릿 리터럴 문법 오류 수정

---

## v0.1.0 — 2026-03-20

### :sparkles: New Features
- 초기 버전 — 드림룸 RPG, 달이 맥락 인식, 운세/퀴즈, 온보딩
- 냥이방 맵 뷰: 아이소메트릭 씬 + 인터랙티브 배치
- 방치형 마을 게임 엔진: 캐릭터 이동+작업+수집 루프, 건물 배치
- 꿈테마 잠옷 고양이: 해몽 해금→마을 등장, 8종 스프라이트
- 시설 상주형 방치 게임: 자동 생산, 업그레이드
- 고양이 스프라이트 시스템: PNG+SVG 폴백, 5종 breed

### :bug: Bug Fixes
- roomStars null 체크, var hoisting, gameInited TDZ 해결
- 고양이 z-index CSS 보강
- page-room flex 레이아웃 수정
- 건물 HTML 정적 배치, gameRunning 참조 에러 수정
- 이미지 의존 제거 — 순수 CSS 도형 렌더링 폴백

---

*Generated on 2026-03-25*
