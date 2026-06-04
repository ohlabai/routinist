-- build 248: profile.this_month_* timezone 버그 fix.
--
-- 증상 (크넥 사례): 6월 4건 / 17.63km 인데 profile 은 1건 / 10.31km 만 표시.
--
-- 원인: _recompute_profile_this_month 함수가 CURRENT_DATE (UTC) 기준으로 "오늘" 을 계산.
-- activity_date 는 health-sync 가 사용자 timezone (KST) 기준으로 저장.
-- 한국 새벽 (UTC 기준 전날 21~24시) 에 sync 된 활동은 activity_date 가 KST 내일,
-- 트리거의 CURRENT_DATE 는 UTC 어제 → "activity_date <= CURRENT_DATE" 조건에서 제외.
-- 월 경계에서도 같은 문제 (5/31 23 UTC 에 들어온 6/1 KST 데이터가 5월에 합산).
--
-- Fix: now() AT TIME ZONE 'Asia/Seoul' 로 KST 기준 오늘 / 이번달 계산.
-- 현재 사용자 100% 한국. 글로벌 확장 시 profile.country_code 별 분기 가능.

CREATE OR REPLACE FUNCTION public._recompute_profile_this_month(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_km NUMERIC;
  v_runs INTEGER;
  v_today_kst DATE;
BEGIN
  v_today_kst := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT COALESCE(SUM(distance_km), 0)::numeric, COUNT(*)::int
  INTO v_km, v_runs
  FROM public.activities
  WHERE user_id = p_user_id
    AND activity_date >= DATE_TRUNC('month', v_today_kst)::date
    AND activity_date <= v_today_kst;

  UPDATE public.profiles
  SET this_month_distance_km = v_km,
      this_month_runs = v_runs,
      this_month_updated_at = now()
  WHERE id = p_user_id;
END;
$function$;

-- 영향받은 모든 사용자에 대해 즉시 백필.
-- 정확한 영향 범위: profile.this_month_updated_at 이 KST 기준 오늘 자정 이전인데
-- KST 기준 이번달 활동이 있는 사용자. 안전하게 모든 사용자 recompute.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public._recompute_profile_this_month(r.id);
  END LOOP;
END $$;
