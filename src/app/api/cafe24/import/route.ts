// Cafe24 상품 자동 동기화 API.
//
// 호출 방법:
// - Vercel Cron (vercel.json) — 매일 새벽 4시 KST
// - 어드민 콘솔 수동 트리거 (CRON_SECRET 헤더)
//
// 흐름:
// 1. oauth_tokens 에서 cafe24 토큰 조회
// 2. 만료 5분 이내면 refresh_token 으로 갱신 + DB 업데이트
// 3. Cafe24 API 호출 → products / variants / brands / categories 통합 fetch
// 4. Supabase products / shop_product_variants upsert
//
// 환경변수 필수:
// - CAFE24_CLIENT_ID, CAFE24_CLIENT_SECRET (refresh 용)
// - CAFE24_MALL_ID (기본 'routinist')
// - SUPABASE_SERVICE_ROLE_KEY
// - PUSH_CRON_SECRET (cron 인증 — 푸시랑 공유)

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface OAuthTokenRow {
  id: string;
  provider: string;
  account_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
}

interface Cafe24Category { category_no: number; recommend?: string; new?: string }
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
  category?: Cafe24Category[];
  quantity?: number;
}
interface Cafe24VariantOption { name: string; value: string }
interface Cafe24Variant {
  variant_code: string;
  options: Cafe24VariantOption[];
  display: 'T' | 'F';
  selling: 'T' | 'F';
  display_order: number;
  quantity: number;
  additional_amount: string;
}

async function authenticate(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.PUSH_CRON_SECRET;
  if (!cronSecret) return false;
  const auth = req.headers.get('authorization') ?? '';
  const queryToken = req.nextUrl.searchParams.get('token');
  return auth === `Bearer ${cronSecret}` || queryToken === cronSecret;
}

async function getValidToken(supabase: SupabaseClient, mallId: string): Promise<string | null> {
  const { data } = await supabase
    .from('oauth_tokens')
    .select('id, provider, account_id, access_token, refresh_token, expires_at')
    .eq('provider', 'cafe24')
    .eq('account_id', mallId)
    .maybeSingle();
  if (!data) return null;
  const tok = data as OAuthTokenRow;

  const expDate = new Date(tok.expires_at);
  const minLeft = (expDate.getTime() - Date.now()) / 60000;
  if (minLeft > 5) return tok.access_token;

  // refresh 필요
  const clientId = process.env.CAFE24_CLIENT_ID;
  const clientSecret = process.env.CAFE24_CLIENT_SECRET;
  if (!clientId || !clientSecret || !tok.refresh_token) {
    console.warn('[cafe24/import] refresh 자격증명 누락');
    return null;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }).toString(),
  });
  if (!r.ok) {
    console.error('[cafe24/import] refresh fail', await r.text().catch(() => ''));
    return null;
  }
  const json = await r.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
    refresh_token_expires_at: string;
  };
  await supabase.from('oauth_tokens').update({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_at,
    refresh_expires_at: json.refresh_token_expires_at,
  }).eq('id', tok.id);
  console.log('[cafe24/import] token refreshed');
  return json.access_token;
}

function makeCafe24Fetch(mallId: string, token: string) {
  const base = `https://${mallId}.cafe24api.com/api/v2/admin`;
  return async function <T>(path: string): Promise<T> {
    const r = await fetch(`${base}${path}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Cafe24-Api-Version': '2026-03-01',
      },
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Cafe24 API ${r.status} (${path}): ${txt.slice(0, 200)}`);
    }
    return await r.json() as T;
  };
}

function formatVariantOptions(options: Cafe24VariantOption[]): { name: string | null; value: string | null } {
  if (!options || options.length === 0) return { name: null, value: null };
  if (options.length === 1) return { name: options[0].name || null, value: options[0].value || null };
  return {
    name: options.map(o => o.name).filter(Boolean).join(' / ') || null,
    value: options.map(o => o.value).filter(Boolean).join(' / ') || null,
  };
}

async function runImport(mallId: string, token: string, supabase: SupabaseClient): Promise<{ inserted: number; updated: number; archived: number; variants: number; total: number }> {
  const cf = makeCafe24Fetch(mallId, token);

  // 1차 list — 활성 상품
  const products: Cafe24Product[] = [];
  let offset = 0;
  while (true) {
    const data = await cf<{ products: Cafe24Product[] }>(`/products?limit=100&offset=${offset}&display=T`);
    const arr = data.products ?? [];
    products.push(...arr);
    if (arr.length < 100) break;
    offset += 100;
  }

  // 브랜드 캐시
  const brandMap = new Map<string, string>();
  try {
    const brandsData = await cf<{ brands: { brand_code: string; brand_name: string }[] }>(`/brands?limit=100`);
    for (const b of brandsData.brands ?? []) brandMap.set(b.brand_code, b.brand_name);
  } catch {}
  const categoryCache = new Map<number, string>();

  let inserted = 0, updated = 0, archived = 0, variantsTotal = 0;

  for (const baseProd of products) {
    let detail: Cafe24Product | null = null;
    try {
      const r = await cf<{ product: Cafe24Product }>(`/products/${baseProd.product_no}`);
      detail = r.product;
    } catch {}
    const data = detail ?? baseProd;
    const externalId = String(data.product_no);
    const price = parseInt(data.price, 10) || 0;
    const comparePrice = data.retail_price ? (parseInt(data.retail_price, 10) || null) : null;
    const isActive = data.display === 'T' && data.selling === 'T' && price > 0;
    const status = isActive ? 'published' : 'archived';
    const imagesArr: string[] = [];
    // 메인 detail 이미지 + 추가 이미지 슬라이드용
    if (data.detail_image && data.detail_image !== data.list_image) imagesArr.push(data.detail_image);
    // 추가 이미지 fetch (실패해도 무시)
    try {
      type AddImg = { image: string; image_no?: number; thumbnail?: string };
      const r = await cf<{ additionalimages: AddImg[] }>(`/products/${data.product_no}/additionalimages`);
      for (const img of r.additionalimages ?? []) {
        if (img.image) imagesArr.push(img.image);
      }
    } catch {}

    let categoryName: string | null = null;
    if (Array.isArray(data.category) && data.category.length > 0) {
      const cat = data.category[data.category.length - 1] ?? data.category[0];
      if (categoryCache.has(cat.category_no)) {
        categoryName = categoryCache.get(cat.category_no) ?? null;
      } else {
        try {
          const r = await cf<{ category: { category_no: number; category_name: string } }>(`/categories/${cat.category_no}`);
          if (r.category?.category_name) {
            categoryName = r.category.category_name;
            categoryCache.set(cat.category_no, categoryName);
          }
        } catch {}
      }
    }
    const brandName = data.brand_code ? brandMap.get(data.brand_code) ?? null : null;

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
      // is_active 는 GENERATED column — 명시적 set 안 함
      metadata: {
        cafe24_product_code: data.product_code,
        cafe24_brand_code: data.brand_code,
        cafe24_categories: data.category,
      },
    };

    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('source', 'cafe24')
      .eq('external_id', externalId)
      .maybeSingle();

    let productId: string | null = (existing as { id: string } | null)?.id ?? null;
    if (productId) {
      await supabase.from('products').update(productPayload).eq('id', productId);
      if (status === 'archived') archived++;
      else updated++;
    } else {
      const { data: created } = await supabase.from('products').insert(productPayload).select('id').single();
      productId = (created as { id: string } | null)?.id ?? null;
      if (productId) inserted++;
    }

    if (productId && isActive) {
      try {
        const r = await cf<{ variants: Cafe24Variant[] }>(`/products/${data.product_no}/variants`);
        for (const v of r.variants ?? []) {
          const { name: optName, value: optValue } = formatVariantOptions(v.options);
          const isVActive = v.display === 'T' && v.selling === 'T';
          const vPayload = {
            product_id: productId,
            external_id: v.variant_code,
            option_name: optName,
            option_value: optValue,
            price_delta_krw: parseInt(v.additional_amount, 10) || 0,
            stock: isVActive ? (v.quantity ?? 0) : 0,
            position: v.display_order ?? 0,
          };
          const { data: existingV } = await supabase
            .from('shop_product_variants')
            .select('id')
            .eq('product_id', productId)
            .eq('external_id', v.variant_code)
            .maybeSingle();
          if (existingV) {
            await supabase.from('shop_product_variants').update(vPayload).eq('id', (existingV as { id: string }).id);
          } else {
            await supabase.from('shop_product_variants').insert(vPayload);
          }
          variantsTotal++;
        }
      } catch {}
    }
  }

  return { inserted, updated, archived, variants: variantsTotal, total: products.length };
}

export async function POST(req: NextRequest) {
  if (!await authenticate(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: 'Backend misconfigured' }, { status: 500 });
  }

  const mallId = process.env.CAFE24_MALL_ID || 'routinist';
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = await getValidToken(supabase, mallId);
  if (!token) {
    return NextResponse.json({ error: 'Cafe24 token unavailable (refresh expired or missing)' }, { status: 503 });
  }

  try {
    const result = await runImport(mallId, token, supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cafe24/import] fail', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
