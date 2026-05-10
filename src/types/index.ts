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
  coordinates: [number, number, number?][]; // [lng, lat, elevation?]
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

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price_krw: number;
  mileage_price: number | null;
  image_url: string | null;
  stock: number;
  is_active: boolean;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  product?: Product;
}

export type OrderStatus = 'pending' | 'paid' | 'shipping' | 'delivered' | 'cancelled' | 'refunded';
export type PaymentMethod = 'card' | 'transfer' | 'mileage' | 'mixed';

export interface Order {
  id: string;
  user_id: string;
  status: OrderStatus;
  total_krw: number;
  mileage_used: number;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  shipping_memo: string | null;
  payment_method: PaymentMethod | null;
  payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_krw: number;
  created_at: string;
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
