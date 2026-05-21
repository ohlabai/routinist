-- build 160 #1: watch?v= 영상 ID 7개가 모두 oEmbed 404 (실제 존재하지 않거나 삭제됨).
-- "이 동영상은 볼 수 없습니다" 토스트 원인. 검색 결과 페이지 URL 로 일괄 전환 — 항상 작동.
UPDATE public.virtual_courses
SET youtube_url = CASE id
  WHEN 'b0bd0bbe-3d8a-47c7-83c2-7dc5a5f0bd84' THEN 'https://www.youtube.com/results?search_query=Boston+Marathon+course'
  WHEN '3771fb5d-b016-4f7f-aadf-210989bc4f54' THEN 'https://www.youtube.com/results?search_query=Tokyo+Marathon+course'
  WHEN 'f52edd10-80ed-431e-9367-fc73d8d7aaf7' THEN 'https://www.youtube.com/results?search_query=Berlin+Marathon+course'
  WHEN 'bea0d4f9-1ce1-420a-8157-e6999315b42b' THEN 'https://www.youtube.com/results?search_query=Tokyo+Mount+Fuji+running'
  WHEN 'a921fbd8-8c16-4811-a396-ba1dddc76811' THEN 'https://www.youtube.com/results?search_query=Great+Wall+China+running'
  WHEN '978203aa-0a97-417d-b639-188b5512a1a0' THEN 'https://www.youtube.com/results?search_query=London+Marathon+course'
  WHEN '81ec16e2-11b5-4045-a0c8-e4f758f110c1' THEN 'https://www.youtube.com/results?search_query=New+York+Marathon+course'
END
WHERE id IN (
  'b0bd0bbe-3d8a-47c7-83c2-7dc5a5f0bd84',
  '3771fb5d-b016-4f7f-aadf-210989bc4f54',
  'f52edd10-80ed-431e-9367-fc73d8d7aaf7',
  'bea0d4f9-1ce1-420a-8157-e6999315b42b',
  'a921fbd8-8c16-4811-a396-ba1dddc76811',
  '978203aa-0a97-417d-b639-188b5512a1a0',
  '81ec16e2-11b5-4045-a0c8-e4f758f110c1'
);
