-- 2026-05-14 build 128 — 챌린지 시리즈 (The Conqueror 풍 코스 묶음)

------------------------------------------------------------
-- (A) course_series 테이블
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.virtual_courses
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.course_series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS virtual_courses_series_idx ON public.virtual_courses(series_id, sort_order);

ALTER TABLE public.course_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_select_all ON public.course_series;
CREATE POLICY cs_select_all ON public.course_series FOR SELECT USING (true);

DROP POLICY IF EXISTS cs_admin_write ON public.course_series;
CREATE POLICY cs_admin_write ON public.course_series FOR ALL
  USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

------------------------------------------------------------
-- (B) seed — 시리즈 3개 + 코스 매핑
------------------------------------------------------------
INSERT INTO public.course_series (slug, name, description, emoji, sort_order) VALUES
  ('world_majors', 'World Marathon Majors', '세계 6대 메이저 마라톤 — 보스턴 · 도쿄 · 베를린 · 런던 · 시카고 · 뉴욕. 모두 완주하면 Six Stars 메달.', '🏆', 1),
  ('korea_heritage', '한국 도전', '한국의 길과 산을 달려봐요. 제주 올레부터 부산 갈맷길까지.', '🇰🇷', 2),
  ('asia_explorer', '아시아 익스플로러', '도쿄 마라톤 · 후지산 · 만리장성 · 타이베이까지. 아시아 명소를 잇는 시리즈.', '🌏', 3)
ON CONFLICT (slug) DO NOTHING;

-- 시리즈 매핑
UPDATE public.virtual_courses SET series_id = (SELECT id FROM public.course_series WHERE slug = 'world_majors')
  WHERE name IN ('보스턴 마라톤', '도쿄 마라톤', '베를린 마라톤', '런던 마라톤', '시카고 마라톤', '뉴욕 마라톤');

UPDATE public.virtual_courses SET series_id = (SELECT id FROM public.course_series WHERE slug = 'korea_heritage')
  WHERE name IN ('제주 올레길 1코스', '서울 한강 종주', '부산 갈맷길');

UPDATE public.virtual_courses SET series_id = (SELECT id FROM public.course_series WHERE slug = 'asia_explorer')
  WHERE name IN ('도쿄 마라톤', '도쿄 → 후지산', '만리장성 일부', '타이베이 101 → 양밍산');

------------------------------------------------------------
-- (C) fetch_course_series — 시리즈 list + 코스 수 + 내 완주 수
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_course_series()
RETURNS TABLE (
  series_id UUID,
  slug TEXT,
  name TEXT,
  description TEXT,
  emoji TEXT,
  course_count INTEGER,
  my_completed INTEGER,
  total_distance_km NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.slug,
    s.name,
    s.description,
    s.emoji,
    (SELECT COUNT(*)::INTEGER FROM public.virtual_courses vc WHERE vc.series_id = s.id AND vc.is_active),
    (SELECT COUNT(*)::INTEGER FROM public.user_course_progress ucp
       JOIN public.virtual_courses vc ON vc.id = ucp.course_id
      WHERE vc.series_id = s.id AND ucp.user_id = v_user_id AND ucp.completed_at IS NOT NULL),
    (SELECT COALESCE(SUM(vc.distance_km), 0)::NUMERIC(10,1) FROM public.virtual_courses vc WHERE vc.series_id = s.id AND vc.is_active)
  FROM public.course_series s
  WHERE s.is_active
  ORDER BY s.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_course_series() TO authenticated, anon;
