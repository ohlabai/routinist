-- 2026-08-09: 온보딩 게이트를 display_name 휴리스틱 → 명시 플래그(onboarded_at) 로 교체.
--
-- 문제: 게이트가 `display_name === '러너' && total_runs === 0` 이었는데, handle_new_user 트리거가
-- OAuth 의 name/full_name 을 display_name 에 그대로 넣는다. Google id_token 에는 name claim 이
-- 항상 있으므로 **Google 가입자는 100% 온보딩을 건너뛴다.**
-- 실측 (2026-08-09): 회원 75명 중 Google 46명(61%) 전원 name claim 보유 → 온보딩 미노출.
--   그 결과 ① 구글 실명이 동의 없이 공개 랭킹 닉네임이 되고 ② 지역·생년·성별이 비어
--   ranking 페이지의 hasDemographics 게이트에 걸려 랭킹 탭이 링크 한 줄로 대체된다.
-- Apple 은 name claim 이 없어 '러너' 로 들어오므로 온보딩이 떠서, 두 소셜 로그인의
-- 신규 경험이 정반대였다.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- 기존 회원 백필: 이미 온보딩을 했거나(인구정보 보유) 실사용 중인 사람에게 갑자기
-- 온보딩이 뜨지 않도록 완료 처리. 판단 기준은 "온보딩에서 받는 값이 하나라도 있음"
-- 또는 "이미 러닝 기록이 있음".
UPDATE public.profiles p
SET onboarded_at = COALESCE(p.updated_at, p.created_at, now())
WHERE p.onboarded_at IS NULL
  AND (
    p.region_si IS NOT NULL OR p.region_gu IS NOT NULL
    OR p.birth_year IS NOT NULL OR p.gender IS NOT NULL
    OR COALESCE(p.total_runs, 0) > 0
    OR EXISTS (SELECT 1 FROM public.monthly_goals g WHERE g.user_id = p.id)
  );

COMMENT ON COLUMN public.profiles.onboarded_at IS
  '온보딩 완료 시각. NULL 이면 미완료 → 앱이 온보딩을 띄운다 (display_name 휴리스틱 대체).';
