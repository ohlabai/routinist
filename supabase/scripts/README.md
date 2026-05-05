supabase/scripts/
==================

마이그레이션이 아닌 일회성 데이터 작업 스크립트. 마이그레이션과 달리 자동
적용되지 않으며, 필요한 환경에서 service_role 로 직접 실행한다.

실행:
  supabase db execute --file supabase/scripts/<파일명>
또는 Supabase Studio SQL editor 에 붙여 실행.

## 클럽 월별 결산 import

`import-club-monthly-html.mjs` — 외부 결산 HTML(`MEMBERS_DATA` JS 변수 포함)을
`club_external_*` 테이블 INSERT SQL 로 변환.

전제 조건:
1. `migrations/20260505000000_club_external_members.sql` 적용 완료
2. 대상 클럽이 `clubs` 테이블에 존재 (앱에서 먼저 생성)

사용:
```
node supabase/scripts/import-club-monthly-html.mjs \
  --html ~/Downloads/bit-runners-2026-04.html \
  --club-name 'BIT RUNNERS' \
  --year 2026 --month 4 \
  > supabase/scripts/bit-runners-2026-04.sql
```

생성된 SQL 은 idempotent — 같은 (club, year, month) 를 다시 import 하면
해당 월의 기존 활동을 삭제하고 다시 넣음.
