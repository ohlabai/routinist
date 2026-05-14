-- 2026-05-14 build 136 — 우승자 맞히기 자동 라운드 + 자동 정산.
--
-- 문제: cron 이 없어서 새 주의 라운드가 만들어지지 않음. 결과:
--   1) get_current_prediction_round() 가 지난 주의 settled/stale round 를 반환
--   2) 위젯에 "마감됨" 표시 → 사용자는 아무것도 못 함 → 에러로 인지
--
-- 해결 (cron 없이): get_current_prediction_round 를 plpgsql 로 변경,
--   호출 시점에 (a) 현재 주 라운드가 없으면 생성, (b) 종료된 미정산 라운드를 정산.
--   이 함수는 클라이언트가 매 진입 시 호출하므로 lazy + 셀프 힐링.

CREATE OR REPLACE FUNCTION public.get_current_prediction_round()
RETURNS TABLE (
  id UUID,
  week_of DATE,
  starts_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  state TEXT,
  my_pick UUID,
  total_picks INTEGER
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_monday DATE;
  v_round_id UUID;
BEGIN
  -- KST 기준 이번 주 월요일
  v_monday := date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul')::DATE;

  -- 이번 주 라운드 없으면 생성 (SECURITY DEFINER 이므로 RLS 무관).
  -- 컬럼·반환 TABLE 변수와 이름 충돌 방지 위해 alias 명시.
  IF NOT EXISTS (SELECT 1 FROM public.prediction_rounds r WHERE r.week_of = v_monday AND r.cohort_type = 'global') THEN
    INSERT INTO public.prediction_rounds (week_of, cohort_type, cohort_value, starts_at, closes_at, ends_at)
    VALUES (
      v_monday,
      'global',
      NULL,
      (v_monday::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE 'Asia/Seoul',
      ((v_monday::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE 'Asia/Seoul' + INTERVAL '5 days 23 hours 59 minutes'),
      ((v_monday::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE 'Asia/Seoul' + INTERVAL '6 days 23 hours 59 minutes')
    )
    ON CONFLICT (week_of) DO NOTHING;
  END IF;

  -- 종료 시각이 지났는데 settle 안 된 과거 라운드(들) 자동 정산.
  -- 보통 1~2 개 — 한 번씩만 처리됨 (settle 함수 안에 idempotent guard).
  FOR v_round_id IN
    SELECT r.id FROM public.prediction_rounds r
    WHERE r.cohort_type = 'global'
      AND r.state != 'settled'
      AND r.ends_at < NOW()
    ORDER BY r.week_of ASC
  LOOP
    BEGIN
      PERFORM public.settle_prediction_round(v_round_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[prediction] settle 실패 (%): %', v_round_id, SQLERRM;
    END;
  END LOOP;

  -- 현재 라운드 반환 — 이번 주 시작 시각 이전이면 직전 주(아직 정산 전 OR 정산 직후) 도 허용
  RETURN QUERY
  SELECT
    r.id, r.week_of, r.starts_at, r.closes_at, r.ends_at, r.state,
    (SELECT picked_user_id FROM public.prediction_picks pp
      WHERE pp.round_id = r.id AND pp.user_id = auth.uid() LIMIT 1) AS my_pick,
    (SELECT COUNT(*)::INTEGER FROM public.prediction_picks pp WHERE pp.round_id = r.id) AS total_picks
  FROM public.prediction_rounds r
  WHERE r.cohort_type = 'global'
  ORDER BY r.week_of DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_prediction_round() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_current_prediction_round() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_current_prediction_round() TO authenticated;
