-- 2026-05-14 build 122 — 월드런 대륙 카테고리 + 코스 확장

------------------------------------------------------------
-- (A) virtual_courses.continent 컬럼
------------------------------------------------------------
ALTER TABLE public.virtual_courses
  ADD COLUMN IF NOT EXISTS continent TEXT;

CREATE INDEX IF NOT EXISTS virtual_courses_continent_idx ON public.virtual_courses(continent, sort_order);

-- 기존 5개 코스 continent 채우기
UPDATE public.virtual_courses SET continent = 'asia' WHERE name IN ('도쿄 마라톤', '제주 올레길 1코스', '서울 한강 종주');
UPDATE public.virtual_courses SET continent = 'americas' WHERE name = '보스턴 마라톤';
UPDATE public.virtual_courses SET continent = 'europe' WHERE name = '베를린 마라톤';

------------------------------------------------------------
-- (B) 코스 추가 — 대륙별 (총 12개 신규)
------------------------------------------------------------
INSERT INTO public.virtual_courses (name, distance_km, country, description, continent, sort_order, entry_fee_p) VALUES
  -- 아시아
  ('도쿄 → 후지산', 100.0, '🇯🇵 일본', '도쿄에서 출발해 후지산 5합목까지 100km. 일본 트레일 러너들의 도전 코스.', 'asia', 10, 1500),
  ('만리장성 일부', 50.0, '🇨🇳 중국', '북경 근교 만리장성 50km 트레일 구간. 가파른 계단과 산악.', 'asia', 11, 1500),
  ('타이베이 101 → 양밍산', 30.0, '🇹🇼 대만', '타이베이 도심에서 양밍산 국립공원까지 30km.', 'asia', 12, 1000),
  ('부산 갈맷길', 50.0, '🇰🇷 한국', '부산 해운대·광안리·태종대를 잇는 해안 트레일 50km.', 'asia', 13, 1500),
  -- 유럽
  ('런던 마라톤', 42.195, '🇬🇧 영국', '템스강을 따라 흐르는 평탄 코스. 빅벤·타워브릿지 명소 코스.', 'europe', 20, 1500),
  ('파리 마라톤', 42.195, '🇫🇷 프랑스', '에펠탑·샹젤리제·루브르 광장. 파리의 봄을 달리는 코스.', 'europe', 21, 1500),
  ('암스테르담 마라톤', 42.195, '🇳🇱 네덜란드', '운하의 도시 암스테르담. 평탄해 PB 노리는 러너들이 사랑.', 'europe', 22, 1500),
  -- 미주
  ('뉴욕 마라톤', 42.195, '🇺🇸 미국', '5개 자치구 — 스태튼 아일랜드부터 센트럴파크까지. 베라자노 다리 시작.', 'americas', 30, 1500),
  ('시카고 마라톤', 42.195, '🇺🇸 미국', '미시간 호수를 끼고 도심 일주. 평탄하고 시원한 가을 코스.', 'americas', 31, 1500),
  -- 오세아니아
  ('시드니 → 본다이', 25.0, '🇦🇺 호주', '시드니 오페라하우스에서 본다이 비치까지 25km 해안 코스.', 'oceania', 40, 1000),
  -- 아프리카
  ('빅토리아 호수 둘레', 80.0, '🇰🇪 케냐', '엘리트 마라토너의 본고장 케냐. 빅토리아 호수 둘레 80km 챌린지.', 'africa', 50, 1500),
  -- 환상의 코스
  ('지구 한 바퀴', 1000.0, '🌍 세계', '꿈의 코스. 누적 1,000km — 6개월~1년 장기 챌린지. 완주 시 골드 메달.', 'global', 99, 1500)
ON CONFLICT (name) DO NOTHING;
