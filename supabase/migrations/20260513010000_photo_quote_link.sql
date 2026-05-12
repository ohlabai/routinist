-- 2026-05-13 build 106
-- 공유카드/포토 카드의 캡션을 essay_body 대신 사용자가 선택한 명언으로 노출.
-- - activity_photos.quote_id 컬럼 (nullable FK to quotes.id) 추가
-- - public_gallery_feed view 에 quote_text / quote_author 노출
-- 기존 essay_body 컬럼/데이터는 보존 (러너의 에세이는 메뉴에서 숨김 처리만, 데이터는 살림).

------------------------------------------------------------
-- (A) activity_photos.quote_id 컬럼
------------------------------------------------------------
ALTER TABLE public.activity_photos
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS activity_photos_quote_id_idx
  ON public.activity_photos(quote_id) WHERE quote_id IS NOT NULL;

------------------------------------------------------------
-- (B) public_gallery_feed view 갱신 — quote_text / quote_author 노출
-- view 는 CREATE OR REPLACE 가 컬럼 추가 가능하지만 순서 보장 위해 DROP 후 재생성.
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
    q.text AS quote_text,
    q.author AS quote_author,
    ph.like_count,
    ph.created_at,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    a.distance_km,
    a.activity_date
   FROM public.activity_photos ph
     JOIN public.profiles p ON p.id = ph.user_id
     JOIN public.activities a ON a.id = ph.activity_id
     LEFT JOIN public.quotes q ON q.id = ph.quote_id AND q.status = 'approved'
  WHERE ph.share_in_gallery = true AND p.is_public = true AND a.visibility = 'public'::text
  ORDER BY ph.created_at DESC;

------------------------------------------------------------
-- (C) 권한 부여 — view 는 SECURITY INVOKER 기본, RLS 는 underlying table 따름.
-- public_gallery_feed 가 anon/authenticated SELECT 가 필요하므로 그대로 둠.
------------------------------------------------------------
GRANT SELECT ON public.public_gallery_feed TO anon, authenticated;
