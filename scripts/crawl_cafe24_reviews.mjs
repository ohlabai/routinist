// cafe24 routinist.cafe24.com 의 상품후기 게시판 크롤링.
// /board/review/list.html?board_no=4 를 Playwright 로 렌더 후 리뷰 row 추출.
// 각 리뷰: 별점, 본문, 작성자, 작성일, 연결 상품 (있으면).

import pkg from 'playwright';
const { chromium } = pkg;

const URL_LIST = 'https://routinist.cafe24.com/board/review/list.html?board_no=4';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

console.log('→ 페이지 로드:', URL_LIST);
await page.goto(URL_LIST, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// 후기 리스트의 row 추출 — cafe24 의 표준 클래스 시도
const reviews = await page.evaluate(() => {
  // 다양한 selector 시도 (cafe24 신/구 스킨)
  const rowSelectors = [
    'table.boardList tbody tr',
    '.df-board__list-row',
    'tr.xans-record-',
    'li.xans-record-',
    '[class*="review"] tbody tr',
  ];
  let rows = [];
  for (const sel of rowSelectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      rows = Array.from(els);
      console.log(`[debug] selector ${sel} → ${els.length} rows`);
      break;
    }
  }

  // 각 row 의 텍스트 추출
  return rows.map((row) => {
    const text = row.textContent?.trim().replace(/\s+/g, ' ').slice(0, 800) ?? '';
    // 별점 추정 — img alt 또는 class
    const stars = row.querySelectorAll('img[src*="star"], img[alt*="별점"], [class*="rating"]').length;
    const link = row.querySelector('a[href*="board"]')?.getAttribute('href') ?? null;
    return { text, stars, link };
  });
});

console.log(`\n→ ${reviews.length} rows 추출`);
console.log(JSON.stringify(reviews.slice(0, 10), null, 2));

// 페이지 전체 HTML 일부도 디버그 출력
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
console.log('\n=== body text 일부 ===');
console.log(bodyText);

await browser.close();
