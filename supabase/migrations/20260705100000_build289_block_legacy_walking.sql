-- build 289: 구버전 앱 (≤1.2.5, build 288) 의 걷기 재동기화 차단.
--
-- 배경: build 289 에서 걷기 동기화를 opt-in (기본 러닝만) 으로 바꾸고 기존 걷기 98건을 삭제했지만,
-- "러닝만" 필터는 클라이언트 코드라 구버전 설치 기기가 동기화하면 걷기가 그대로 재INSERT 됨
-- (실제 사례: 삭제 당일 hans 기기 재동기화로 16건 재유입). 앱 업데이트가 전 사용자에게 퍼지기 전까지
-- 서버에서 막아야 삭제가 유지됨.
--
-- 구분 방법: 구버전 걷기 INSERT 는 source='health_kit'. build 289+ 의 opt-in 걷기는
-- source='health_kit_walk' 로 보냄 (src/lib/health-sync.ts). 따라서 walking 인데
-- health_kit_walk 가 아니면 전부 구버전 유입 → RETURN NULL 로 조용히 skip.
-- RAISE EXCEPTION 이 아닌 이유: 구버전 클라이언트의 동기화 전체가 에러로 깨지지 않게
-- (supabase-js insert 는 return=minimal 이라 0-row 성공으로 처리됨).

-- source CHECK 제약에 health_kit_walk 추가 (기존 4개 값 + 1)
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE activities ADD CONSTRAINT activities_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'gps'::text, 'health_kit'::text, 'health_kit_walk'::text, 'health_connect'::text]));

CREATE OR REPLACE FUNCTION block_legacy_walking_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.activity_type = 'walking' AND NEW.source IS DISTINCT FROM 'health_kit_walk' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_legacy_walking ON activities;
CREATE TRIGGER trg_block_legacy_walking
  BEFORE INSERT ON activities
  FOR EACH ROW
  EXECUTE FUNCTION block_legacy_walking_insert();
