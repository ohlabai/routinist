#!/usr/bin/env npx tsx
/**
 * Cafe24 Open API → Supabase products 동기화 스크립트.
 *
 * 사용법:
 *   1) Cafe24 개발자센터 (https://developers.cafe24.com) 에서 앱 생성
 *   2) Authorization Code → Access Token 발급
 *   3) .env.local 에 추가:
 *        CAFE24_MALL_ID=routinist
 *        CAFE24_ACCESS_TOKEN=xxx
 *        CAFE24_REFRESH_TOKEN=yyy   (선택)
 *        SUPABASE_SERVICE_ROLE_KEY=...
 *   4) 실행: npx tsx scripts/cafe24_import.ts
 *
 * 동작:
 *   - Cafe24 /api/v2/admin/products 에서 활성 상품 페이지네이션으로 모두 가져옴
 *   - source='cafe24', external_id=product_no 로 upsert
 *   - 기존 동일 external_id 가 있으면 update, 없으면 insert
 *   - 가격, 재고, 이미지, 카테고리 동기화
 *   - 옵션 (variants) 도 함께 동기화 (별도 endpoint /products/{no}/variants)
 *
 * 주기:
 *   - 수동: 새 상품 등록 시
 *   - cron: Vercel Cron 또는 GitHub Actions 로 1일 1회
 *
 * 주의:
 *   - manual 입력 상품 (source='manual') 은 건드리지 않음
 *   - Cafe24 측 가격이 0 이거나 status=비활성이면 archived 처리
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

interface Cafe24Product {
  product_no: number;
  product_name: string;
  product_code?: string;
  price: string;       // 문자열로 옴 (Cafe24 API 특이)
  retail_price?: string;
  display: 'T' | 'F';
  selling: 'T' | 'F';
  description?: string;
  detail_image?: string;
  list_image?: string;
  brand_code?: string;
  category?: { category_no: number; category_name?: string }[];
  quantity?: number;
}

interface Cafe24Variant {
  variants_code: string;
  product_no: number;
  options: { option_name: string; option_value: string }[];
  display: 'T' | 'F';
  selling: 'T' | 'F';
  quantity: number;
  additional_amount: string;
}

const MALL_ID = process.env.CAFE24_MALL_ID;
const ACCESS_TOKEN = process.env.CAFE24_ACCESS_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function cafe24Fetch<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${CAFE24_BASE}${path}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Cafe24-Api-Version': '2024-09-01',
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Cafe24 API ${r.status}: ${txt.slice(0, 200)}`);
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

async function fetchVariants(productNo: number): Promise<Cafe24Variant[]> {
  try {
    type Resp = { variants: Cafe24Variant[] };
    const data = await cafe24Fetch<Resp>(`/products/${productNo}/variants`);
    return data.variants ?? [];
  } catch {
    // variants 없는 상품은 404 가능
    return [];
  }
}

async function main(): Promise<void> {
  check();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`🛒 Cafe24 (${MALL_ID}) 상품 동기화 시작...`);
  const cafeProducts = await fetchAllProducts();
  console.log(`📦 Cafe24 에서 ${cafeProducts.length}개 상품 로드 완료`);

  let inserted = 0;
  let updated = 0;
  let archived = 0;
  let variantsTotal = 0;

  for (const cp of cafeProducts) {
    const externalId = String(cp.product_no);
    const price = parseInt(cp.price, 10) || 0;
    const comparePrice = cp.retail_price ? parseInt(cp.retail_price, 10) : null;
    const isActive = cp.display === 'T' && cp.selling === 'T' && price > 0;
    const status = isActive ? 'published' : 'archived';
    const imagesArr: string[] = [];
    if (cp.detail_image) imagesArr.push(cp.detail_image);
    if (cp.list_image && cp.list_image !== cp.detail_image) imagesArr.push(cp.list_image);

    // products upsert (source+external_id 유니크)
    const { data: existing } = await supabase
      .from('products')
      .select('id, source')
      .eq('source', 'cafe24')
      .eq('external_id', externalId)
      .maybeSingle();

    const productPayload = {
      external_id: externalId,
      source: 'cafe24',
      name: cp.product_name,
      description: cp.description ?? null,
      price_krw: price,
      compare_price_krw: comparePrice,
      thumbnail_url: cp.list_image ?? cp.detail_image ?? null,
      images: imagesArr,
      stock: cp.quantity ?? 0,
      brand: cp.brand_code ?? null,
      category: cp.category?.[0]?.category_name ?? null,
      status,
      is_active: isActive,
      metadata: { cafe24_product_code: cp.product_code },
    };

    if (existing) {
      const { error } = await supabase.from('products').update(productPayload).eq('id', (existing as { id: string }).id);
      if (error) {
        console.warn(`  ⚠️ 업데이트 실패 ${cp.product_name}: ${error.message}`);
        continue;
      }
      if (status === 'archived') archived++;
      else updated++;
    } else {
      const { error } = await supabase.from('products').insert(productPayload);
      if (error) {
        console.warn(`  ⚠️ 삽입 실패 ${cp.product_name}: ${error.message}`);
        continue;
      }
      inserted++;
    }

    // variants 동기화 (옵션 있는 상품만)
    if (isActive) {
      const variants = await fetchVariants(cp.product_no);
      if (variants.length > 0) {
        const { data: prodRow } = await supabase
          .from('products')
          .select('id')
          .eq('source', 'cafe24')
          .eq('external_id', externalId)
          .maybeSingle();
        if (prodRow) {
          const productId = (prodRow as { id: string }).id;
          for (const v of variants) {
            const optName = v.options?.[0]?.option_name ?? null;
            const optValue = v.options?.map(o => o.option_value).join(' / ') ?? null;
            const priceDelta = parseInt(v.additional_amount, 10) || 0;
            const stock = v.quantity ?? 0;

            const { data: existingV } = await supabase
              .from('shop_product_variants')
              .select('id')
              .eq('product_id', productId)
              .eq('external_id', v.variants_code)
              .maybeSingle();
            const vPayload = {
              product_id: productId,
              external_id: v.variants_code,
              option_name: optName,
              option_value: optValue,
              price_delta_krw: priceDelta,
              stock,
            };
            if (existingV) {
              await supabase.from('shop_product_variants').update(vPayload).eq('id', (existingV as { id: string }).id);
            } else {
              await supabase.from('shop_product_variants').insert(vPayload);
            }
            variantsTotal++;
          }
        }
      }
    }
  }

  console.log(`✅ 완료: 신규 ${inserted}건, 수정 ${updated}건, 비활성 ${archived}건, 옵션 ${variantsTotal}건`);
}

main().catch(e => {
  console.error('❌ 실패:', e);
  process.exit(1);
});
