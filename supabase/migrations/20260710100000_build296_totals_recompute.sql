-- build 296 hotfix: 통산 캐시를 증분 → 전체 재계산으로 전환 (드리프트 원천 차단)
--
-- 증분 (+NEW -OLD) 방식이 나흘 새 2회 드리프트 (걷기 재태깅 이중 적용 등 — hans 통산
-- 815.99 vs 실측 808.47). 원인 특정보다 구조 전환이 정답: 현재 규모 (activities ~1.7k,
-- 유저별 수백 행 + idx_activities_user) 에선 변경 시 전체 SUM 이 충분히 싸고 항상 정확.
-- 유저 1만+ 스케일에서 증분 복귀를 검토하되 그땐 원장 검증 잡과 페어로.

CREATE OR REPLACE FUNCTION public.update_profile_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE profiles p SET
    total_distance_km = s.km,
    total_runs = s.runs,
    total_duration_seconds = s.dur,
    updated_at = NOW()
  FROM (
    SELECT COALESCE(SUM(a.distance_km), 0) AS km,
           COUNT(*) AS runs,
           COALESCE(SUM(COALESCE(a.duration_seconds, 0)), 0) AS dur
    FROM public.activities a
    WHERE a.user_id = v_user
      AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
  ) s
  WHERE p.id = v_user;

  -- user_id 가 바뀌는 UPDATE (실사용 없음, 방어) — 이전 소유자도 재계산
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    UPDATE profiles p SET
      total_distance_km = s.km, total_runs = s.runs, total_duration_seconds = s.dur, updated_at = NOW()
    FROM (
      SELECT COALESCE(SUM(a.distance_km), 0) AS km, COUNT(*) AS runs,
             COALESCE(SUM(COALESCE(a.duration_seconds, 0)), 0) AS dur
      FROM public.activities a
      WHERE a.user_id = OLD.user_id
        AND (a.activity_type IS NULL OR a.activity_type <> 'walking')
    ) s
    WHERE p.id = OLD.user_id;
  END IF;

  RETURN NULL;
END;
$function$;

-- 전 유저 재백필 (드리프트 정정)
UPDATE public.profiles p SET
  total_distance_km = COALESCE(s.km, 0),
  total_runs = COALESCE(s.runs, 0),
  total_duration_seconds = COALESCE(s.dur, 0),
  updated_at = NOW()
FROM (
  SELECT pr.id,
         SUM(a.distance_km) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS km,
         COUNT(a.id) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS runs,
         SUM(COALESCE(a.duration_seconds, 0)) FILTER (WHERE a.activity_type IS NULL OR a.activity_type <> 'walking') AS dur
  FROM public.profiles pr
  LEFT JOIN public.activities a ON a.user_id = pr.id
  GROUP BY pr.id
) s
WHERE s.id = p.id;
