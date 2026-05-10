-- 2026-05-09: routine_photos_trending RPC fix
-- 1) region_gu 모호 — RETURNS TABLE 컬럼 vs profiles.region_gu 컬럼 충돌. profiles.region_gu 명시.
-- 2) follows.followed_id ❌ → following_id ✅ (우리 schema 와 일치)

CREATE OR REPLACE FUNCTION public.routine_photos_trending(viewer_id uuid, limit_n integer DEFAULT 20)
RETURNS TABLE(
  photo_id uuid, photo_url text, caption text, user_id uuid,
  display_name text, avatar_url text, region_gu text,
  distance_km numeric, activity_date date,
  like_count integer, liked_by_me boolean, score numeric,
  created_at timestamp with time zone
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  viewer_gu TEXT;
BEGIN
  SELECT profiles.region_gu INTO viewer_gu FROM profiles WHERE profiles.id = viewer_id;

  RETURN QUERY
  WITH friend_ids AS (
    SELECT following_id AS id FROM follows WHERE follower_id = viewer_id
  )
  SELECT
    ph.id,
    ph.photo_url,
    ph.caption,
    ph.user_id,
    p.display_name,
    p.avatar_url,
    p.region_gu,
    a.distance_km,
    a.activity_date,
    ph.like_count,
    EXISTS(SELECT 1 FROM photo_likes pl WHERE pl.photo_id = ph.id AND pl.user_id = viewer_id) AS liked_by_me,
    (
      ph.like_count::NUMERIC
      * CASE WHEN ph.user_id IN (SELECT id FROM friend_ids) THEN 1.5 ELSE 1.0 END
      * CASE WHEN viewer_gu IS NOT NULL AND p.region_gu = viewer_gu THEN 1.3 ELSE 1.0 END
      + GREATEST(0, 7 - EXTRACT(DAY FROM (now() - ph.created_at)))::NUMERIC * 0.5
    ) AS score,
    ph.created_at
  FROM activity_photos ph
  JOIN profiles p ON p.id = ph.user_id
  JOIN activities a ON a.id = ph.activity_id
  WHERE ph.share_in_gallery = true
    AND p.is_public = true
    AND a.visibility = 'public'
    AND ph.created_at > now() - INTERVAL '7 days'
  ORDER BY score DESC, ph.created_at DESC
  LIMIT limit_n;
END;
$$;
