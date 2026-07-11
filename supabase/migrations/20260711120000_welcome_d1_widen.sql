-- build 298: welcome_d1 조건 완화 — 역대 발송 0건의 원인 수정.
--
-- 기존 조건이 실제 유입 패턴과 불일치:
-- ① 24~48h 창이 너무 좁음 — push 토큰 등록이 늦으면 (권한을 나중에 허용) 창을 놓치고 영구 미발송.
--    → 24h~96h 로 확대 (dedup 은 카테고리 이력이 이미 담당).
-- ② "활동 0건" 조건 — 신규 유저 대부분이 가입 당일 Apple Health bulk import 를 하므로
--    사실상 전원 제외됐음. 조건 제거하고, 활동 유무에 따라 카피 분기
--    (기록 있음 = "기록 잘 들어왔어요, 이번 주 첫 러닝 가볍게" / 없음 = 기존 첫 러닝 유도).

CREATE OR REPLACE FUNCTION public.enqueue_welcome_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_row RECORD;
  v_has_activity BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION '권한이 없습니다 (service_role only)';
  END IF;

  FOR v_row IN
    SELECT DISTINCT pd.user_id
      FROM public.push_device_tokens pd
      JOIN auth.users u ON u.id = pd.user_id
     WHERE pd.enabled = true
       AND u.created_at BETWEEN NOW() - INTERVAL '96 hours'
                            AND NOW() - INTERVAL '24 hours'
       AND public.should_send_push(pd.user_id, 'welcome_d1')
       AND NOT EXISTS (
         SELECT 1 FROM public.push_send_log psl
          WHERE psl.user_id = pd.user_id
            AND psl.category = 'welcome_d1'
       )
     LIMIT 500
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.activities a WHERE a.user_id = v_row.user_id
    ) INTO v_has_activity;

    INSERT INTO public.push_send_log
      (user_id, category, title, body, payload, status, send_after)
    VALUES
      (v_row.user_id, 'welcome_d1',
       public.push_text(v_row.user_id,
         'Routinist 에 오신 걸 환영해요! 🎉',
         'Welcome to Routinist! 🎉'),
       CASE WHEN v_has_activity THEN
         public.push_text(v_row.user_id,
           '기록이 잘 들어왔어요 👟 이번 주 첫 러닝, 가볍게 시작해볼까요?',
           'Your runs are all in 👟 How about an easy first run this week?')
       ELSE
         public.push_text(v_row.user_id,
           '첫 러닝, 가볍게 1km 어때요? 👟 Apple Health 연동하면 자동으로 기록돼요',
           'How about an easy 1km for your first run? 👟 Connect Apple Health and it logs itself')
       END,
       jsonb_build_object('kind', 'welcome_d1', 'deep_link', '/'),
       'pending',
       public.local_evening(v_row.user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;
