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
  if (opts.search) q = q.ilike('name', `%${opts.search}%`);

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

  // 같은 product+variant 면 quantity 증가
  let existingQuery = supabase
    .from('shop_cart_items')
    .select('id, quantity')
    .eq('user_id', user.id)
    .eq('product_id', productId);
  existingQuery = variantId
    ? existingQuery.eq('variant_id', variantId)
    : existingQuery.is('variant_id', null);

  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) {
    const row = existing as { id: string; quantity: number };
    const { error } = await supabase
      .from('shop_cart_items')
      .update({ quantity: row.quantity + quantity })
      .eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('shop_cart_items')
      .insert({ user_id: user.id, product_id: productId, variant_id: variantId, quantity });
    if (error) throw error;
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

export async function cancelOrder(orderId: string, reason?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function fetchMyOrders(limit: number = 20, offset: number = 0): Promise<Order[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
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
