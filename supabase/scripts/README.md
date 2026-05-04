supabase/scripts/
==================

마이그레이션이 아닌 일회성 데이터 작업 스크립트. 마이그레이션과 달리 자동
적용되지 않으며, 필요한 환경에서 service_role 로 직접 실행한다.

실행:
  supabase db execute --file supabase/scripts/<파일명>
또는 Supabase Studio SQL editor 에 붙여 실행.
