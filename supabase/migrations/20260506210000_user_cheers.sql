-- 2026-05-06: 사람 단위 응원 — 랭킹/프로필에서 ❤️ 🔥 💪 👏 🎉 보내기
-- 기존 activity_cheers 는 활동 단위라 별도 테이블 필요.

CREATE TABLE IF NOT EXISTS public.user_cheers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('❤️', '🔥', '💪', '👏', '🎉')),
  context TEXT,                              -- 'ranking' | 'profile' | 'home_hero'
  week_of DATE NOT NULL DEFAULT (date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul')::DATE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user != to_user),  -- 자기한테 못 보냄
  UNIQUE (from_user, to_user, week_of, emoji)  -- 같은 주 같은 이모지 중복 방지
);

CREATE INDEX IF NOT EXISTS idx_uc_to_user_week ON public.user_cheers(to_user, week_of DESC);
CREATE INDEX IF NOT EXISTS idx_uc_from_user_week ON public.user_cheers(from_user, week_of DESC);

ALTER TABLE public.user_cheers ENABLE ROW LEVEL SECURITY;

-- 누구나 SELECT (랭킹에 누가 응원했는지 표시 가능)
DROP POLICY IF EXISTS "user_cheers_select" ON public.user_cheers;
CREATE POLICY "user_cheers_select" ON public.user_cheers FOR SELECT USING (true);

-- 본인이 보내는 응원만 INSERT
DROP POLICY IF EXISTS "user_cheers_insert" ON public.user_cheers;
CREATE POLICY "user_cheers_insert" ON public.user_cheers FOR INSERT
  WITH CHECK (auth.uid() = from_user);

-- 본인이 보낸 응원만 DELETE (취소 가능)
DROP POLICY IF EXISTS "user_cheers_delete" ON public.user_cheers;
CREATE POLICY "user_cheers_delete" ON public.user_cheers FOR DELETE
  USING (auth.uid() = from_user);

-- 받은 응원 카운트 RPC — 프로필 페이지에서 표시
CREATE OR REPLACE FUNCTION public.get_user_cheer_summary(p_user_id UUID)
RETURNS TABLE (
  emoji TEXT,
  total_count INTEGER,
  week_count INTEGER
)
LANGUAGE SQL STABLE SECURITY INVOKER AS $$
  SELECT
    e.emoji,
    COUNT(uc.id)::INTEGER AS total_count,
    COUNT(uc.id) FILTER (
      WHERE uc.week_of = date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul')::DATE
    )::INTEGER AS week_count
  FROM (VALUES ('❤️'), ('🔥'), ('💪'), ('👏'), ('🎉')) AS e(emoji)
  LEFT JOIN public.user_cheers uc ON uc.to_user = p_user_id AND uc.emoji = e.emoji
  GROUP BY e.emoji
  ORDER BY total_count DESC;
$$;

REVOKE ALL ON FUNCTION public.get_user_cheer_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_cheer_summary(UUID) TO authenticated;

-- 내가 이번 주 어떤 사람에게 어떤 이모지를 보냈는지 (UI 토글 상태용)
CREATE OR REPLACE FUNCTION public.get_my_sent_cheers_this_week()
RETURNS TABLE (to_user UUID, emoji TEXT)
LANGUAGE SQL STABLE SECURITY INVOKER AS $$
  SELECT uc.to_user, uc.emoji
    FROM public.user_cheers uc
   WHERE uc.from_user = auth.uid()
     AND uc.week_of = date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
$$;

REVOKE ALL ON FUNCTION public.get_my_sent_cheers_this_week() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_sent_cheers_this_week() TO authenticated;
