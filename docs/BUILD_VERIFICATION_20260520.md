# MONGGEUL Build 재실행 검증 (2026-05-20)

**plan**: closing plan `ec15dbb04` Task 4.
**결과**: ✅ **빌드 성공** (vite 2.12s). dream.js + my.js 분리 5 모듈 모두 chunk 빌드 확증.

## §1 Pre/Post baseline

| 항목 | Pre (29d stale) | Post (본 세션) |
|------|-----------------|-----------------|
| dist 크기 | 4.5M | **4.5M** |
| dist 파일 수 | 115 | **115** |
| 마지막 mtime | 2026-04-20 22:29 | **2026-05-20 01:56** |
| 빌드 시간 | n/a | **2.12s** |

## §2 빌드 출력 (꼬리 25 line 발췌)

```
dist/assets/web-CkrTveZN.js              1.03 kB │ gzip:   0.51 kB
dist/assets/pg-toss-Bx5psvw3.js          1.08 kB │ gzip:   0.71 kB
dist/assets/index-CV4Cquht.js            8.26 kB │ gzip:   3.37 kB
dist/assets/tab-community-BrCk25pU.js   13.00 kB │ gzip:   4.99 kB
dist/assets/purify.es-BgtpMKW3.js       22.77 kB │ gzip:   8.79 kB
dist/assets/svc-community-DKmNu6wx.js   32.83 kB │ gzip:  12.58 kB
dist/assets/tab-dali-6ZEPOxuh.js        37.21 kB │ gzip:  13.88 kB
dist/assets/tab-dream-D52_qT2z.js       77.63 kB │ gzip:  26.93 kB
dist/assets/data-symbols-DT8fSDvp.js    93.49 kB │ gzip:  27.64 kB
dist/assets/data-dreams-Bs_KFf8H.js    110.98 kB │ gzip:  29.24 kB
dist/assets/index.es-pz0s51VB.js       159.74 kB │ gzip:  53.60 kB
dist/assets/supabase-DqnlNUYn.js       176.03 kB │ gzip:  46.24 kB
dist/assets/html2canvas.esm-QH1iLAAe.js 202.38 kB │ gzip:  48.04 kB
dist/assets/jspdf.es.min-CJjC9aOG.js   390.67 kB │ gzip: 128.81 kB
dist/assets/tab-my-BQw_sjvj.js         535.23 kB │ gzip: 159.37 kB  ← warning >500 kB

✓ built in 2.12s
```

## §3 분리 5 모듈 chunk 빌드 확증

본 세션 신설 5 모듈 모두 vite 가 자동 chunk 분리:
- `dream-demo.js` / `dream-validator.js` → `data-dreams-*.js` 또는 합쳐서 chunk
- `dream-share.js` → `tab-dream-*.js` (77 kB)
- `dream-voice.js` → 동
- `my-monthly-report.js` → `tab-my-*.js` (535 kB) 안

빌드 작동 확증 = 분리 후 **module graph 무결**.

## §4 발견 (vite warning)

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

`tab-my-BQw_sjvj.js` = **535 kB** (warning). my.js 가 1887 LOC 큰 상태. 추가 분리 가치 영역:
- 캘린더 / Report / Flow / Dict / 감정/상징/수면 = 별 책임 영역, 분리 가능

다만 본 plan 범위 외. 다음 plan 후보.

## §5 결론

| 점검 | 결과 |
|------|------|
| 빌드 작동 | ✅ 성공 (2.12s) |
| 분리 5 모듈 chunk | ✅ 모두 빌드 |
| dist 크기 변화 | 변화 없음 (4.5M / 115 파일) |
| 29d stale 해소 | ✅ mtime 갱신 |
| 큰 chunk warning | tab-my 535 kB (추가 분리 가치, 다음 plan) |

## 출처

- 본 빌드 실행 = 2026-05-20 본 세션 직접 `npm run build`.
- node_modules 사전 존재 확증.
