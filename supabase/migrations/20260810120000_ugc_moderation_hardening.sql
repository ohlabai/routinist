-- UGC 안전장치 강화 (Apple Guideline 1.2 거절 대응, 2026-08-10)
-- 감사 결과 (6개 gap 그룹) 중 DB 레이어 전부:
--  1. content_reports CHECK 3종이 실제 사용값과 불일치 → copyright 신고·quote 신고 처리가 런타임 실패
--  2. activity_photos 에 UPDATE RLS 정책 0개 → 어드민 "사진 비공개" 가 조용히 실패 (0행 갱신)
--  3. is_clean_text() 가 프로덕션에만 수동 존재 (9단어) → 코드화 + 사전 확장 + 적용 표면 확대
--  4. 차단 서버구멍: 기존 대화 쪽지 수신, 차단 유저 댓글 푸시 도달, 댓글/응원 SELECT 미필터
--  5. 차단 시 개발자 통보 없음 (Apple: "blocking should also notify the developer")
--  6. 신고 접수 시 관리자 통보 없음 → 24시간 내 조치 불가

-- ─── 1. content_reports CHECK 확장 ─────────────────────────────
ALTER TABLE content_reports DROP CONSTRAINT content_reports_reason_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_reason_check
  CHECK (reason IN ('inappropriate','spam','harassment','copyright','block','other'));

ALTER TABLE content_reports DROP CONSTRAINT content_reports_status_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_status_check
  CHECK (status IN ('open','reviewed','removed','closed'));

ALTER TABLE content_reports DROP CONSTRAINT content_reports_target_type_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_target_type_check
  CHECK (target_type IN ('photo','user','message','quote','feedback','photo_comment','activity_comment','club'));

-- 하드코딩 이메일 정책 제거 — content_reports_select_own 이 is_shop_admin() 을 이미 포함,
-- 클라 어드민 4명 (admin-emails.ts) 과 정합.
DROP POLICY IF EXISTS content_reports_admin_select ON content_reports;

-- ─── 2. activity_photos UPDATE 정책 (어드민 콘텐츠 제거의 실체) ──
CREATE POLICY activity_photos_admin_update ON activity_photos
  FOR UPDATE USING (is_shop_admin()) WITH CHECK (is_shop_admin());

-- ─── 3. is_clean_text 코드화 + 확장 ────────────────────────────
-- 우회 문자 (공백·특수문자·숫자) 제거 후 부분 매칭. 클라 1차 필터 (src/lib/moderation.ts) 와
-- 목록 동기 유지 — 둘 중 서버가 최종 방어선.
CREATE OR REPLACE FUNCTION public.is_clean_text(t text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n text;
BEGIN
  IF t IS NULL OR length(trim(t)) = 0 THEN RETURN TRUE; END IF;
  -- 정규화: 소문자화 + 공백/구두점/숫자 제거 ("시 발" → "시발", "f.u.c.k" → "fuck")
  n := lower(regexp_replace(t, '[\s\-_.,!?~^*+#@''"()\[\]{}|\\/;:<>=&%$0-9]+', '', 'g'));
  IF n ~ ('(시발|씨발|ㅅㅂ|ㅆㅂ|씨빨|시빨|씨팔|시팔|tlqkf' ||
          '|개새끼|개세끼|개색기|개색끼|ㄱㅅㄲ|새끼야' ||
          '|병신|ㅂㅅ|븅신|빙신|지랄|ㅈㄹ|좆|존나|ㅈㄴ' ||
          '|느금마|니애미|니어미|느그애미|엠창' ||
          '|걸레년|창녀|창놈|갈보' ||
          '|보지|자위|섹스|sex|야동|딸딸이|오르가즘|포르노|porn' ||
          '|유두|클리토리스|사정했|삽입해' ||
          '|틀딱|한남충|김치녀|메갈|일베충|급식충|똥꼬충' ||
          '|흑형|깜둥이|짱깨|쪽바리|조센징' ||
          '|fuck|shit|bitch|asshole|nigger|nigga|faggot|retard' ||
          '|motherfucker|cunt|whore|blowjob|handjob|cumshot)') THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;

-- 필터 적용 표면 확대: 활동 댓글 · 쪽지 · 명언 · 클럽 · 프로필 (기존: photo_comments 만)
CREATE OR REPLACE FUNCTION public.ugc_clean_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'activity_comments' OR TG_TABLE_NAME = 'photo_comments' OR TG_TABLE_NAME = 'messages' THEN
    IF NOT public.is_clean_text(NEW.body) THEN
      RAISE EXCEPTION 'objectionable_content' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'quotes' THEN
    IF NOT public.is_clean_text(NEW.text) OR NOT public.is_clean_text(NEW.author) THEN
      RAISE EXCEPTION 'objectionable_content' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'clubs' THEN
    IF NOT public.is_clean_text(NEW.name) OR NOT public.is_clean_text(NEW.description) THEN
      RAISE EXCEPTION 'objectionable_content' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF NOT public.is_clean_text(NEW.display_name) OR NOT public.is_clean_text(NEW.bio) THEN
      RAISE EXCEPTION 'objectionable_content' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activity_comments_clean ON activity_comments;
CREATE TRIGGER activity_comments_clean BEFORE INSERT OR UPDATE ON activity_comments
  FOR EACH ROW EXECUTE FUNCTION public.ugc_clean_check();
DROP TRIGGER IF EXISTS messages_clean ON messages;
CREATE TRIGGER messages_clean BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.ugc_clean_check();
DROP TRIGGER IF EXISTS quotes_clean ON quotes;
CREATE TRIGGER quotes_clean BEFORE INSERT OR UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION public.ugc_clean_check();
DROP TRIGGER IF EXISTS clubs_clean ON clubs;
CREATE TRIGGER clubs_clean BEFORE INSERT OR UPDATE ON clubs
  FOR EACH ROW EXECUTE FUNCTION public.ugc_clean_check();
DROP TRIGGER IF EXISTS profiles_clean ON profiles;
CREATE TRIGGER profiles_clean BEFORE INSERT OR UPDATE OF display_name, bio ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.ugc_clean_check();

-- ─── 4. 차단 서버 적용 ─────────────────────────────────────────
-- 역방향 조회 인덱스 (PK 는 (blocker_id, blocked_id) 가정 — 양방향 검사 대비)
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id, blocker_id);

-- 4a. 기존 대화에서도 차단되면 쪽지 전송 불가 (기존: conversations 생성 시점만 검사)
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  (SELECT auth.uid()) = sender_id
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_id
      AND ((SELECT auth.uid()) = c.user_a OR (SELECT auth.uid()) = c.user_b)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = c.user_a AND b.blocked_id = c.user_b)
           OR (b.blocker_id = c.user_b AND b.blocked_id = c.user_a)
      )
  )
);

-- 4b. 차단 관계면 댓글 SELECT 제외 (서버 필터 — 클라 필터는 보조로 유지)
--     (select auth.uid()) = InitPlan 캐싱 (행마다 재평가 방지)
DROP POLICY IF EXISTS photo_comments_select ON photo_comments;
CREATE POLICY photo_comments_select ON photo_comments FOR SELECT USING (
  ((EXISTS (SELECT 1 FROM activity_photos ap
            WHERE ap.id = photo_comments.photo_id AND ap.share_in_gallery = true))
   OR user_id = (SELECT auth.uid()))
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = photo_comments.user_id)
       OR (b.blocker_id = photo_comments.user_id AND b.blocked_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS comments_select ON activity_comments;
CREATE POLICY comments_select ON activity_comments FOR SELECT USING (
  activity_id IN (SELECT activities.id FROM activities)
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = activity_comments.user_id)
       OR (b.blocker_id = activity_comments.user_id AND b.blocked_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS user_cheers_select ON user_cheers;
CREATE POLICY user_cheers_select ON user_cheers FOR SELECT USING (
  NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = user_cheers.from_user)
       OR (b.blocker_id = user_cheers.from_user AND b.blocked_id = (SELECT auth.uid()))
  )
);

-- 4c. 차단 관계면 새 댓글 작성도 차단 (콘텐츠 생성 원천 봉쇄)
DROP POLICY IF EXISTS photo_comments_insert ON photo_comments;
CREATE POLICY photo_comments_insert ON photo_comments FOR INSERT WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM activity_photos ap
    WHERE ap.id = photo_comments.photo_id AND ap.share_in_gallery = true
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = ap.user_id AND b.blocked_id = (SELECT auth.uid()))
           OR (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = ap.user_id)
      )
  )
);

DROP POLICY IF EXISTS comments_insert ON activity_comments;
CREATE POLICY comments_insert ON activity_comments FOR INSERT WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND NOT EXISTS (
    SELECT 1 FROM activities a
    JOIN user_blocks b ON (b.blocker_id = a.user_id AND b.blocked_id = (SELECT auth.uid()))
                       OR (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = a.user_id)
    WHERE a.id = activity_comments.activity_id
  )
);

-- 4d. 차단 유저의 댓글이 푸시/인박스로 도달하던 구멍
CREATE OR REPLACE FUNCTION public.notify_on_photo_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM activity_photos WHERE id = NEW.photo_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  -- 차단 관계면 알림 미발행 (Apple 1.2: 차단 = 즉시·완전 단절)
  IF EXISTS (SELECT 1 FROM user_blocks b
             WHERE (b.blocker_id = owner_id AND b.blocked_id = NEW.user_id)
                OR (b.blocker_id = NEW.user_id AND b.blocked_id = owner_id)) THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (owner_id, 'photo_comment', NEW.photo_id, NEW.user_id, LEFT(NEW.body, 60));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_activity_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM activities WHERE id = NEW.activity_id;
  IF owner_id IS NULL OR owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM user_blocks b
             WHERE (b.blocker_id = owner_id AND b.blocked_id = NEW.user_id)
                OR (b.blocker_id = NEW.user_id AND b.blocked_id = owner_id)) THEN
    RETURN NEW;
  END IF;
  INSERT INTO user_notifications (user_id, kind, source_id, actor_id, preview)
  VALUES (owner_id, 'activity_comment', NEW.activity_id, NEW.user_id, LEFT(NEW.body, 60));
  RETURN NEW;
END;
$$;

-- ─── 5. 차단 시 개발자 통보 (Apple 명시 요구) ───────────────────
-- user_blocks insert → content_reports 자동 접수. 중복 차단(재차단)은 open 리포트 있으면 skip.
CREATE OR REPLACE FUNCTION public.tg_block_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM content_reports
    WHERE reporter_id = NEW.blocker_id AND target_type = 'user'
      AND target_id = NEW.blocked_id::text AND reason = 'block' AND status = 'open'
  ) THEN
    INSERT INTO content_reports (reporter_id, target_type, target_id, reason, detail, status)
    VALUES (NEW.blocker_id, 'user', NEW.blocked_id::text, 'block', '자동 접수: 사용자 차단', 'open');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_blocks_report ON user_blocks;
CREATE TRIGGER user_blocks_report AFTER INSERT ON user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_report();

-- ─── 6. 신고 접수 → 관리자 푸시 (24시간 내 조치의 실행 수단) ────
CREATE OR REPLACE FUNCTION public.tg_report_notify_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO push_send_log (user_id, category, title, body, payload, status)
  SELECT u.id, 'admin_report',
    '🚨 신고 접수 — ' || NEW.target_type,
    '사유: ' || NEW.reason || ' · 24시간 내 확인이 필요해요',
    jsonb_build_object('deep_link', '/admin/reports', 'report_id', NEW.id),
    'pending'
  FROM auth.users u
  WHERE u.email IN ('hans@openhan.kr','claire@openhan.kr','dylan@openhan.kr','jane@openhan.kr');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS content_reports_notify ON content_reports;
CREATE TRIGGER content_reports_notify AFTER INSERT ON content_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_report_notify_admins();

-- 어드민이 신고된 활동 댓글을 제거할 수 있어야 함 (photo_comments_delete 는 이미 admin 포함)
DROP POLICY IF EXISTS comments_delete ON activity_comments;
CREATE POLICY comments_delete ON activity_comments FOR DELETE USING ((SELECT auth.uid()) = user_id OR is_shop_admin());
