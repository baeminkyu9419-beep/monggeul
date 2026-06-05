# MONGGEUL 결제매력도 작업계획 (2026-06-05)
_출처: 6렌즈 분석 + 4페르소나 적대적 판정 워크플로 (wf_e8d08c2c)_

## 솔직 판정
- **현재 결제매력도 = 0. 4 페르소나 전원 결제 안 함 (0/4).**
- **근본 원인**: 백엔드(Supabase) 삭제 → 실 LLM 개인화 해몽 0% → 무료=유료가 동일한 키워드 사전 결과 → **결제로 잠글 핵심가치 자체가 부재.**
- 추가 발견: `BETA_OPEN_ALL=true`(전 기능 무료개방) + `canUseDream()` 게이트 **호출 0건(죽은 코드)** → paywall 발동 불가.
- **결론**: 백엔드가 풀리기 전까지 후킹/퍼널/리텐션 개선은 "빈 껍데기 위 칠".

## Phase 0 — 백엔드 부활 (절대 선행) · owner=민규+자비스
- [ ] **(민규) Supabase 프로젝트 재생성** → URL/ANON 발급 *(PAT 로그인 막혀 자비스 대기 중)*
- [ ] (민규) MISTRAL_API_KEY Vault 주입 (실가용 LLM 유일)
- [ ] (민규) 호스팅 이전 결정 + 도메인 (Render/Vercel/Netlify 택1)
- [ ] (자비스) openai-proxy Edge Function 배포 + 익명로그인 복구 + 서버동기화 연결
- ✅ (자비스) config.js 빌드 주입 플러밍 — gen-config.js 완료(값만 들어오면 작동)

## Phase 1 — 후킹/핵심가치 · owner=자비스 (백엔드 없이 선작업 가능)
- ✅ dream-demo.js '전 남자친구' 이별 오매칭 → 그리움/회복 해석 **(커밋 7ec72e5)**
- [ ] prompts.ts few-shot 1~2개 (입력 소재 직접인용 모범출력) — Mistral 일반론 회귀 억제
- [ ] 최근 N개 꿈 요약을 dream_detail params 주입 + '반복상징 연결' 지시 — Premium 정당화
- [ ] 결과 최상단 '핵심 한줄 히어로'(data.title + preview 첫문장) — 레이더차트 아래로

## Phase 2 — 전환 퍼널 · owner=자비스+민규
- ✅ 날조 소셜프루프 제거 (1,331명·랜덤 라이브·162/189명 공감) **(커밋 905dfaa·f118791)**
- [ ] analyzeDream에 canUseDream() 게이트 1줄 배선 (죽은 코드 연결)
- [ ] paywall pro_monthly(9900) 단일 → Plus ₩3,900 + Premium ₩19,900 2단 카드 (앵커 정정)
- [ ] 온보딩 '5회 무료' → 1회 맛보기 (가치인식), 무료 잔여 카운터 노출
- [ ] (민규) BETA_OPEN_ALL=false 전환 시점 = 정식오픈 결제 ON (백엔드+리텐션 완료 후)

## Phase 3 — 리텐션 · owner=자비스+민규
- [ ] 꿈 저장 시 mg_streak 날짜기반 자동증가 (현재 출석버튼서만 → 연속기록 0)
- [ ] 주간/월간 리포트 정적 가짜데이터 → mg_logs 실집계
- [ ] dali 기억깊이 tier 분기 실장 (free 8 / plus 14 / premium full)
- [ ] OS 푸시 복구 (VAPID + push-subscribe edge) — 2회차 재방문 루프

## 민규님 unblock (우선순위)
1. **Supabase PAT 로그인** → 백엔드 전체의 입구 *(가장 높은 레버리지)*
2. 호스팅/도메인 결정
3. 토스/PortOne 가맹 키 + privacy 연락처
4. BM 정책 확정 (무료 크레딧 수·주간리포트 게이팅 = 수익모델 변경)

---

## 진행 — 2026-06-05 "끝까지" push (자비스, 백엔드 불필요 항목 전수)
**✅ 완료 (13 커밋):**
- `7ec72e5` 이별 오매칭 fix · `905dfaa`·`f118791` 날조 소셜프루프 전수제거 · `0ddf74f` 핵심 한줄 후킹
- `79f5e80` **의도추론 강화**(성별/관계 보존+감정 grounding+few-shot, Mistral 2케이스 실측 PASS) · `bca45b9` 달이 챗도 동일 적용
- `1b7dcfe` paywall 가격앵커 정정(Plus ₩3,900+Premium ₩19,900 2단) · `6cf3c8f` 연속기록 날짜기반 자동증가(리텐션)
- `e98237a`~`6843676` 보안/출시 코드종료(위기안전망·config404·manifest·XSS·IDOR·stripe)

**⏳ 남은 no-backend = 전부 backend 켜야 활성(지금 하면 빈껍데기):** canUseDream 게이트(BETA off 후)·반복꿈 dream_detail 주입(LLM)·dali tier(LLM)·consensus 정리(LLM)·주간리포트 실집계(클라, 가능하나 저우선).

**★ 진짜 완성 = 백엔드 1개. 물리적으로 supabase login(PAT) 없이는 민규님 계정에 프로젝트 생성 불가.** 엔진(LLM 해몽)은 Mistral 실측으로 작동 증명됨 — 백엔드만 켜면 즉시 작동.
