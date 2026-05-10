-- In-app 계정 삭제 RPC — Apple App Store Guideline 5.1.1(v) 의무.
-- 본인 (auth.uid()) 자신의 데이터만 삭제. SECURITY DEFINER 로 auth.users 까지 정리.
--
-- 삭제 대상:
--   - profiles (cascade 로 follows, messages, activities, photos, etc 자동 정리)
--   - auth.users (마지막 — 이걸 지워야 같은 이메일 재가입 가능)
--
-- profiles.id 가 auth.users.id 를 참조하므로 cascade FK 로 대부분 자동.
-- 다만 일부 테이블은 cascade 가 아닐 수 있어 명시적으로 삭제.

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '로그인되지 않은 사용자';
  end if;

  -- 명시적 정리 (FK 가 cascade 가 아닐 수 있는 테이블).
  -- 존재하지 않는 테이블은 try/catch 로 무시.
  begin delete from public.activity_photos where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.calendar_photos where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.photo_likes where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.cheers where from_user_id = uid or to_user_id = uid; exception when undefined_table then null; end;
  begin delete from public.user_cheers where from_user_id = uid or to_user_id = uid; exception when undefined_table then null; end;
  begin delete from public.winner_picks where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.messages where sender_id = uid; exception when undefined_table then null; end;
  begin delete from public.conversations where user_a = uid or user_b = uid; exception when undefined_table then null; end;
  begin delete from public.follows where follower_id = uid or following_id = uid; exception when undefined_table then null; end;
  begin delete from public.club_members where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.activities where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.monthly_goals where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.mileage_transactions where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.quote_likes where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.client_error_logs where user_id = uid; exception when undefined_table then null; end;
  begin delete from public.profiles where id = uid; exception when others then null; end;

  -- auth.users 삭제 — definer 권한 필요. 같은 이메일 재가입 가능.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;

comment on function delete_my_account() is 'Apple 5.1.1(v) — 본인이 호출하면 모든 사용자 데이터와 auth.users 행을 삭제.';
