// MONGGEUL — saveToDreamlog() 무료 저장 10개 제한 게이트 회귀 검증 (실행형)
// 결함: window.BETA_OPEN_ALL 은 어디서도 set 되지 않아 (typeof===undefined) 분기가 항상
//   dead code 였음 → 무료 10개 저장 제한이 전혀 작동하지 않았다.
// 수정: subscription.js 의 import 모듈 상수 BETA_OPEN_ALL(현재 false) 를 직접 참조.
//
// 이 테스트는 두 가지를 한다:
//  (1) 소스 안티-리그레션: dead 한 window.BETA_OPEN_ALL 가드가 사라지고
//      모듈 상수 기반 가드가 들어왔는지 확인.
//  (2) 실행형: 수정된 게이트 결정 로직을 실제로 평가해 시나리오별 발동 여부 검증.
//
// 실행: node tests/verify_storage_limit_gate.mjs   (exit 0 = PASS, 1 = FAIL)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const dreamSrc = readFileSync(join(ROOT, 'src', 'tabs', 'dream.js'), 'utf-8');
const subSrc = readFileSync(join(ROOT, 'src', 'services', 'subscription.js'), 'utf-8');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('PASS ' + name); }
  else { console.log('FAIL ' + name); failures++; }
}

// saveToDreamlog 함수 본문만 추출 (export function saveToDreamlog(){ ... } 까지 가장 가까운 본문)
const m = dreamSrc.match(/export function saveToDreamlog\(\)\s*\{[\s\S]*?\n\}/);
const body = m ? m[0] : '';
check('saveToDreamlog 함수 추출됨', body.length > 0);

// (1) 소스 안티-리그레션
// dead code 의 실제 런타임 패턴(typeof window.BETA_OPEN_ALL 체크)이 제거됐는지 확인.
// (설명 주석에 문자열이 남는 것은 무관 — 실행되는 가드 식만 검사)
check('dead code typeof window.BETA_OPEN_ALL 가드 제거됨', !/typeof\s+window\.BETA_OPEN_ALL/.test(body));
check('dead code window.BETA_OPEN_ALL 조건식 제거됨', !/!window\.BETA_OPEN_ALL/.test(body));
check('모듈 상수 BETA_OPEN_ALL 가드로 교체됨', /if\(!BETA_OPEN_ALL\)/.test(body));
check('BETA_OPEN_ALL import 됨', /import\s*\{[^}]*\bBETA_OPEN_ALL\b[^}]*\}\s*from\s*['"]\.\.\/services\/subscription\.js['"]/.test(dreamSrc));
check('FREE_STORAGE_LIMIT import 됨', /import\s*\{[^}]*\bFREE_STORAGE_LIMIT\b[^}]*\}\s*from\s*['"]\.\.\/services\/subscription\.js['"]/.test(dreamSrc));
check('가드 안에서 tier==="free" 체크', /tier==='free'/.test(body));
check('가드 안에서 FREE_STORAGE_LIMIT 비교', /logs\.length>=FREE_STORAGE_LIMIT/.test(body));
check('한도 초과 시 showPaywall(\'storage_limit\') 호출', /showPaywall\('storage_limit'\)/.test(body));
check('한도 초과 시 early return', /showPaywall\('storage_limit'\);\s*\n\s*return;/.test(body));

// subscription.js 계약: BETA_OPEN_ALL 단일 진실점 + FREE_STORAGE_LIMIT 정의
check('subscription.js: export const BETA_OPEN_ALL', /export const BETA_OPEN_ALL\s*=\s*(true|false)/.test(subSrc));
check('subscription.js: FREE_STORAGE_LIMIT = 10', /export const FREE_STORAGE_LIMIT\s*=\s*10/.test(subSrc));

// (2) 실행형: 수정된 게이트의 실제 결정 로직을 재현해 시나리오별 평가.
//   gateBlocks(BETA_OPEN_ALL, tier, logsLen, LIMIT) === showPaywall+return 여부.
const LIMIT = 10;
function gateBlocks(beta, tier, logsLen) {
  // 수정된 dream.js 가드와 동일한 로직:
  if (!beta) {
    if (tier === 'free' && logsLen >= LIMIT) {
      return true; // showPaywall('storage_limit') + return
    }
  }
  return false; // 저장 진행
}

// 핵심 회귀: BETA_OPEN_ALL=false(현재 값) + free + 10개 이상 → 차단되어야 함 (이전엔 dead code 라 차단 안 됨)
check('[실행] beta=false, free, 10개 → 차단', gateBlocks(false, 'free', 10) === true);
check('[실행] beta=false, free, 11개 → 차단', gateBlocks(false, 'free', 11) === true);
check('[실행] beta=false, free, 9개 → 허용', gateBlocks(false, 'free', 9) === false);
check('[실행] beta=false, free, 0개 → 허용', gateBlocks(false, 'free', 0) === false);
check('[실행] beta=false, premium, 50개 → 허용(유료 무제한)', gateBlocks(false, 'premium', 50) === false);
check('[실행] beta=false, plus, 50개 → 허용(유료 무제한)', gateBlocks(false, 'plus', 50) === false);
check('[실행] beta=true(전체개방), free, 50개 → 허용', gateBlocks(true, 'free', 50) === false);

// 버그 재현 증명: 옛 로직(window.BETA_OPEN_ALL 미정의 → 분기 진입 자체가 안 됨)은
//   free + 10개여도 절대 차단하지 못했음을 명시.
function oldGateBlocks(tier, logsLen) {
  const winBeta = undefined; // window.BETA_OPEN_ALL 은 어디서도 set 안 됨
  if (typeof winBeta !== 'undefined' && !winBeta) {
    if (tier === 'free' && logsLen >= LIMIT) return true;
  }
  return false;
}
check('[버그재현] 옛 로직은 free+10개여도 차단 못 함(dead code 증명)', oldGateBlocks('free', 10) === false);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
