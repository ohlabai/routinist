-- 2026-05-14 build 135 — 나머지 12개 코스 풀 데이터 (story/landmarks/winners/youtube)

-- 도쿄 → 후지산 (100km)
UPDATE public.virtual_courses SET
  story = E'도쿄 도심에서 후지산 5합목까지 100km 트레일 챌린지. 일본 트레일 러너들이 ''울트라 트레일''을 입문할 때 도전하는 정통 코스.\n\n도쿄 신주쿠에서 출발해 다카오산을 거쳐 후지노미야 트레일로 진입. 도시 → 산악 → 화산 — 풍경이 극적으로 바뀌어요. 후지산 5합목(해발 2,300m) 도착이 피니시. 보통 16~30시간.\n\n해외 러너에게는 ''Mt. Fuji 100'' 으로 알려져있고, 매년 9~10월에 비공식 도전이 활발.',
  landmarks = '[
    {"km":0,"name":"신주쿠 출발","description":"도쿄 도청"},
    {"km":35,"name":"다카오산","description":"수도권 최고 인기 등산로"},
    {"km":60,"name":"후지노미야 트레일헤드","description":"후지산 본격 트레일 시작"},
    {"km":85,"name":"새벽 5합목","description":"고도 2,000m 도달"},
    {"km":100,"name":"5합목 피니시","description":"해발 2,305m"}
  ]'::jsonb,
  course_record = '비공식 약 14시간 (일본 트레일 엘리트 기준)',
  youtube_url = 'https://www.youtube.com/watch?v=SsmvUm8XJ_g'
WHERE name = '도쿄 → 후지산';

-- 만리장성 일부 (50km)
UPDATE public.virtual_courses SET
  story = E'베이징 근교 모티엔위·바다링·시마타이 구간을 잇는 만리장성 50km 트레일. 무너진 옛 성벽과 복원된 구간이 번갈아 나오고, 가파른 계단이 끝없이 이어져요.\n\n매년 5월 ''Great Wall Marathon''이 열리는데, 본 코스는 그보다 길고 험한 트레일 버전. 5,164계단을 오르내리고 누적 고도 1,400m+. 한 번 도전하면 평생 잊지 못해요.',
  landmarks = '[
    {"km":0,"name":"모티엔위","description":"가장 보존 잘된 구간 출발"},
    {"km":15,"name":"바다링","description":"가장 유명한 구간"},
    {"km":30,"name":"진산링","description":"무너진 야성 구간"},
    {"km":50,"name":"시마타이","description":"가장 험한 종착점"}
  ]'::jsonb,
  course_record = 'Great Wall Marathon 4:48 (2019 Christian Holmen 노르웨이)',
  youtube_url = 'https://www.youtube.com/watch?v=GbQjlntfRl4'
WHERE name = '만리장성 일부';

-- 타이베이 101 → 양밍산 (30km)
UPDATE public.virtual_courses SET
  story = E'타이베이 101 마천루에서 출발해 시린·스린 구역을 지나 양밍산 국립공원까지 30km. 도심 → 강 → 온천 → 산악 — 대만의 다양한 면모를 한 번에.\n\n양밍산은 화산 지대 — 김이 모락모락 나는 유황 노천탕이 인근에. 완주 후 온천 휴식이 별미.',
  landmarks = '[
    {"km":0,"name":"타이베이 101","description":"세계 9위 마천루"},
    {"km":10,"name":"시린 야시장","description":"대만 최대 야시장"},
    {"km":20,"name":"양밍산 입구","description":"국립공원 진입"},
    {"km":30,"name":"칠성산","description":"양밍산 최고봉 1,120m"}
  ]'::jsonb
WHERE name = '타이베이 101 → 양밍산';

-- 부산 갈맷길 (50km)
UPDATE public.virtual_courses SET
  story = E'해운대 → 광안리 → 태종대를 잇는 부산 해안 트레일 50km. 갈매기의 길 ''갈맷길''. 9개 구간 중 핵심 1~3 구간만 잇는 정수.\n\n해변과 절벽이 번갈아 나오고, 광안대교의 야경·태종대의 자살바위·송도해상케이블카가 모두 코스 위. 부산을 가장 부산답게 달리는 길.\n\n장거리지만 평탄해 첫 울트라 입문자에게 인기.',
  landmarks = '[
    {"km":0,"name":"해운대 동백섬","description":"누리마루 APEC 하우스"},
    {"km":12,"name":"광안리 해변","description":"광안대교 일출/일몰"},
    {"km":25,"name":"용두산 공원","description":"부산타워"},
    {"km":38,"name":"송도해상케이블카","description":"환상의 해상 트레일"},
    {"km":50,"name":"태종대","description":"부산 최남단 등대"}
  ]'::jsonb,
  course_record = '평균 6~8시간 (러닝 기준)'
WHERE name = '부산 갈맷길';

-- 런던 마라톤 (42.195km)
UPDATE public.virtual_courses SET
  story = E'템스강을 따라 흐르는 평탄 코스. 1981년 첫 대회 이래 매년 4월 런던의 봄을 채우는 축제.\n\n그리니치 공원 출발 → 타워브릿지 → 런던아이 → 빅벤 → 버킹엄궁 결승. 시내 명소를 모두 도장 깨기. 빅 6 (World Marathon Majors) 중 가장 화려한 응원과 코스튬 러너로 유명. 4만 명 이상 참가.\n\n참가 자격: BQ 또는 자선 단체 추첨. 일반 추첨 당첨률 5% 이하라 ''당첨됐다''는 자체가 명예.',
  past_winners = '[
    {"year":2024,"name":"Alexander Mutiso","time":"2:04:01","notes":"케냐"},
    {"year":2023,"name":"Kelvin Kiptum","time":"2:01:25","notes":"케냐 — 코스 기록"},
    {"year":2024,"name":"Peres Jepchirchir","time":"2:16:16","notes":"여자 세계 신 (당시) — 케냐"}
  ]'::jsonb,
  youtube_url = 'https://www.youtube.com/watch?v=2L1JjCEsJOM',
  official_url = 'https://www.tcslondonmarathon.com/',
  course_record = '남자 2:01:25 (2023 Kelvin Kiptum) · 여자 2:16:16 (2024 Peres Jepchirchir)',
  landmarks = '[
    {"km":0,"name":"Greenwich Park","description":"전통의 출발선"},
    {"km":21,"name":"Tower Bridge","description":"명물 다리"},
    {"km":35,"name":"Canary Wharf","description":"런던 동쪽 금융가"},
    {"km":42,"name":"The Mall","description":"버킹엄궁 앞 결승선"}
  ]'::jsonb
WHERE name = '런던 마라톤';

-- 파리 마라톤 (42.195km)
UPDATE public.virtual_courses SET
  story = E'에펠탑·샹젤리제·루브르·노트르담을 모두 지나는 4월의 봄 코스. 1977년 첫 대회 이래 ''세계에서 가장 아름다운 마라톤''으로 불려요.\n\n샹젤리제 출발 → 콩코르드 광장 → 루브르 → 노트르담 → 부아 드 뱅센 (반환) → 부아 드 불로뉴 결승. 5만 명 참가 — 빅 6 다음으로 큰 마라톤.\n\n프랑스 와인의 향과 빵 굽는 냄새가 코스 곳곳에서 — 봄날의 파리 그 자체를 달리는 듯.',
  past_winners = '[
    {"year":2024,"name":"Mulugeta Asefa","time":"2:05:25","notes":"에티오피아"},
    {"year":2023,"name":"Abdi Nageeye","time":"2:04:56","notes":"네덜란드 — 코스 기록"},
    {"year":2024,"name":"Enat Tirusew","time":"2:20:23","notes":"여자 — 에티오피아"}
  ]'::jsonb,
  official_url = 'https://www.schneiderelectricparismarathon.com/',
  course_record = '남자 2:04:56 (2023 Abdi Nageeye) · 여자 2:20:19 (2003 Mizuki Noguchi)',
  landmarks = '[
    {"km":0,"name":"Champs-Élysées","description":"개선문 옆 출발"},
    {"km":8,"name":"Louvre","description":"세계 최대 박물관"},
    {"km":18,"name":"Bois de Vincennes","description":"동쪽 큰 공원"},
    {"km":35,"name":"Eiffel Tower","description":"센강 따라 회복 구간"},
    {"km":42,"name":"Avenue Foch","description":"개선문 서쪽 결승"}
  ]'::jsonb
WHERE name = '파리 마라톤';

-- 암스테르담 마라톤 (42.195km)
UPDATE public.virtual_courses SET
  story = E'운하의 도시 암스테르담을 가로지르는 10월의 평탄 코스. 1975년 시작. 평탄해서 ''유럽 PB의 성지''로 불려요.\n\n올림픽 스타디움 출발 → 보스 공원 → 시내 운하 → 다시 스타디움 결승. 트랙 입장 후 200m 도는 결승 장면이 명물.\n\n약 18,000명 참가 — 유럽 5대 마라톤. 가성비 좋은 PB 코스를 찾는 러너들이 사랑.',
  past_winners = '[
    {"year":2023,"name":"Tsegaye Getachew","time":"2:04:49","notes":"에티오피아"},
    {"year":2022,"name":"Tsegaye Kidanu","time":"2:03:50","notes":"에티오피아 — 코스 기록"}
  ]'::jsonb,
  course_record = '남자 2:03:39 (2018 Lawrence Cherono) · 여자 2:19:01 (2023 Almaz Ayana)',
  landmarks = '[
    {"km":0,"name":"Olympisch Stadion","description":"1928 올림픽 스타디움"},
    {"km":15,"name":"Amstel 강","description":"도시 동쪽 강변"},
    {"km":30,"name":"Vondelpark","description":"시민 휴식 공원"},
    {"km":42,"name":"트랙 결승","description":"트랙 200m 도는 명장면"}
  ]'::jsonb
WHERE name = '암스테르담 마라톤';

-- 뉴욕 마라톤 (42.195km)
UPDATE public.virtual_courses SET
  story = E'뉴욕 5개 자치구를 모두 도는 ''세계 최대 도시 마라톤''. 5만 명 이상 참가. 1976년 매니해튼 외부 확장 이후 ''뉴욕의 마라톤''으로 정착.\n\n스태튼 아일랜드 출발 → Verrazzano-Narrows Bridge (개회식 같은 출발) → 브루클린 → 퀸즈 → 맨해튼 1번가 → 브롱크스 → 센트럴파크 결승. 매 구간이 다른 도시 같음.\n\n참가 자격: BQ + 추첨 (당첨률 약 8%). 가을 단풍 절정인 11월 첫 일요일.',
  past_winners = '[
    {"year":2024,"name":"Abdi Nageeye","time":"2:07:39","notes":"네덜란드"},
    {"year":2023,"name":"Tamirat Tola","time":"2:04:58","notes":"에티오피아 — 코스 기록"},
    {"year":2023,"name":"Hellen Obiri","time":"2:27:23","notes":"여자 — 케냐"}
  ]'::jsonb,
  youtube_url = 'https://www.youtube.com/watch?v=Sl3qSXmwGfA',
  official_url = 'https://www.nyrr.org/tcsnycmarathon',
  course_record = '남자 2:04:58 (2023 Tamirat Tola) · 여자 2:22:31 (2003 Margaret Okayo)',
  landmarks = '[
    {"km":0,"name":"Verrazzano Bridge","description":"스태튼아일랜드 → 브루클린 다리"},
    {"km":13,"name":"브루클린 ","description":"가장 시끄러운 응원 구간"},
    {"km":25,"name":"Queensboro Bridge","description":"맨해튼 진입 — 응원 정적, 발소리만"},
    {"km":33,"name":"1번가","description":"맨해튼 응원 함성"},
    {"km":42,"name":"Central Park","description":"전설의 결승선"}
  ]'::jsonb
WHERE name = '뉴욕 마라톤';

-- 시카고 마라톤 (42.195km)
UPDATE public.virtual_courses SET
  story = E'미시간 호수를 끼고 시카고 도심을 일주하는 10월의 평탄 코스. 1977년 첫 대회 이래 ''세계에서 가장 빠른 마라톤'' 중 하나.\n\n그랜트 파크 출발 → 시카고 강 따라 도심 → 차이나타운 → 그랜트 파크 결승. 평탄·시원·도심·응원 — PB 노리기 완벽.\n\n2018년 키프초게가 세계 신 (2:01:39, 당시) 을 세운 무대. 2024년 루스 첩게티치가 여자 세계 신 (2:09:56) 을 세움.',
  past_winners = '[
    {"year":2024,"name":"Ruth Chepngetich","time":"2:09:56","notes":"여자 세계 신 — 케냐"},
    {"year":2023,"name":"Kelvin Kiptum","time":"2:00:35","notes":"케냐 — 당시 세계 신"},
    {"year":2024,"name":"John Korir","time":"2:02:43","notes":"케냐"}
  ]'::jsonb,
  official_url = 'https://www.chicagomarathon.com/',
  course_record = '남자 2:00:35 (2023 Kelvin Kiptum) · 여자 2:09:56 (2024 Ruth Chepngetich)',
  landmarks = '[
    {"km":0,"name":"Grant Park","description":"미시간 호숫가 출발"},
    {"km":12,"name":"Lincoln Park","description":"북쪽 회복 구간"},
    {"km":25,"name":"West Loop","description":"도심 서쪽"},
    {"km":33,"name":"Chinatown","description":"용춤 응원 명물"},
    {"km":42,"name":"Grant Park","description":"같은 자리 결승"}
  ]'::jsonb
WHERE name = '시카고 마라톤';

-- 시드니 → 본다이 (25km)
UPDATE public.virtual_courses SET
  story = E'시드니 오페라하우스에서 본다이 비치까지 해안 트레일 25km. 호주에서 가장 사랑받는 러닝 코스 중 하나.\n\n오페라하우스 출발 → 하버 브릿지 → 시드니 도심 → 센테니얼 공원 → 본다이까지. 후반은 ''Bondi to Coogee Walk'' 일부 구간을 역방향으로 — 절벽 위 풍경.\n\n매년 9월 ''City2Surf'' 8만명 참가 행사가 비슷한 구간. 본다이 도착 후 바다로 곧장 뛰어드는 게 문화.',
  landmarks = '[
    {"km":0,"name":"Sydney Opera House","description":"세계문화유산 출발"},
    {"km":3,"name":"Harbour Bridge","description":"시드니의 아이콘"},
    {"km":15,"name":"Centennial Park","description":"넓은 시민 공원"},
    {"km":25,"name":"Bondi Beach","description":"호주에서 가장 유명한 해변"}
  ]'::jsonb,
  course_record = 'City2Surf 14km 39:43 (2019 Edward Goddard)'
WHERE name = '시드니 → 본다이';

-- 빅토리아 호수 둘레 (80km)
UPDATE public.virtual_courses SET
  story = E'케냐 ''엘리트 마라토너의 본고장''. 키수무 인근 빅토리아 호수 둘레 80km 트레일.\n\n키프초게·체룰리 같은 세계 정상 러너들이 새벽 5시 호숫가를 달리며 훈련하는 곳. 해발 1,500m, 평균 페이스가 약간 더 빨라지는 ''고지대 효과''로 유명.\n\n실제 케냐 트레이닝 캠프(이텐) 도 이 호수 근처. 도전한다면 80km 풀 둘레가 가장 정통.',
  landmarks = '[
    {"km":0,"name":"키수무","description":"호수 동안 도시"},
    {"km":20,"name":"Hippo Point","description":"하마 무리 출몰"},
    {"km":50,"name":"Mfangano Island 입구","description":"호수 위 섬"},
    {"km":80,"name":"키수무 회귀","description":"완주 → 차이"}
  ]'::jsonb,
  course_record = '비공식 — 케냐 트레이닝 캠프 러너들의 일상 코스'
WHERE name = '빅토리아 호수 둘레';

-- 지구 한 바퀴 (1000km)
UPDATE public.virtual_courses SET
  story = E'꿈의 코스. 누적 1,000km 챌린지. 평균 한 달 30km × 33개월 — 약 1년~3년 장기 도전.\n\n월드런의 다른 코스들을 도전하면서 누적 km 가 1,000km 에 도달하면 자동으로 진행률 채워져요. 끝까지 도전한 사람만이 받을 수 있는 골드 메달.\n\n달리기를 ''일생의 일''로 만든 사람의 길.',
  landmarks = '[
    {"km":0,"name":"시작","description":"여정의 출발"},
    {"km":100,"name":"100km","description":"센추리 첫 돌파"},
    {"km":500,"name":"500km","description":"중간점 도달"},
    {"km":800,"name":"800km","description":"마지막 200km 남은 시점"},
    {"km":1000,"name":"피니시","description":"골드 메달 자격"}
  ]'::jsonb,
  course_record = '평균 1~3년 (꾸준한 러너 기준)'
WHERE name = '지구 한 바퀴';
