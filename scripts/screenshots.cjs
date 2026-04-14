// 몽글몽글 — 스토어 스크린샷 자동 생성
// 실행: node scripts/screenshots.js
// 필요: npx vite preview가 localhost:4173에서 실행 중이어야 함

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://localhost:4173/monggeul/';
const OUT = path.join(__dirname, '..', 'screenshots');

// 디바이스 프리셋
const DEVICES = {
  'iphone-6.7': { width: 430, height: 932, scale: 3, suffix: '1290x2796' },   // iPhone 15 Pro Max
  'iphone-5.5': { width: 414, height: 736, scale: 3, suffix: '1242x2208' },   // iPhone 8 Plus
  'android':    { width: 412, height: 915, scale: 2.625, suffix: '1080x2400' }, // Pixel 7
};

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const [device, spec] of Object.entries(DEVICES)) {
    console.log(`\n📱 ${device} (${spec.suffix})`);
    const page = await browser.newPage();
    await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: spec.scale });

    // 다크모드 강제
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

    // 1. 해몽 탭 (메인)
    console.log('  1/5 해몽 탭...');
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r=>setTimeout(r,2000));
    // 스플래시 제거
    await page.evaluate(() => { const s = document.getElementById('appSplash'); if (s) s.remove(); });
    // 온보딩/로그인 모달 닫기
    await page.evaluate(() => {
      const onb = document.getElementById('onboardingOverlay'); if (onb) onb.style.display = 'none';
      const login = document.getElementById('loginModal'); if (login) login.style.display = 'none';
      localStorage.setItem('mg_onboarded', '1');
      localStorage.setItem('mg_login_skipped', '1');
    });
    await new Promise(r=>setTimeout(r,500));
    await page.screenshot({ path: `${OUT}/${device}_01_dream.png` });
    console.log('    ✅ 01_dream.png');

    // 2. 달이 탭
    console.log('  2/5 달이 탭...');
    await page.evaluate(() => window.switchTab('chat'));
    await new Promise(r=>setTimeout(r,1500));
    await page.screenshot({ path: `${OUT}/${device}_02_dali.png` });
    console.log('    ✅ 02_dali.png');

    // 3. 커뮤니티 탭
    console.log('  3/5 커뮤니티 탭...');
    await page.evaluate(() => window.switchTab('community'));
    await new Promise(r=>setTimeout(r,1000));
    await page.screenshot({ path: `${OUT}/${device}_03_community.png` });
    console.log('    ✅ 03_community.png');

    // 4. MY 탭
    console.log('  4/5 MY 탭...');
    await page.evaluate(() => window.switchTab('log'));
    await new Promise(r=>setTimeout(r,1000));
    await page.screenshot({ path: `${OUT}/${device}_04_my.png` });
    console.log('    ✅ 04_my.png');

    // 5. 해몽 결과 (데모)
    console.log('  5/5 해몽 결과...');
    await page.evaluate(() => window.switchTab('dream'));
    await new Promise(r=>setTimeout(r,500));
    // 데모 결과 표시
    await page.evaluate(() => {
      const demo = {
        title: '🐍 재물이 온다',
        badges: ['길몽', '재물운'],
        stats: { '길흉': 82, '연애운': 45, '재물운': 91, '건강운': 60, '활력': 74, '직관': 88 },
        emotions: ['😮 놀라움', '😨 긴장', '✨ 기대감'],
        preview: '꿈에서 <strong>황금 뱀</strong>이 나타났어요. 이 꿈은 <strong>재물과 행운</strong>의 강력한 상징이에요. 특히 뱀의 색과 행동에 중요한 비밀이 숨겨져 있어요. 더 깊은 분석이 준비되어 있어요...',
      };
      if (typeof showResult === 'function') showResult(demo, '뱀이 나왔어요');
    });
    await new Promise(r=>setTimeout(r,2000));
    // 결과로 스크롤
    await page.evaluate(() => {
      const el = document.getElementById('resultEl');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await new Promise(r=>setTimeout(r,500));
    await page.screenshot({ path: `${OUT}/${device}_05_result.png` });
    console.log('    ✅ 05_result.png');

    await page.close();
  }

  await browser.close();
  console.log(`\n✅ 완료! ${OUT} 폴더에 ${Object.keys(DEVICES).length * 5}장 생성됨`);
  console.log('\n📋 스토어 업로드:');
  console.log('  iOS: iphone-6.7_*.png (6.7인치) + iphone-5.5_*.png (5.5인치)');
  console.log('  Android: android_*.png');
}

run().catch(e => { console.error('❌ 에러:', e.message); process.exit(1); });
