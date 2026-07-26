-- 루틴포토 원본 사진 보기 (2026-07-26 hans): 공유카드는 배경사진+기록 오버레이가
-- 합성된 PNG 만 저장돼 왔음 → 라이트박스에서 "깨끗한 원본" 을 보여줄 수 없었다.
-- 이제 등록 시 원본 배경 (JPEG, 최대 1600px) 을 함께 업로드하고 여기 연결.
--
-- 조회는 RPC 경유 — activity_photos 직접 SELECT 는 RLS 로 타인 행 접근이 막혀 있어,
-- 갤러리 공개 (share_in_gallery=true) 행에 한해 original_url 만 노출한다.

ALTER TABLE public.activity_photos ADD COLUMN IF NOT EXISTS original_url TEXT;

CREATE OR REPLACE FUNCTION public.get_photo_original(p_photo_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ap.original_url FROM public.activity_photos ap
  WHERE ap.id = p_photo_id
    AND (ap.share_in_gallery = true OR ap.user_id = auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.get_photo_original(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_photo_original(UUID) TO authenticated;
