-- 2026-08-09: 랭킹 변동 시각화 (hans 요청 — 그래프 + 전일/전주/전월 대비 등락).
--
-- 지금까지 순위를 어디에도 보관하지 않아 "몇 등 올랐는지" 를 계산할 근거가 없었다.
-- 매일 전 회원의 순위를 배치로 굽는 대신, 홈 히어로가 이미 계산해서 받은 순위를 그대로
-- 하루 1행으로 upsert 한다 (추가 집계 비용 0, 앱을 여는 사용자만 쌓임 = 필요한 사람만).
-- 초기 그래프가 비지 않도록 최근 30일치는 activities 로 소급 계산해 채운다.

CREATE TABLE IF NOT EXISTS public.rank_snapshots (
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  axis           text NOT NULL CHECK (axis IN ('week', 'month', 'year')),
  snapshot_date  date NOT NULL,                       -- KST 기준 날짜
  rank_position  integer NOT NULL,
  total_in_scope integer NOT NULL,
  km             numeric NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, axis, snapshot_date)
);

ALTER TABLE public.rank_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_snapshots_select_own ON public.rank_snapshots;
CREATE POLICY rank_snapshots_select_own ON public.rank_snapshots
  FOR SELECT USING (auth.uid() = user_id);

-- 쓰기는 RPC(SECURITY DEFINER) 로만 — 클라이언트가 순위를 위조하지 못하게 직접 INSERT 금지.

-- ── 오늘 순위 기록 (홈 히어로가 RPC 응답을 받은 직후 호출) ────────────────
CREATE OR REPLACE FUNCTION public.record_rank_snapshot(
  p_axis text, p_rank integer, p_total integer, p_km numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF p_axis NOT IN ('week','month','year') THEN RETURN; END IF;
  -- 기록 없는 상태(rank 0)는 의미가 없어 저장하지 않는다.
  IF p_rank IS NULL OR p_rank < 1 THEN RETURN; END IF;

  INSERT INTO public.rank_snapshots (user_id, axis, snapshot_date, rank_position, total_in_scope, km)
  VALUES (v_uid, p_axis, (now() AT TIME ZONE 'Asia/Seoul')::date, p_rank, COALESCE(p_total,0), COALESCE(p_km,0))
  ON CONFLICT (user_id, axis, snapshot_date)
  DO UPDATE SET rank_position = EXCLUDED.rank_position,
                total_in_scope = EXCLUDED.total_in_scope,
                km = EXCLUDED.km;
END;
$$;

REVOKE ALL ON FUNCTION public.record_rank_snapshot(text,integer,integer,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_rank_snapshot(text,integer,integer,numeric) TO authenticated;

-- ── 변동 조회: 최근 N일 시계열 + 전일/전주/전월 대비 등락 ──────────────────
-- delta 는 "이전 순위 - 현재 순위" (양수 = 상승). 비교 시점에 기록이 없으면 NULL.
CREATE OR REPLACE FUNCTION public.get_rank_history(p_axis text DEFAULT 'month', p_days integer DEFAULT 14)
RETURNS TABLE (
  snapshot_date date, rank_position integer, total_in_scope integer, km numeric,
  delta_day integer, delta_week integer, delta_month integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_days int := LEAST(GREATEST(COALESCE(p_days, 14), 2), 90);
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH series AS (
    SELECT s.snapshot_date, s.rank_position, s.total_in_scope, s.km
    FROM public.rank_snapshots s
    WHERE s.user_id = v_uid AND s.axis = p_axis
      AND s.snapshot_date > v_today - v_days
    ORDER BY s.snapshot_date
  ),
  latest AS (SELECT * FROM series ORDER BY snapshot_date DESC LIMIT 1),
  -- 비교 시점: 해당 날짜 이전(포함)의 가장 가까운 기록 — 매일 열지 않아도 등락이 나오게.
  prev AS (
    SELECT
      (SELECT s.rank_position FROM public.rank_snapshots s
        WHERE s.user_id = v_uid AND s.axis = p_axis AND s.snapshot_date <= v_today - 1
        ORDER BY s.snapshot_date DESC LIMIT 1) AS d1,
      (SELECT s.rank_position FROM public.rank_snapshots s
        WHERE s.user_id = v_uid AND s.axis = p_axis AND s.snapshot_date <= v_today - 7
        ORDER BY s.snapshot_date DESC LIMIT 1) AS d7,
      (SELECT s.rank_position FROM public.rank_snapshots s
        WHERE s.user_id = v_uid AND s.axis = p_axis AND s.snapshot_date <= v_today - 30
        ORDER BY s.snapshot_date DESC LIMIT 1) AS d30
  )
  SELECT se.snapshot_date, se.rank_position, se.total_in_scope, se.km,
         CASE WHEN se.snapshot_date = (SELECT l.snapshot_date FROM latest l)
              THEN (SELECT p.d1 FROM prev p) - se.rank_position END,
         CASE WHEN se.snapshot_date = (SELECT l.snapshot_date FROM latest l)
              THEN (SELECT p.d7 FROM prev p) - se.rank_position END,
         CASE WHEN se.snapshot_date = (SELECT l.snapshot_date FROM latest l)
              THEN (SELECT p.d30 FROM prev p) - se.rank_position END
  FROM series se
  ORDER BY se.snapshot_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_rank_history(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rank_history(text,integer) TO authenticated;

-- ── 최근 30일 소급 백필 (month 축) ────────────────────────────────────────
-- 그래프가 첫날부터 비어 보이지 않도록. 스코프는 "공개 프로필 전체" 근사 —
-- 히어로 기본 필터(국가)와 사실상 동일하다 (현 회원 대부분이 KR).
INSERT INTO public.rank_snapshots (user_id, axis, snapshot_date, rank_position, total_in_scope, km)
SELECT r.user_id, 'month', r.d, r.rk::int, r.total::int, r.km
FROM (
  SELECT d.d, a.user_id,
         SUM(a.distance_km) AS km,
         RANK() OVER (PARTITION BY d.d ORDER BY SUM(a.distance_km) DESC) AS rk,
         COUNT(*) OVER (PARTITION BY d.d) AS total
  FROM generate_series(
         ((now() AT TIME ZONE 'Asia/Seoul')::date - 29),
         (now() AT TIME ZONE 'Asia/Seoul')::date,
         interval '1 day') AS d(d)
  JOIN public.activities a
    ON a.activity_date >= date_trunc('month', d.d)::date
   AND a.activity_date <= d.d
   AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
  JOIN public.profiles p ON p.id = a.user_id AND p.is_public = true
  GROUP BY d.d, a.user_id
) r
ON CONFLICT (user_id, axis, snapshot_date) DO NOTHING;
