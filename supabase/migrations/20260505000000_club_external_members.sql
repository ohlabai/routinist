-- 2026-05-05: 클럽 외부 멤버 (앱 미가입 동호회 회원) 기록
-- 1) club_external_members  — 이름 + 나중에 가입 시 linked_user_id 로 연결
-- 2) club_external_activities — 일별 러닝 기록 (날짜·시간·거리)
-- 3) club_external_monthly_goals — 멤버별 월간 km 목표 (개인마다 다름)
--
-- RLS: 클럽 멤버 = 읽기, 클럽 owner/admin = 쓰기

-- ───────────────── 1. members ─────────────────
CREATE TABLE IF NOT EXISTS public.club_external_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  linked_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cem_club ON public.club_external_members(club_id);
CREATE INDEX IF NOT EXISTS idx_cem_linked ON public.club_external_members(linked_user_id);

-- ───────────────── 2. activities ─────────────────
CREATE TABLE IF NOT EXISTS public.club_external_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.club_external_members(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  started_at TIMESTAMPTZ,
  distance_km NUMERIC(6,2) NOT NULL CHECK (distance_km >= 0),
  source TEXT NOT NULL DEFAULT 'manual_import',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cea_member_date ON public.club_external_activities(member_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_cea_date ON public.club_external_activities(activity_date);

-- ───────────────── 3. monthly goals ─────────────────
CREATE TABLE IF NOT EXISTS public.club_external_monthly_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.club_external_members(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  goal_km NUMERIC(6,1) NOT NULL CHECK (goal_km >= 0),
  UNIQUE (member_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_cemg_year_month ON public.club_external_monthly_goals(year, month);

-- ───────────────── RLS ─────────────────
ALTER TABLE public.club_external_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_external_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_external_monthly_goals ENABLE ROW LEVEL SECURITY;

-- members: public 클럽이거나 본인이 멤버인 클럽 → 읽기
DROP POLICY IF EXISTS "cem_select" ON public.club_external_members;
CREATE POLICY "cem_select" ON public.club_external_members FOR SELECT USING (
  club_id IN (SELECT id FROM public.clubs WHERE is_public = true)
  OR club_id IN (SELECT club_id FROM public.club_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "cem_admin_write" ON public.club_external_members;
CREATE POLICY "cem_admin_write" ON public.club_external_members FOR ALL USING (
  club_id IN (
    SELECT club_id FROM public.club_members
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  )
) WITH CHECK (
  club_id IN (
    SELECT club_id FROM public.club_members
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  )
);

-- activities: 소속 멤버가 보이는 클럽이면 → 읽기. 관리 권한은 같은 클럽 admin/owner.
DROP POLICY IF EXISTS "cea_select" ON public.club_external_activities;
CREATE POLICY "cea_select" ON public.club_external_activities FOR SELECT USING (
  member_id IN (
    SELECT id FROM public.club_external_members
    WHERE club_id IN (SELECT id FROM public.clubs WHERE is_public = true)
       OR club_id IN (SELECT club_id FROM public.club_members WHERE user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "cea_admin_write" ON public.club_external_activities;
CREATE POLICY "cea_admin_write" ON public.club_external_activities FOR ALL USING (
  member_id IN (
    SELECT id FROM public.club_external_members
    WHERE club_id IN (
      SELECT club_id FROM public.club_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  )
) WITH CHECK (
  member_id IN (
    SELECT id FROM public.club_external_members
    WHERE club_id IN (
      SELECT club_id FROM public.club_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  )
);

-- goals: 같은 패턴
DROP POLICY IF EXISTS "cemg_select" ON public.club_external_monthly_goals;
CREATE POLICY "cemg_select" ON public.club_external_monthly_goals FOR SELECT USING (
  member_id IN (
    SELECT id FROM public.club_external_members
    WHERE club_id IN (SELECT id FROM public.clubs WHERE is_public = true)
       OR club_id IN (SELECT club_id FROM public.club_members WHERE user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "cemg_admin_write" ON public.club_external_monthly_goals;
CREATE POLICY "cemg_admin_write" ON public.club_external_monthly_goals FOR ALL USING (
  member_id IN (
    SELECT id FROM public.club_external_members
    WHERE club_id IN (
      SELECT club_id FROM public.club_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  )
) WITH CHECK (
  member_id IN (
    SELECT id FROM public.club_external_members
    WHERE club_id IN (
      SELECT club_id FROM public.club_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  )
);

-- ───────────────── 월별 결산 view ─────────────────
-- 한 멤버의 월간 합계 + 목표 + 달성 여부를 한 row 로
CREATE OR REPLACE VIEW public.club_external_monthly_summary AS
SELECT
  m.id              AS member_id,
  m.club_id,
  m.name,
  m.linked_user_id,
  EXTRACT(YEAR  FROM a.activity_date)::int  AS year,
  EXTRACT(MONTH FROM a.activity_date)::int  AS month,
  COUNT(a.id)::int                          AS run_count,
  COUNT(DISTINCT a.activity_date)::int      AS days_count,
  COALESCE(SUM(a.distance_km), 0)::numeric  AS total_km,
  COALESCE(MAX(a.distance_km), 0)::numeric  AS max_run_km,
  g.goal_km,
  CASE WHEN g.goal_km IS NULL OR g.goal_km = 0 THEN NULL
       ELSE ROUND(SUM(a.distance_km) / g.goal_km * 100, 1) END AS goal_pct,
  CASE WHEN g.goal_km IS NULL OR g.goal_km = 0 THEN NULL
       ELSE SUM(a.distance_km) >= g.goal_km END               AS goal_achieved,
  SUM(a.distance_km) >= 50                                    AS pass50
FROM public.club_external_members m
JOIN public.club_external_activities a ON a.member_id = m.id
LEFT JOIN public.club_external_monthly_goals g
  ON g.member_id = m.id
 AND g.year  = EXTRACT(YEAR  FROM a.activity_date)::int
 AND g.month = EXTRACT(MONTH FROM a.activity_date)::int
GROUP BY m.id, m.club_id, m.name, m.linked_user_id,
         EXTRACT(YEAR FROM a.activity_date), EXTRACT(MONTH FROM a.activity_date),
         g.goal_km;
