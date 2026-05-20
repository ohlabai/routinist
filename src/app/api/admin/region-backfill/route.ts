// build 155: 지역 미입력 사용자 일괄 백필.
// - profile.country_code / region_si / region_gu 모두 NULL 인 사용자만 대상
// - 가장 최근 GPS 활동의 첫 좌표로 Nominatim 역지오코딩
// - Nominatim 공공 rate limit 1req/sec → 호출 사이 1.1s sleep
// - admin email 전용 (hans@openhan.kr 등)
//
// POST /api/admin/region-backfill
// body: {} (옵션 없음 — 전체 NULL 사용자 일괄)
// response: { processed, applied, skipped, errors }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-emails';

export const dynamic = 'force-dynamic';

async function reverseGeocode(lat: number, lng: number): Promise<{
  country_code: string;
  si: string | null;
  gu: string | null;
  display: string;
} | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko&zoom=12`;
  try {
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        // Nominatim 정책 — User-Agent 명시 권장
        'User-Agent': 'Routinist/1.0 (admin region backfill)',
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      address?: {
        country_code?: string;
        state?: string;
        province?: string;
        city?: string;
        county?: string;
        borough?: string;
        suburb?: string;
        city_district?: string;
      };
    };
    const country = (data.address?.country_code || 'kr').toUpperCase();
    if (country === 'KR') {
      // 한국 시·도 매핑 (간단)
      const state = data.address?.state || data.address?.province || '';
      const siMap: Record<string, string> = {
        Seoul: '서울특별시', Busan: '부산광역시', Daegu: '대구광역시',
        Incheon: '인천광역시', Gwangju: '광주광역시', Daejeon: '대전광역시',
        Ulsan: '울산광역시', Sejong: '세종특별자치시', Gyeonggi: '경기도',
        Gangwon: '강원특별자치도', Chungcheongbuk: '충청북도', Chungcheongnam: '충청남도',
        Jeollabuk: '전북특별자치도', Jeollanam: '전라남도', Gyeongsangbuk: '경상북도',
        Gyeongsangnam: '경상남도', Jeju: '제주특별자치도',
      };
      let si: string | null = null;
      // 한글 매칭 우선
      for (const v of Object.values(siMap)) {
        if (state.includes(v)) { si = v; break; }
      }
      if (!si) {
        for (const [k, v] of Object.entries(siMap)) {
          if (state.includes(k)) { si = v; break; }
        }
      }
      const rawGu = data.address?.city_district || data.address?.borough
        || data.address?.county || data.address?.suburb || data.address?.city || '';
      // gu 정규화 — '구' / '시' / '군' 으로 끝나는 한국식만
      const gu = /[구시군]$/.test(rawGu) ? rawGu : null;
      return {
        country_code: 'KR',
        si,
        gu,
        display: [si, gu].filter(Boolean).join(' ') || '한국',
      };
    }
    return {
      country_code: country,
      si: data.address?.state ?? null,
      gu: data.address?.city ?? null,
      display: [data.address?.state, data.address?.city].filter(Boolean).join(' ') || country,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const accessToken = authHeader.slice(7);

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supaUrl || !anonKey || !serviceKey) {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }

    const userClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!isAdminEmail(user.email ?? null)) {
      return NextResponse.json({ error: 'forbidden — admin only' }, { status: 403 });
    }

    const svc = createClient(supaUrl, serviceKey);

    // 대상: 모든 region 필드 NULL + 활동(GPS 있는) 1개 이상
    const { data: targets, error: targetsErr } = await svc
      .from('profiles')
      .select('id, display_name')
      .is('country_code', null)
      .is('region_si', null)
      .is('region_gu', null);
    if (targetsErr) {
      return NextResponse.json({ error: 'targets fetch fail', detail: targetsErr.message }, { status: 500 });
    }

    const results: Array<{
      user_id: string;
      display_name: string | null;
      applied: boolean;
      reason?: string;
      region?: { country_code: string; si: string | null; gu: string | null; display: string };
    }> = [];
    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const t of targets ?? []) {
      // 활동 첫 GPS 좌표
      const { data: acts } = await svc
        .from('activities')
        .select('route_data')
        .eq('user_id', t.id)
        .not('route_data', 'is', null)
        .order('activity_date', { ascending: false })
        .limit(1);
      const route = acts?.[0]?.route_data as { coordinates?: [number, number, number?, number?][] } | null;
      const first = route?.coordinates?.[0];
      if (!first || first.length < 2) {
        results.push({ user_id: t.id, display_name: t.display_name, applied: false, reason: 'no_gps' });
        skipped++;
        continue;
      }
      const [lng, lat] = first;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        results.push({ user_id: t.id, display_name: t.display_name, applied: false, reason: 'invalid_gps' });
        skipped++;
        continue;
      }

      // Nominatim rate limit — 1.1s 간격
      await new Promise(r => setTimeout(r, 1100));
      const region = await reverseGeocode(lat, lng);
      if (!region) {
        results.push({ user_id: t.id, display_name: t.display_name, applied: false, reason: 'geocode_fail' });
        skipped++;
        errors.push(`${t.display_name}: geocode 실패`);
        continue;
      }

      // 동시 race 방어 — 그동안 누가 채웠으면 skip
      const { error: updErr } = await svc
        .from('profiles')
        .update({
          country_code: region.country_code,
          region_si: region.si,
          region_gu: region.gu,
        })
        .eq('id', t.id)
        .is('country_code', null)
        .is('region_si', null)
        .is('region_gu', null);
      if (updErr) {
        results.push({ user_id: t.id, display_name: t.display_name, applied: false, reason: 'update_fail' });
        errors.push(`${t.display_name}: ${updErr.message}`);
        skipped++;
        continue;
      }

      results.push({
        user_id: t.id,
        display_name: t.display_name,
        applied: true,
        region: { country_code: region.country_code, si: region.si, gu: region.gu, display: region.display },
      });
      applied++;
    }

    return NextResponse.json({
      processed: (targets ?? []).length,
      applied,
      skipped,
      errors,
      results,
    });
  } catch (e) {
    return NextResponse.json({
      error: 'exception',
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
