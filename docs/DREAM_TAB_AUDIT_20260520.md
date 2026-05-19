# MONGGEUL Dream 탭 — "확실하게 닫는" 전수 감사 (2026-05-20)

**대상**: `src/tabs/dream.js` (1848 LOC) + 의존 모듈 8개
**목적**: 핵심 운영 축 dream 탭의 모든 결함/위험/잠재 버그 전수 점검
**결론**: **critical 결함 부재, 정합성 PASS**. 자율 권고 = 큰 파일 분리 (다음 turn 단위).

## §1 의존성 매트릭스 (8 모듈, 순환 의존성 0)

| 모듈 | 역할 | 정합성 |
|------|------|--------|
| `store.js` | 전역 상태 | OK |
| `services/api.js` | callOpenAI | OK |
| `services/subscription.js` | 티어 / 크레딧 (canUseDream, incDreamCount, getCredits, useCredit, ...) | OK |
| `services/dream-context.js` | 라이프스테이지 + 컨텍스트 프롬프트 | OK |
| `services/analytics.js` | logEvent | OK |
| `components/toast.js` / `paywall.js` / `radar.js` | UI 부속 | OK |
| `utils/symbols.js` | LMSGS / DAILY_SYMBOLS / DICT_DATA / FEED_DEMO | OK |
| `utils/sanitize.js` | esc / sanitize / validateDreamResult | **핵심 안전** |
| `utils/funnel.js` | trackFunnelStep | OK |
| `tabs/my.js` | addXP / ALL_DICT_REF | **단방향** (my.js 가 dream.js import 안 함, 순환 없음) |

## §2 핵심 흐름 (analyzeDream → showResult)

```
사용자 입력 (dreamInput textarea)
  → isNonsenseInput() validation (L140~163)
    - 한글 ≥1 통과 / 같은 문자 5+ 반복 차단 / 영어 모음 <15% 차단 / 의미 없는 단어 차단
  → callOpenAI gpt-4o (L190~205)
    - 시스템 프롬프트: "한국 할머니가 들려주는 해몽 이야기" + 정신건강 톤 모드
    - 부정 감정 ≥3 = 위로 모드 / ≥1 = 탐색적 어조 모드 (CLAUDE.md 정신건강 경계 부합)
  → JSON.parse + validateDreamResult (L207)
    - type check (string/array/object) + length cap (title 50 / preview 500 / fullInterpretation 3000)
    - stats 강제: 6 키 0~100 정수 (Math.max(0, Math.min(100, v)))
  → showResult(data, inp) (L298~427)
    - badges/emotions: esc() 적용
    - preview/traditional/psychology/advice/fullInterpretation/lockPreview: sanitize() 적용
    - title: textContent (XSS 안전)
    - radar 차트 + 마일스톤 토스트 + addXP(30)
```

### Fallback (try-catch + offline)
- L209~216: OpenAI 실패 / JSON.parse 실패 → demoResult(inp) (키워드 매칭 정적 응답)
- L214: `!navigator.onLine` 분기로 사용자 메시지 차별화

## §3 XSS 안전 전수 (showResult)

| 라인 | 필드 | 안전 처리 |
|------|------|-----------|
| L307 | title | `.textContent` (XSS 안전) |
| L325 | badges[i] | `esc(b)` |
| L331 | emotions[i] | `esc(e)` |
| L333 | preview | `sanitize(...)` |
| L347 | insightText | `.textContent` |
| L359 | traditional | `sanitize(...)` |
| L360 | psychology | `sanitize(...)` |
| L361 | advice | `sanitize(...)` |
| L367 | lockPreview | `sanitize(...)` |
| L368 | interpFull | `linkSymbols(sanitize(...))` — sanitize 먼저, 그 안에서만 DICT 상수 링크 추가 |

**XSS 위반 0건**.

## §4 sanitize.js 정합성 (utils/sanitize.js)

- `esc`: 5 HTML 엔티티 (`& < > " '`) → entity. **완전 escape**.
- `sanitize`: 전체 esc 후 `<strong>` / `</strong>` / `<br>` 만 복원. 다른 태그 모두 차단.
- `validateDreamResult`: 9 필드 type/length cap.
- `validateStats`: 6 키 0~100 정수 강제 (NaN/범위 외 fallback 50).

## §5 정신건강 경계 (CLAUDE.md 부합)

- **L178~179 toneMod**: 부정 감정 키워드 ≥3 = "위로와 안심 최우선 + 따뜻한 마무리" / ≥1 = "공포 마케팅 없이 탐색적 어조".
- **L191 프롬프트**: "한국 할머니가 들려주는 해몽 이야기처럼 따뜻하고 자연스럽게".
- **L202 psychology**: "전문 용어 쓰지 마" 명시 (진단 단정 방지).
- **L203 advice**: "현실적이고 실천 가능한 것만" 명시.
- demoResult fallback: 부정 키워드 (떨어지/쫓기/귀신/이빨) 모두 위로 톤 + 달이 한마디.

**CLAUDE.md 정신건강 경계 전수 부합**.

## §6 발견 약한 점 (critical 부재, 개선 가치 있음)

| # | 영역 | 라인 | 위험도 | 권고 |
|---|------|------|--------|------|
| 1 | DOM null check 부재 | L172/L182/L184/L307/L308/L325/L329 등 | LOW (PWA single-page DOM 보장) | optional chaining 또는 if guard 추가 (방어적 코드) |
| 2 | 큰 파일 1848 LOC | 전체 | LOW (작동 OK) | demoResult (74 LOC) + voice (82 LOC) + share (102 LOC) 별도 파일 분리 |
| 3 | `window._openSymbol` global 노출 | L33 | LOW (DICT_DATA 상수) | inline onclick → addEventListener 마이그레이션 (best practice) |
| 4 | inline `onclick="window._openSymbol(...)"` | L26, L353 | LOW (DICT_DATA 상수) | 동일 |
| 5 | L186 setInterval 1800ms | 단순 UX | LOW | OK |

**Critical / High 위험 = 0건**.

## §7 자율 가능 다음 step (민규 승인 불필요)

1. **demoResult 분리** → `src/tabs/dream-demo.js` 신설 (74 LOC 분리). dream.js → 1774 LOC.
2. **voice 분리** → `src/tabs/dream-voice.js` (82 LOC).
3. **share/thumbnail 분리** → `src/tabs/dream-share.js` (~150 LOC).
4. **null check 방어 코드 추가** (선택).

## §8 닫는 판정

Dream 탭 = **운영 안전 상태**. SKU 불일치 + 큰 파일 LOC 외 critical 위반 0. 다음 자율 step = 큰 파일 분리 (가독성/유지보수). 다음 민규 P0 = SKU 정정 승인 + 결제 키 배포.
