-- content_reports abuse 방지 — 같은 사용자가 같은 대상을 무한 신고하는 걸 막음.
-- 한 사람당 한 대상에 대해 1회만 신고 가능. (운영팀이 reviewed/removed 처리 후
-- 다시 신고가 필요하면 status 를 처리하고 새 row 를 만들면 됨.)

alter table public.content_reports
  drop constraint if exists content_reports_unique_per_target;

alter table public.content_reports
  add constraint content_reports_unique_per_target
  unique (reporter_id, target_type, target_id);

comment on constraint content_reports_unique_per_target on public.content_reports is
  '한 사용자가 같은 콘텐츠를 중복 신고하지 못하게 (Apple 1.2 abuse 방지)';
