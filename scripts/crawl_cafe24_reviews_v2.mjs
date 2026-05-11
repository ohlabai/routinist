// cafe24 routinist 상품후기 (board_no=4) 크롤링 v2.
// 각 row 별로 title / body / author / date / product_name / rating 추출.
// 결과를 JSON 으로 출력하면 supabase RPC 로 일괄 import.

import pkg from 'playwright';
const { chromium } = pkg;

const URL_LIST = 'https://routinist.cafe24.com/board/review/list.html?board_no=4';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await ctx.newPage();

await page.goto(URL_LIST, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);

// 페이지 끝까지 스크롤 (lazy load 대비)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1500);

const reviews = await page.evaluate(() => {
  const rows = document.querySelectorAll('tr.xans-record-, table.boardList tbody tr');
  if (rows.length === 0) {
    // fallback selector
    const alt = document.querySelectorAll('tbody tr');
    return Array.from(alt).map(r => ({ debug: r.outerHTML.slice(0, 200) })).slice(0, 3);
  }

  return Array.from(rows).map((row) => {
    // 별점 — cafe24 의 별점은 통상 grade1~grade5 클래스 또는 img alt="별점 N점"
    let rating = null;
    const gradeEl = row.querySelector('[class*="grade"]');
    if (gradeEl) {
      const m = gradeEl.className.match(/grade(\d)/);
      if (m) rating = parseInt(m[1], 10);
    }
    if (!rating) {
      const starImg = row.querySelector('img[alt*="별점"]');
      if (starImg) {
        const alt = starImg.getAttribute('alt') ?? '';
        const m = alt.match(/(\d)/);
        if (m) rating = parseInt(m[1], 10);
      }
    }

    // 제목 — cafe24 보드의 제목은 td.subject 또는 a (제목 링크) 첫 번째
    const titleEl = row.querySelector('.subject a, td.subject, .title') || row.querySelector('a[href*="board"]');
    let title = titleEl?.textContent?.trim().replace(/\s+/g, ' ') ?? '';

    // 본문 — listing 페이지엔 보통 한 줄 요약. 모든 cell text 합산.
    const bodyCell = row.querySelector('.contents, .content, .body-text, .summary');
    let body = bodyCell?.textContent?.trim().replace(/\s+/g, ' ') ?? '';

    // 작성자 — td.user 또는 user-name 같은 클래스
    const authorEl = row.querySelector('.user-name, .writer, td.writer, [class*="author"]');
    const author = authorEl?.textContent?.trim() ?? '';

    // 날짜 — YYYY-MM-DD 패턴 텍스트
    const allText = row.textContent ?? '';
    const dateMatch = allText.match(/\d{4}-\d{2}-\d{2}/);
    const date = dateMatch?.[0] ?? '';

    // 상품명 — cafe24 리뷰는 row 안에 상품명 표시. 마지막 cell 또는 별도 class.
    const productEl = row.querySelector('.product-name, .pname, a[href*="product/detail"]');
    let productName = productEl?.textContent?.trim() ?? '';

    // 본문 link 도 — 상세 페이지 URL
    const detailLink = row.querySelector('a[href*="article_no"]')?.getAttribute('href') ?? null;

    return {
      title,
      body,
      author,
      date,
      product_name: productName,
      rating,
      detail_url: detailLink,
      // debug: raw text 일부
      _raw: allText.trim().replace(/\s+/g, ' ').slice(0, 300),
    };
  });
});

console.log(`총 ${reviews.length} reviews`);
console.log(JSON.stringify(reviews, null, 2));

await browser.close();
