-- build 252: 월드런 활성화 — 진행 push (50%/90%) + 친구와 동시 진행 RPC
--
-- (A) user_course_progress.notified_milestones (jsonb array) — 어느 마일스톤이 push 됐는지
--     예: [50, 90]. 중복 발사 방지.
-- (B) notify_course_progress() — activities AFTER INSERT 트리거. 진행중 코스 progress 재계산.
--     50% / 90% 도달 시 push_send_log INSERT + notified_milestones 업데이트.
-- (C) fetch_course_friends(p_course_id) — 같은 코스 참가중인 내 팔로잉 친구 진행률.

------------------------------------------------------------
-- (A) 컬럼
------------------------------------------------------------
ALTER TABLE public.user_course_progress
  ADD COLUMN IF NOT EXISTS notified_milestones JSONB NOT NULL DEFAULT '[]'::jsonb;

------------------------------------------------------------
-- (B) 진행 push 트리거
--   activity INSERT 시 사용자의 진행중 코스 각각에 대해 누적 km 재계산.
--   50%/90% 임계값 처음 통과 시 push_send_log 큐잉 + notified_milestones 에 기록.
--   완주 (>=100%) 는 fetch_my_courses() 의 _complete_course 가 처리하므로 여기선 push 만 처리.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_course_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r RECORD;
  v_progress NUMERIC;
  v_pct NUMERIC;
  v_done JSONB;
  v_milestone INT;
  v_remaining NUMERIC;
BEGIN
  -- in-progress 코스만 반복 (completed_at IS NULL)
  FOR r IN
    SELECT ucp.course_id, ucp.started_at, ucp.notified_milestones,
           vc.name, vc.distance_km
      FROM public.user_course_progress ucp
      JOIN public.virtual_courses vc ON vc.id = ucp.course_id
     WHERE ucp.user_id = NEW.user_id
       AND ucp.completed_at IS NULL
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
      FROM public.activities a
     WHERE a.user_id = NEW.user_id AND a.created_at >= r.started_at;

    IF r.distance_km IS NULL OR r.distance_km <= 0 THEN CONTINUE; END IF;
    v_pct := v_progress / r.distance_km * 100;
    v_done := r.notified_milestones;

    -- 50% / 90% 처음 도달
    FOREACH v_milestone IN ARRAY ARRAY[50, 90]
    LOOP
      IF v_pct >= v_milestone AND v_pct < 100
         AND NOT (v_done @> to_jsonb(v_milestone)) THEN
        IF public.should_send_push(NEW.user_id, 'course_progress') THEN
          v_remaining := GREATEST(0, r.distance_km - v_progress);
          INSERT INTO public.push_send_log (user_id, category, title, body, payload, status)
          VALUES (
            NEW.user_id, 'course_progress',
            CASE WHEN v_milestone = 50
                 THEN '🔥 ' || r.name || ' 절반 왔어요!'
                 ELSE '🏁 ' || r.name || ' 거의 다 왔어요!' END,
            v_progress::numeric(10,2) || ' / ' || r.distance_km::numeric(10,2) || ' km · '
              || '남은 거리 ' || v_remaining::numeric(10,2) || ' km',
            jsonb_build_object(
              'course_id', r.course_id::text,
              'course_name', r.name,
              'progress_pct', v_milestone,
              'deep_link', '/social/rankings?tab=world'
            ),
            'pending'
          );
        END IF;
        v_done := v_done || to_jsonb(v_milestone);
      END IF;
    END LOOP;

    IF v_done <> r.notified_milestones THEN
      UPDATE public.user_course_progress
         SET notified_milestones = v_done
       WHERE user_id = NEW.user_id AND course_id = r.course_id;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_course_progress ON public.activities;
CREATE TRIGGER trg_notify_course_progress
  AFTER INSERT ON public.activities
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_course_progress();

------------------------------------------------------------
-- (C) fetch_course_friends — 같은 코스 진행중인 친구들의 progress
--   friends = 내가 팔로우(follower_id=me)한 사람.
--   응답: 친구별 progress_km + ratio + completed.
--   상위 10명만, 진행률 내림차순.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_course_friends(p_course_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  progress_km NUMERIC,
  ratio NUMERIC,
  completed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_course_km NUMERIC;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT distance_km INTO v_course_km FROM public.virtual_courses WHERE id = p_course_id;
  IF v_course_km IS NULL OR v_course_km <= 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH my_friends AS (
    SELECT f.following_id AS uid
      FROM public.follows f
     WHERE f.follower_id = v_me
  ),
  joined AS (
    SELECT ucp.user_id, ucp.started_at, ucp.completed_at
      FROM public.user_course_progress ucp
      JOIN my_friends mf ON mf.uid = ucp.user_id
     WHERE ucp.course_id = p_course_id
  ),
  progress AS (
    SELECT j.user_id,
           j.started_at,
           j.completed_at,
           COALESCE((
             SELECT SUM(a.distance_km)
               FROM public.activities a
              WHERE a.user_id = j.user_id
                AND a.created_at >= j.started_at
           ), 0)::numeric AS progress_km
      FROM joined j
  )
  SELECT
    p.user_id,
    pr.display_name,
    pr.avatar_url,
    p.progress_km,
    LEAST(1, p.progress_km / v_course_km)::numeric AS ratio,
    p.completed_at,
    p.started_at
  FROM progress p
  JOIN public.profiles pr ON pr.id = p.user_id
  ORDER BY p.completed_at IS NULL, p.progress_km DESC
  LIMIT 10;
END $$;

REVOKE ALL ON FUNCTION public.fetch_course_friends(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_course_friends(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_course_friends(UUID) TO authenticated;
