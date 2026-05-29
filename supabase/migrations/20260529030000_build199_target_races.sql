-- build 199: 타겟 레이스 카운트다운 + 권장 훈련량 (Phase 3).
-- 사용자가 풀/하프/10K 같은 목표 레이스 설정 → 남은 주차별 권장 km/회수.
-- CTL 기반 점진적 증가 (10% rule) 추천.

CREATE TABLE IF NOT EXISTS public.target_races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- "춘천마라톤", "한강 10K" 등 자유 입력
  race_date DATE NOT NULL,
  distance_meters INTEGER NOT NULL,      -- 5000 / 10000 / 21097 / 42195 / 기타
  target_seconds INTEGER,                -- 목표 완주 시간 (선택)
  notes TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS target_races_user_date_idx ON public.target_races (user_id, race_date);

ALTER TABLE public.target_races ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tr_select_own ON public.target_races;
CREATE POLICY tr_select_own ON public.target_races FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS tr_modify_own ON public.target_races;
CREATE POLICY tr_modify_own ON public.target_races FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 다음 임박 레이스 + 권장 주간 훈련량.
-- 권장 주간 km: CTL 기반 점진 증가 (현재 CTL × 7 × 1.1 = 다음 주 목표).
-- 단순화: 레이스까지 남은 주 × 약 5% 증가 / 마지막 주는 taper.
CREATE OR REPLACE FUNCTION public.get_next_target_race() RETURNS JSON AS $$
DECLARE
  v_uid UUID;
  v_race RECORD;
  v_days_left INTEGER;
  v_weeks_left INTEGER;
  v_recommended_weekly_km NUMERIC;
  v_ctl NUMERIC;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'auth required'); END IF;

  SELECT * INTO v_race
  FROM public.target_races
  WHERE user_id = v_uid
    AND is_completed = false
    AND race_date >= CURRENT_DATE
  ORDER BY race_date ASC
  LIMIT 1;

  IF v_race IS NULL THEN RETURN json_build_object('race', NULL); END IF;

  v_days_left := v_race.race_date - CURRENT_DATE;
  v_weeks_left := GREATEST(0, CEIL(v_days_left / 7.0)::INTEGER);

  -- 사용자 최근 CTL 가져오기
  BEGIN
    SELECT ctl INTO v_ctl FROM public.get_my_fitness_trend(7) ORDER BY date DESC LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_ctl := NULL;
  END;

  -- 권장 주간 km: CTL 있으면 그 × 5.5 (~ 1주 누적 추정). 없으면 거리 별 표준값.
  IF v_ctl IS NOT NULL AND v_ctl > 5 THEN
    v_recommended_weekly_km := ROUND(v_ctl * 5.5, 1);
  ELSE
    -- 거리별 표준 추천 (캐주얼 러너 평균)
    v_recommended_weekly_km := CASE
      WHEN v_race.distance_meters >= 42000 THEN 50
      WHEN v_race.distance_meters >= 21000 THEN 35
      WHEN v_race.distance_meters >= 10000 THEN 25
      ELSE 15
    END;
  END IF;

  -- Taper (마지막 2주는 80% / 60%)
  IF v_weeks_left <= 1 THEN v_recommended_weekly_km := ROUND(v_recommended_weekly_km * 0.6, 1);
  ELSIF v_weeks_left = 2 THEN v_recommended_weekly_km := ROUND(v_recommended_weekly_km * 0.8, 1);
  END IF;

  RETURN json_build_object(
    'race', json_build_object(
      'id', v_race.id,
      'name', v_race.name,
      'race_date', v_race.race_date,
      'distance_meters', v_race.distance_meters,
      'target_seconds', v_race.target_seconds,
      'notes', v_race.notes
    ),
    'days_left', v_days_left,
    'weeks_left', v_weeks_left,
    'recommended_weekly_km', v_recommended_weekly_km,
    'is_taper', v_weeks_left <= 2
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_next_target_race() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_target_race() TO authenticated;

COMMENT ON TABLE public.target_races IS 'build 199: 사용자 목표 레이스. 권장 주간 km + 카운트다운 계산용.';
