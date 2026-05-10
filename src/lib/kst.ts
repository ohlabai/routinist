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
// `Date.now() - n*86400000` 는 UTC 평탄이라 DST 환경에서 23시간 = "n-1일 전" 자정 직전으로 떨어져
// 1일 오차 가능. local 자정 기반 setDate 로 DST 자동 처리.
export function daysAgoStr(n: number): string {
  // 오늘의 local 자정을 시스템 timezone 으로 만든 후 setDate 로 n 일 빼기.
  const todayYmd = toLocalDateStr(new Date());
  const [y, m, d] = todayYmd.split('-').map(Number);
  const target = new Date(y, m - 1, d - n);
  return toLocalDateStr(target);
}

// 주어진 Date 의 사용자 timezone 기준 YYYY-MM (월 prefix).
export function toLocalMonthStr(d: Date = new Date()): string {
  return toLocalDateStr(d).slice(0, 7);
}

// 주어진 Date 의 사용자 timezone 기준 그 주 월요일 YYYY-MM-DD.
// 사용자가 KST 21시에 일요일 → 월요일로 넘어가는 시점을 정확히 처리.
// `new Date(toLocaleString('en-US'))` 비표준 파싱 대신 formatToParts 로 견고하게.
export function startOfWeekStr(d: Date = new Date()): string {
  const tz = getUserTimezone();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday'); // 'Mon'/'Tue'/.../'Sun'
  // weekday → 월요일까지 빼야 할 일수
  const offsetMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const offset = offsetMap[weekday] ?? 0;
  const y = Number(get('year'));
  const m = Number(get('month'));
  const day = Number(get('day'));
  // 시스템 timezone 자정 기반. setDate 가 DST 자동 처리.
  const monday = new Date(y, m - 1, day - offset);
  return toLocalDateStr(monday);
}
