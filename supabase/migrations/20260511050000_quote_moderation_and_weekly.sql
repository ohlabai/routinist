-- 2026-05-11 출시 후 보강.
-- (1) 명언 신고 — content_reports 통합 + 3회 누적 시 자동 hidden 트리거
-- (2) 주간 best quote 푸시 — enqueue_weekly_best_quote RPC
-- (3) admin 보조 — admin_pending_quote_reports RPC

------------------------------------------------------------
-- (A) report_quote RPC — 본인이 사용자 명언 신고
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_quote(
  p_quote_id UUID,
  p_reason TEXT,
  p_detail TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exists BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_reason NOT IN ('inappropriate','spam','harassment','copyright','other') THEN
    RAISE EXCEPTION '유효하지 않은 신고 사유';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.quotes WHERE id = p_quote_id) INTO v_exists;
  IF NOT v_exists THEN RAISE EXCEPTION '존재하지 않는 명언'; END IF;

  -- 본인 명언은 신고 불가
  IF EXISTS(SELECT 1 FROM public.quotes WHERE id = p_quote_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION '본인 명언은 신고할 수 없어요';
  END IF;

  -- 같은 사용자 같은 quote 24h 내 중복 신고 차단
  IF EXISTS(
    SELECT 1 FROM public.content_reports
     WHERE reporter_id = v_user_id
       AND target_type = 'quote'
       AND target_id = p_quote_id::text
       AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    RAISE EXCEPTION '이미 신고하신 명언이에요';
  END IF;

  INSERT INTO public.content_reports
    (reporter_id, target_type, target_id, reason, detail, status)
  VALUES
    (v_user_id, 'quote', p_quote_id::text, p_reason, p_detail, 'open');

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.report_quote(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_quote(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_quote(UUID, TEXT, TEXT) TO authenticated;

------------------------------------------------------------
-- (B) tg_quote_report_auto_hide — 신고 3회 누적 시 quote 자동 숨김
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_quote_report_auto_hide() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_quote_id UUID;
  v_count INT;
BEGIN
  IF NEW.target_type <> 'quote' THEN RETURN NEW; END IF;
  BEGIN
    v_quote_id := NEW.target_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;  -- 잘못된 UUID 면 무시
  END;

  SELECT COUNT(*) INTO v_count
    FROM public.content_reports
   WHERE target_type = 'quote' AND target_id = NEW.target_id;

  UPDATE public.quotes SET report_count = v_count WHERE id = v_quote_id;

  IF v_count >= 3 THEN
    UPDATE public.quotes SET status = 'hidden' WHERE id = v_quote_id AND status <> 'hidden';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quote_report_auto_hide ON public.content_reports;
CREATE TRIGGER trg_quote_report_auto_hide
  AFTER INSERT ON public.content_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_quote_report_auto_hide();

------------------------------------------------------------
-- (C) enqueue_weekly_best_quote — 주간 최고 명언 푸시 큐잉
-- 지난 7일 user_quote 중 좋아요 가장 많이 받은 1개를 작성자에게 축하 푸시.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_weekly_best_quote()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    WITH ranked AS (
      SELECT q.id, q.user_id, q.text,
        COALESCE(COUNT(ql.user_id), 0) AS wk_likes
      FROM public.quotes q
      LEFT JOIN public.quote_likes ql
        ON ql.quote_id = q.id AND ql.created_at > NOW() - INTERVAL '7 days'
      WHERE q.status = 'approved' AND q.user_id IS NOT NULL
      GROUP BY q.id, q.user_id, q.text
      HAVING COUNT(ql.user_id) >= 10
    )
    SELECT * FROM ranked ORDER BY wk_likes DESC LIMIT 5
  LOOP
    -- 이미 같은 quote 의 weekly_best 푸시 발송 이력 있으면 skip
    IF EXISTS(
      SELECT 1 FROM public.push_send_log
       WHERE category = 'weekly_best_quote'
         AND (payload->>'quote_id')::UUID = v_row.id
    ) THEN CONTINUE; END IF;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status)
    VALUES
      (v_row.user_id, 'weekly_best_quote',
       '🏆 이번 주 최고의 명언!',
       '러너들이 ' || v_row.wk_likes || '번 좋아요를 눌렀어요. 명언 사전에서 확인해보세요',
       jsonb_build_object('quote_id', v_row.id, 'deep_link', '/quotes/ranking'),
       'pending');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_weekly_best_quote() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_weekly_best_quote() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_weekly_best_quote() TO service_role;

------------------------------------------------------------
-- (D) admin_pending_quote_reports — 어드민이 처리 안 한 명언 신고 조회
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_pending_quote_reports(p_limit INT DEFAULT 50)
RETURNS TABLE (
  quote_id UUID,
  quote_text TEXT,
  quote_author TEXT,
  quote_status TEXT,
  report_count INT,
  reasons TEXT[],
  last_reported_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    q.id AS quote_id,
    q.text AS quote_text,
    q.author AS quote_author,
    q.status AS quote_status,
    COUNT(cr.id)::INT AS report_count,
    array_agg(DISTINCT cr.reason) AS reasons,
    MAX(cr.created_at) AS last_reported_at
  FROM public.content_reports cr
  JOIN public.quotes q ON q.id::text = cr.target_id
  WHERE cr.target_type = 'quote'
    AND cr.status = 'open'
    AND public.is_shop_admin()  -- admin 만
  GROUP BY q.id, q.text, q.author, q.status
  ORDER BY last_reported_at DESC
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.admin_pending_quote_reports(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_pending_quote_reports(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_pending_quote_reports(INT) TO authenticated;

------------------------------------------------------------
-- (E) admin_resolve_quote_report — 어드민이 신고 처리 (숨김 또는 무시)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_quote_report(
  p_quote_id UUID,
  p_action TEXT  -- 'hide' | 'dismiss'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN
    RAISE EXCEPTION '관리자만';
  END IF;
  IF p_action NOT IN ('hide', 'dismiss', 'restore') THEN
    RAISE EXCEPTION '잘못된 액션';
  END IF;

  IF p_action = 'hide' THEN
    UPDATE public.quotes SET status = 'hidden' WHERE id = p_quote_id;
  ELSIF p_action = 'restore' THEN
    UPDATE public.quotes SET status = 'approved', report_count = 0 WHERE id = p_quote_id;
  END IF;

  -- 모든 미해결 신고 close
  UPDATE public.content_reports
     SET status = 'closed'
   WHERE target_type = 'quote'
     AND target_id = p_quote_id::text
     AND status = 'open';

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_resolve_quote_report(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_quote_report(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_quote_report(UUID, TEXT) TO authenticated;

------------------------------------------------------------
-- content_reports.status 가 NULL 일 때 default 보강
------------------------------------------------------------
ALTER TABLE public.content_reports ALTER COLUMN status SET DEFAULT 'open';
UPDATE public.content_reports SET status = 'open' WHERE status IS NULL;
