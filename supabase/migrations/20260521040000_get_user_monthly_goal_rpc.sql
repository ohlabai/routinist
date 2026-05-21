-- build 161 #8-2: 친구 프로필에서 친구의 이달 목표 조회 RPC.
-- monthly_goals RLS 는 본인만 SELECT — friend 가 직접 쿼리 불가.
-- SECURITY DEFINER 로 우회하되, profile.is_public = true 인 경우만 노출.
CREATE OR REPLACE FUNCTION public.get_user_monthly_goal(
  target_user_id uuid,
  p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_year INTEGER := COALESCE(p_year, EXTRACT(YEAR FROM now())::INT);
  v_month INTEGER := COALESCE(p_month, EXTRACT(MONTH FROM now())::INT);
  v_is_public BOOLEAN;
  v_goal NUMERIC;
BEGIN
  IF target_user_id = auth.uid() THEN
    SELECT goal_km INTO v_goal
    FROM public.monthly_goals
    WHERE user_id = target_user_id AND year = v_year AND month = v_month;
    RETURN v_goal;
  END IF;

  SELECT is_public INTO v_is_public FROM public.profiles WHERE id = target_user_id;
  IF NOT COALESCE(v_is_public, false) THEN RETURN NULL; END IF;

  SELECT goal_km INTO v_goal
  FROM public.monthly_goals
  WHERE user_id = target_user_id AND year = v_year AND month = v_month;
  RETURN v_goal;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_monthly_goal(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_monthly_goal(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_monthly_goal(uuid, integer, integer) TO authenticated;
