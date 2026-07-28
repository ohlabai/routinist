// 쇼핑 — 네이티브 몰 데이터 레이어.
// 토스페이먼츠 결제 흐름:
//   1. addToCart → shop_cart_items
//   2. checkout → createOrderDraft RPC → orderId + amount 받음 (orders.status='pending')
//   3. 토스 SDK 띄움 → 결제 → success URL → server side `/api/payments/toss/confirm`
//   4. server → mark_order_paid RPC → orders.status='paid', 재고 차감 + 마일리지 차감
//
// 클라이언트 직접 호출 ✓ : fetchProducts, createOrderDraft, cancelOrder, addresses CRUD, cart CRUD
// service_role 만 ✗ : mark_order_paid (Vercel API route 에서 server side)

import { getSupabase } from './supabase';
import type {
  Product, ProductVariant, ShippingAddress, Order, OrderItem,
  CartItem, ShopPayment,
} from '@/types';

// =============================================
// 상품
// =============================================

export interface ProductListOptions {
  category?: string;
  featuredOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: 'recent' | 'price_asc' | 'price_desc' | 'featured';
}

export async function fetchProducts(opts: ProductListOptions = {}): Promise<Product[]> {
  const supabase = getSupabase();
  let q = supabase.from('products').select('*').eq('status', 'published');
  if (opts.category) q = q.eq('category', opts.category);
  if (opts.featuredOnly) q = q.eq('is_featured', true);
  if (opts.search) {
    // 공백 기준 토큰 분리, 각 토큰은 name/description/brand 중 하나에 매치 (AND 조합)
    const tokens = opts.search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const t of tokens) {
      const safe = t.replace(/[%,]/g, ''); // injection 차단
      if (!safe) continue;
      q = q.or(`name.ilike.%${safe}%,description.ilike.%${safe}%,brand.ilike.%${safe}%`);
    }
  }

  switch (opts.sort) {
    case 'price_asc': q = q.order('price_krw', { ascending: true }); break;
    case 'price_desc': q = q.order('price_krw', { ascending: false }); break;
    case 'featured': q = q.order('is_featured', { ascending: false }).order('created_at', { ascending: false }); break;
    default: q = q.order('created_at', { ascending: false });
  }
  const offset = opts.offset ?? 0;
  q = q.range(offset, offset + (opts.limit ?? 20) - 1);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function fetchProduct(id: string): Promise<Product | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  return data as Product | null;
}

export async function fetchProductVariants(productId: string): Promise<ProductVariant[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shop_product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductVariant[];
}

export async function fetchProductCategories(): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('category')
    .eq('status', 'published')
    .not('category', 'is', null);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data ?? []) as { category: string | null }[]) {
    if (r.category) set.add(r.category);
  }
  return Array.from(set);
}

// =============================================
// 장바구니 (DB 기반 — 다기기 동기화)
// =============================================

export async function fetchCart(): Promise<CartItem[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shop_cart_items')
    .select(`
      id, user_id, product_id, variant_id, quantity, added_at, updated_at,
      product:products(*),
      variant:shop_product_variants(*)
    `)
    .order('added_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CartItem[];
}

export async function addToCart(
  productId: string,
  variantId: string | null = null,
  quantity: number = 1,
): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  // race-safe — select-then-(insert|update) 사이의 race 로 unique 위반 시 1회 retry.
  const trySelect = async () => {
    let q = supabase
      .from('shop_cart_items')
      .select('id, quantity')
      .eq('user_id', user.id)
      .eq('product_id', productId);
    q = variantId ? q.eq('variant_id', variantId) : q.is('variant_id', null);
    return q.maybeSingle();
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: existing } = await trySelect();
    if (existing) {
      const row = existing as { id: string; quantity: number };
      const { error } = await supabase
        .from('shop_cart_items')
        .update({ quantity: row.quantity + quantity })
        .eq('id', row.id);
      if (error) throw error;
      return;
    }
    const { error } = await supabase
      .from('shop_cart_items')
      .insert({ user_id: user.id, product_id: productId, variant_id: variantId, quantity });
    if (!error) return;
    // unique 위반 (다른 탭이 먼저 insert) → 한 번 더 select 후 update
    if (error.code === '23505' && attempt === 0) continue;
    throw error;
  }
}

export async function updateCartQuantity(cartItemId: string, quantity: number): Promise<void> {
  if (quantity < 1) {
    await removeFromCart(cartItemId);
    return;
  }
  const supabase = getSupabase();
  const { error } = await supabase
    .from('shop_cart_items')
    .update({ quantity })
    .eq('id', cartItemId);
  if (error) throw error;
}

export async function removeFromCart(cartItemId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('shop_cart_items').delete().eq('id', cartItemId);
  if (error) throw error;
}

export async function clearCart(): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('shop_cart_items').delete().eq('user_id', user.id);
  if (error) throw error;
}

// =============================================
// 배송지
// =============================================

export async function fetchAddresses(): Promise<ShippingAddress[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shop_shipping_addresses')
    .select('*')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShippingAddress[];
}

export type NewAddressInput = Omit<ShippingAddress, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export async function createAddress(input: NewAddressInput): Promise<ShippingAddress> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  // is_default=true 면 기존 default 해제 (partial unique 충돌 방지)
  if (input.is_default) {
    await supabase.from('shop_shipping_addresses')
      .update({ is_default: false })
      .eq('user_id', user.id);
  }

  const { data, error } = await supabase
    .from('shop_shipping_addresses')
    .insert({ ...input, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as ShippingAddress;
}

export async function updateAddress(id: string, patch: Partial<ShippingAddress>): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  if (patch.is_default === true) {
    await supabase.from('shop_shipping_addresses')
      .update({ is_default: false })
      .eq('user_id', user.id);
  }
  const { error } = await supabase.from('shop_shipping_addresses').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteAddress(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('shop_shipping_addresses').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// 주문
// =============================================

export interface OrderDraftItem {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
}

export interface OrderDraftAddress {
  recipient: string;
  phone: string;
  postal_code: string;
  address_line1: string;
  address_line2?: string;
  memo?: string;
}

export interface OrderDraftResult {
  order_id: string;
  order_no: string;
  subtotal_krw: number;
  shipping_fee_krw: number;
  total_krw: number;
}

export async function createOrderDraft(
  items: OrderDraftItem[],
  address: OrderDraftAddress,
  mileageUse: number = 0,
): Promise<OrderDraftResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('create_order_draft', {
    p_items: items,
    p_address: address,
    p_mileage_use: mileageUse,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('주문 생성 응답이 없습니다');
  return row as OrderDraftResult;
}

export async function cancelOrder(
  orderId: string,
  reason?: string,
  /**
   * build 186: true 면 pending 외 상태는 no-op. fail page 같은 곳에서
   * paid 상태인데 실수로 환불 처리하는 orphan 차단용.
   */
  onlyIfPending?: boolean,
): Promise<void> {
  const supabase = getSupabase();

  // build 327 (2026-07-28): 사용자 취소는 서버 라우트 경유 — 토스 실환불 + DB 정리.
  // 기존엔 cancel_order RPC 직행이라 DB 상태만 바뀌고 실제 PG 환불이 없었다.
  // onlyIfPending(결제 fail 페이지의 pending 정리)은 돈이 안 걸려 있어 기존 RPC 유지.
  if (!onlyIfPending) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('로그인이 필요해요');
    // 네이티브 앱은 정적 번들(capacitor://localhost)이라 상대 /api 가 없음 — Vercel 절대 URL 로.
    const isNative = typeof window !== 'undefined'
      && Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    const apiBase = isNative ? 'https://app.routinist.kr' : '';
    const res = await fetch(`${apiBase}/api/payments/toss/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderId, reason: reason ?? '사용자 요청' }),
    });
    const json = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) throw new Error(json.error || '취소 실패');
    return;
  }

  const { error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason ?? null,
    p_only_if_pending: true,
  });
  if (error) throw error;
}

export async function fetchMyOrders(
  limit: number = 20,
  offset: number = 0,
  status?: Order['status'],
): Promise<Order[]> {
  const supabase = getSupabase();
  let q = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  q = q.range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchOrder(id: string): Promise<{
  order: Order;
  items: OrderItem[];
  payments: ShopPayment[];
} | null> {
  const supabase = getSupabase();
  const [orderRes, itemsRes, paymentsRes] = await Promise.all([
    supabase.from('orders').select('*').eq('id', id).maybeSingle(),
    supabase.from('order_items').select('*').eq('order_id', id).order('created_at', { ascending: true }),
    supabase.from('shop_payments').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ]);
  if (orderRes.error) throw orderRes.error;
  if (!orderRes.data) return null;
  return {
    order: orderRes.data as Order,
    items: (itemsRes.data ?? []) as OrderItem[],
    payments: (paymentsRes.data ?? []) as ShopPayment[],
  };
}

// =============================================
// 위시리스트 (찜)
// =============================================

export async function fetchWishlist(): Promise<Product[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shop_wishlist')
    .select('product:products(*)')
    .order('added_at', { ascending: false });
  if (error) throw error;
  type Row = { product: Product | null };
  return ((data ?? []) as unknown as Row[])
    .map(r => r.product)
    .filter((p): p is Product => !!p && p.status === 'published');
}

export async function fetchWishlistIds(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('shop_wishlist').select('product_id');
  if (error) return new Set();
  return new Set(((data ?? []) as { product_id: string }[]).map(r => r.product_id));
}

export async function addToWishlist(productId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');
  const { error } = await supabase
    .from('shop_wishlist')
    .insert({ user_id: user.id, product_id: productId });
  // 23505 (중복) 은 멱등으로 OK
  if (error && error.code !== '23505') throw error;
}

export async function removeFromWishlist(productId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('shop_wishlist')
    .delete()
    .eq('user_id', user.id)
    .eq('product_id', productId);
  if (error) throw error;
}

export async function toggleWishlist(productId: string, current: boolean): Promise<boolean> {
  if (current) {
    await removeFromWishlist(productId);
    return false;
  }
  await addToWishlist(productId);
  return true;
}

// =============================================
// 검증 헬퍼 — 클라사이드 입력 검증
// =============================================

const PHONE_RE = /^(010-?\d{4}-?\d{4}|01[16789]-?\d{3,4}-?\d{4})$/;
const POSTAL_RE = /^\d{5}$/;

export function validatePhone(phone: string): boolean {
  return PHONE_RE.test(phone.trim());
}

export function validatePostalCode(code: string): boolean {
  return POSTAL_RE.test(code.trim());
}

// build 182: 입력 중 자동 하이픈 — 010-1234-5678 형식.
// 휴대폰 010-xxxx-xxxx / 011-xxx-xxxx / 02 지역 / 1577-xxxx 등 광범위 처리.
export function formatPhoneKR(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  // 02 (서울) — 2자리 국번
  if (digits.startsWith('02')) {
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  // 010 / 011 / 016~9 / 070 / 050 / 031~64 등 — 3자리 prefix
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

// =============================================
// 운송장 — 어드민/고객 단일 진실
// =============================================

export interface CarrierEntry {
  /** 어드민 select / 고객 표시에 쓰이는 한글 라벨 */
  label: string;
  /** trackingUrl 매칭에 쓰이는 정규화된 키 */
  key: string;
  /** 운송장 번호로 외부 추적 페이지 URL 만들기 */
  buildUrl: (n: string) => string;
}

export const CARRIERS: CarrierEntry[] = [
  { label: 'CJ대한통운', key: 'cj',     buildUrl: n => `https://trace.cjlogistics.com/web/detail.jsp?slipno=${n}` },
  { label: '우체국택배', key: 'epost',  buildUrl: n => `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${n}` },
  { label: '한진택배',   key: 'hanjin', buildUrl: n => `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${n}` },
  { label: '롯데택배',   key: 'lotte',  buildUrl: n => `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${n}` },
  { label: '로젠택배',   key: 'logen',  buildUrl: n => `https://www.ilogen.com/web/personal/trace/${n}` },
];

export function carrierByLabel(label: string | null): CarrierEntry | null {
  if (!label) return null;
  const norm = label.trim().toLowerCase().replace(/\s+/g, '');
  for (const c of CARRIERS) {
    if (c.label === label) return c;
    if (norm.includes(c.key)) return c;
    if (norm.includes(c.label.toLowerCase().replace(/\s+/g, ''))) return c;
  }
  return null;
}

export function trackingUrl(carrier: string | null, no: string | null): string | null {
  if (!carrier || !no) return null;
  const c = carrierByLabel(carrier);
  return c ? c.buildUrl(no) : null;
}

export function orderStatusLabel(s: Order['status']): string {
  switch (s) {
    case 'pending': return '결제 대기';
    case 'paid': return '결제 완료';
    case 'shipped': return '배송 중';
    case 'delivered': return '배송 완료';
    case 'cancelled': return '취소됨';
    case 'refunded': return '환불됨';
    default: return s;
  }
}

export function orderStatusColor(s: Order['status']): string {
  switch (s) {
    case 'pending': return 'text-amber-500';
    case 'paid': return 'text-emerald-500';
    case 'shipped': return 'text-blue-500';
    case 'delivered': return 'text-emerald-600';
    case 'cancelled': return 'text-zinc-500';
    case 'refunded': return 'text-orange-500';
    default: return 'text-zinc-500';
  }
}
