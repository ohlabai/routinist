// UGC 금칙어 필터 (Apple Guideline 1.2 — "A method for filtering objectionable content").
// 사용처: 닉네임·댓글·명언·쪽지·클럽 이름/설명 등 텍스트 UGC 입력 전 검사.
//
// 설계 원칙:
//  - 클라이언트 1차 차단 (즉시 피드백) — 서버 RLS/RPC 검증을 대체하지 않는다.
//  - 과차단 주의: 한글은 부분 문자열 매칭이 위험 ("시발점", "개발" 등) — 단어별로
//    조사/어미가 붙어도 안전한 것만 부분 매칭, 나머지는 우회문자 제거 후 매칭.
//  - 목록은 보수적으로 시작 — 신고(content_reports) 로 들어오는 실사례를 보고 확장.

const SEPARATOR_RE = /[\s\-_.,!?~^*+#@'"()\[\]{}|\\/;:<>=&%$0-9]+/g;

// 우회 입력 정규화: 공백/특수문자 제거 + 소문자화. "시 발" → "시발", "f.u.c.k" → "fuck"
function normalize(text: string): string {
  return text.toLowerCase().replace(SEPARATOR_RE, '');
}

// 부분 매칭해도 오차단이 거의 없는 강한 금칙어 (욕설·성적·혐오).
// 주의: "발기", "자지" 류는 정상 단어와 겹칠 수 있어 제외하거나 신중히.
const BANNED_SUBSTRINGS = [
  // 한국어 욕설
  '시발', '씨발', 'ㅅㅂ', 'ㅆㅂ', '씨빨', '시빨', '씨팔', '시팔', 'tlqkf',
  '개새끼', '개세끼', '개색기', '개색끼', 'ㄱㅅㄲ', '새끼야',
  '병신', 'ㅂㅅ', '븅신', '빙신',
  '지랄', 'ㅈㄹ', '좆', '존나', 'ㅈㄴ', 'niga',
  '느금마', '니애미', '니어미', '느그애미', '엠창',
  '걸레년', '창녀', '창놈', '갈보',
  // 성적
  '보지', '자위', '섹스', 'sex', '야동', '딸딸이', '오르가즘', '포르노', 'porn',
  '유두', '클리토리스', '사정했', '삽입해',
  // 혐오
  '틀딱', '한남충', '김치녀', '메갈', '일베충', '급식충', '똥꼬충',
  '흑형', '깜둥이', '짱깨', '쪽바리', '조센징',
  // 영어 (경계 무시해도 오차단 낮은 것)
  'fuck', 'shit', 'bitch', 'asshole', 'nigger', 'nigga', 'faggot', 'retard',
  'motherfucker', 'cunt', 'whore', 'dick', 'blowjob', 'handjob', 'cumshot',
];

/** 불쾌 콘텐츠 여부. true = 게시/저장 차단 대상. */
export function containsObjectionable(text: string): boolean {
  if (!text) return false;
  const n = normalize(text);
  return BANNED_SUBSTRINGS.some(w => n.includes(w));
}

/**
 * 입력 검증 헬퍼 — 통과 시 null, 차단 시 사용자 노출용 메시지.
 * 어떤 단어에 걸렸는지는 알려주지 않는다 (우회 학습 방지).
 */
export function moderationError(text: string, locale: 'ko' | 'en' = 'ko'): string | null {
  if (!containsObjectionable(text)) return null;
  return locale === 'en'
    ? 'This text contains words that are not allowed.'
    : '사용할 수 없는 단어가 포함되어 있어요.';
}
