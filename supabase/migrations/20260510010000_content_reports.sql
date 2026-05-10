-- App Store Guideline 1.2 — UGC 앱은 사용자가 부적절한 콘텐츠를 신고할 수 있어야 함.
-- 사진(루틴포토) / 사용자 / 쪽지 등 콘텐츠 신고 받는 단일 테이블.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  -- 'photo' | 'user' | 'message' 등 확장 가능
  target_type text not null check (target_type in ('photo','user','message')),
  target_id text not null,
  reason text not null check (reason in ('inappropriate','spam','harassment','other')),
  detail text,
  status text not null default 'open' check (status in ('open','reviewed','removed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_content_reports_target on public.content_reports(target_type, target_id);
create index if not exists idx_content_reports_status on public.content_reports(status, created_at desc);

alter table public.content_reports enable row level security;

drop policy if exists "content_reports_insert" on public.content_reports;
create policy "content_reports_insert" on public.content_reports
  for insert with check (auth.uid() = reporter_id);

-- 본인이 낸 신고만 조회 가능 (운영자는 service_role 로 조회)
drop policy if exists "content_reports_select_own" on public.content_reports;
create policy "content_reports_select_own" on public.content_reports
  for select using (auth.uid() = reporter_id);

comment on table public.content_reports is 'Apple 1.2 UGC 신고 — photo/user/message 부적절 콘텐츠 신고 기록';
