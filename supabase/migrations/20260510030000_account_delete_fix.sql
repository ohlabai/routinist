-- 20260510000000_account_delete.sql 의 컬럼/테이블 이름 오류 fix.
-- 원본 문제:
--   1. user_cheers 컬럼은 from_user/to_user 인데 from_user_id/to_user_id 로 작성됨 → undefined_column.
--   2. cheers / winner_picks 테이블은 존재하지 않음 (실제: activity_cheers / prediction_picks).
--   3. exception when undefined_table 만 잡으므로 undefined_column 시 함수 전체 abort → auth.users 까지 못 지움.
--   4. 마지막 begin/exception when others 가 모든 에러를 silent drop — 부분 실패 진단 불가.
-- 본 마이그레이션은 함수를 재정의하여 위 문제를 모두 fix.

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '로그인되지 않은 사용자';
  end if;

  -- 명시적 정리. 컬럼/테이블 누락은 NOTICE 로 남기고 계속 진행 (전체 abort 방지).
  -- 본인이 owner 인 테이블만 삭제. picked_user_id = uid 인 타인의 픽은 NOT NULL 이므로 같이 삭제.
  begin delete from public.activity_photos where user_id = uid; exception when undefined_table or undefined_column then raise notice 'activity_photos: skipped'; end;
  begin delete from public.calendar_photos where user_id = uid; exception when undefined_table or undefined_column then raise notice 'calendar_photos: skipped'; end;
  begin delete from public.photo_likes where user_id = uid; exception when undefined_table or undefined_column then raise notice 'photo_likes: skipped'; end;
  begin delete from public.activity_cheers where user_id = uid; exception when undefined_table or undefined_column then raise notice 'activity_cheers: skipped'; end;
  begin delete from public.user_cheers where from_user = uid or to_user = uid; exception when undefined_table or undefined_column then raise notice 'user_cheers: skipped'; end;
  begin delete from public.prediction_picks where user_id = uid or picked_user_id = uid; exception when undefined_table or undefined_column then raise notice 'prediction_picks: skipped'; end;
  begin delete from public.user_blocks where blocker_id = uid or blocked_id = uid; exception when undefined_table or undefined_column then raise notice 'user_blocks: skipped'; end;
  begin delete from public.content_reports where reporter_id = uid; exception when undefined_table or undefined_column then raise notice 'content_reports: skipped'; end;
  begin delete from public.messages where sender_id = uid; exception when undefined_table or undefined_column then raise notice 'messages: skipped'; end;
  begin delete from public.conversations where user_a = uid or user_b = uid; exception when undefined_table or undefined_column then raise notice 'conversations: skipped'; end;
  begin delete from public.follows where follower_id = uid or following_id = uid; exception when undefined_table or undefined_column then raise notice 'follows: skipped'; end;
  begin delete from public.club_members where user_id = uid; exception when undefined_table or undefined_column then raise notice 'club_members: skipped'; end;
  begin delete from public.activities where user_id = uid; exception when undefined_table or undefined_column then raise notice 'activities: skipped'; end;
  begin delete from public.monthly_goals where user_id = uid; exception when undefined_table or undefined_column then raise notice 'monthly_goals: skipped'; end;
  begin delete from public.mileage_transactions where user_id = uid; exception when undefined_table or undefined_column then raise notice 'mileage_transactions: skipped'; end;
  begin delete from public.quote_likes where user_id = uid; exception when undefined_table or undefined_column then raise notice 'quote_likes: skipped'; end;
  begin delete from public.client_error_logs where user_id = uid; exception when undefined_table or undefined_column then raise notice 'client_error_logs: skipped'; end;

  -- profiles 는 cascade 의 base. 실패 시 그대로 raise (silent drop 금지).
  delete from public.profiles where id = uid;

  -- auth.users 삭제 — 같은 이메일 재가입 가능. definer 권한 필요.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;

comment on function delete_my_account() is 'Apple 5.1.1(v) — 본인이 호출하면 모든 사용자 데이터와 auth.users 행을 삭제. 컬럼/테이블 누락은 NOTICE 후 계속, profiles/auth.users 삭제 실패는 raise.';
