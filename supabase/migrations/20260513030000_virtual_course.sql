-- 2026-05-13 build 106 — 세계를 달려! (Virtual Course)
-- 유명 마라톤·트레일 코스를 가상 누적. 활동 km 이 코스에 쌓이고 완주 시 메달 수여.
-- 참고: Conqueror (theconqueror.events).

------------------------------------------------------------
-- (A) virtual_courses — 어드민이 입력
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.virtual_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  distance_km NUMERIC NOT NULL CHECK (distance_km > 0),
  country TEXT,
  description TEXT,
  hero_image_url TEXT,
  checkpoints JSONB,  -- [{name, km, description}] 형태, 선택사항
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS virtual_courses_active_idx
  ON public.virtual_courses(sort_order) WHERE is_active = true;

------------------------------------------------------------
-- (B) user_course_progress — 시작 / 완주 추적 (누적 km 은 RPC 산출)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_course_progress (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.virtual_courses(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS ucp_user_idx ON public.user_course_progress(user_id);

------------------------------------------------------------
-- (C) course_medals — 수기 발급
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_medals (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.virtual_courses(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  medal_url TEXT,  -- 어드민이 업로드한 메달 이미지
  note TEXT,
  PRIMARY KEY (user_id, course_id)
);

------------------------------------------------------------
-- (D) RLS
------------------------------------------------------------
ALTER TABLE public.virtual_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_course_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_medals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vc_select_active ON public.virtual_courses;
CREATE POLICY vc_select_active ON public.virtual_courses
  FOR SELECT USING (is_active = true OR public.is_shop_admin());

DROP POLICY IF EXISTS vc_admin_all ON public.virtual_courses;
CREATE POLICY vc_admin_all ON public.virtual_courses
  FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

DROP POLICY IF EXISTS ucp_own ON public.user_course_progress;
CREATE POLICY ucp_own ON public.user_course_progress
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS cm_select_own_or_admin ON public.course_medals;
CREATE POLICY cm_select_own_or_admin ON public.course_medals
  FOR SELECT USING (user_id = auth.uid() OR public.is_shop_admin());

DROP POLICY IF EXISTS cm_admin_write ON public.course_medals;
CREATE POLICY cm_admin_write ON public.course_medals
  FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

------------------------------------------------------------
-- (E) RPC — start_course
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_course(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.virtual_courses WHERE id = p_course_id AND is_active) THEN
    RAISE EXCEPTION '비활성 코스이거나 존재하지 않아요';
  END IF;
  INSERT INTO public.user_course_progress (user_id, course_id)
  VALUES (v_user_id, p_course_id)
  ON CONFLICT (user_id, course_id) DO NOTHING;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_course(UUID) TO authenticated;

------------------------------------------------------------
-- (F) RPC — fetch_my_courses
-- 내가 시작한 코스 + 진행 km (activities.distance_km 합산, started_at 이후) + 완주 여부.
-- 완주 자동 처리: 누적 ≥ distance_km 이면 completed_at 자동 세팅.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_my_courses()
RETURNS TABLE (
  course_id UUID,
  name TEXT,
  country TEXT,
  description TEXT,
  hero_image_url TEXT,
  distance_km NUMERIC,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  progress_km NUMERIC,
  has_medal BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  r RECORD;
  v_progress NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT
      c.id, c.name, c.country, c.description, c.hero_image_url, c.distance_km,
      ucp.started_at, ucp.completed_at
    FROM public.user_course_progress ucp
    JOIN public.virtual_courses c ON c.id = ucp.course_id
    WHERE ucp.user_id = v_user_id
    ORDER BY ucp.started_at DESC
  LOOP
    SELECT COALESCE(SUM(a.distance_km), 0) INTO v_progress
    FROM public.activities a
    WHERE a.user_id = v_user_id AND a.created_at >= r.started_at;

    -- 완주 자동 처리 — 누적 ≥ 코스 거리.
    IF r.completed_at IS NULL AND v_progress >= r.distance_km THEN
      UPDATE public.user_course_progress
         SET completed_at = now()
       WHERE user_id = v_user_id AND course_id = r.id;
      r.completed_at := now();
    END IF;

    course_id := r.id;
    name := r.name;
    country := r.country;
    description := r.description;
    hero_image_url := r.hero_image_url;
    distance_km := r.distance_km;
    started_at := r.started_at;
    completed_at := r.completed_at;
    progress_km := v_progress;
    has_medal := EXISTS (SELECT 1 FROM public.course_medals WHERE user_id = v_user_id AND course_id = r.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_courses() TO authenticated;

------------------------------------------------------------
-- (G) seed — MVP 5개 코스
------------------------------------------------------------
INSERT INTO public.virtual_courses (name, distance_km, country, description, sort_order) VALUES
  ('보스턴 마라톤', 42.195, '🇺🇸 미국', '세계 최초 마라톤 대회 코스. 홉킨턴에서 보스턴까지.', 1),
  ('도쿄 마라톤', 42.195, '🇯🇵 일본', '도쿄 도청에서 도쿄역까지. 일본 6대 마라톤.', 2),
  ('베를린 마라톤', 42.195, '🇩🇪 독일', '세계 신기록이 자주 깨지는 평탄한 코스.', 3),
  ('제주 올레길 1코스', 15.6, '🇰🇷 한국', '시흥초에서 광치기해변까지. 바다와 오름.', 4),
  ('서울 한강 종주', 40.0, '🇰🇷 한국', '광나루부터 잠실, 반포, 여의도, 가양까지.', 5)
ON CONFLICT (name) DO NOTHING;
