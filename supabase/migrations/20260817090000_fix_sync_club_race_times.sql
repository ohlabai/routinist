-- 2026-08-17: sync_club_race_times 가 실행 자체가 안 되던 것 수리.
--
-- 증상: 호출 즉시 42P10 "invalid reference to FROM-clause entry for table \"e\"".
-- 원인: UPDATE ... FROM LATERAL (...) 안에서 **UPDATE 대상 별칭(e)** 을 참조했다.
--       Postgres 는 UPDATE 타깃을 FROM 의 LATERAL 항목에서 참조하는 것을 허용하지 않는다.
-- 왜 안 잡혔나: plpgsql 은 함수 본문의 SQL 을 **실행 시점에** 파싱한다. CREATE FUNCTION 은
--       성공하므로 마이그레이션이 통과했고, 8/21 대회 당일 "기록 가져오기" 를 누르는 순간
--       터졌을 것이다. (교훈: plpgsql 함수는 만든 뒤 반드시 한 번 호출해봐야 한다)
--
-- 수정: LATERAL 대신 DISTINCT ON 으로 사용자별 최장거리 1건을 미리 뽑아 조인한다.

CREATE OR REPLACE FUNCTION public.sync_club_race_times(p_race_id UUID)
RETURNS TABLE (matched INTEGER, missing INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_race public.club_races%ROWTYPE;
  v_matched INTEGER := 0;
  v_missing INTEGER := 0;
BEGIN
  SELECT * INTO v_race FROM public.club_races WHERE id = p_race_id;
  IF v_race.id IS NULL THEN
    RAISE EXCEPTION '대회를 찾을 수 없습니다';
  END IF;

  -- 운영자만 (SECURITY DEFINER 라 RLS 를 우회하므로 여기서 직접 확인)
  IF NOT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = v_race.club_id AND user_id = auth.uid() AND role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION '클럽 운영자만 기록을 동기화할 수 있습니다';
  END IF;

  UPDATE public.club_race_entries e
  SET seconds     = m.elapsed_s,
      distance_km = m.distance_km,
      activity_id = m.activity_id,
      source      = 'auto',
      updated_at  = NOW()
  FROM (
    -- 참가자별로 대회 창 안에서 **가장 멀리 뛴** 활동 1건.
    -- 기록은 실경과(ended_at - started_at). ended_at 이 없으면 duration_seconds 로 폴백.
    SELECT DISTINCT ON (a.user_id)
           a.user_id,
           a.id AS activity_id,
           a.distance_km,
           COALESCE(
             NULLIF(EXTRACT(EPOCH FROM (a.ended_at - a.started_at))::INTEGER, 0),
             a.duration_seconds
           ) AS elapsed_s
    FROM public.activities a
    WHERE a.started_at >= v_race.starts_at
      AND a.started_at <  v_race.ends_at
      AND a.user_id IN (
        SELECT user_id FROM public.club_race_entries
        WHERE race_id = p_race_id AND user_id IS NOT NULL
      )
    ORDER BY a.user_id, a.distance_km DESC
  ) m
  WHERE e.race_id = p_race_id
    AND e.user_id = m.user_id
    AND e.source IN ('pending','auto')     -- 수동 입력·DNF 는 보존
    AND m.elapsed_s > 0;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  SELECT COUNT(*) INTO v_missing
  FROM public.club_race_entries
  WHERE race_id = p_race_id AND seconds IS NULL AND source <> 'dnf';

  RETURN QUERY SELECT v_matched, v_missing;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_club_race_times(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_club_race_times(UUID) TO authenticated;
