#!/usr/bin/env npx tsx
/**
 * Cafe24 Open API → Supabase products 동기화 스크립트.
 *
 * 사용법:
 *   1) Cafe24 개발자센터 (https://developers.cafe24.com) 에서 앱 생성
 *   2) Authorization Code → Access Token 발급
 *   3) .env.local 에 추가:
 *        CAFE24_MALL_ID=routinist
 *        CAFE24_CLIENT_ID=...
 *        CAFE24_CLIENT_SECRET=...
 *        CAFE24_ACCESS_TOKEN=...
 *        CAFE24_REFRESH_TOKEN=...
 *        CAFE24_TOKEN_EXPIRES_AT=ISO8601    (선택, refresh 판단용)
 *        SUPABASE_SERVICE_ROLE_KEY=...
 *   4) 실행: npm run cafe24:import
 *
 * 동작:
 *   - access_token 만료 < 5분 시 refresh_token 으로 자동 갱신 → .env.local 업데이트
 *   - Cafe24 /api/v2/admin/products 활성 상품 페이지네이션 모두 가져옴
 *   - source='cafe24', external_id=product_no 로 upsert
 *   - 옵션 (variants), 카테고리 (별도 endpoint), 브랜드 (별도 endpoint) 까지 동기화
 *
 * 주기:
 *   - 수동: 새 상품 등록 시
 *   - cron: Vercel Cron 또는 GitHub Actions 로 1일 1회 (refresh_token 14일 유효)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

// .env.local 명시적 로드 (Next.js 컨벤션과 일치 — dotenv/config 는 기본 .env 만 읽음)
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env'), override: false });

interface Cafe24ProductCategory {
  category_no: number;
  recommend?: string;
  new?: string;
}

interface Cafe24Product {
  product_no: number;
  product_name: string;
  product_code?: string;
  price: string;
  retail_price?: string;
  display: 'T' | 'F';
  selling: 'T' | 'F';
  description?: string;
  detail_image?: string;
  list_image?: string;
  small_image?: string;
  brand_code?: string;
  category?: Cafe24ProductCategory[];
  quantity?: number;
}

interface Cafe24VariantOption {
  name: string;
  value: string;
}

interface Cafe24Variant {
  variant_code: string;
  product_no?: number;
  options: Cafe24VariantOption[];
  display: 'T' | 'F';
  selling: 'T' | 'F';
  display_order: number;
  quantity: number;
  additional_amount: string;
}

const MALL_ID = process.env.CAFE24_MALL_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENV_PATH = resolve(process.cwd(), '.env.local');

let ACCESS_TOKEN = process.env.CAFE24_ACCESS_TOKEN ?? '';

function check(): void {
  const missing: string[] = [];
  if (!MALL_ID) missing.push('CAFE24_MALL_ID');
  if (!ACCESS_TOKEN) missing.push('CAFE24_ACCESS_TOKEN');
  if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error(`❌ env 누락: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const CAFE24_BASE = `https://${MALL_ID}.cafe24api.com/api/v2/admin`;

async function refreshAccessTokenIfNeeded(): Promise<void> {
  const expAt = process.env.CAFE24_TOKEN_EXPIRES_AT;
  if (!expAt) return;
  const expDate = new Date(expAt);
  const minutesLeft = (expDate.getTime() - Date.now()) / 60000;
  if (minutesLeft > 5) return; // 5분 이상 남으면 그대로 사용

  const clientId = process.env.CAFE24_CLIENT_ID;
  const clientSecret = process.env.CAFE24_CLIENT_SECRET;
  const refreshToken = process.env.CAFE24_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('⚠️ access_token 만료 임박 + refresh 자격 증명 누락 — 재인증 필요');
    return;
  }

  console.log(`🔄 access_token 만료 ${minutesLeft.toFixed(1)}분 남음 — refresh 시도`);
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch(`https://${MALL_ID}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error(`❌ refresh 실패: ${txt.slice(0, 200)}`);
    process.exit(1);
  }
  const json = await r.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
    refresh_token_expires_at: string;
  };
  ACCESS_TOKEN = json.access_token;
  console.log('✅ refresh 성공 — 새 access_token 으로 .env.local 업데이트');

  // .env.local 업데이트
  await updateEnvLocal({
    CAFE24_ACCESS_TOKEN: json.access_token,
    CAFE24_REFRESH_TOKEN: json.refresh_token,
    CAFE24_TOKEN_EXPIRES_AT: json.expires_at,
    CAFE24_REFRESH_EXPIRES_AT: json.refresh_token_expires_at,
  });
}

async function updateEnvLocal(updates: Record<string, string>): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(ENV_PATH, 'utf-8');
  } catch {
    // .env.local 없으면 새로 생성
  }
  const lines = content ? content.split('\n') : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      out.push(`${m[1]}=${updates[m[1]]}`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  await fs.writeFile(ENV_PATH, out.join('\n').replace(/\n+$/, '') + '\n');
}

async function cafe24Fetch<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${CAFE24_BASE}${path}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Cafe24-Api-Version': '2026-03-01',
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Cafe24 API ${r.status} (${path}): ${txt.slice(0, 200)}`);
  }
  return await r.json() as T;
}

async function fetchAllProducts(): Promise<Cafe24Product[]> {
  const out: Cafe24Product[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    type Resp = { products: Cafe24Product[] };
    const data = await cafe24Fetch<Resp>(`/products?limit=${limit}&offset=${offset}&display=T`);
    const arr = data.products ?? [];
    out.push(...arr);
    if (arr.length < limit) break;
    offset += limit;
  }
  return out;
}

async function fetchProductDetail(productNo: number): Promise<Cafe24Product | null> {
  try {
    type Resp = { product: Cafe24Product };
    const data = await cafe24Fetch<Resp>(`/products/${productNo}`);
    return data.product;
  } catch (e) {
    console.warn(`  ⚠️ product detail ${productNo} fetch fail:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchVariants(productNo: number): Promise<Cafe24Variant[]> {
  try {
    type Resp = { variants: Cafe24Variant[] };
    const data = await cafe24Fetch<Resp>(`/products/${productNo}/variants`);
    return data.variants ?? [];
  } catch {
    return [];
  }
}

async function fetchAllBrands(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    type Resp = { brands: { brand_code: string; brand_name: string }[] };
    const data = await cafe24Fetch<Resp>(`/brands?limit=100`);
    for (const b of data.brands ?? []) {
      map.set(b.brand_code, b.brand_name);
    }
  } catch (e) {
    console.warn('⚠️ brands fetch fail:', e instanceof Error ? e.message : e);
  }
  return map;
}

async function fetchCategoryName(categoryNo: number, cache: Map<number, string>): Promise<string | null> {
  if (cache.has(categoryNo)) return cache.get(categoryNo) ?? null;
  try {
    type Resp = { category: { category_no: number; category_name: string } };
    const data = await cafe24Fetch<Resp>(`/categories/${categoryNo}`);
    const name = data.category?.category_name ?? null;
    if (name) cache.set(categoryNo, name);
    return name;
  } catch {
    return null;
  }
}

function formatVariantOptions(options: Cafe24VariantOption[]): { name: string | null; value: string | null } {
  if (!options || options.length === 0) return { name: null, value: null };
  // 옵션 1개면 그대로, 여러개면 합쳐서 표시
  if (options.length === 1) {
    return { name: options[0].name || null, value: options[0].value || null };
  }
  const namePart = options.map(o => o.name).filter(Boolean).join(' / ');
  const valuePart = options.map(o => o.value).filter(Boolean).join(' / ');
  return { name: namePart || null, value: valuePart || null };
}

async function main(): Promise<void> {
  check();
  await refreshAccessTokenIfNeeded();

  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`🛒 Cafe24 (${MALL_ID}) 상품 동기화 시작...`);

  const [cafeProducts, brandsMap] = await Promise.all([
    fetchAllProducts(),
    fetchAllBrands(),
  ]);
  console.log(`📦 Cafe24 에서 ${cafeProducts.length}개 상품 로드, ${brandsMap.size}개 브랜드 캐시`);

  const categoryCache = new Map<number, string>();

  let inserted = 0;
  let updated = 0;
  let archived = 0;
  let variantsTotal = 0;

  for (const cp of cafeProducts) {
    // detail fetch — 카테고리/브랜드/이미지 등 추가 정보
    const detail = await fetchProductDetail(cp.product_no);
    const data = detail ?? cp;

    const externalId = String(data.product_no);
    const price = parseInt(data.price, 10) || 0;
    const comparePrice = data.retail_price ? parseInt(data.retail_price, 10) || null : null;
    const isActive = data.display === 'T' && data.selling === 'T' && price > 0;
    const status = isActive ? 'published' : 'archived';
    const imagesArr: string[] = [];
    if (data.detail_image) imagesArr.push(data.detail_image);

    // 카테고리 첫 번째 해석
    let categoryName: string | null = null;
    if (Array.isArray(data.category) && data.category.length > 0) {
      // 가장 깊은 (구체적인) 카테고리 우선 — 없으면 첫 번째
      const firstCat = data.category[data.category.length - 1] ?? data.category[0];
      categoryName = await fetchCategoryName(firstCat.category_no, categoryCache);
    }

    // 브랜드 명 해석
    const brandName = data.brand_code ? brandsMap.get(data.brand_code) ?? null : null;

    const productPayload = {
      external_id: externalId,
      source: 'cafe24',
      name: data.product_name,
      description: data.description ?? null,
      price_krw: price,
      compare_price_krw: comparePrice,
      thumbnail_url: data.list_image ?? data.detail_image ?? data.small_image ?? null,
      images: imagesArr,
      stock: data.quantity ?? 0,
      brand: brandName,
      category: categoryName,
      status,
      is_active: isActive,
      metadata: {
        cafe24_product_code: data.product_code,
        cafe24_brand_code: data.brand_code,
        cafe24_categories: data.category,
      },
    };

    // products upsert
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('source', 'cafe24')
      .eq('external_id', externalId)
      .maybeSingle();

    let productId: string | null = (existing as { id: string } | null)?.id ?? null;

    if (productId) {
      const { error } = await supabase.from('products').update(productPayload).eq('id', productId);
      if (error) {
        console.warn(`  ⚠️ 업데이트 실패 ${data.product_name}: ${error.message}`);
        continue;
      }
      if (status === 'archived') archived++;
      else updated++;
    } else {
      const { data: created, error } = await supabase
        .from('products').insert(productPayload).select('id').single();
      if (error) {
        console.warn(`  ⚠️ 삽입 실패 ${data.product_name}: ${error.message}`);
        continue;
      }
      productId = (created as { id: string }).id;
      inserted++;
    }

    // variants 동기화
    if (isActive && productId) {
      const variants = await fetchVariants(data.product_no);
      for (const v of variants) {
        const { name: optName, value: optValue } = formatVariantOptions(v.options);
        const priceDelta = parseInt(v.additional_amount, 10) || 0;
        const stock = v.quantity ?? 0;
        const isVActive = v.display === 'T' && v.selling === 'T';

        const { data: existingV } = await supabase
          .from('shop_product_variants')
          .select('id')
          .eq('product_id', productId)
          .eq('external_id', v.variant_code)
          .maybeSingle();
        const vPayload = {
          product_id: productId,
          external_id: v.variant_code,
          option_name: optName,
          option_value: optValue,
          price_delta_krw: priceDelta,
          stock: isVActive ? stock : 0,
          position: v.display_order ?? 0,
        };
        if (existingV) {
          await supabase.from('shop_product_variants').update(vPayload)
            .eq('id', (existingV as { id: string }).id);
        } else {
          await supabase.from('shop_product_variants').insert(vPayload);
        }
        variantsTotal++;
      }
    }
  }

  console.log(`✅ 완료: 신규 ${inserted}건, 수정 ${updated}건, 비활성 ${archived}건, 옵션 ${variantsTotal}건`);
}

main().catch(e => {
  console.error('❌ 실패:', e);
  process.exit(1);
});
