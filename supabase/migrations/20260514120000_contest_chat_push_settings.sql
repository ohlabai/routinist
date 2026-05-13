-- 2026-05-14 build 121 — 친선런 채팅 + 사용자 푸시 설정

------------------------------------------------------------
-- (A) contest_messages — 친선런 단체 채팅
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contest_messages (
  id BIGSERIAL PRIMARY KEY,
  contest_id UUID NOT NULL REFERENCES public.daily_contests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contest_messages_idx ON public.contest_messages(contest_id, created_at DESC);

ALTER TABLE public.contest_messages ENABLE ROW LEVEL SECURITY;

-- 참가자/호스트만 SELECT
DROP POLICY IF EXISTS cm_select_participants ON public.contest_messages;
CREATE POLICY cm_select_participants ON public.contest_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.daily_contests c WHERE c.id = contest_id AND c.host_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.daily_contest_participants p WHERE p.contest_id = contest_messages.contest_id AND p.user_id = auth.uid())
  );

-- 본인이 참가자/호스트일 때만 INSERT
DROP POLICY IF EXISTS cm_insert_participants ON public.contest_messages;
CREATE POLICY cm_insert_participants ON public.contest_messages
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.daily_contests c WHERE c.id = contest_id AND c.host_user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.daily_contest_participants p WHERE p.contest_id = contest_messages.contest_id AND p.user_id = auth.uid())
    )
  );

-- 본인 메시지만 DELETE
DROP POLICY IF EXISTS cm_delete_own ON public.contest_messages;
CREATE POLICY cm_delete_own ON public.contest_messages
  FOR DELETE USING (user_id = auth.uid());

------------------------------------------------------------
-- (B) fetch_contest_messages — profile join
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_contest_messages(p_contest_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  id BIGINT,
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  body TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.user_id, COALESCE(p.display_name, '익명'), p.avatar_url, m.body, m.created_at
  FROM public.contest_messages m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.contest_id = p_contest_id
  ORDER BY m.created_at ASC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_contest_messages(UUID, INTEGER) TO authenticated;

------------------------------------------------------------
-- (C) profiles.push_settings — 카테고리별 푸시 toggle (jsonb)
-- 기본: 모두 true. 사용자가 끄고 싶은 카테고리만 false.
-- 카테고리: friend_overtake, milestone, contest, club_course, feedback_reply, weekly_recap, marketing
------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.update_push_settings(p_settings JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  UPDATE public.profiles SET push_settings = COALESCE(p_settings, '{}'::jsonb) WHERE id = v_user_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_push_settings(JSONB) TO authenticated;

------------------------------------------------------------
-- (D) admin_fetch_club_emails — 클럽 멤버 이메일 list (어드민/owner만)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_club_member_emails(p_club_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid(); v_role TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  -- 클럽 owner / admin 만 조회 (또는 앱 어드민)
  SELECT role INTO v_role FROM public.club_members WHERE club_id = p_club_id AND user_id = v_user_id;
  IF (v_role IS NULL OR v_role NOT IN ('owner','admin')) AND NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '클럽 운영자만 조회할 수 있어요';
  END IF;

  RETURN QUERY
  SELECT cm.user_id, u.email::TEXT, COALESCE(p.display_name, '익명')
  FROM public.club_members cm
  JOIN auth.users u ON u.id = cm.user_id
  LEFT JOIN public.profiles p ON p.id = cm.user_id
  WHERE cm.club_id = p_club_id AND cm.user_id IS NOT NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_club_member_emails(UUID) TO authenticated;
