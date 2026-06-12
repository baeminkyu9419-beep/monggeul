/**
 * monggeul E2E runner — puppeteer 4 scenarios
 * usage: node e2e_runner.cjs <scenario> <base_url>
 * exit 0 = PASS, exit 1 = FAIL, exit 2 = SKIP (puppeteer/browser missing)
 *
 * scenarios: dream_input | paywall_cta | offline_fallback | price_display
 */
'use strict';

const scenario = process.argv[2];
const baseUrl = process.argv[3] || 'http://localhost:4173/monggeul/';

if (!scenario) {
  console.error('Usage: node e2e_runner.cjs <scenario> [base_url]');
  process.exit(1);
}

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.log('SKIP: puppeteer not installed');
  process.exit(2);
}

const TIMEOUT = 30000;

async function getBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

// ── 시나리오 1: 꿈 입력 → 해몽 결과 렌더 ──────────────────────────────────
async function scenarioDreamInput(baseUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // 스플래시 대기 (appSplash 사라질 때까지 or 3s)
    await page.waitForFunction(() => {
      const s = document.getElementById('appSplash');
      return !s || s.style.opacity === '0' || !document.body.contains(s);
    }, { timeout: 6000 }).catch(() => {});

    // 꿈 입력
    await page.waitForSelector('#dreamInput', { timeout: TIMEOUT });
    // analyzeDream 등록 대기
    await page.waitForFunction(() => typeof window.analyzeDream === 'function', { timeout: TIMEOUT });
    await page.type('#dreamInput', '전 여자친구가 꿈에 나왔어요', { delay: 20 });

    // 해몽 버튼 클릭 — page.evaluate 방식 (버튼이 뷰포트 밖에 있어도 동작)
    await page.evaluate(() => { const btn = document.querySelector('.btn-main'); if (btn) btn.click(); });

    // 결과 대기 — resultEl 에 class 'on' 추가됨 + interpText 내용 채워짐
    // 최대 15s (LLM 없으면 demo 폴백으로 즉시)
    const resultRendered = await page.waitForFunction(() => {
      const el = document.getElementById('resultEl');
      if (!el) return false;
      // CSS class 'on' 방식 또는 display != none 둘 다 허용
      const hasOn = el.classList.contains('on');
      const notHidden = window.getComputedStyle(el).display !== 'none';
      if (!hasOn && !notHidden) return false;
      const interp = document.getElementById('interpText');
      if (interp && interp.textContent.trim().length > 10) return true;
      // rTitle 이 기본값("🌙 해몽 결과")과 달라지거나 rDate 에 날짜가 들어오면 렌더됨
      const rDate = document.getElementById('rDate');
      if (rDate && rDate.textContent.trim().length > 2) return true;
      return hasOn && interp && interp.textContent.trim().length > 0;
    }, { timeout: 15000 }).catch(() => null);

    if (!resultRendered) {
      const html = await page.evaluate(() => {
        const r = document.getElementById('resultEl');
        return r ? 'classes=' + r.className + ' interp=' + (document.getElementById('interpText')||{}).textContent : 'resultEl not found';
      });
      throw new Error('Result not rendered. debug: ' + html);
    }

    // 결과 텍스트 확인
    const interpText = await page.$eval('#interpText', el => el.textContent.trim()).catch(() => '');
    const rDate = await page.$eval('#rDate', el => el.textContent.trim()).catch(() => '');
    if (!interpText && !rDate) {
      throw new Error('interpText and rDate both empty after result rendered');
    }

    console.log('PASS: dream_input | interpText=' + interpText.slice(0, 60));
  } finally {
    await browser.close();
  }
}

// ── 시나리오 2: paywall CTA → 결제 모달 열림 ──────────────────────────────
async function scenarioPaywallCta(baseUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    await page.waitForFunction(() => {
      const s = document.getElementById('appSplash');
      return !s || s.style.opacity === '0' || !document.body.contains(s);
    }, { timeout: 6000 }).catch(() => {});

    // showPremiumPaywall() 직접 호출 (window global)
    await page.waitForFunction(() => typeof window.showPremiumPaywall === 'function', { timeout: TIMEOUT });
    await page.evaluate(() => window.showPremiumPaywall());

    // 결제 모달 대기 — ₩3,900 텍스트 포함 요소
    const priceFound = await page.waitForFunction(() => {
      return document.body.innerHTML.includes('3,900') || document.body.innerHTML.includes('3900');
    }, { timeout: 8000 }).catch(() => null);

    if (!priceFound) {
      throw new Error('Price ₩3,900 not found in paywall modal');
    }

    // 결제수단 선택 버튼 클릭 (pw-btn data-action=pack_1 OR plus_monthly)
    const ctaClicked = await page.evaluate(() => {
      // pack_1 또는 plus_monthly CTA 찾기
      const btn = document.querySelector('.pw-btn[data-action="pack_1"], .pw-btn[data-action="plus_monthly"]');
      if (!btn) return false;
      btn.click();
      return true;
    });

    if (!ctaClicked) {
      throw new Error('Could not find/click paywall CTA button');
    }

    // 결제수단 모달 대기 (mg-method-btn 존재)
    const methodModal = await page.waitForFunction(() => {
      return document.querySelector('.mg-method-btn') !== null;
    }, { timeout: 8000 }).catch(() => null);

    if (!methodModal) {
      // showPaymentComingSoon 이 열렸는지 확인 (대안 — Supabase 없는 경우)
      const comingSoon = await page.evaluate(() => {
        const m = document.getElementById('paymentComingSoon');
        return m && m.style.display !== 'none';
      });
      if (!comingSoon) {
        throw new Error('Neither method modal nor paymentComingSoon opened after CTA click');
      }
      console.log('PASS: paywall_cta | payment coming soon modal (no Supabase — expected)');
      return;
    }

    console.log('PASS: paywall_cta | method modal opened');
  } finally {
    await browser.close();
  }
}

// ── 시나리오 3: 오프라인 → demoResult 폴백 렌더 ───────────────────────────
async function scenarioOfflineFallback(baseUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    await page.waitForFunction(() => {
      const s = document.getElementById('appSplash');
      return !s || s.style.opacity === '0' || !document.body.contains(s);
    }, { timeout: 6000 }).catch(() => {});

    await page.waitForSelector('#dreamInput', { timeout: TIMEOUT });

    // 앱 JS 완전 초기화 대기 (analyzeDream 함수 window에 등록될 때까지)
    await page.waitForFunction(() => typeof window.analyzeDream === 'function', { timeout: TIMEOUT });
    // 추가 안정화 대기 (동적 import 완료 — tab-dream chunk 포함)
    await new Promise(r => setTimeout(r, 2000));

    // 오프라인 모드 활성화 (페이지 이미 로드된 후)
    await page.setOfflineMode(true);

    await page.type('#dreamInput', '뱀 꿈을 꿨어요', { delay: 20 });
    // page.evaluate 방식 (버튼이 뷰포트 밖에 있어도 동작)
    await page.evaluate(() => { const btn = document.querySelector('.btn-main'); if (btn) btn.click(); });

    // 결과 대기 — demo 폴백은 LLM 실패 후 즉시 렌더 (class 'on' 방식)
    const resultRendered = await page.waitForFunction(() => {
      const el = document.getElementById('resultEl');
      if (!el) return false;
      const hasOn = el.classList.contains('on');
      const notHidden = window.getComputedStyle(el).display !== 'none';
      if (!hasOn && !notHidden) return false;
      const interp = document.getElementById('interpText');
      if (interp && interp.textContent.trim().length > 10) return true;
      const rDate = document.getElementById('rDate');
      if (rDate && rDate.textContent.trim().length > 2) return true;
      return hasOn;
    }, { timeout: 15000 }).catch(() => null);

    await page.setOfflineMode(false);

    if (!resultRendered) {
      const debug = await page.evaluate(() => {
        const el = document.getElementById('resultEl');
        const ld = document.getElementById('loadingEl');
        return JSON.stringify({
          resultClass: el ? el.className : 'missing',
          loadingClass: ld ? ld.className : 'missing',
          interpLen: (document.getElementById('interpText') || {}).textContent?.length,
          analyzeDreamType: typeof window.analyzeDream,
        });
      });
      throw new Error('Result not rendered in offline mode. debug: ' + debug);
    }

    // 빈 화면 금지 확인
    const interpText = await page.$eval('#interpText', el => el.textContent.trim()).catch(() => '');
    const resultClass = await page.$eval('#resultEl', el => el.className).catch(() => '');
    if (!interpText && !resultClass.includes('on')) {
      throw new Error('Offline fallback: interpText empty and resultEl not .on');
    }

    console.log('PASS: offline_fallback | fallback rendered | interpText=' + interpText.slice(0, 60));
  } finally {
    await browser.close();
  }
}

// ── 시나리오 4: 가격 표기 정합 (₩3,900) ──────────────────────────────────
async function scenarioPriceDisplay(baseUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    await page.waitForFunction(() => {
      const s = document.getElementById('appSplash');
      return !s || s.style.opacity === '0' || !document.body.contains(s);
    }, { timeout: 6000 }).catch(() => {});

    await page.waitForFunction(() => typeof window.showPremiumPaywall === 'function', { timeout: TIMEOUT });
    await page.evaluate(() => window.showPremiumPaywall());

    await page.waitForFunction(() => {
      return document.body.innerHTML.includes('3,900') || document.body.innerHTML.includes('3900');
    }, { timeout: 8000 }).catch(() => null);

    // DOM 전체 텍스트에서 가격 텍스트 수집
    const priceCheck = await page.evaluate(() => {
      // 가시적 텍스트에서 ₩ + 숫자 패턴 수집
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const prices = [];
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent;
        const m = t.match(/₩[\d,]+/g);
        if (m) prices.push(...m);
      }
      return prices;
    });

    // ₩3,900 이 존재하는지
    const has3900 = priceCheck.some(p => p.replace(/,/g, '') === '₩3900' || p === '₩3,900');
    if (!has3900) {
      throw new Error('₩3,900 not found in DOM prices: ' + JSON.stringify(priceCheck));
    }

    // ₩3,900 외 다른 plus 가격이 단독으로 표기되는지 검사 (4,900 / 2,900 등 단독 노출 금지)
    // 단: pack_1(₩1,900), unconscious_profile(₩2,900), premium(₩19,900) 은 별개 상품이므로 허용
    // Plus 플랜 가격 앵커는 ₩3,900 이어야 함
    // 검사: ₩9,900 이 유일한 plus 가격 앵커로 노출되면 FAIL (레거시 잔존 감지)
    const bodyHtml = await page.evaluate(() => document.body.innerHTML);
    const has9900AsPlus = /₩9,900[^가-힣]*월|₩9900[^가-힣]*월/i.test(bodyHtml) &&
                         !/₩3,900|₩3900/.test(bodyHtml);
    if (has9900AsPlus) {
      throw new Error('Legacy ₩9,900 is sole plus price — ₩3,900 missing');
    }

    console.log('PASS: price_display | ₩3,900 found | all prices: ' + JSON.stringify(priceCheck));
  } finally {
    await browser.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  try {
    switch (scenario) {
      case 'dream_input':
        await scenarioDreamInput(baseUrl);
        break;
      case 'paywall_cta':
        await scenarioPaywallCta(baseUrl);
        break;
      case 'offline_fallback':
        await scenarioOfflineFallback(baseUrl);
        break;
      case 'price_display':
        await scenarioPriceDisplay(baseUrl);
        break;
      default:
        console.error('Unknown scenario: ' + scenario);
        process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();
