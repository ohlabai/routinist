// 폰 timezone 기준 YYYY-MM-DD 변환.
// `.toISOString().split('T')[0]` 또는 `.toISOString().slice(0, 10)` 은 UTC 라 KST 새벽에 어제로 표시되는 버그.
// 사용자가 출장으로 다른 timezone 에 있으면 자동 반영 (Asia/Seoul 하드코딩 X).
//
// reference_timezone_handling.md 룰: `.split('T')[0]` 절대 금지.

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

// 주어진 Date 를 사용자 timezone 의 YYYY-MM-DD 로 반환.
export function toLocalDateStr(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: getUserTimezone(),
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch {
    // Intl 미지원 폴백 — UTC+9 (한국 사용자 다수 가정)
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
}

// 오늘 (사용자 timezone). 매번 호출 시 현재 시각 기준.
export function todayStr(): string {
  return toLocalDateStr(new Date());
}

// n 일 전 날짜 (사용자 timezone). n=1 이면 어제, n=60 이면 60일 전.
export function daysAgoStr(n: number): string {
  return toLocalDateStr(new Date(Date.now() - n * 86400000));
}

// 주어진 Date 의 사용자 timezone 기준 YYYY-MM (월 prefix).
export function toLocalMonthStr(d: Date = new Date()): string {
  return toLocalDateStr(d).slice(0, 7);
}

// 주어진 Date 의 사용자 timezone 기준 그 주 월요일 YYYY-MM-DD.
// 사용자가 KST 21시에 일요일 → 월요일로 넘어가는 시점을 정확히 처리.
export function startOfWeekStr(d: Date = new Date()): string {
  // 로컬 timezone 의 요일을 알기 위해 toLocaleString 사용.
  const tz = getUserTimezone();
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const day = local.getDay(); // 0=일 ~ 6=토
  const diff = day === 0 ? 6 : day - 1; // 월요일이 시작
  const monday = new Date(local);
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return toLocalDateStr(monday);
}
