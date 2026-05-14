-- 2026-05-15 build 137 — 월드런 코스 YouTube 영상 누락 fix (사용자 피드백 #3-1).
-- 5개 코스가 youtube_url NULL: 사용자가 "월드런 동영상이 안 나옴" 보고.
-- 정확한 공식 영상 ID 가 빠르게 검증 불가하므로 일관성 있게 YouTube 검색 URL 로 채움.
-- CourseDetailSheet 는 youtube_url 을 외부 링크로 열기만 함 (iframe 아님) — 검색 URL 도 호환.

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=%EC%A0%9C%EC%A3%BC+%EC%98%AC%EB%A0%88%EA%B8%B8+1%EC%BD%94%EC%8A%A4'
 WHERE name = '제주 올레길 1코스' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=%EC%84%9C%EC%9A%B8+%ED%95%9C%EA%B0%95+%EC%9E%90%EC%A0%84%EA%B1%B0%EA%B8%B8+%EB%9F%AC%EB%8B%9D'
 WHERE name = '서울 한강 종주' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=Taipei+101+Yangmingshan+running'
 WHERE name = '타이베이 101 → 양밍산' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=%EB%B6%80%EC%82%B0+%EA%B0%88%EB%A7%9F%EA%B8%B8'
 WHERE name = '부산 갈맷길' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=Paris+Marathon+course'
 WHERE name = '파리 마라톤' AND youtube_url IS NULL;

-- 나머지 5개 코스도 일관성 차원에서 같이 채움.
UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=Amsterdam+Marathon'
 WHERE name = '암스테르담 마라톤' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=Chicago+Marathon+course'
 WHERE name = '시카고 마라톤' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=Sydney+to+Bondi+running'
 WHERE name = '시드니 → 본다이' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=Lake+Victoria+running+africa'
 WHERE name = '빅토리아 호수 둘레' AND youtube_url IS NULL;

UPDATE public.virtual_courses
   SET youtube_url = 'https://www.youtube.com/results?search_query=around+the+world+running+documentary'
 WHERE name = '지구 한 바퀴' AND youtube_url IS NULL;
