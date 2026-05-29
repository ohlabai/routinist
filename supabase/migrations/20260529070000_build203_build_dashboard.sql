-- build 203: Phase C — Build Dashboard + 체크리스트.
-- 빌드별 기능 정리 + 인터랙티브 체크리스트 + 체크 상태 영구 보관.

-- ─── 1) build_releases ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.build_releases (
  build_number INTEGER PRIMARY KEY,
  marketing_version TEXT,        -- '1.2', '1.3'
  title TEXT NOT NULL,           -- 한 줄 요약
  summary TEXT,                  -- 마크다운 (긴 설명)
  commit_sha TEXT,
  released_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS build_releases_released_idx ON public.build_releases (released_at DESC);

ALTER TABLE public.build_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS br_admin_read ON public.build_releases;
CREATE POLICY br_admin_read ON public.build_releases FOR SELECT USING (public.is_shop_admin());
DROP POLICY IF EXISTS br_admin_write ON public.build_releases;
CREATE POLICY br_admin_write ON public.build_releases FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

-- ─── 2) build_test_checklist ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.build_test_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_number INTEGER NOT NULL REFERENCES public.build_releases(build_number) ON DELETE CASCADE,
  category TEXT NOT NULL,                  -- 'Phase 1' / '회귀 점검' 등
  ord INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  detail TEXT,
  expected TEXT,                            -- 정상 동작 기준
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS btc_build_idx ON public.build_test_checklist (build_number, category, ord);

ALTER TABLE public.build_test_checklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS btc_admin_read ON public.build_test_checklist;
CREATE POLICY btc_admin_read ON public.build_test_checklist FOR SELECT USING (public.is_shop_admin());
DROP POLICY IF EXISTS btc_admin_write ON public.build_test_checklist;
CREATE POLICY btc_admin_write ON public.build_test_checklist FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

-- ─── 3) build_test_results — admin 별 체크 상태 ────────────────────────
-- 누구든 admin 이 체크하면 공유. 마지막 변경 admin 표시.
CREATE TABLE IF NOT EXISTS public.build_test_results (
  checklist_id UUID PRIMARY KEY REFERENCES public.build_test_checklist(id) ON DELETE CASCADE,
  result TEXT NOT NULL DEFAULT 'pending',  -- 'pending' / 'pass' / 'fail' / 'skip'
  note TEXT,
  checked_by UUID REFERENCES auth.users(id),
  checked_by_email TEXT,
  checked_at TIMESTAMPTZ
);

ALTER TABLE public.build_test_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS btr_admin_read ON public.build_test_results;
CREATE POLICY btr_admin_read ON public.build_test_results FOR SELECT USING (public.is_shop_admin());
DROP POLICY IF EXISTS btr_admin_write ON public.build_test_results;
CREATE POLICY btr_admin_write ON public.build_test_results FOR ALL USING (public.is_shop_admin()) WITH CHECK (public.is_shop_admin());

-- ─── 4) RPC: 빌드 목록 + 진행률 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_builds()
RETURNS TABLE (
  build_number INTEGER,
  marketing_version TEXT,
  title TEXT,
  released_at DATE,
  total_checks INTEGER,
  passed INTEGER,
  failed INTEGER,
  pending INTEGER
) AS $$
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  RETURN QUERY
    SELECT br.build_number, br.marketing_version, br.title, br.released_at,
      (SELECT COUNT(*)::INTEGER FROM public.build_test_checklist c WHERE c.build_number = br.build_number),
      (SELECT COUNT(*)::INTEGER FROM public.build_test_checklist c LEFT JOIN public.build_test_results r ON r.checklist_id = c.id WHERE c.build_number = br.build_number AND r.result = 'pass'),
      (SELECT COUNT(*)::INTEGER FROM public.build_test_checklist c LEFT JOIN public.build_test_results r ON r.checklist_id = c.id WHERE c.build_number = br.build_number AND r.result = 'fail'),
      (SELECT COUNT(*)::INTEGER FROM public.build_test_checklist c LEFT JOIN public.build_test_results r ON r.checklist_id = c.id WHERE c.build_number = br.build_number AND (r.result IS NULL OR r.result = 'pending'))
    FROM public.build_releases br
   ORDER BY br.build_number DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_list_builds FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_builds TO authenticated;

-- ─── 5) RPC: 한 빌드의 전체 체크리스트 + 결과 ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_build_detail(p_build_number INTEGER)
RETURNS JSON AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  SELECT json_build_object(
    'release', (SELECT row_to_json(br) FROM public.build_releases br WHERE br.build_number = p_build_number),
    'checklist', COALESCE((
      SELECT json_agg(json_build_object(
        'id', c.id, 'category', c.category, 'ord', c.ord, 'title', c.title,
        'detail', c.detail, 'expected', c.expected,
        'result', COALESCE(r.result, 'pending'),
        'note', r.note,
        'checked_by_email', r.checked_by_email,
        'checked_at', r.checked_at
      ) ORDER BY c.category, c.ord)
      FROM public.build_test_checklist c
      LEFT JOIN public.build_test_results r ON r.checklist_id = c.id
      WHERE c.build_number = p_build_number
    ), '[]'::json)
  ) INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_get_build_detail FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_build_detail TO authenticated;

-- ─── 6) RPC: 체크 토글 ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_check_result(
  p_checklist_id UUID,
  p_result TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
BEGIN
  IF NOT public.is_shop_admin() THEN RAISE EXCEPTION '권한이 없어요'; END IF;
  IF p_result NOT IN ('pending', 'pass', 'fail', 'skip') THEN RAISE EXCEPTION 'invalid result'; END IF;
  v_uid := auth.uid();
  SELECT email::TEXT INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.build_test_results (checklist_id, result, note, checked_by, checked_by_email, checked_at)
    VALUES (p_checklist_id, p_result, p_note, v_uid, v_email, NOW())
    ON CONFLICT (checklist_id) DO UPDATE
      SET result = EXCLUDED.result,
          note = EXCLUDED.note,
          checked_by = EXCLUDED.checked_by,
          checked_by_email = EXCLUDED.checked_by_email,
          checked_at = EXCLUDED.checked_at;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.admin_set_check_result FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_check_result TO authenticated;

-- ─── 7) build 197~202 시드 데이터 ───────────────────────────────────────
INSERT INTO public.build_releases (build_number, marketing_version, title, released_at, commit_sha) VALUES
  (197, '1.2', 'Best Splits + PB 갱신 알림 (Phase 1)', '2026-05-29', '148d415'),
  (198, '1.2', '러닝 코치 (AI) + CTL/TSB + 일일 코칭 (Phase 2)', '2026-05-29', '0988ffa'),
  (199, '1.2', '타겟 레이스 + 시즌 결산 (Phase 3)', '2026-05-29', 'e7c673c'),
  (200, '1.2', '친구 PB + 클럽 챌린지 (Phase 4)', '2026-05-29', '55b8730'),
  (201, '1.2', '회원 관리 DB view (Phase A)', '2026-05-29', '9c9e2a9'),
  (202, '1.2', '회원 상세 + 푸시·마일리지·차단 액션 (Phase B)', '2026-05-29', 'f85bd4c'),
  (203, '1.2', 'Build Dashboard + 체크리스트 (Phase C)', '2026-05-29', NULL)
ON CONFLICT (build_number) DO NOTHING;

-- build 197 체크리스트
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (197, 'Phase 1 PB', 1, '트래킹 후 PB 자동 갱신', '저장 직후 활동 상세 자동 이동, "새 PB" 보라색 뱃지 표시'),
  (197, 'Phase 1 PB', 2, '첫 활동 모든 구간 PB', '"NEW PB!" 카드 + 자기 기록 N개 갱신 footer'),
  (197, 'Phase 1 PB', 3, 'GPS 없는 활동 (HealthKit) Best Splits 카드', '카드 안 보임이 정상'),
  (197, 'Phase 1 PB', 4, '시간 형식 표시', 'm:ss 또는 h:mm:ss (4:32 / 1:23:45)'),
  (197, 'Phase 1 PB', 5, '페이스 형식 표시', '4''32" (분''초")'),
  (197, 'Phase 1 PB', 6, 'personal_bests RLS', '본인 row read OK, 다른 사람은 안 보임 (is_public=true 친구는 read 가능)')
ON CONFLICT DO NOTHING;

-- build 198 체크리스트
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (198, 'Phase 2 Coach', 1, '"내 정보" 에 러닝 코치 (AI) 진입 카드', '마일리지 위에 보라/핑크 그라데이션 + NEW 뱃지'),
  (198, 'Phase 2 Coach', 2, '/coach 페이지 진입', '헤더에 "러닝 코치 AI"'),
  (198, 'Phase 2 Coach', 3, '오늘 컨디션 hero', '0~100 점수 + 그라데이션 (≥80 에메랄드 / 50~79 보라 / <50 주황) + 6단계 메시지'),
  (198, 'Phase 2 Coach', 4, '하단 3칸 표시', '장기 피트니스 / 최근 부하 / 컨디션 숫자'),
  (198, 'Phase 2 Coach', 5, '14일 차트', '보라 실선 (CTL) + 주황 점선 (ATL) + 범례'),
  (198, 'Phase 2 Coach', 6, '데이터 0건 사용자', '차트 안 보이고 "아직 분석할 활동이 부족해요" 표시'),
  (198, 'Phase 2 Coach', 7, '⚙️ 설정 펼침', '체중 / 최대 심박수 입력 칸 (선택)'),
  (198, 'Phase 2 Coach', 8, '체중 250 초과 입력', '"20~250kg 사이로" 경고'),
  (198, 'Phase 2 Coach', 9, '설정 저장 후 새로고침', '입력값 유지')
ON CONFLICT DO NOTHING;

-- build 199 체크리스트
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (199, 'Phase 3 Race', 1, '/coach 페이지에 "목표 레이스" 카드', '컨디션 hero 아래 표시'),
  (199, 'Phase 3 Race', 2, '처음엔 "다음 대회 등록하기" 점선 박스', '탭하면 폼 펼침'),
  (199, 'Phase 3 Race', 3, '대회 등록 폼', '대회명·날짜·거리(5K/10K/하프/풀) 입력 후 저장'),
  (199, 'Phase 3 Race', 4, '저장 후 카운트다운 hero', 'N일 남음 + 권장 주간 km'),
  (199, 'Phase 3 Race', 5, '2주 이내 레이스', '"⚠️ 테이퍼링 기간" 안내'),
  (199, 'Phase 3 Recap', 1, '시즌 결산 카드 (분기말 ±7일)', '오늘 5/29 기준 안 보임이 정상. 6/24 이후 노출 확인'),
  (199, 'Phase 3 Recap', 2, '시즌 결산 라벨', '"1분기 결산" / "상반기 결산" / "3분기 결산" / "한 해 결산"')
ON CONFLICT DO NOTHING;

-- build 200 체크리스트
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (200, 'Phase 4 Friend', 1, 'demo 계정 PB 갱신 후 push_send_log 확인', 'follower 별 row 들어감'),
  (200, 'Phase 4 Friend', 2, 'follower iOS 기기에서 푸시 수신', '"🎉 친구 PB 갱신! demo님이 1km 4:32 PB 달성"'),
  (200, 'Phase 4 Friend', 3, '24h 안 같은 거리 PB 또 갱신', '중복 푸시 X'),
  (200, 'Phase 4 Overtake', 1, '이번 주 km 친구보다 많을 때', '친구에게 "⚡ 추월당했어요!" 푸시'),
  (200, 'Phase 4 Club', 1, '클럽 상세 → "챌린지·모임" 탭', '최상단에 새 클럽 챌린지 카드'),
  (200, 'Phase 4 Club', 2, '챌린지 0개인 클럽', '카드 안 보임이 정상'),
  (200, 'Phase 4 Club', 3, '챌린지 있을 때', '일 남음 / 목표 km / 목표 회수 3칸 + leaderboard top10'),
  (200, 'Phase 4 Club', 4, 'Leaderboard', '1위 왕관 + 내 row 노란 강조'),
  (200, 'Phase 4 Club', 5, '챌린지 여러 개', '상단 탭으로 전환 가능')
ON CONFLICT DO NOTHING;

-- build 201 체크리스트
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (201, 'Phase A Users', 1, '/admin/users 페이지 진입', '21 컬럼 가로 스크롤 테이블 + 검색 + 필터 + 정렬'),
  (201, 'Phase A Users', 2, '필터 패널 토글', '11 필터 칩 적용 시 색상 강조 + 활성 필터 수 뱃지'),
  (201, 'Phase A Users', 3, '정렬 select', '7 옵션 (가입일↑↓·총km↑↓·활동수↓·최근활동↓·마일리지↓)'),
  (201, 'Phase A Users', 4, '페이지네이션', '50/페이지 + 이전·다음 + 페이지 카운터'),
  (201, 'Phase A Users', 5, '이탈 30일+ 사용자', 'idle_days 빨간 강조'),
  (201, 'Phase A Users', 6, '코치 opt-in 사용자', 'AI 라벨 보라 표시'),
  (201, 'Phase A Users', 7, '공개/감춤 토글', '눈 아이콘 클릭으로 즉시 변경 + 토스트'),
  (201, 'Phase A Users', 8, '닉네임 / "상세" 버튼 클릭', '/admin/users/detail?id=... 로 이동')
ON CONFLICT DO NOTHING;

-- build 202 체크리스트
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (202, 'Phase B Detail', 1, '/admin/users/detail?id=... 페이지', '프로필 hero + 통계 4칩 + 액션 4버튼 + 6 history 카드'),
  (202, 'Phase B Detail', 2, '최근 활동·주문·마일리지·푸시 history', '각 30 row 한도 timeline'),
  (202, 'Phase B Action', 1, '"푸시 발송" 버튼', '제목·내용 입력 폼 → 실행 → push_send_log row + admin_action_log 자동'),
  (202, 'Phase B Action', 2, '"마일리지" 버튼', '양수=지급 / 음수=차감. 사유 필수. 잔액 GREATEST(0, ...) floor'),
  (202, 'Phase B Action', 3, '"차단" 버튼', '사유 필수. is_public=false 처리. 영구 삭제 아님'),
  (202, 'Phase B Action', 4, '"영구 삭제" 버튼', 'confirm 다이얼로그 후 admin_delete_user RPC + 목록으로 리다이렉트'),
  (202, 'Phase B Audit', 1, 'admin_action_log 기록', '모든 액션이 audit log 카드에 시간순 표시'),
  (202, 'Phase B Audit', 2, 'admin 외 사용자 RPC 호출', '"권한이 없어요" 거부')
ON CONFLICT DO NOTHING;

-- 회귀 점검 (공통)
INSERT INTO public.build_test_checklist (build_number, category, ord, title, expected) VALUES
  (200, '회귀 점검', 1, '홈 진입 시간', '변함 없거나 약간 느려졌어도 무관 (lite-fetch 유지)'),
  (200, '회귀 점검', 2, '"▶ 달리기 시작" 트래킹 (build 194)', '그대로 동작'),
  (200, '회귀 점검', 3, '이번 주/이번 달 공유카드 (build 195)', '그대로 동작'),
  (200, '회귀 점검', 4, '일간 공유카드 지역+랭킹 (build 196)', '그대로 동작'),
  (200, '회귀 점검', 5, '결제 (build 190)', '카드 결제 여전히 정상'),
  (200, '회귀 점검', 6, '캘린더·랭킹·소셜 탭', '변경 영향 없음')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.build_releases IS 'build 203 — 빌드별 기능 정리 게시판';
COMMENT ON TABLE public.build_test_checklist IS 'build 203 — 빌드별 테스트 체크리스트 (admin 작성)';
COMMENT ON TABLE public.build_test_results IS 'build 203 — 체크리스트 결과 (admin 공유)';
