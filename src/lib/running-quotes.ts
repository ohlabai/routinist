// 매일 바뀌는 러닝 명언. 지도 탭 + 공유 카드 등 여러 곳에서 같은 명언 사용.

export const RUNNING_QUOTES = [
  '달리는 것은 나 자신과의 약속이다',
  '어제보다 한 걸음 더, 그것이 성장이다',
  '느려도 괜찮아, 멈추지만 않으면 돼',
  '달릴 때 가장 솔직한 나를 만난다',
  '매일 달리는 사람은 매일 이기는 사람이다',
  '시작이 반이다, 오늘도 신발 끈을 묶자',
  '땀은 노력의 증거, 기록은 성장의 증거',
  '같은 길도 매번 다른 이야기가 된다',
  '달리기는 가장 정직한 운동이다',
  '오늘 뛴 거리가 내일의 자신감이 된다',
  '바람을 가르며 달리는 순간, 모든 고민은 사라진다',
  '달리기는 혼자 하지만, 결코 외롭지 않다',
  '1km든 10km든, 달린 사람이 이기는 거야',
  '꾸준함이 재능을 이긴다',
  '내가 달리는 이유는 어제의 나를 넘기 위해서',
  '러닝은 명상이다, 발로 하는 명상',
  '오늘 달리지 않으면, 내일 후회한다',
  '같은 코스를 달려도 매번 새로운 기록이 된다',
  '달리기를 멈추면 시간도 멈춘다',
  '한 발짝씩, 그렇게 멀리 간다',
];

/**
 * 오늘의 명언 — date 기준 deterministic. 같은 날엔 같은 문장.
 * 활동 날짜 기반으로 호출하면 그 날 공유 카드에 어울리는 명언.
 */
export function getDailyQuote(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return RUNNING_QUOTES[Math.abs(dayOfYear) % RUNNING_QUOTES.length];
}
