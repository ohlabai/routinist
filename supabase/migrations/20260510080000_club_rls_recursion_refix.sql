-- club_members RLS 무한 재귀 회귀 fix (재발).
-- 2026-04-17 한 번 고쳤으나 그 후 다른 마이그레이션에서 self-reference 정책이 다시 추가됨.
-- 클럽 만들기 (club_members 첫 INSERT) 자체가 차단되는 critical 버그.
--
-- 해결: SECURITY DEFINER 함수로 위임 (RLS 평가 자체 우회) + 정책 단순화.

-- 1) 헬퍼 함수 재정의 (idempotent)
CREATE OR REPLACE FUNCTION public.is_club_admin(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = cid AND user_id = uid AND role IN ('owner', 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_club_member(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = cid AND user_id = uid
  )
$$;

-- 2) 모든 기존 club_members 정책 제거 후 재구성
DROP POLICY IF EXISTS "club_members_select" ON public.club_members;
DROP POLICY IF EXISTS "club_members_insert" ON public.club_members;
DROP POLICY IF EXISTS "club_members_delete" ON public.club_members;
DROP POLICY IF EXISTS "club_members_delete_owner_cascade" ON public.club_members;
DROP POLICY IF EXISTS "club_members_update" ON public.club_members;

-- SELECT — 멤버 목록은 클럽 내부 공개 정보. 로그인만 하면 OK.
CREATE POLICY "club_members_select" ON public.club_members
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT — 본인 자신 추가 (가입) 또는 admin 이 다른 사람 추가
CREATE POLICY "club_members_insert" ON public.club_members
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR public.is_club_admin(club_id, auth.uid())
  );

-- DELETE — 본인 탈퇴 / admin 의 회원 제명 / clubs 의 created_by 인 owner / 운영자
CREATE POLICY "club_members_delete" ON public.club_members
  FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.is_club_admin(club_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = club_members.club_id
        AND (c.created_by = auth.uid() OR (auth.jwt() ->> 'email') = 'hans@openhan.kr')
    )
  );

-- UPDATE — admin 만 role 변경 가능
CREATE POLICY "club_members_update" ON public.club_members
  FOR UPDATE
  USING (public.is_club_admin(club_id, auth.uid()))
  WITH CHECK (public.is_club_admin(club_id, auth.uid()));

-- 3) clubs 정책도 재귀 위험 제거 — clubs_select 의 club_members 참조는 select 함수 사용
DROP POLICY IF EXISTS "clubs_select" ON public.clubs;
CREATE POLICY "clubs_select" ON public.clubs
  FOR SELECT
  USING (
    is_public = true
    OR public.is_club_member(id, auth.uid())
  );

DROP POLICY IF EXISTS "clubs_update" ON public.clubs;
CREATE POLICY "clubs_update" ON public.clubs
  FOR UPDATE
  USING (public.is_club_admin(id, auth.uid()))
  WITH CHECK (public.is_club_admin(id, auth.uid()));

GRANT EXECUTE ON FUNCTION public.is_club_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_club_member(uuid, uuid) TO authenticated;
