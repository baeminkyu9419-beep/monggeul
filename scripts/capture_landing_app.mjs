// 무창 캡처 — dist 서빙(localhost:8099) 에서 landing(마케팅) + app(SPA) 렌더 실증.
// usage: node scripts/capture_landing_app.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.CAP_BASE || 'http://localhost:8099';
const OUT = 'evidence/landing_revival';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});
const report = {};

try {
  // ── 1) 마케팅 랜딩 (/landing.html) ──
  const lp = await browser.newPage();
  await lp.setViewport({ width: 1280, height: 900 });
  await lp.goto(`${BASE}/landing.html`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  const landing = await lp.evaluate(() => ({
    title: document.title,
    hasNav: !!document.querySelector('.nav'),
    hasHeroCTA: !!document.querySelector('a[href*="index.html"]'),
    walkthroughEls: document.querySelectorAll('[class*="walkthrough"], [id*="walkthrough"], [class*="wt-"]').length,
    lenisActive: typeof window.__lenis !== 'undefined',
    bodyText: (document.body.innerText || '').slice(0, 120).replace(/\s+/g, ' ').trim(),
  }));
  await lp.screenshot({ path: `${OUT}/01_landing_top.png` });
  // 워크스루 영역까지 스크롤(Lenis 관성 트리거)
  await lp.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
  await new Promise(r => setTimeout(r, 1400));
  await lp.screenshot({ path: `${OUT}/02_landing_mid.png` });
  report.landing = landing;
  await lp.close();

  // ── 2) 앱 (/index.html) — SPA + 오로라 패럴랙스 이식 확인 ──
  const ap = await browser.newPage();
  await ap.setViewport({ width: 420, height: 900 });
  await ap.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1800));
  // 앱 페이지를 스크롤시켜 --sky-y 가 갱신되는지 측정
  const skyBefore = await ap.evaluate(() => getComputedStyle(document.getElementById('sky')).getPropertyValue('--sky-y') || document.getElementById('sky')?.style.getPropertyValue('--sky-y') || '');
  await ap.evaluate(() => {
    const p = document.querySelector('.pages > .page.active');
    if (p) p.scrollTop = 400;
    p && p.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 900));
  const app = await ap.evaluate(() => {
    const sky = document.getElementById('sky');
    const skyY = sky ? (sky.style.getPropertyValue('--sky-y') || getComputedStyle(sky).getPropertyValue('--sky-y')) : '';
    const tf = sky ? getComputedStyle(sky).transform : '';
    return {
      hasSky: !!sky,
      skyTransform: tf,
      skyYAfterScroll: (skyY || '').trim(),
      hasDreamInput: !!document.getElementById('dreamInput'),
      hasAuroraHero: !!document.querySelector('.aurora-hero'),
      activePage: document.querySelector('.pages > .page.active')?.id || null,
    };
  });
  app.skyYBefore = (skyBefore || '').trim();
  await ap.screenshot({ path: `${OUT}/03_app_dream.png` });
  report.app = app;
  await ap.close();
} catch (e) {
  report.error = String(e && e.stack || e);
} finally {
  await browser.close();
}

fs.writeFileSync(`${OUT}/capture_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
