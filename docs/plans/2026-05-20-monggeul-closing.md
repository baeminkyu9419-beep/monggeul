# MONGGEUL 확실하게 닫기 — 자비스 자율 영역 완성 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MONGGEUL Phase 0 Archive 97.8% 상태에서 자비스 자율 영역 잔여 작업 전수 종결 — 큰 파일 분리 + Edge Functions 정합성 + 빌드 검증 + 보안 점검 = "운영 안전 + 다음 민규 P0 (SKU/결제 키) 만 남은 상태".

**Architecture:** dream.js 1751 LOC + my.js 2109 LOC 등 큰 파일을 책임별로 분리 → 가독성/유지보수. Edge Functions 15 중 toss-* 5개 중복 분석 보고서. dist 29d stale 재빌드 + syntax 검증. 보안 sanitize 모듈 확장 점검.

**Tech Stack:** JavaScript (Vite 6, ES modules) / Supabase Edge Functions (Deno) / Capacitor 8 (Android+iOS). 단위 테스트 인프라 = **부재** (vitest 미도입). 검증 = `node --check` syntax + import grep + git build manual smoke.

**검증 정책 (TDD 대체)**: MONGGEUL 에 단위 테스트 도구 부재 + CLAUDE.md "기능 추가 금지" 로 vitest 도입은 별도 결정 영역. 본 plan 의 모든 분리/리팩토링은:
1. 분리 전 grep 으로 사용처 전수 확보
2. 분리 후 `node --check` syntax 검증
3. import 정합성 grep
4. (선택) `npm run build` smoke test
5. 분리 단위마다 frequent commit

**민규 P0 (본 plan 영역 외, 박제만)**: SKU 가격 정정 (paywall ₩9,900 → ₩3,900) / AdSense pub-id / Google Play $25 / Apple p8 / Google service account JSON / toss-* 정리 방향.

---

## 파일 구조

### 신설 예정
- `src/tabs/dream-share.js` — share/thumbnail 함수 모음 (~150 LOC 분리)
- `src/tabs/dream-voice.js` — 음성 입력 (~102 LOC 분리, updateCharCount 의존성 해결)
- `src/utils/dream-symbols-data.js` — dream-data.js 의 EXTENDED_DICT 분리 (선택, 1219 LOC 큰 경우)
- `projects/MONGGEUL/docs/EDGE_FUNCTIONS_AUDIT_20260520.md` — toss-* 5개 정합성 분석 보고서
- `projects/MONGGEUL/docs/BUILD_VERIFICATION_20260520.md` — dist 빌드 재실행 결과 박제

### 수정 예정
- `src/tabs/dream.js:998-1077` — voice 함수 제거 + import 추가 (1751 → 1649 LOC)
- `src/tabs/dream.js:623-724` — share 함수 제거 + import 추가 (1649 → ~1500 LOC)
- `src/utils/sanitize.js` — `linkSymbols` 안전 검증 보강 (선택)

### 영향 받지 않음 (CLAUDE.md 기능 추가 금지)
- `src/app.js` — TABS 배열 등 그대로
- `src/store.js` — 전역 상태 그대로
- `supabase/migrations/` — DB schema 그대로
- `src/components/*.js` — UI 컴포넌트 그대로

---

## Task 1: dream.js share/thumbnail 분리

**책임**: dream.js L603~724 의 공유/썸네일 함수 4개 (`shareResult` / `generateShareCard` / `generateDreamThumbnail` / `generateResultThumbnail`) 를 별도 파일로 추출.

**Files:**
- Create: `projects/MONGGEUL/src/tabs/dream-share.js`
- Modify: `projects/MONGGEUL/src/tabs/dream.js:603-724` (함수 제거) + `:15` (import 추가)

- [ ] **Step 1: 함수 사용처 grep 사전 확보**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && grep -n "shareResult\|generateShareCard\|generateDreamThumbnail\|generateResultThumbnail" src/ -r --include="*.js"
```

Expected: dream.js 내부 + (가능) app.js / index.html inline. 외부 의존 모두 list.

- [ ] **Step 2: dream-share.js 신설 (4 함수 + 의존 import)**

```javascript
// 몽글몽글 — 해몽 공유/썸네일
import { showToast } from '../components/toast.js';
import { logEvent } from '../services/analytics.js';
// 추가 의존 = grep 결과 기반

export function shareResult() { /* dream.js L603 본문 그대로 */ }
export async function generateShareCard() { /* dream.js L623 본문 그대로 */ }
export async function generateDreamThumbnail(dreamText) { /* dream.js L900 본문 그대로 */ }
export async function generateResultThumbnail(inp) { /* dream.js L916 본문 그대로 */ }
```

- [ ] **Step 3: dream.js 정정 (4 함수 본문 제거 + import 추가)**

L15 부근에 추가:
```javascript
import { shareResult, generateShareCard, generateDreamThumbnail, generateResultThumbnail } from './dream-share.js';
```

L603, L623, L900, L916 의 `export function/async function ...` 본문 4개 제거 (re-export 자동).

- [ ] **Step 4: syntax + import 정합성 검증**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && node --check src/tabs/dream-share.js && node --check src/tabs/dream.js && grep -n "shareResult\|generateShareCard\|generateDreamThumbnail\|generateResultThumbnail" src/tabs/dream.js
```

Expected: 두 파일 OK. dream.js 내 grep = import 1줄 + 호출처만 (export 본문 0).

- [ ] **Step 5: Commit**

```bash
cd /c/JARVIS_NEW && git add projects/MONGGEUL/src/tabs/dream-share.js projects/MONGGEUL/src/tabs/dream.js && git commit -m "MONGGEUL dream.js share/thumbnail 4 함수 분리 → src/tabs/dream-share.js"
```

---

## Task 2: dream.js voice 분리 (updateCharCount 의존성 해결)

**책임**: dream.js L976~1077 음성 입력 (state vars + `stopVoiceInput` + `startVoiceInput` + 2 event listeners) 분리. `updateCharCount` 역방향 의존성 = window 글로벌 노출로 해결.

**Files:**
- Create: `projects/MONGGEUL/src/tabs/dream-voice.js`
- Modify: `projects/MONGGEUL/src/tabs/dream.js:976-1077` + `:15` (import) + `updateCharCount` 정의 직후 (window 노출)

- [ ] **Step 1: updateCharCount 사용처 + window 노출 패턴 grep**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && grep -n "updateCharCount" src/ -r --include="*.js"
```

Expected: dream.js L1027 정의 + L1037 startVoiceInput 내부 호출 + (가능) app.js 등.

- [ ] **Step 2: dream.js updateCharCount 정의 직후 window 노출 추가**

L1027 `export function updateCharCount(){...}` 본문 끝 직후:
```javascript
// dream-voice.js (분리 모듈) 에서 호출 가능하도록 window 노출
if(typeof window!=='undefined') window.updateCharCount = updateCharCount;
```

- [ ] **Step 3: dream-voice.js 신설**

```javascript
// 몽글몽글 — 해몽 음성 입력 (Web Speech API)
import { showToast } from '../components/toast.js';

let _activeRecognition=null;
let _voiceTimeout=null;

export function stopVoiceInput(){ /* dream.js L981~996 본문 그대로 */ }

export function startVoiceInput(){
  // ... (dream.js L998~1067 본문 그대로)
  // rec.onresult 내부 updateCharCount() 호출 → window.updateCharCount() 로 정정
  rec.onresult=(e)=>{
    let text='';
    for(let i=0;i<e.results.length;i++)text+=e.results[i][0].transcript;
    inp.value=text;
    if(window.updateCharCount) window.updateCharCount();
  };
  // ...
}

// 페이지 가시성 변경(뒤로가기/다른 앱 전환) 시 음성 인식 중단
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&_activeRecognition)stopVoiceInput();
});

window.addEventListener('popstate',()=>{
  if(_activeRecognition)stopVoiceInput();
});
```

- [ ] **Step 4: dream.js 정정 (voice 본문 제거 + import 추가)**

L15 부근에 추가:
```javascript
import { stopVoiceInput, startVoiceInput } from './dream-voice.js';
```

L976~1077 의 state vars + 2 함수 + 2 event listeners 모두 제거 (re-export 자동).

- [ ] **Step 5: syntax + import 정합성 검증**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && node --check src/tabs/dream-voice.js && node --check src/tabs/dream.js && grep -n "stopVoiceInput\|startVoiceInput\|_activeRecognition" src/tabs/dream.js
```

Expected: 두 파일 OK. dream.js 내 grep = import 1줄 + 호출처만 (export 본문 0, state vars 0).

- [ ] **Step 6: Commit**

```bash
cd /c/JARVIS_NEW && git add projects/MONGGEUL/src/tabs/dream-voice.js projects/MONGGEUL/src/tabs/dream.js && git commit -m "MONGGEUL dream.js voice 102 LOC 분리 → src/tabs/dream-voice.js (updateCharCount window 글로벌 해결)"
```

---

## Task 3: toss-* 5 Edge Functions 정합성 분석 보고서

**책임**: HANDOFF §0.2 발견 "toss-* 5개 중복 가능성" 검증. 각 함수 head 비교 + 책임 + 중복/정리 권고 박제.

**Files:**
- Create: `projects/MONGGEUL/docs/EDGE_FUNCTIONS_AUDIT_20260520.md`

대상 = `supabase/functions/` 의 `toss-checkout` / `toss-confirm` / `toss-payment-confirm` / `toss-payment-ready` / `toss-payment-webhook` / `toss-webhook` (6개).

- [ ] **Step 1: 각 toss-* 함수 entry 파일 head + endpoint 책임 grep**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && for f in supabase/functions/toss-*; do echo "=== $f ==="; head -30 "$f/index.ts" 2>/dev/null || head -30 "$f"/*.ts 2>/dev/null; done
```

- [ ] **Step 2: 보고서 작성**

`projects/MONGGEUL/docs/EDGE_FUNCTIONS_AUDIT_20260520.md`:
```markdown
# MONGGEUL Edge Functions 정합성 감사 (2026-05-20)

## §1 전수 매핑 (15개)
[15 함수 책임 + 호출 source + endpoint 일행 요약]

## §2 toss-* 6개 분석
| 함수 | 책임 | 호출 시점 | 중복? |
|------|------|----------|-------|
[grep 결과 기반 채움]

## §3 권고
- 통합 후보 / 분리 유지 / 삭제 권고 / 민규 결정 영역
```

- [ ] **Step 3: Commit**

```bash
cd /c/JARVIS_NEW && git add projects/MONGGEUL/docs/EDGE_FUNCTIONS_AUDIT_20260520.md && git commit -m "MONGGEUL Edge Functions 15 정합성 + toss-* 6개 분석 보고서"
```

---

## Task 4: dist 빌드 재실행 + 검증

**책임**: dist 29d stale (2026-04-20) 해소. `npm run build` 작동 확증 + 산출물 변경 폭 박제.

**Files:**
- Create: `projects/MONGGEUL/docs/BUILD_VERIFICATION_20260520.md`
- Modify: `projects/MONGGEUL/dist/` (재빌드 산출물, gitignored 가능)

**전제**: node + npm 환경. node_modules 설치되어 있는지 확인.

- [ ] **Step 1: node_modules 존재 확인**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && ls node_modules 2>&1 | head -5
```

Expected: 디렉토리 존재 OR "No such" 시 다음 step 으로 `npm install` 진행.

- [ ] **Step 2: (조건) npm install (node_modules 부재 시만)**

Run (background, ~5분):
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && npm install 2>&1 | tail -20
```

Expected: "added N packages" 또는 "up to date".

- [ ] **Step 3: 사전 baseline (dist 현재 상태)**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && du -sh dist/ && find dist -type f | wc -l && ls dist/assets/ | head -10
```

박제: 본 결과 보고서 §1 baseline.

- [ ] **Step 4: npm run build 실행**

Run (background, ~30s~2분):
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && npm run build 2>&1 | tail -30
```

Expected: "✓ built in Xms" 또는 vite 성공 메시지. Error 시 stop + 조사.

- [ ] **Step 5: 사후 baseline 비교 + 보고서**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && du -sh dist/ && find dist -type f | wc -l
```

`projects/MONGGEUL/docs/BUILD_VERIFICATION_20260520.md`:
```markdown
# MONGGEUL Build 재실행 검증 (2026-05-20)

## §1 Pre/Post baseline
| 항목 | Pre (29d stale) | Post |
|------|-----------------|------|
| dist 크기 | 4.5M | [실측] |
| dist 파일 수 | 115 | [실측] |
| 마지막 mtime | 2026-04-20 22:29 | [실측] |

## §2 빌드 출력 (tail 30)
[npm run build 마지막 30줄]

## §3 결론
빌드 작동 [확증/실패]. dream.js 분리 (97 LOC) + share/voice 분리 반영 확증.
```

- [ ] **Step 6: Commit (dist 는 gitignored 가능 → 보고서만)**

```bash
cd /c/JARVIS_NEW && git add projects/MONGGEUL/docs/BUILD_VERIFICATION_20260520.md && git commit -m "MONGGEUL dist 29d stale 해소 — npm run build 재실행 + 산출물 변경 박제"
```

---

## Task 5: my.js 부분 분리 (가장 큰 2109 LOC)

**책임**: dream 탭 다음 큰 단일 파일 my.js 의 책임 분해. CLAUDE.md "기능 추가 금지" 준수, 분리만.

**전제**: my.js 의 export + section markers 먼저 매핑.

**Files:**
- Create: `projects/MONGGEUL/src/tabs/my-export.js` (또는 책임별 1~2 분리 파일)
- Modify: `projects/MONGGEUL/src/tabs/my.js`

- [ ] **Step 1: my.js 구조 매핑**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && grep -n "^export\|^function\|^async function\|^const [A-Z]\|^// ─" src/tabs/my.js | head -50
```

Expected: my.js 의 export + section marker 목록. 분리 후보 1~2 영역 결정.

- [ ] **Step 2: 분리 후보 결정 (자비스 판단)**

조건:
- 분리 후보 = my.js 의 가장 응집된 책임 1~2개 (예: pattern report / XP system / dict reference / export modal)
- 분리 단위 = 200~400 LOC (너무 크면 다음 turn 로)
- 외부 의존 최소화 (가능하면 사이클 없음)

박제: 본 task 의 분리 후보 + 이유 (TodoWrite 또는 인라인 주석).

- [ ] **Step 3: 분리 파일 신설 + my.js 정정**

(분리 후보가 X 일 때) 새 파일 신설 + my.js 에서 본문 제거 + import 추가.

- [ ] **Step 4: syntax + import 정합성 검증**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && node --check src/tabs/my.js && node --check src/tabs/[new-file].js
```

Expected: 양쪽 OK.

- [ ] **Step 5: Commit**

```bash
cd /c/JARVIS_NEW && git add projects/MONGGEUL/src/tabs/my.js projects/MONGGEUL/src/tabs/[new-file].js && git commit -m "MONGGEUL my.js 부분 분리 ([N] LOC) → src/tabs/[new-file].js"
```

---

## Task 6: 보안 점검 — sanitize 확장 영역

**책임**: dream 탭 감사 §6 발견 "window._openSymbol global + inline onclick" 잠재 영역 점검. DICT_DATA 상수 안전, 다만 best practice = addEventListener 마이그레이션. 본 task = 점검 + 안전 확증 박제 (필요 시 정정).

**Files:**
- Modify: 없음 (점검 후 안전 확증 박제)
- Create: `projects/MONGGEUL/docs/SECURITY_CHECK_20260520.md`

- [ ] **Step 1: inline onclick 전수 grep**

Run:
```bash
cd /c/JARVIS_NEW/projects/MONGGEUL && grep -rn "onclick=" src/ --include="*.js" | head -20
```

Expected: dream.js L26/L33/L353 + 다른 사용처 list.

- [ ] **Step 2: 각 inline onclick 의 인자 source 확증**

각 결과의 인자가 사용자 입력 (XSS 위험) 인지 상수 (안전) 인지 grep + read.

- [ ] **Step 3: 보고서**

`projects/MONGGEUL/docs/SECURITY_CHECK_20260520.md`:
```markdown
# MONGGEUL 보안 점검 (2026-05-20)

## §1 inline onclick 전수
[grep 결과 + 인자 source 분석 + XSS 안전 판정]

## §2 결론
[모두 상수 source = 안전 / 또는 일부 위험 + 정정 권고]
```

- [ ] **Step 4: Commit**

```bash
cd /c/JARVIS_NEW && git add projects/MONGGEUL/docs/SECURITY_CHECK_20260520.md && git commit -m "MONGGEUL 보안 점검 — inline onclick 전수 + XSS 안전 확증"
```

---

## Self-Review (skill 강제 체크리스트)

**1. Spec coverage**: 
- ✅ dream.js 분리 (T1 share + T2 voice) — spec dream.js 1751 LOC 잔여
- ✅ my.js 분리 (T5) — spec my.js 2109 LOC
- ✅ Edge Functions 정합성 (T3) — spec toss-* 5개 중복
- ✅ 빌드 검증 (T4) — spec dist 29d stale
- ✅ 보안 점검 (T6) — spec sanitize 확장
- ❌ dream-data.js 1219 LOC / dali.js 992 LOC = 본 plan 범위 외 (다음 plan)
- ❌ SKU 정정 = 민규 P0 (본 plan 범위 외, 명시)

**2. Placeholder scan**: 
- T5 Step 3 "(분리 후보가 X 일 때)" = X 변수 = 자비스 판단 결과. 의도된 placeholder. 자비스가 Step 1~2 후 X 확정 후 진행.
- 다른 task = 모두 실 명령 + 코드 명시.

**3. Type consistency**:
- `shareResult` / `generateShareCard` / `generateDreamThumbnail` / `generateResultThumbnail` Task 1 전체 동일.
- `stopVoiceInput` / `startVoiceInput` / `_activeRecognition` Task 2 전체 동일.

---

## 실행 정책 (자비스 자체 판단)

본 plan = **Inline Execution** (Superpowers `superpowers:executing-plans` skill 활용). 이유:
- 6 task = 본 세션 안 또는 다음 1~2 turn 내 완료 가능
- 각 task = 분리 + syntax 검증 + commit 의 명확한 단위
- Subagent-Driven 의 context isolation 가치 < Inline 의 한 세션 일관성

본 turn 내 즉시 다음 진입 = Task 1 (dream.js share 분리). 토큰 한계 시 Task 1 commit 후 본 turn 마감, 다음 turn 에 Task 2~6 자율 진행.

## 출처
- 본 plan 의 자율 영역 정의 = `projects/MONGGEUL/HANDOFF.md §0.2` (commit `c2ae02795`)
- dream 탭 닫는 감사 = `projects/MONGGEUL/docs/DREAM_TAB_AUDIT_20260520.md` (commit `e7f5af5f2`)
- 본 plan 작성 = Superpowers `superpowers:writing-plans` skill (install commit `0acdc10ba`)
