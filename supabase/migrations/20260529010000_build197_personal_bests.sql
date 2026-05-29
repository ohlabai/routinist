-- build 197: Best Splits + PB (Personal Best) 인프라.
-- 활동의 GPS 스트림에서 sliding-window 로 1km/5km/10km/half/full 구간 최고 페이스 계산.
-- 신규 PB 달성 시 푸시 알림 + 홈 카드 강조.

-- 표준 PB 거리 (m): 1km, 3km, 5km, 10km, 하프, 풀
-- 다른 사용자가 임의 거리도 도전할 수 있게 distance_meters integer 로 보관 (enum 아님).

CREATE TABLE IF NOT EXISTS public.personal_bests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  distance_meters INTEGER NOT NULL,           -- 1000, 3000, 5000, 10000, 21097, 42195
  best_seconds INTEGER NOT NULL,              -- 그 구간 가장 빠른 시간 (초)
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  achieved_at TIMESTAMPTZ NOT NULL,           -- 활동의 ended_at
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, distance_meters)
);

CREATE INDEX IF NOT EXISTS personal_bests_user_idx ON public.personal_bests (user_id);

-- RLS — 본인 record 만 read/write.
ALTER TABLE public.personal_bests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pb_select_own ON public.personal_bests;
CREATE POLICY pb_select_own ON public.personal_bests FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS pb_select_friends ON public.personal_bests;
-- Phase 4 친구 PB 알림에서 친구의 PB 도 보여야 함. visibility 분기는 profile.is_public 기준.
CREATE POLICY pb_select_friends ON public.personal_bests FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = user_id AND p.is_public = true)
  );

DROP POLICY IF EXISTS pb_insert_own ON public.personal_bests;
CREATE POLICY pb_insert_own ON public.personal_bests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pb_update_own ON public.personal_bests;
CREATE POLICY pb_update_own ON public.personal_bests FOR UPDATE
  USING (user_id = auth.uid());

-- upsert_personal_best — client 가 split 계산 후 갱신 호출.
-- 반환: 신규 PB 여부 (true=새 갱신) + 이전 기록 (null 가능).
-- 신규 PB 면 trigger 로 push 알림 enqueue.
CREATE OR REPLACE FUNCTION public.upsert_personal_best(
  p_distance_meters INTEGER,
  p_best_seconds INTEGER,
  p_activity_id UUID,
  p_achieved_at TIMESTAMPTZ
) RETURNS TABLE (is_new_pb BOOLEAN, prev_seconds INTEGER, prev_activity_id UUID) AS $$
DECLARE
  v_uid UUID;
  v_existing RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_distance_meters < 100 OR p_best_seconds < 1 THEN
    RAISE EXCEPTION 'invalid distance/seconds';
  END IF;

  SELECT best_seconds, activity_id INTO v_existing
  FROM public.personal_bests
  WHERE user_id = v_uid AND distance_meters = p_distance_meters;

  -- 기존 기록 없음 → insert (첫 기록도 PB 로 간주)
  IF v_existing IS NULL THEN
    INSERT INTO public.personal_bests (user_id, distance_meters, best_seconds, activity_id, achieved_at)
    VALUES (v_uid, p_distance_meters, p_best_seconds, p_activity_id, p_achieved_at);
    RETURN QUERY SELECT true, NULL::INTEGER, NULL::UUID;
    RETURN;
  END IF;

  -- 기존 기록 있고 새 기록이 더 빠름 → 갱신
  IF p_best_seconds < v_existing.best_seconds THEN
    UPDATE public.personal_bests
       SET best_seconds = p_best_seconds,
           activity_id = p_activity_id,
           achieved_at = p_achieved_at,
           updated_at = NOW()
     WHERE user_id = v_uid AND distance_meters = p_distance_meters;
    RETURN QUERY SELECT true, v_existing.best_seconds, v_existing.activity_id;
    RETURN;
  END IF;

  -- 그 외 → no-op
  RETURN QUERY SELECT false, v_existing.best_seconds, v_existing.activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.upsert_personal_best(INTEGER, INTEGER, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_personal_best(INTEGER, INTEGER, UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_personal_best(INTEGER, INTEGER, UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON TABLE public.personal_bests IS 'build 197: 사용자별 거리 PB. 표준은 1/3/5/10/21097/42195m.';
COMMENT ON FUNCTION public.upsert_personal_best(INTEGER, INTEGER, UUID, TIMESTAMPTZ) IS 'PB 갱신/생성. 신규 PB 면 is_new_pb=true 반환 → 클라이언트가 알림 표시.';
