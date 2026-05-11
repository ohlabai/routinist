// cafe24 routinist 의 상품후기 (board_no=4) 를 Playwright 로 크롤링 + 우리 DB 에 import.
// 1) body innerText 가져옴 (cafe24 frontend 가 SPA 라 SSR HTML 미사용)
// 2) 정규식으로 row 분리 (product_name → title → body → author → date → view_count)
// 3) product_name → 우리 products.id 매칭 (cafe24_product_code 또는 이름 매칭)
// 4) admin_import_cafe24_review RPC (service_role) 로 INSERT

import pkg from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
const { chromium } = pkg;

const URL_LIST = 'https://routinist.cafe24.com/board/review/list.html?board_no=4';
const PROJ_REF = 'linkabdqhnzanmbmwyzp';
const SB_TOKEN = fs.readFileSync(`${os.homedir()}/.supabase/access-token`, 'utf8').trim();

async function sb(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${SB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`SB ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ────────────── 1) Playwright 로 페이지 렌더 + 본문 추출 ──────────────
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();
await page.goto(URL_LIST, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4000);
for (let i = 0; i < 5; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * 1500);
  await page.waitForTimeout(400);
}
const text = await page.evaluate(() => document.body.innerText);
await browser.close();
console.log('text dump:', text.length, 'bytes');

// ────────────── 2) 패턴 파싱 ──────────────
// 각 row 패턴:
//   <product_name>
//   <title 줄>
//   <body 여러 줄>
//   <빈 줄 또는 (반복된 body) 또는 …>
//   <author 줄 — '****' 포함>
//   <date 줄 — YYYY-MM-DD>
//   <view_count — 숫자만>
//   다음 row 시작 (product_name)
const lines = text.split('\n').map(l => l.trim());
const reviews = [];
let i = 0;
while (i < lines.length) {
  if (!lines[i].startsWith('루티니스트')) { i++; continue; }
  const productName = lines[i];
  i++;
  // title — 다음 비빈 줄
  while (i < lines.length && !lines[i]) i++;
  const title = lines[i] ?? '';
  i++;
  // body — author (****) 만나기 전까지
  const bodyParts = [];
  while (i < lines.length && !/\*{3,}/.test(lines[i])) {
    if (lines[i]) bodyParts.push(lines[i]);
    i++;
  }
  // 마지막 reprint 본문 (… 끝) 제거 — 첫 chunk 만 의미
  let body = bodyParts.join('\n').trim();
  // '···' 또는 ' ··· ' 로 끝나는 마지막 라인이 reprint duplicate 라 제거
  body = body.replace(/[\s·]+$/, '').trim();
  // duplicate 줄 제거 — 첫 절반 + 둘째 절반이 같으면 첫 것만
  if (bodyParts.length >= 2) {
    const last = bodyParts[bodyParts.length - 1];
    const beforeDup = bodyParts.slice(0, -1).join('\n').replace(/\s+/g, '');
    if (last.replace(/[\s·]+/g, '').length > 0 &&
        beforeDup.includes(last.replace(/[\s·]+/g, '').slice(0, 30))) {
      body = bodyParts.slice(0, -1).join('\n').trim();
    }
  }
  const author = lines[i] ?? '';
  i++;
  const date = lines[i] ?? '';
  i++;
  const viewCount = parseInt(lines[i] ?? '0', 10);
  i++;
  if (productName && title && author && date) {
    reviews.push({ product_name: productName, title, body, author, date, view_count: viewCount });
  }
}
console.log(`parsed ${reviews.length} reviews`);
console.log(JSON.stringify(reviews.slice(0, 2), null, 2));

if (reviews.length === 0) {
  console.error('파싱 0건 — 로직 점검 필요');
  process.exit(1);
}

// ────────────── 3) 우리 DB products 매핑 ──────────────
const productRows = await sb(`SELECT id, name FROM public.products WHERE source='cafe24' ORDER BY name;`);
const products = Array.isArray(productRows) ? productRows : [];
console.log(`DB products: ${products.length}`);

const matchProduct = (cafeName) => {
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  const target = norm(cafeName);
  // exact name 매칭
  for (const p of products) {
    if (norm(p.name) === target) return p;
  }
  // partial 매칭 — cafe24 이름이 우리 이름의 접두사 또는 포함
  for (const p of products) {
    if (target.startsWith(norm(p.name).slice(0, 15))) return p;
    if (norm(p.name).startsWith(target.slice(0, 15))) return p;
  }
  return null;
};

// ────────────── 4) INSERT (Management API 로 SQL 직접) ──────────────
let imported = 0;
let skipped = 0;
let unmatched = 0;
const errors = [];

for (const r of reviews) {
  const prod = matchProduct(r.product_name);
  if (!prod) {
    unmatched++;
    errors.push(`unmatched: ${r.product_name}`);
    continue;
  }
  // 외부 ID — author + date + title 의 hash 로 멱등
  const external_id = `cafe24-${r.date}-${r.author}-${r.title}`.replace(/['"]/g, '').slice(0, 100);
  const title = r.title.replace(/'/g, "''");
  const body = (r.title + '\n\n' + r.body).replace(/'/g, "''").slice(0, 2000);
  const author = r.author.replace(/'/g, "''");
  const extId = external_id.replace(/'/g, "''");
  const rating = 5;  // cafe24 frontend 에 별점 안 노출 — 기본 5점 (사용자가 admin 에서 수정 가능)
  const createdAt = `${r.date} 12:00:00+00`;

  try {
    await sb(`
      INSERT INTO public.product_reviews
        (product_id, user_id, rating, body, source, external_author, external_id, created_at)
      VALUES
        ('${prod.id}', NULL, ${rating}, '${body}', 'cafe24', '${author}', '${extId}', '${createdAt}')
      ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET body = EXCLUDED.body, external_author = EXCLUDED.external_author;
    `);
    imported++;
  } catch (e) {
    skipped++;
    errors.push(`${prod.name}: ${e.message?.slice(0, 80)}`);
  }
}

// 캐시 갱신 — 매핑된 product 들 rating cache
const productIds = new Set();
for (const r of reviews) {
  const p = matchProduct(r.product_name);
  if (p) productIds.add(p.id);
}
for (const pid of productIds) {
  await sb(`
    UPDATE public.products SET
      rating_count = (SELECT COUNT(*) FROM public.product_reviews WHERE product_id = '${pid}' AND NOT is_hidden),
      rating_avg = COALESCE((SELECT AVG(rating)::NUMERIC(3,2) FROM public.product_reviews WHERE product_id = '${pid}' AND NOT is_hidden), 0)
    WHERE id = '${pid}';
  `).catch(() => {});
}

console.log(`\n===== 결과 =====`);
console.log(`imported: ${imported}`);
console.log(`unmatched: ${unmatched}`);
console.log(`skipped: ${skipped}`);
console.log(`products affected: ${productIds.size}`);
if (errors.length) {
  console.log(`\nerrors:`);
  errors.slice(0, 10).forEach(e => console.log(' ', e));
}
