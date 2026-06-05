// 디자인 목업 스크린샷 — puppeteer 로 HTML→PNG (모바일 뷰포트).
//   실행: node scripts/shoot.mjs design-preview.html design-preview.png
import puppeteer from 'puppeteer';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const inFile = process.argv[2] || 'design-preview.html';
const outFile = process.argv[3] || 'design-preview.png';
const url = pathToFileURL(path.resolve(inFile)).href;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 1100, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));   // 폰트/별 정착
await page.screenshot({ path: outFile, fullPage: true });
await browser.close();
console.log('shot →', outFile);
