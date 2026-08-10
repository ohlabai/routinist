-- 차단 자동신고가 unique 제약 (reporter_id, target_type, target_id) 과 충돌하면
-- 트리거 예외가 user_blocks INSERT 까지 굴려버려 차단 자체가 실패한다.
-- (해제 후 재차단 시 이전 리포트가 open 이 아니면 IF NOT EXISTS 가드를 통과 → 23505)
-- ON CONFLICT DO NOTHING 으로 흡수.
CREATE OR REPLACE FUNCTION public.tg_block_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO content_reports (reporter_id, target_type, target_id, reason, detail, status)
  VALUES (NEW.blocker_id, 'user', NEW.blocked_id::text, 'block', '자동 접수: 사용자 차단', 'open')
  ON CONFLICT ON CONSTRAINT content_reports_unique_per_target DO NOTHING;
  RETURN NEW;
END;
$$;
