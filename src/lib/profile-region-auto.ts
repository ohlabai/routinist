// build 155: 지역 미입력 사용자의 첫 활동 GPS 로 자동 지역 등록.
//
// 정책:
// - profile.country_code / region_si / region_gu 모두 null 일 때만 적용 (이미 설정한 사용자 절대 덮어쓰지 않음)
// - 활동의 첫 좌표로 Nominatim 역지오코딩 → profile update
// - 클라이언트 LocalStorage 플래그 (`routinist_region_auto_set`) 에 timestamp + display 저장
//   → Dashboard 가 다음 mount 시 안내 모달 1회 표시
//
// 호출 위치:
// - health-sync.ts 의 syncHealthData 백그라운드 후처리 (route_data 채워진 직후)
// - admin 백필 일괄 처리 (server-side, LocalStorage 플래그 없음)

import { detectRegionFromCoord, type DetectedRegion } from './geo';
import { getSupabase } from './supabase';

export interface AutoRegionResult {
  applied: boolean;
  reason?: 'already_set' | 'no_gps' | 'geocode_fail' | 'update_fail' | 'no_activity';
  region?: DetectedRegion;
}

/**
 * 사용자 profile 의 region 이 비어있고 GPS 활동이 있으면 자동 등록.
 * 안내는 클라이언트 LocalStorage 플래그로 (Dashboard 가 다음 mount 시 1회 모달).
 */
export async function autoDetectAndSetRegion(userId: string): Promise<AutoRegionResult> {
  const supabase = getSupabase();

  // 1. profile 가 이미 region 가지고 있으면 skip
  const { data: profile } = await supabase
    .from('profiles')
    .select('country_code, region_si, region_gu')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) return { applied: false, reason: 'no_activity' };
  if (profile.country_code || profile.region_si || profile.region_gu) {
    return { applied: false, reason: 'already_set' };
  }

  // 2. GPS 있는 첫 활동 (가장 최근)
  const { data: activities } = await supabase
    .from('activities')
    .select('route_data')
    .eq('user_id', userId)
    .not('route_data', 'is', null)
    .order('activity_date', { ascending: false })
    .limit(1);
  const route = activities?.[0]?.route_data as { coordinates?: [number, number, number?, number?][] } | null;
  const firstCoord = route?.coordinates?.[0];
  if (!firstCoord || firstCoord.length < 2) return { applied: false, reason: 'no_gps' };
  const [lng, lat] = firstCoord;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { applied: false, reason: 'no_gps' };

  // 3. 역지오코딩
  let region: DetectedRegion;
  try {
    region = await detectRegionFromCoord(lat, lng);
  } catch {
    return { applied: false, reason: 'geocode_fail' };
  }

  // 4. profile update
  const { error } = await supabase
    .from('profiles')
    .update({
      country_code: region.country_code,
      region_si: region.si,
      region_gu: region.gu,
    })
    .eq('id', userId)
    // 동시 update race 방어 — 다른 곳에서 이미 채웠으면 안 덮음
    .is('country_code', null)
    .is('region_si', null)
    .is('region_gu', null);
  if (error) return { applied: false, reason: 'update_fail' };

  // 5. 클라이언트 안내용 LocalStorage 플래그
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('routinist_region_auto_set', JSON.stringify({
        at: Date.now(),
        display: region.display,
        country_code: region.country_code,
      }));
    } catch {}
  }

  return { applied: true, region };
}

/**
 * Dashboard mount 시 호출 — 자동 등록 직후이면 1회 안내 모달 표시용 정보 반환.
 */
export function consumeRegionAutoNotice(): { display: string; country_code: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('routinist_region_auto_set');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; display: string; country_code: string };
    // 보여준 후엔 삭제 — 1회만.
    window.localStorage.removeItem('routinist_region_auto_set');
    // 7일 지나면 stale — 무시
    if (Date.now() - parsed.at > 7 * 24 * 3600_000) return null;
    return { display: parsed.display, country_code: parsed.country_code };
  } catch {
    return null;
  }
}
