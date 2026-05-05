-- BIT RUNNERS / BIT Runners 2026-04 import
-- generated: 2026-05-05T11:18:39.113Z
-- members: 19

BEGIN;

-- 1. 클럽 id 조회
DO $$
DECLARE
  v_club_id uuid;
  v_member_id uuid;
BEGIN
  SELECT id INTO v_club_id FROM public.clubs WHERE name = 'BIT Runners' LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION '클럽을 찾을 수 없습니다: %', 'BIT Runners';
  END IF;

  -- 같은 달 기존 활동 삭제 (idempotent re-import)
  DELETE FROM public.club_external_activities
  WHERE activity_date >= DATE '2026-04-01'
    AND activity_date <  DATE '2026-05-01'
    AND member_id IN (
      SELECT id FROM public.club_external_members WHERE club_id = v_club_id
    );

  -- 최철용: 204.06km, goal 200km, 19회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '최철용')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 200)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 07:00:00+09:00', 7.25, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-03', TIMESTAMPTZ '2026-04-03 07:00:00+09:00', 4.25, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 07:00:00+09:00', 7.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-09', TIMESTAMPTZ '2026-04-09 07:00:00+09:00', 12.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-11', TIMESTAMPTZ '2026-04-11 07:00:00+09:00', 10.12, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 07:00:00+09:00', 12.23, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 07:00:00+09:00', 9.49, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-14', TIMESTAMPTZ '2026-04-14 07:00:00+09:00', 7.49, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-16', TIMESTAMPTZ '2026-04-16 07:00:00+09:00', 9.54, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-17', TIMESTAMPTZ '2026-04-17 07:00:00+09:00', 9.95, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-18', TIMESTAMPTZ '2026-04-18 07:00:00+09:00', 14.71, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 07:00:00+09:00', 14.61, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 07:00:00+09:00', 12.32, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-22', TIMESTAMPTZ '2026-04-22 07:00:00+09:00', 9.54, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-24', TIMESTAMPTZ '2026-04-24 07:00:00+09:00', 0.75, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 07:00:00+09:00', 27.04, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 07:00:00+09:00', 17.13, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 07:00:00+09:00', 9.46, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 07:00:00+09:00', 8.31, 'html_import_2026_4');

  -- 박현용: 172.4km, goal 150km, 16회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '박현용')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 150)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-01', TIMESTAMPTZ '2026-04-01 07:17:00+09:00', 10.12, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 07:38:00+09:00', 10.18, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 09:56:00+09:00', 17.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 07:38:00+09:00', 9.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 08:02:00+09:00', 17.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 07:29:00+09:00', 22.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-14', TIMESTAMPTZ '2026-04-14 07:30:00+09:00', 10.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 07:29:00+09:00', 10.3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-16', TIMESTAMPTZ '2026-04-16 07:41:00+09:00', 10.3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 07:41:00+09:00', 10.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 08:38:00+09:00', 7.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-22', TIMESTAMPTZ '2026-04-22 07:34:00+09:00', 8.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 07:32:00+09:00', 10.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-24', TIMESTAMPTZ '2026-04-24 07:25:00+09:00', 6.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 23:06:00+09:00', 5.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 00:19:00+09:00', 7.1, 'html_import_2026_4');

  -- 김태현: 124.81km, goal 100km, 25회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '김태현')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 100)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-01', TIMESTAMPTZ '2026-04-01 15:41:00+09:00', 2.66, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 17:50:00+09:00', 3.08, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 12:52:00+09:00', 7.99, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 16:50:00+09:00', 4.34, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 13:04:00+09:00', 7.02, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 15:21:00+09:00', 4.46, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-07', TIMESTAMPTZ '2026-04-07 15:27:00+09:00', 5.32, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 16:35:00+09:00', 5.37, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-10', TIMESTAMPTZ '2026-04-10 12:01:00+09:00', 3.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 07:49:00+09:00', 5.15, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 20:05:00+09:00', 5.34, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-14', TIMESTAMPTZ '2026-04-14 11:43:00+09:00', 3.47, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-16', TIMESTAMPTZ '2026-04-16 22:23:00+09:00', 5.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-17', TIMESTAMPTZ '2026-04-17 08:49:00+09:00', 5.37, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-18', TIMESTAMPTZ '2026-04-18 21:29:00+09:00', 7.12, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 08:17:00+09:00', 4.36, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 22:39:00+09:00', 4.44, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 10:59:00+09:00', 5.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-22', TIMESTAMPTZ '2026-04-22 12:27:00+09:00', 5.39, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 18:36:00+09:00', 5.39, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-24', TIMESTAMPTZ '2026-04-24 09:36:00+09:00', 5.41, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 00:18:00+09:00', 4.8, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 14:52:00+09:00', 7.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 14:49:00+09:00', 4.43, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-30', TIMESTAMPTZ '2026-04-30 20:05:00+09:00', 3.03, 'html_import_2026_4');

  -- 오민혁: 120.46km, goal 120km, 7회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '오민혁')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 120)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 15:22:00+09:00', 29.88, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 07:35:00+09:00', 12.19, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 07:41:00+09:00', 9.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-22', TIMESTAMPTZ '2026-04-22 07:54:00+09:00', 10.31, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-27', TIMESTAMPTZ '2026-04-27 07:35:00+09:00', 20.19, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 19:18:00+09:00', 24.57, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 11:27:00+09:00', 14.12, 'html_import_2026_4');

  -- 성차민: 105.7km, goal 150km, 14회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '성차민')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 150)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 21:26:00+09:00', 7, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 12:46:00+09:00', 4.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 19:13:00+09:00', 8, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 20:36:00+09:00', 6.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 21:20:00+09:00', 15.9, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 21:28:00+09:00', 5.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-16', TIMESTAMPTZ '2026-04-16 20:36:00+09:00', 14.8, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 22:01:00+09:00', 6.3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 21:34:00+09:00', 5.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 22:06:00+09:00', 5.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 22:12:00+09:00', 7.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 22:34:00+09:00', 5.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 22:30:00+09:00', 9.3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 21:31:00+09:00', 5.2, 'html_import_2026_4');

  -- 문신기: 83.5km, goal 100km, 5회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '문신기')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 100)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 08:44:00+09:00', 17.34, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 10:46:00+09:00', 27.96, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 20:46:00+09:00', 11.3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 11:05:00+09:00', 19.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-30', TIMESTAMPTZ '2026-04-30 21:36:00+09:00', 7.3, 'html_import_2026_4');

  -- 최명훈: 72.86km, goal 70km, 9회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '최명훈')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 70)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 23:06:00+09:00', 8.8, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 21:35:00+09:00', 8.92, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-10', TIMESTAMPTZ '2026-04-10 23:11:00+09:00', 8.8, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 20:27:00+09:00', 10.31, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 10:25:00+09:00', 8.77, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 08:28:00+09:00', 10.27, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 22:25:00+09:00', 6.28, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 00:10:00+09:00', 3.5, 'html_import_2026_4'),
    (v_member_id, DATE '2026-05-01', TIMESTAMPTZ '2026-05-01 00:28:00+09:00', 7.21, 'html_import_2026_4');

  -- 강도균: 65.03km, goal 170km, 8회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '강도균')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 170)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 23:51:00+09:00', 12.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 10:01:00+09:00', 7.17, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 22:36:00+09:00', 9.77, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-11', TIMESTAMPTZ '2026-04-11 18:35:00+09:00', 10.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 22:42:00+09:00', 8.25, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-16', TIMESTAMPTZ '2026-04-16 23:32:00+09:00', 8.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-24', TIMESTAMPTZ '2026-04-24 23:52:00+09:00', 3.81, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 10:21:00+09:00', 5.63, 'html_import_2026_4');

  -- 이지영: 59.55km, goal 100km, 8회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '이지영')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 100)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 10:48:00+09:00', 7.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 21:44:00+09:00', 6.54, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 18:03:00+09:00', 10.05, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 22:20:00+09:00', 7.58, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 08:32:00+09:00', 7.02, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 22:56:00+09:00', 7.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 22:02:00+09:00', 7.02, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 22:49:00+09:00', 7.32, 'html_import_2026_4');

  -- 심성재: 59.17km, goal 60km, 8회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '심성재')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 60)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 16:54:00+09:00', 11.29, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 18:40:00+09:00', 10.28, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 13:20:00+09:00', 2.98, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-10', TIMESTAMPTZ '2026-04-10 09:30:00+09:00', 4.44, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-11', TIMESTAMPTZ '2026-04-11 10:02:00+09:00', 4.65, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 20:58:00+09:00', 6.43, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 14:05:00+09:00', 10.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 21:36:00+09:00', 9.09, 'html_import_2026_4');

  -- 이승우: 52.06km, goal 100km, 8회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '이승우')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 100)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 07:33:00+09:00', 9.87, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 07:19:00+09:00', 5.83, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-17', TIMESTAMPTZ '2026-04-17 07:25:00+09:00', 5.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 09:22:00+09:00', 5.63, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 08:53:00+09:00', 5.41, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 07:57:00+09:00', 5.07, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 07:47:00+09:00', 12.68, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-30', TIMESTAMPTZ '2026-04-30 07:39:00+09:00', 2.19, 'html_import_2026_4');

  -- 윤화식: 51.42km, goal 50km, 14회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '윤화식')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 50)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 20:47:00+09:00', 2.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 17:26:00+09:00', 7.39, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 21:03:00+09:00', 3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-09', TIMESTAMPTZ '2026-04-09 21:15:00+09:00', 2.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-10', TIMESTAMPTZ '2026-04-10 20:15:00+09:00', 3.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 20:28:00+09:00', 2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-18', TIMESTAMPTZ '2026-04-18 09:52:00+09:00', 1.77, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 20:26:00+09:00', 2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 19:10:00+09:00', 6.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-24', TIMESTAMPTZ '2026-04-24 19:38:00+09:00', 5.63, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-27', TIMESTAMPTZ '2026-04-27 19:25:00+09:00', 2.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 17:22:00+09:00', 3.33, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 22:31:00+09:00', 6.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-30', TIMESTAMPTZ '2026-04-30 20:53:00+09:00', 3.6, 'html_import_2026_4');

  -- 박영건: 51.39km, goal 50km, 5회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '박영건')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 50)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 21:40:00+09:00', 6.18, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 20:10:00+09:00', 8.04, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 07:48:00+09:00', 10.44, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 22:05:00+09:00', 9.91, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 21:21:00+09:00', 16.82, 'html_import_2026_4');

  -- 홍성조: 50.8km, goal 50km, 14회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '홍성조')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 50)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-01', TIMESTAMPTZ '2026-04-01 08:55:00+09:00', 2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 08:05:00+09:00', 2.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-07', TIMESTAMPTZ '2026-04-07 07:56:00+09:00', 2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 07:24:00+09:00', 3.01, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 07:06:00+09:00', 2.84, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-17', TIMESTAMPTZ '2026-04-17 07:21:00+09:00', 2.58, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 08:14:00+09:00', 2.63, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-21', TIMESTAMPTZ '2026-04-21 10:22:00+09:00', 2.21, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-22', TIMESTAMPTZ '2026-04-22 07:07:00+09:00', 4.2, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 07:49:00+09:00', 6.65, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-27', TIMESTAMPTZ '2026-04-27 07:28:00+09:00', 3.18, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 07:55:00+09:00', 6.18, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 09:31:00+09:00', 6.98, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-30', TIMESTAMPTZ '2026-04-30 07:25:00+09:00', 4.24, 'html_import_2026_4');

  -- 김연주: 50.57km, goal 120km, 6회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '김연주')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 120)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 21:15:00+09:00', 3.18, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 08:44:00+09:00', 14.16, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-15', TIMESTAMPTZ '2026-04-15 23:07:00+09:00', 8.02, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 11:11:00+09:00', 8.39, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 06:55:00+09:00', 12.37, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-30', TIMESTAMPTZ '2026-04-30 14:15:00+09:00', 4.45, 'html_import_2026_4');

  -- 강수남: 50.54km, goal 60km, 5회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '강수남')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 60)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-03', TIMESTAMPTZ '2026-04-03 23:00:00+09:00', 11.41, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-20', TIMESTAMPTZ '2026-04-20 10:33:00+09:00', 8.08, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 12:09:00+09:00', 10.54, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-27', TIMESTAMPTZ '2026-04-27 11:00:00+09:00', 12.31, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 12:00:00+09:00', 8.2, 'html_import_2026_4');

  -- 김창옥: 50.06km, goal 110km, 10회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '김창옥')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 110)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-01', TIMESTAMPTZ '2026-04-01 15:01:00+09:00', 5, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 06:16:00+09:00', 6.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 12:48:00+09:00', 4.62, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-04', TIMESTAMPTZ '2026-04-04 18:25:00+09:00', 5, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-05', TIMESTAMPTZ '2026-04-05 18:31:00+09:00', 6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-06', TIMESTAMPTZ '2026-04-06 15:15:00+09:00', 4.38, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-07', TIMESTAMPTZ '2026-04-07 10:13:00+09:00', 4.02, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-08', TIMESTAMPTZ '2026-04-08 16:44:00+09:00', 4.25, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-27', TIMESTAMPTZ '2026-04-27 19:26:00+09:00', 5.22, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 19:19:00+09:00', 5.19, 'html_import_2026_4');

  -- 정성원: 45.9km, goal 60km, 8회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '정성원')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 60)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-02', TIMESTAMPTZ '2026-04-02 07:24:00+09:00', 3.81, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-07', TIMESTAMPTZ '2026-04-07 08:16:00+09:00', 7.09, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-09', TIMESTAMPTZ '2026-04-09 07:58:00+09:00', 4.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-13', TIMESTAMPTZ '2026-04-13 06:56:00+09:00', 7.4, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-19', TIMESTAMPTZ '2026-04-19 08:43:00+09:00', 7.9, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-23', TIMESTAMPTZ '2026-04-23 18:28:00+09:00', 4.3, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 20:20:00+09:00', 7.6, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-27', TIMESTAMPTZ '2026-04-27 20:35:00+09:00', 3.7, 'html_import_2026_4');

  -- 이상화: 44.18km, goal 50km, 8회
  INSERT INTO public.club_external_members (club_id, name)
  VALUES (v_club_id, '이상화')
  ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_member_id;

  INSERT INTO public.club_external_monthly_goals (member_id, year, month, goal_km)
  VALUES (v_member_id, 2026, 4, 50)
  ON CONFLICT (member_id, year, month) DO UPDATE SET goal_km = EXCLUDED.goal_km;

  INSERT INTO public.club_external_activities (member_id, activity_date, started_at, distance_km, source) VALUES
    (v_member_id, DATE '2026-04-12', TIMESTAMPTZ '2026-04-12 18:53:00+09:00', 4.9, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-14', TIMESTAMPTZ '2026-04-14 12:47:00+09:00', 5.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-18', TIMESTAMPTZ '2026-04-18 09:54:00+09:00', 7, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-25', TIMESTAMPTZ '2026-04-25 09:34:00+09:00', 7.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-26', TIMESTAMPTZ '2026-04-26 11:17:00+09:00', 9.1, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-28', TIMESTAMPTZ '2026-04-28 20:02:00+09:00', 5.65, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 15:16:00+09:00', 2.27, 'html_import_2026_4'),
    (v_member_id, DATE '2026-04-29', TIMESTAMPTZ '2026-04-29 21:12:00+09:00', 3.06, 'html_import_2026_4');

END $$;

COMMIT;
