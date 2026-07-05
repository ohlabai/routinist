// build 281: 매일 라이벌 콜아웃 push 큐잉.
// - D-3 ~ D-1 사이 라이벌 격차가 5km 이내면 "한 번만 뛰면 역전!" push
// - 월초~중반엔 colossal 격차여도 시간 충분해서 push 안 보냄 (noisy 방지)
// vercel.json crons 에서 매일 18:00 KST = 09:00 UTC 호출.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronAuthenticated } from '@/lib/cron-auth';

interface RivalRow {
  user_id: string;
  opponent_id: string;
  month: string;
}

export async function POST(req: NextRequest) {
  if (!isCronAuthenticated(req, 'RIVAL_CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'backend misconfigured' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 오늘 KST
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const month = `${yyyy}-${mm}`;
  const monthStart = `${month}-01`;
  const lastDay = new Date(Date.UTC(yyyy, kst.getUTCMonth() + 1, 0)).getUTCDate();
  const today = kst.getUTCDate();
  const daysLeft = lastDay - today;

  // D-3 ~ D-1 만 발사. D-0 (말일) 은 결과 알림으로 별도 (phase 3).
  if (daysLeft > 3 || daysLeft < 1) {
    return NextResponse.json({ ok: true, skipped: true, days_left: daysLeft });
  }

  // build 291: 페이지네이션 — 이전엔 limit 없는 select 가 PostgREST 기본 1000행에서
  // 조용히 잘려 유저가 늘수록 km 합계가 왜곡됐다 (리뷰 P2). range 루프로 전량 수집.
  const fetchAll = async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const PAGE = 1000;
    const all: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    return all;
  };

  let rivals: RivalRow[];
  let acts: { user_id: string; distance_km: number | string }[];
  let profiles: { id: string; push_settings: Record<string, boolean> | null; locale: string | null }[];
  try {
    rivals = await fetchAll<RivalRow>((from, to) =>
      supabase.from('monthly_rivals').select('user_id, opponent_id, month').eq('month', month).range(from, to));
    if (rivals.length === 0) {
      return NextResponse.json({ ok: true, queued: 0 });
    }
    const userIds = Array.from(new Set(rivals.flatMap((r: RivalRow) => [r.user_id, r.opponent_id])));
    acts = await fetchAll((from, to) =>
      supabase.from('activities').select('user_id, distance_km')
        .in('user_id', userIds).gte('activity_date', monthStart).eq('visibility', 'public').range(from, to));
    // build 291: should_send_push RPC 를 쌍마다 호출하던 N+1 제거 — push_settings/locale 일괄 조회
    profiles = await fetchAll((from, to) =>
      supabase.from('profiles').select('id, push_settings, locale').in('id', userIds).range(from, to));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const kmMap = new Map<string, number>();
  for (const a of acts) {
    kmMap.set(a.user_id, (kmMap.get(a.user_id) ?? 0) + Number(a.distance_km));
  }
  const profileMap = new Map(profiles.map(p => [p.id, p]));

  // build 291: 같은 날 재실행 (Vercel 재시도/수동 호출) 중복 발사 방지 — 오늘 이미 큐잉된 대상 제외
  // KST 오늘 00:00 의 UTC 시각 = UTC 자정 - 9h
  const kstDayStart = new Date(Date.UTC(yyyy, kst.getUTCMonth(), today) - 9 * 60 * 60 * 1000).toISOString();
  const { data: alreadyQueued } = await supabase
    .from('push_send_log')
    .select('user_id')
    .eq('category', 'social_rival')
    .gte('created_at', kstDayStart)
    .limit(10000);
  const sentToday = new Set((alreadyQueued ?? []).map((r: { user_id: string }) => r.user_id));

  let queued = 0;
  for (const r of rivals) {
    const myKm = kmMap.get(r.user_id) ?? 0;
    const rivalKm = kmMap.get(r.opponent_id) ?? 0;
    const diff = rivalKm - myKm;  // 양수 = 페이스메이커가 앞섬

    // D-3 ~ D-1 + 격차 0.1km ~ 5km 안 → 콜아웃
    if (diff < 0.1 || diff > 5) continue;
    if (sentToday.has(r.user_id)) continue;

    const prof = profileMap.get(r.user_id);
    // should_send_push 와 동일 규칙: 미설정 = true
    if (prof?.push_settings?.['social_rival'] === false) continue;

    // build 291: ⚔️/적대 카피 → 동반 톤 (feedback_friendly_language_tone) + ko/en
    const en = prof?.locale === 'en';
    const title = en ? '🏃 Catch up with your pacemaker!' : '🏃 페이스메이커와 나란히 달려요';
    const body = en
      ? (daysLeft === 1
          ? `Last day! Your pacemaker is ${diff.toFixed(1)}km ahead — one run closes the gap`
          : `D-${daysLeft} · Your pacemaker is ${diff.toFixed(1)}km ahead. One run and you're side by side!`)
      : (daysLeft === 1
          ? `오늘이 마지막! 페이스메이커가 ${diff.toFixed(1)}km 앞서 있어요 — 한 번 뛰면 나란히`
          : `D-${daysLeft} · 페이스메이커가 ${diff.toFixed(1)}km 앞서 있어요. 한 번 뛰면 따라잡아요!`);

    const { error } = await supabase.from('push_send_log').insert({
      user_id: r.user_id,
      category: 'social_rival',
      title, body,
      payload: { kind: 'rival_callout', rival_id: r.opponent_id, days_left: daysLeft, diff_km: diff },
      status: 'pending',
    });
    if (!error) queued++;
  }

  return NextResponse.json({ ok: true, queued, days_left: daysLeft, month });
}

export async function GET(req: NextRequest) { return POST(req); }
