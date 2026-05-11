// v4 — body innerText 를 행 패턴으로 split 해서 정규식 파싱. selector 의존 X.
import pkg from 'playwright';
import fs from 'node:fs';
const { chromium } = pkg;

const URL_LIST = 'https://routinist.cafe24.com/board/review/list.html?board_no=4';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();

await page.goto(URL_LIST, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4000);
// 페이지 전체 스크롤
for (let i = 0; i < 5; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * 1500);
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);

// HTML 전체 dump
const html = await page.content();
fs.writeFileSync('/tmp/cafe24_reviews_rendered.html', html);
console.log('HTML dump:', html.length, 'bytes → /tmp/cafe24_reviews_rendered.html');

// body innerText 도 dump
const text = await page.evaluate(() => document.body.innerText);
fs.writeFileSync('/tmp/cafe24_reviews_text.txt', text);
console.log('text dump:', text.length, 'bytes → /tmp/cafe24_reviews_text.txt');

await browser.close();
