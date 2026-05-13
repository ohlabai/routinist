-- 2026-05-14 build 108 — 제안 게시판 UGC 신고 (Apple 1.2)
-- 제안 게시판 글에도 사진/명언처럼 신고 가능하게.

------------------------------------------------------------
-- (A) content_reports.target_type 에 'feedback' / 'quote' 포함 보장
-- 기존 check 가 quote 추가 시점에 누락된 케이스가 있어 다시 갱신.
------------------------------------------------------------
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_target_type_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_target_type_check
  CHECK (target_type IN ('photo','user','message','quote','feedback'));

------------------------------------------------------------
-- (B) report_feedback RPC
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_feedback(
  p_feedback_id UUID,
  p_reason TEXT,
  p_detail TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_reason NOT IN ('inappropriate','spam','harassment','other') THEN
    RAISE EXCEPTION '유효하지 않은 신고 사유';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.feedback_posts WHERE id = p_feedback_id) THEN
    RAISE EXCEPTION '게시글을 찾을 수 없어요';
  END IF;
  IF EXISTS(SELECT 1 FROM public.feedback_posts WHERE id = p_feedback_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION '본인 글은 신고할 수 없어요';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.content_reports
     WHERE reporter_id = v_user_id
       AND target_type = 'feedback'
       AND target_id = p_feedback_id::text
       AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    RAISE EXCEPTION '이미 신고하신 게시글이에요';
  END IF;

  INSERT INTO public.content_reports
    (reporter_id, target_type, target_id, reason, detail, status)
  VALUES
    (v_user_id, 'feedback', p_feedback_id::text, p_reason, p_detail, 'open');
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.report_feedback(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_feedback(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_feedback(UUID, TEXT, TEXT) TO authenticated;

------------------------------------------------------------
-- (C) 자동 숨김 트리거 — 신고 3회 누적 시 is_public=false (Apple 1.2 24h 응대 의무)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_feedback_report_auto_hide() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_fid UUID; v_count INT;
BEGIN
  IF NEW.target_type <> 'feedback' THEN RETURN NEW; END IF;
  BEGIN
    v_fid := NEW.target_id::UUID;
  EXCEPTION WHEN OTHERS THEN RETURN NEW;
  END;
  SELECT COUNT(*) INTO v_count
    FROM public.content_reports
   WHERE target_type = 'feedback' AND target_id = NEW.target_id;
  IF v_count >= 3 THEN
    UPDATE public.feedback_posts SET is_public = false WHERE id = v_fid AND is_public = true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_feedback_report_auto_hide ON public.content_reports;
CREATE TRIGGER trg_feedback_report_auto_hide
  AFTER INSERT ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_feedback_report_auto_hide();
