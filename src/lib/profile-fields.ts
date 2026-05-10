// 다른 유저의 프로필을 조회할 때 사용할 안전한 컬럼 목록.
// profiles RLS 가 `is_public = true` 인 모든 행을 누구나 SELECT 가능하지만 컬럼 레벨 필터는 없으므로,
// `select('*')` 을 쓰면 privacy_zone_*, mileage_balance, birth_year 같은 민감 컬럼이 노출됨.
// 모든 "다른 유저 프로필" 조회에서 이 상수를 사용할 것.
//
// 본인 프로필 조회는 `select('*')` 사용 OK — RLS 가 auth.uid() = id 로 제한.

export const PUBLIC_PROFILE_FIELDS =
  'id, display_name, avatar_url, bio, region_si, region_gu, region_dong, is_public, total_distance_km, total_runs, total_duration_seconds, country_code, running_since, created_at, updated_at';
