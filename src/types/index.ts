export type MemberStatus = 'active' | 'dormant';

export interface Member {
  id: string;
  name: string;
  member_number: number;
  join_date: string | null;
  join_location: string | null;
  status: MemberStatus;
}

export interface RunningLog {
  id: string;
  member_id: string;
  run_date: string;
  distance_km: number;
  duration_minutes: number | null;
  memo: string | null;
  created_at: string;
}

export interface MonthlyGoal {
  id: string;
  member_id: string;
  year: number;
  month: number;
  goal_km: number;
}

export interface MonthlyRecord {
  member_id: string;
  year: number;
  month: number;
  goal_km: number;
  achieved_km: number;
}

export interface Award {
  id: string;
  member_id: string;
  year: number;
  month: number;
  award_type: '피니셔상' | '롱런상' | '개근상' | '특별상';
  description: string | null;
}

export interface MemberWithStats extends Member {
  total_distance: number;
  total_runs: number;
  current_month_distance: number;
  current_month_goal: number;
  current_month_runs: number;
  monthly_records: MonthlyRecord[];
  awards: Award[];
}

export interface DashboardStats {
  total_club_distance: number;
  active_members: number;
  total_members: number;
  current_month_total: number;
  current_month_avg: number;
}

// =============================================
// Routinist 타입 (새 스키마)
// =============================================

export type ActivitySource = 'manual' | 'gps' | 'health_kit' | 'health_connect';

export type ActivityVisibility = 'public' | 'followers' | 'club' | 'private';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  locale: string;
  region_si: string | null;
  region_gu: string | null;
  region_dong: string | null;
  country_code: string | null;
  birth_year: number | null;
  gender: 'male' | 'female' | 'other' | null;
  show_gender?: boolean;
  running_since: string | null;
  is_public: boolean;
  total_distance_km: number;
  total_runs: number;
  total_duration_seconds: number;
  mileage_balance: number;
  privacy_zone_lat: number | null;
  privacy_zone_lng: number | null;
  privacy_zone_radius_m: number;
  created_at: string;
  updated_at: string;
  // build 156: 이달 캐시 — activities 도착 전 즉시 표시. activity trigger 가 자동 갱신.
  this_month_distance_km?: number;
  this_month_runs?: number;
  this_month_updated_at?: string | null;
  // build 198: 러닝 코치 (AI) opt-in. weight/max_hr/resting_hr 는 본인만 보임 (랭킹·비교 X).
  weight_kg?: number | null;
  max_hr?: number | null;
  resting_hr?: number | null;
  coach_opt_in?: boolean;
}

export interface Activity {
  id: string;
  user_id: string;
  activity_date: string;
  distance_km: number;
  duration_seconds: number | null;
  pace_avg_sec_per_km: number | null;
  calories: number | null;
  memo: string | null;
  source: ActivitySource;
  route_data: GeoJSONLineString | null;
  map_snapshot_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  visibility: ActivityVisibility;
  created_at: string;
  // 확장 필드 (Apple Health 추가 데이터)
  heart_rate_avg?: number | null;
  heart_rate_max?: number | null;
  active_energy_kcal?: number | null;
  activity_type?: 'running' | 'walking' | null;
}

export interface UserMonthlyGoal {
  id: string;
  user_id: string;
  year: number;
  month: number;
  goal_km: number;
}

export interface GeoJSONLineString {
  type: 'LineString';
  // [lng, lat, elevation?, unix_seconds?] — build 151: 4번째 슬롯에 timestamp (재동기화 후 부터).
  // MP4 공유 시 timestamp 있으면 실제 페이스로 라인 그리기 속도 조절.
  coordinates: [number, number, number?, number?][];
}

export interface LegacyMemberLink {
  user_id: string;
  member_id: string;
  linked_at: string;
}

// =============================================
// 소셜 타입
// =============================================

export interface Follow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface Club {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  is_public: boolean;
  member_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ClubMemberRole = 'owner' | 'admin' | 'member';

export interface ClubMember {
  club_id: string;
  user_id: string;
  role: ClubMemberRole;
  joined_at: string;
  profile?: Profile;
}

export interface ActivityComment {
  id: string;
  activity_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile?: Profile;
}

export interface ActivityCheer {
  activity_id: string;
  user_id: string;
  created_at: string;
}

export interface ActivityPhoto {
  id: string;
  activity_id: string;
  user_id: string;
  photo_url: string;
  sort_order: number;
  created_at: string;
}

// =============================================
// 쪽지 타입
// =============================================

export interface UserBlock {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
  created_at: string;
  other_user?: Profile;
  last_message?: Message;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

// =============================================
// 마일리지 타입
// =============================================

export type MileageTxType = 'run_earn' | 'purchase_spend' | 'gift_send' | 'gift_receive' | 'admin_adjust' | 'refund' | 'reward';

export interface MileageTransaction {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  tx_type: MileageTxType;
  reference_id: string | null;
  description: string | null;
  created_at: string;
  event_type?: string | null; // 'distance_km' | 'first_5km' | ... (reward 분류용)
  metadata?: Record<string, unknown> | null;
}

// =============================================
// 쇼핑 타입
// =============================================

export type ProductStatus = 'draft' | 'published' | 'archived';
export type ProductSource = 'manual' | 'cafe24';

export interface Product {
  id: string;
  external_id: string | null;
  source: ProductSource;
  name: string;
  slug: string | null;
  description: string | null;
  thumbnail_url: string | null;
  image_url: string | null;          // legacy — thumbnail_url 우선
  images: string[];                  // 추가 이미지 (gallery)
  price_krw: number;
  compare_price_krw: number | null;  // 정가 (할인 표시)
  mileage_price: number | null;      // legacy — 마일리지로만 결제하는 가상 상품용
  brand: string | null;
  category: string | null;
  stock: number;
  status: ProductStatus;
  is_featured: boolean;
  is_active: boolean;                // legacy
  metadata: Record<string, unknown>;
  rating_avg?: number;               // 캐시 — product_reviews 평균
  rating_count?: number;             // 캐시 — product_reviews 카운트
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  external_id: string | null;
  sku: string | null;
  option_name: string | null;        // '사이즈'
  option_value: string | null;       // 'M'
  price_delta_krw: number;
  stock: number;
  is_default: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  user_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  added_at: string;
  updated_at: string;
  product?: Product;
  variant?: ProductVariant | null;
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export type PaymentMethod = 'card' | 'kakaopay' | 'naverpay' | 'tosspay' | 'transfer' | 'mileage' | 'mixed';

export interface Order {
  id: string;
  user_id: string;
  order_no: string | null;
  status: OrderStatus;
  subtotal_krw: number;
  shipping_fee_krw: number;
  mileage_used: number;
  total_krw: number;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_postal_code: string | null;
  shipping_address: string | null;
  shipping_address_line2: string | null;
  shipping_memo: string | null;
  payment_method: PaymentMethod | null;
  payment_id: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  tracking_carrier: string | null;
  tracking_no: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  unit_price_krw: number;
  quantity: number;
  subtotal_krw: number | null;       // unit_price_krw * quantity (legacy null 가능)
  thumbnail_url: string | null;
  created_at: string;
}

export interface ShippingAddress {
  id: string;
  user_id: string;
  recipient_name: string;
  phone: string;
  postal_code: string;
  address_line1: string;
  address_line2: string | null;
  is_default: boolean;
  label: string | null;              // '집' '회사' 등 별칭
  created_at: string;
  updated_at: string;
}

export type PaymentProvider = 'toss' | 'inicis' | 'mileage_only';
export type PaymentStatus = 'pending' | 'done' | 'failed' | 'cancelled' | 'refunded' | 'partial_refunded';

export interface ShopPayment {
  id: string;
  order_id: string;
  provider: PaymentProvider;
  provider_payment_key: string | null;
  provider_order_id: string | null;
  method: string | null;
  amount_krw: number;
  status: PaymentStatus;
  raw_response: Record<string, unknown> | null;
  failure_code: string | null;
  failure_reason: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  refunded_amount_krw: number;
  created_at: string;
  updated_at: string;
}

// =============================================
// 지역 랭킹 타입
// =============================================

export interface RegionalRanking {
  region_si: string;
  region_gu: string;
  region_dong: string | null;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  year: number;
  month: number;
  monthly_km: number;
  run_count: number;
  rank_in_gu: number;
}
