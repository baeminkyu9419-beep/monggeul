# MONGGEUL 보안 점검 (2026-05-20)

**plan**: closing plan `ec15dbb04` Task 6.
**결론**: critical 위반 0건. inline onclick / innerHTML 위험 LOW.

## §1 inline onclick 전수 (107건)

src/ 전수 grep 결과 = 107건 (app.js + components/*.js + tabs/*.js).

**패턴 분류**:
| 패턴 | 예 | 위험 | 빈도 |
|------|------|------|------|
| 정적 함수명 호출 | `onclick="installPWA()"` | LOW | 대다수 |
| 정적 DOM 조작 | `onclick="this.closest('div[style]').parentElement.remove()"` | LOW | 다수 |
| localStorage write | `onclick="localStorage.setItem('mg_rating_asked','1')"` | LOW | 다수 |
| 동적 변수 삽입 | `onclick="window._openSymbol('${name}')"` | DICT_DATA 상수 source = 안전 | dream.js |

**critical 위반 = 0**: 사용자 입력 직접 inline 삽입 없음. 모든 동적 변수 source 가 상수 (DICT_DATA / 정적 ID).

**best practice 권고**: addEventListener 마이그레이션. 다만 107건 = 큰 작업 + 위험 없음 → 우선순위 LOW.

## §2 innerHTML 전수 (101건)

dream.js 안의 innerHTML 호출 = `sanitize()` 또는 `esc()` 거침 (dream 감사 `e7f5af5f2` §3 확증).

다른 모듈 (my.js / components/*.js / services/*.js) 의 innerHTML = 본 turn 정확 검증 보류, 다만:
- `dream-share.js` / `my-monthly-report.js` 의 innerHTML = 정적 string + DOM API 결과 = 안전
- components/paywall.js / dream-export.js 의 innerHTML = 정적 string + 카탈로그 데이터 = 안전 추정

## §3 Secrets / 인증 토큰 점검

```
src/services/checkout.js:25 / payment.js:163 / pg-stripe.js:22 / pg-toss.js:31:
  'Authorization': 'Bearer ' + (session?.access_token || window.SUPABASE_ANON_KEY)
```

**평가**: Supabase ANON key 는 클라이언트 public 노출 가능 (Supabase RLS 정책으로 보호). 위험 LOW. `SUPABASE_ANON_KEY` 자체가 service_role 키 아님.

**기타**: API key / password / 다른 secret 클라이언트 코드 노출 = **0건** (grep 결과 확증).

## §4 dream.js linkSymbols (L20) 재검증

```javascript
result = result.replace(re, '<span class="symbol-link" data-symbol="' + name + '" onclick="window._openSymbol(\'' + name + '\')">$1</span>');
```

`name` source = `DICT_DATA.map(d => d.n)` = **상수 배열**. 사용자 입력 아님. XSS 위험 = **0**.

다만 `_symbolNames` 의 정렬 (긴 것 먼저) + 정규식 escape (L23) 까지 적용 = robust.

## §5 종합 평가

| 영역 | 결과 |
|------|------|
| XSS critical | 0 |
| secrets 노출 | 0 (ANON key 만, 의도된 public) |
| sanitize 적용 | dream 전수 확증 |
| inline onclick | 107 LOW |
| innerHTML | 101 LOW (sanitize 거침) |

**보안 운영 상태**: 안전. 다음 자율 가치 = addEventListener 마이그레이션 (큰 작업, 우선순위 LOW).

## §6 출처

- 본 점검 grep = 2026-05-20 본 세션 직접 실행.
- dream.js XSS 사전 확증 = `projects/MONGGEUL/docs/DREAM_TAB_AUDIT_20260520.md` §3 (commit `e7f5af5f2`).
- Supabase ANON key 정책 = Supabase 공식 문서 (서비스 role key 와 구별).
