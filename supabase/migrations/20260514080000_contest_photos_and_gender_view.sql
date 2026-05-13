-- 2026-05-14 build 117 — 친선런 만남 후기 사진 + view 에 gender 노출

------------------------------------------------------------
-- (A) activity_photos.contest_id — 친선런과 연결
------------------------------------------------------------
ALTER TABLE public.activity_photos
  ADD COLUMN IF NOT EXISTS contest_id UUID REFERENCES public.daily_contests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS activity_photos_contest_id_idx
  ON public.activity_photos(contest_id) WHERE contest_id IS NOT NULL;

------------------------------------------------------------
-- (B) public_gallery_feed view 갱신 — gender / show_gender / contest_id 노출
------------------------------------------------------------
DROP VIEW IF EXISTS public.public_gallery_feed;
CREATE VIEW public.public_gallery_feed AS
  SELECT ph.id AS photo_id,
    ph.activity_id,
    ph.user_id,
    ph.photo_url,
    ph.caption,
    ph.essay_body,
    ph.quote_id,
    ph.contest_id,
    q.text AS quote_text,
    q.author AS quote_author,
    ph.like_count,
    ph.created_at,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    p.gender,
    p.show_gender,
    a.distance_km,
    a.activity_date
   FROM public.activity_photos ph
     JOIN public.profiles p ON p.id = ph.user_id
     JOIN public.activities a ON a.id = ph.activity_id
     LEFT JOIN public.quotes q ON q.id = ph.quote_id AND q.status = 'approved'
  WHERE ph.share_in_gallery = true AND p.is_public = true AND a.visibility = 'public'::text
  ORDER BY ph.created_at DESC;

GRANT SELECT ON public.public_gallery_feed TO anon, authenticated;

------------------------------------------------------------
-- (C) fetch_contest_photos — 특정 친선런에 연결된 모든 사진
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_contest_photos(p_contest_id UUID)
RETURNS TABLE (
  photo_id UUID,
  photo_url TEXT,
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  distance_km NUMERIC,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  -- 본인 참가자 또는 호스트만 조회
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_contests c
    WHERE c.id = p_contest_id
      AND (c.host_user_id = v_user_id
           OR EXISTS (SELECT 1 FROM public.daily_contest_participants p
                      WHERE p.contest_id = c.id AND p.user_id = v_user_id))
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ph.id,
    ph.photo_url,
    ph.user_id,
    COALESCE(p.display_name, '익명'),
    p.avatar_url,
    a.distance_km,
    ph.created_at
  FROM public.activity_photos ph
  JOIN public.activities a ON a.id = ph.activity_id
  JOIN public.profiles p ON p.id = ph.user_id
  WHERE ph.contest_id = p_contest_id
  ORDER BY ph.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_contest_photos(UUID) TO authenticated;

------------------------------------------------------------
-- (D) attach_photo_to_contest — 본인 사진을 친선런에 연결
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_photo_to_contest(
  p_photo_id UUID,
  p_contest_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;

  -- 본인 사진인지 확인
  IF NOT EXISTS (SELECT 1 FROM public.activity_photos WHERE id = p_photo_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION '본인 사진이 아닙니다';
  END IF;

  -- 본인이 친선런 참가자/호스트인지 확인
  IF NOT EXISTS (
    SELECT 1 FROM public.daily_contests c
    WHERE c.id = p_contest_id
      AND (c.host_user_id = v_user_id
           OR EXISTS (SELECT 1 FROM public.daily_contest_participants p
                      WHERE p.contest_id = c.id AND p.user_id = v_user_id))
  ) THEN
    RAISE EXCEPTION '참가 중인 친선런이 아닙니다';
  END IF;

  UPDATE public.activity_photos SET contest_id = p_contest_id WHERE id = p_photo_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_photo_to_contest(UUID, UUID) TO authenticated;
