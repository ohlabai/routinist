-- 2026-05-14 build 123 — 월드런 The Conqueror 풍 강화
-- 가격 100~1000 마일리지로 재조정 + 스토리/우승자/유튜브/고도 컬럼

------------------------------------------------------------
-- (A) 가격 재조정 — 거리 차등 100~1000 마일리지
------------------------------------------------------------
UPDATE public.virtual_courses SET entry_fee_p = 100 WHERE distance_km < 20;
UPDATE public.virtual_courses SET entry_fee_p = 200 WHERE distance_km >= 20 AND distance_km < 41;
UPDATE public.virtual_courses SET entry_fee_p = 500 WHERE distance_km >= 41 AND distance_km < 50;
UPDATE public.virtual_courses SET entry_fee_p = 800 WHERE distance_km >= 50 AND distance_km < 100;
UPDATE public.virtual_courses SET entry_fee_p = 1000 WHERE distance_km >= 100;

------------------------------------------------------------
-- (B) virtual_courses 풍부한 컬럼
------------------------------------------------------------
ALTER TABLE public.virtual_courses
  ADD COLUMN IF NOT EXISTS story TEXT,
  ADD COLUMN IF NOT EXISTS past_winners JSONB,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS official_url TEXT,
  ADD COLUMN IF NOT EXISTS elevation_profile JSONB,
  ADD COLUMN IF NOT EXISTS landmarks JSONB,  -- [{km, name, description}]
  ADD COLUMN IF NOT EXISTS course_record TEXT;

------------------------------------------------------------
-- (C) 대표 3개 코스에 스토리텔링 데이터
------------------------------------------------------------
UPDATE public.virtual_courses SET
  story = E'세계에서 가장 오래된 마라톤. 1897년 첫 대회 이래 매년 4월 셋째 월요일(애국자의 날)에 열려요. 출발지 홉킨턴에서 보스턴 보일스턴 스트리트 결승선까지 42.195km.\n\n코스의 진가는 후반부 21마일(34km) 지점에 나타나요. 뉴턴 힐스라 불리는 4개의 언덕 중 마지막 ''Heartbreak Hill'' (이름의 유래: 1936년 디펜딩 챔피언 존 A 켈리가 이 언덕에서 무너진 것을 ''심장이 부서졌다''고 보도한 기자 때문). 평지 코스에 익숙한 러너들이 여기서 무너져요.\n\n출전 자격이 까다로워요. 연령·성별별 BQ(Boston Qualifying) 기준을 통과한 러너만 참가 가능. 그래서 보스턴 마라톤 출전증은 러닝 커뮤니티의 훈장.',
  past_winners = '[
    {"year": 2023, "name": "Evans Chebet", "time": "2:05:54", "notes": "케냐 — 2년 연속"},
    {"year": 2024, "name": "Sisay Lemma", "time": "2:06:17", "notes": "에티오피아"},
    {"year": 2022, "name": "Peres Jepchirchir", "time": "2:21:01", "notes": "여자 — 케냐"}
  ]'::jsonb,
  youtube_url = 'https://www.youtube.com/watch?v=jE-DtRJpV2k',
  official_url = 'https://www.baa.org/',
  course_record = '남자 2:03:02 (2011 Geoffrey Mutai) · 여자 2:19:59 (2014 Buzunesh Deba)',
  landmarks = '[
    {"km": 0, "name": "Hopkinton Start", "description": "전통의 출발선"},
    {"km": 16, "name": "Wellesley 응원의 벽", "description": "Wellesley 여대생들의 응원 굉음"},
    {"km": 32, "name": "Heartbreak Hill", "description": "마지막 언덕. 여기서 승부가 갈림"},
    {"km": 41, "name": "Boylston Street", "description": "마지막 직선 — 영광의 결승선"}
  ]'::jsonb,
  elevation_profile = '[
    {"km":0,"m":150},{"km":5,"m":100},{"km":10,"m":70},{"km":15,"m":60},{"km":20,"m":50},
    {"km":25,"m":70},{"km":28,"m":85},{"km":30,"m":95},{"km":32,"m":75},{"km":35,"m":40},
    {"km":40,"m":15},{"km":42,"m":10}
  ]'::jsonb
WHERE name = '보스턴 마라톤';

UPDATE public.virtual_courses SET
  story = E'평탄한 도심 코스 + 어마어마한 응원. 2007년 처음 열린 도쿄 마라톤은 짧은 역사에도 World Marathon Majors 6대 마라톤 중 하나로 자리 잡았어요.\n\n도쿄 도청 출발 → 신주쿠 거리 → 황궁 옆 → 아사쿠사 센소지 → 니혼바시 → 도쿄역 피니시. 38,000명이 참가하는데, 길가에 시민 응원단·치어리더·라이브 밴드·전통 북 두드리는 모습까지 — 일본 특유의 정성과 디테일이 가득.\n\n페이스 유지하기 좋은 평탄 코스라 PB(개인 기록) 노리는 러너들이 사랑. 일본 응원 문화를 경험하고 싶다면 ',
  past_winners = '[
    {"year": 2024, "name": "Benson Kipruto", "time": "2:02:16", "notes": "케냐 — 코스 기록"},
    {"year": 2023, "name": "Deso Gelmisa", "time": "2:05:22", "notes": "에티오피아"},
    {"year": 2024, "name": "Sutume Kebede", "time": "2:15:55", "notes": "여자 — 에티오피아"}
  ]'::jsonb,
  youtube_url = 'https://www.youtube.com/watch?v=DI4Zg8VVqfA',
  official_url = 'https://www.marathon.tokyo/',
  course_record = '남자 2:02:16 (2024 Benson Kipruto) · 여자 2:15:55 (2024 Sutume Kebede)',
  landmarks = '[
    {"km": 0, "name": "도쿄 도청", "description": "신주쿠 출발선"},
    {"km": 15, "name": "황궁 일대", "description": "사쿠라다 문 통과"},
    {"km": 27, "name": "아사쿠사 센소지", "description": "전통 거리 + 가미나리몬"},
    {"km": 42, "name": "도쿄역", "description": "마루노우치 결승선"}
  ]'::jsonb
WHERE name = '도쿄 마라톤';

UPDATE public.virtual_courses SET
  story = E'세계 신기록이 자주 깨지는 코스. 평탄해서 ''마라톤 PB의 성지''라 불러요. 1974년 첫 대회 이래 8번의 마라톤 세계 신기록이 이곳에서 탄생.\n\n2022년 9월 25일, 엘리우드 키프초게가 2:01:09로 세계 신기록 갱신. 2023년 켈빈 키프툼이 2:00:35로 다시 깸. 2024년 9월 키프툼이 교통사고로 사망한 후, 그를 기리며 9월 마라톤이 치러져요.\n\n베를린 브란덴부르크 문을 통과하며 끝나는 결승 장면이 명물. 도시 곳곳에 라이브 음악·시민 응원·맥주(!) 까지.',
  past_winners = '[
    {"year": 2023, "name": "Kelvin Kiptum", "time": "2:00:35", "notes": "케냐 — 세계 신기록 (당시)"},
    {"year": 2022, "name": "Eliud Kipchoge", "time": "2:01:09", "notes": "케냐 — 당시 세계 신기록"},
    {"year": 2024, "name": "Milkesa Mengesha", "time": "2:03:17", "notes": "에티오피아"}
  ]'::jsonb,
  youtube_url = 'https://www.youtube.com/watch?v=5OuCkkvavCM',
  official_url = 'https://www.bmw-berlin-marathon.com/',
  course_record = '남자 2:00:35 (2023 Kelvin Kiptum) · 여자 2:11:53 (2023 Tigist Assefa)',
  landmarks = '[
    {"km": 0, "name": "Reichstag", "description": "독일 의사당 옆 출발"},
    {"km": 22, "name": "Charlottenburg", "description": "궁전·박물관 거리"},
    {"km": 38, "name": "Potsdamer Platz", "description": "도심 광장"},
    {"km": 42, "name": "Brandenburger Tor", "description": "베를린의 상징 — 영광의 피니시"}
  ]'::jsonb
WHERE name = '베를린 마라톤';

------------------------------------------------------------
-- (D) 한국 코스 2개에도 story 추가
------------------------------------------------------------
UPDATE public.virtual_courses SET
  story = E'대한민국 올레길의 첫 코스. 시흥초등학교에서 시작해 광치기 해변까지 15.6km. 말미오름과 알오름을 넘어 종달리 해변·성산일출봉을 옆으로 끼고 걷는 길.\n\n2007년 9월 8일, 사단법인 제주올레가 ''제주 사람들이 길을 잃지 않도록''이라는 마음으로 만든 길. 누군가는 ''제주의 시작''이라 불러요. 일출봉 등반과 함께 도전하면 더 풍성한 경험.',
  course_record = '평균 4~5시간 (걷기 기준), 러닝 1.5~2시간',
  landmarks = '[
    {"km": 0, "name": "시흥초등학교", "description": "올레 1코스 시작점"},
    {"km": 4, "name": "말미오름·알오름", "description": "쌍둥이 오름 능선"},
    {"km": 10, "name": "종달리 해변", "description": "에메랄드빛 바다"},
    {"km": 15.6, "name": "광치기 해변", "description": "성산일출봉이 보이는 종착지"}
  ]'::jsonb
WHERE name = '제주 올레길 1코스';

UPDATE public.virtual_courses SET
  story = E'광나루부터 가양까지 한강 자전거 종주길 40km. 서울 러너들의 표준 장거리 코스.\n\n잠실대교·뚝섬·반포 무지개분수·동작·여의도·서강대교·양화·성산대교를 거쳐 가양까지 — 다리 8개를 통과하며 서울의 야경을 횡단해요. 봄꽃·여름 시원한 강바람·가을 단풍·겨울 새벽 안개 — 4계절 다른 풍경.\n\n페이스 5분 30초로 약 3시간 40분 ~ 4시간. 첫 풀마라톤 도전 전 코스로 인기.',
  course_record = '평균 4시간 (장거리 러너 기준)',
  landmarks = '[
    {"km": 0, "name": "광나루역", "description": "한강 동쪽 시작점"},
    {"km": 10, "name": "잠실철교 → 뚝섬", "description": "잠실 빌딩숲 옆"},
    {"km": 20, "name": "반포 무지개분수", "description": "서울의 명물"},
    {"km": 28, "name": "여의도", "description": "도심 한복판"},
    {"km": 40, "name": "가양역", "description": "한강 서쪽 종착"}
  ]'::jsonb
WHERE name = '서울 한강 종주';
