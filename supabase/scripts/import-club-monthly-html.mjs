#!/usr/bin/env node
// 클럽 월별 결산 HTML → SQL 변환기
//
// 사용:
//   node supabase/scripts/import-club-monthly-html.mjs \
//     --html ~/Downloads/bit-runners-2026-04.html \
//     --club-name 'BIT RUNNERS' \
//     --year 2026 --month 4 \
//     > supabase/scripts/bit-runners-2026-04.sql
//
// HTML 안에 `const MEMBERS_DATA = [...]` 형태의 JSON 이 들어있어야 함.
// 멤버 (club_id, name) 와 활동 (member_id, activity_date, started_at, distance_km) 을 INSERT.
// 재실행 시 멤버는 ON CONFLICT 로 idempotent. 활동은 매 import 마다 누적되므로
// 같은 달을 다시 import 하기 전에 해당 월 row 를 먼저 삭제하는 statement 도 SQL 에 포함됨.

import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const htmlPath  = args.html;
const clubName  = args['club-name'];
const year      = parseInt(args.year, 10);
const month     = parseInt(args.month, 10);

if (!htmlPath || !clubName || !year || !month) {
  console.error('usage: --html <path> --club-name <name> --year <YYYY> --month <M>');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

const m = html.match(/const\s+MEMBERS_DATA\s*=\s*(\[[\s\S]*?\]);/);
if (!m) {
  console.error('MEMBERS_DATA not found in HTML');
  process.exit(1);
}
const members = JSON.parse(m[1]);

const esc = (s) => String(s).replace(/'/g, "''");
const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
const nextMonth  = month === 12
  ? `${year + 1}-01-01`
  : `${year}-${String(month + 1).padStart(2, '0')}-01`;

console.log(`-- BIT RUNNERS / ${clubName} ${year}-${String(month).padStart(2, '0')} import`);
console.log(`-- generated: ${new Date().toISOString()}`);
console.log(`-- members: ${members.length}`);
console.log();
console.log('BEGIN;');
console.log();
console.log('-- 1. 클럽 id 조회');
console.log(`DO $$`);
console.log(`DECLARE`);
console.log(`  v_club_id uuid;`);
console.log(`  v_member_id uuid;`);
console.log(`BEGIN`);
console.log(`  SELECT id INTO v_club_id FROM public.clubs WHERE name = '${esc(clubName)}' LIMIT 1;`);
console.log(`  IF v_club_id IS NULL THEN`);
console.log(`    RAISE EXCEPTION '클럽을 찾을 수 없습니다: %', '${esc(clubName)}';`);
console.log(`  END IF;`);
console.log();
console.log(`  -- 같은 달 기존 활동 삭제 (idempotent re-import)`);
console.log(`  DELETE FROM public.club_external_activities`);
console.log(`  WHERE activity_date >= DATE '${monthStart}'`);
console.log(`    AND activity_date <  DATE '${nextMonth}'`);
console.log(`    AND member_id IN (`);
console.log(`      SELECT id FROM public.club_external_members WHERE club_id = v_club_id`);
console.log(`    );`);
console.log();

for (const m of members) {
  console.log(`  -- ${m.name}: ${m.final_dist}km, goal ${m.goal}km, ${m.run_count}회`);
  console.log(`  INSERT INTO public.club_external_members (club_id, name)`);
  console.log(`  VALUES (v_club_id, '${esc(m.name)}')`);
  console.log(`  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name`);
  console.log(`  RETURNING id INTO v_member_id;`);
  console.log();
  console.log(`  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)`);
  console.log(`  VALUES (v_member_id, ${year}, ${month}, ${m.goal})`);
  console.log(`  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;`);
  console.log();

  if (m.run_events && m.run_events.length > 0) {
    console.log(`  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES`);
    const rows = m.run_events.map((e) => {
      const startedAt = e.datetime
        ? `TIMESTAMPTZ '${e.datetime.replace('T', ' ')}+09:00'`
        : 'NULL';
      return `    (v_member_id, DATE '${e.date}', ${startedAt}, ${e.delta}, 'html_import_${year}_${month}')`;
    });
    console.log(rows.join(',\n') + ';');
    console.log();
  }
}

console.log(`END $$;`);
console.log();
console.log('COMMIT;');
