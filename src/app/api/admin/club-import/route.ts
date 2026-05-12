// 클럽 결산 HTML import API (build 100 — 자동 import).
// 기존 supabase/scripts/import-club-monthly-html.mjs 의 Node 로직을 API endpoint 로 포팅.
// 동작: HTML 안 `const MEMBERS_DATA = [...]` JSON 추출 → club_external_* 테이블 upsert.
//
// 인증: Authorization: Bearer <access_token> + admin email 검사.
// 멱등: 같은 month 재실행 시 이전 활동 삭제 후 재insert.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-emails';

export const dynamic = 'force-dynamic';

interface RunEvent {
  date: string;
  datetime?: string;
  delta: number;
}

interface MemberData {
  name: string;
  goal?: number;
  run_count?: number;
  final_dist?: number;
  run_events?: RunEvent[];
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

    // 1) 사용자 인증 + admin email 검사
    const userClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!isAdminEmail(user.email ?? null)) {
      return NextResponse.json({ error: 'forbidden — admin only' }, { status: 403 });
    }

    // 2) body parse
    const body = await req.json();
    const html = body?.html as string | undefined;
    const clubName = body?.clubName as string | undefined;
    const year = Number(body?.year);
    const month = Number(body?.month);

    if (!html || !clubName || !year || !month) {
      return NextResponse.json(
        { error: 'html / clubName / year / month required' },
        { status: 400 }
      );
    }

    // 3) MEMBERS_DATA JSON 추출
    const m = html.match(/const\s+MEMBERS_DATA\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) {
      return NextResponse.json({ error: 'MEMBERS_DATA not found in HTML' }, { status: 400 });
    }

    let members: MemberData[];
    try {
      members = JSON.parse(m[1]);
    } catch {
      return NextResponse.json({ error: 'MEMBERS_DATA JSON parse failed' }, { status: 400 });
    }

    // 4) Service role 로 처리
    const admin = createClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 5) 클럽 id 조회
    const { data: club, error: clubErr } = await admin
      .from('clubs')
      .select('id')
      .eq('name', clubName)
      .single();
    if (clubErr || !club) {
      return NextResponse.json(
        { error: `클럽을 찾을 수 없음: ${clubName}` },
        { status: 404 }
      );
    }
    const clubId = club.id as string;

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    // 6) 기존 멤버 ID 매핑
    const { data: existingMembers } = await admin
      .from('club_external_members')
      .select('id, name')
      .eq('club_id', clubId);
    const nameToId = new Map<string, string>(
      (existingMembers ?? []).map(m => [m.name as string, m.id as string])
    );

    // 7) 새 멤버 추가
    const newMembers = members.filter(m => !nameToId.has(m.name));
    if (newMembers.length > 0) {
      const { data: inserted, error: insErr } = await admin
        .from('club_external_members')
        .insert(newMembers.map(m => ({ club_id: clubId, name: m.name })))
        .select('id, name');
      if (insErr) {
        return NextResponse.json({ error: `member insert: ${insErr.message}` }, { status: 500 });
      }
      (inserted ?? []).forEach(m => nameToId.set(m.name as string, m.id as string));
    }

    // 8) 같은 달 기존 활동 삭제 (멱등)
    const memberIds = members
      .map(m => nameToId.get(m.name))
      .filter((v): v is string => !!v);
    if (memberIds.length > 0) {
      await admin
        .from('club_external_activities')
        .delete()
        .gte('activity_date', monthStart)
        .lt('activity_date', nextMonthStart)
        .in('member_id', memberIds);
    }

    // 9) 목표 upsert + 활동 insert
    let goalCount = 0;
    let activityCount = 0;
    const errors: string[] = [];

    for (const mem of members) {
      const memberId = nameToId.get(mem.name);
      if (!memberId) continue;

      if (typeof mem.goal === 'number') {
        const { error: goalErr } = await admin
          .from('club_external_monthly_goals')
          .upsert(
            { member_id: memberId, year, month, goal_km: mem.goal },
            { onConflict: 'member_id,year,month' }
          );
        if (goalErr) errors.push(`${mem.name} goal: ${goalErr.message}`);
        else goalCount++;
      }

      if (mem.run_events && mem.run_events.length > 0) {
        const rows = mem.run_events.map(e => ({
          member_id: memberId,
          activity_date: e.date,
          started_at: e.datetime ? `${e.datetime.replace('T', ' ')}+09:00` : null,
          distance_km: e.delta,
          source: `html_import_${year}_${month}`,
        }));
        const { error: actErr } = await admin
          .from('club_external_activities')
          .insert(rows);
        if (actErr) errors.push(`${mem.name} activities: ${actErr.message}`);
        else activityCount += rows.length;
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      summary: {
        members: members.length,
        new_members: newMembers.length,
        goals: goalCount,
        activities: activityCount,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
