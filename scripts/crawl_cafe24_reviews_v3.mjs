// v3 — DOM 구조 파악 (어떤 element 가 review row 인지 자동 탐색).
import pkg from 'playwright';
const { chromium } = pkg;

const URL_LIST = 'https://routinist.cafe24.com/board/review/list.html?board_no=4';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();
await page.goto(URL_LIST, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1500);

// 1) 어떤 selector 가 row 단위인지 자동 탐색
const candidates = await page.evaluate(() => {
  // 페이지의 div/li/tr 중 "루티니스트" 텍스트 + 작성자 (****) + 날짜 패턴 다 가진 element
  const all = document.querySelectorAll('div, li, tr, article');
  const matches = [];
  for (const el of all) {
    const t = el.textContent ?? '';
    if (t.includes('루티니스트') && /\*{3,}/.test(t) && /\d{4}-\d{2}-\d{2}/.test(t) && t.length < 2000) {
      // 너무 큰 컨테이너 제외 — 직계 부모가 같은 패턴이면 skip
      const parentMatch = el.parentElement && /\*{3,}/.test(el.parentElement.textContent ?? '') && el.parentElement.textContent !== t;
      if (!parentMatch) {
        matches.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className,
          textLen: t.length,
          textSample: t.trim().replace(/\s+/g, ' ').slice(0, 200),
        });
      }
    }
  }
  // 가장 빈도 높은 className 찾기
  const classFreq = {};
  matches.forEach(m => { if (m.cls) classFreq[m.cls] = (classFreq[m.cls] ?? 0) + 1; });
  return {
    totalMatched: matches.length,
    classFreq: Object.entries(classFreq).sort((a,b)=>b[1]-a[1]).slice(0, 5),
    sampleMatches: matches.slice(0, 3),
  };
});
console.log('=== 분석 결과 ===');
console.log(JSON.stringify(candidates, null, 2));

await browser.close();
