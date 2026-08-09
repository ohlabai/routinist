-- 2026-08-09: 광고 유입 급증 대비 인덱스 (전면 리뷰 성능 파트). 현재 activities ~2k 행이라
-- 지금은 seq scan 도 빠르지만 10~100배에서 무너지는 지점을 미리 막는다.

-- 1) activities(created_at) — 현재 없음(activity_date 만 있음). 다음이 전부 전역 seq scan 이었다:
--    · LiveRunningIndicator: 60초마다 created_at >= 30분전 COUNT (홈 열어둔 유저마다)
--    · fetch_nearby_runners: 상관 서브쿼리의 created_at >= now()-30d
--    · 리퍼럴/최근활동 정렬
CREATE INDEX IF NOT EXISTS idx_activities_created ON public.activities (created_at DESC);

-- 2) 랭킹 집계 (find_my_combined_ranking / find_hero_rank) — activity_date 범위로 전 유저를
--    GROUP BY user_id SUM(distance_km) 한다. 러닝만(walking 제외) 부분 인덱스 + distance_km
--    INCLUDE 로 index-only scan 을 노린다. 랭킹은 홈 진입마다 도는 최다 호출 쿼리.
CREATE INDEX IF NOT EXISTS idx_activities_rank_agg
  ON public.activities (activity_date, user_id) INCLUDE (distance_km)
  WHERE (activity_type IS NULL OR activity_type <> 'walking');

-- 3) push_send_log stale 회수 — route.ts 가 status='sending' 을 60초마다 스캔하는데
--    부분 인덱스는 'pending' 만 커버해 sending 회수가 전체 seq scan 이었다 (99.9% 0행 매칭).
CREATE INDEX IF NOT EXISTS idx_push_sending
  ON public.push_send_log (send_after) WHERE status = 'sending';
