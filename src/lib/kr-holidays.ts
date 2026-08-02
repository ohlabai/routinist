// 한국 공휴일 오프라인 테이블 (2024~2030) — 네이버 달력 스타일 표시용.
// 음력 명절(설·추석·부처님오신날)은 해마다 양력 날짜가 달라 계산 대신 정적 테이블 사용
// (region-gps lookup 과 같은 원칙: 오프라인 + 미리 채워두기).
// 대체공휴일 룰(2023 확대 기준): 삼일절·광복절·개천절·한글날·어린이날·부처님오신날·성탄절은
// 토/일 겹침 시, 설·추석 연휴는 일요일 겹침 시 다음 평일. 신정·현충일은 대체 없음.
// ⚠️ 2031년 이후 달을 열면 공휴일 미표시 (주말 색상만 적용) — 연말에 다음 해 데이터 추가.

export type KrHoliday = { name: string; nameEn: string };

// [date, ko, en]
const RAW: [string, string, string][] = [
  // ===== 2024 =====
  ['2024-01-01', '신정', "New Year's Day"],
  ['2024-02-09', '설날 연휴', 'Seollal Holiday'],
  ['2024-02-10', '설날', 'Seollal'],
  ['2024-02-11', '설날 연휴', 'Seollal Holiday'],
  ['2024-02-12', '대체휴일', 'Substitute'],
  ['2024-03-01', '삼일절', 'Independence Movement Day'],
  ['2024-04-10', '선거일', 'Election Day'],
  ['2024-05-05', '어린이날', "Children's Day"],
  ['2024-05-06', '대체휴일', 'Substitute'],
  ['2024-05-15', '부처님오신날', "Buddha's Birthday"],
  ['2024-06-06', '현충일', 'Memorial Day'],
  ['2024-08-15', '광복절', 'Liberation Day'],
  ['2024-09-16', '추석 연휴', 'Chuseok Holiday'],
  ['2024-09-17', '추석', 'Chuseok'],
  ['2024-09-18', '추석 연휴', 'Chuseok Holiday'],
  ['2024-10-01', '국군의 날', 'Armed Forces Day'],
  ['2024-10-03', '개천절', 'National Foundation Day'],
  ['2024-10-09', '한글날', 'Hangul Day'],
  ['2024-12-25', '성탄절', 'Christmas Day'],
  // ===== 2025 =====
  ['2025-01-01', '신정', "New Year's Day"],
  ['2025-01-27', '임시공휴일', 'Temporary Holiday'],
  ['2025-01-28', '설날 연휴', 'Seollal Holiday'],
  ['2025-01-29', '설날', 'Seollal'],
  ['2025-01-30', '설날 연휴', 'Seollal Holiday'],
  ['2025-03-01', '삼일절', 'Independence Movement Day'],
  ['2025-03-03', '대체휴일', 'Substitute'],
  ['2025-05-05', '어린이날', "Children's Day"], // 부처님오신날과 겹침
  ['2025-05-06', '대체휴일', 'Substitute'],
  ['2025-06-03', '선거일', 'Election Day'],
  ['2025-06-06', '현충일', 'Memorial Day'],
  ['2025-08-15', '광복절', 'Liberation Day'],
  ['2025-10-03', '개천절', 'National Foundation Day'],
  ['2025-10-05', '추석 연휴', 'Chuseok Holiday'],
  ['2025-10-06', '추석', 'Chuseok'],
  ['2025-10-07', '추석 연휴', 'Chuseok Holiday'],
  ['2025-10-08', '대체휴일', 'Substitute'],
  ['2025-10-09', '한글날', 'Hangul Day'],
  ['2025-12-25', '성탄절', 'Christmas Day'],
  // ===== 2026 =====
  ['2026-01-01', '신정', "New Year's Day"],
  ['2026-02-16', '설날 연휴', 'Seollal Holiday'],
  ['2026-02-17', '설날', 'Seollal'],
  ['2026-02-18', '설날 연휴', 'Seollal Holiday'],
  ['2026-03-01', '삼일절', 'Independence Movement Day'],
  ['2026-03-02', '대체휴일', 'Substitute'],
  ['2026-05-05', '어린이날', "Children's Day"],
  ['2026-05-24', '부처님오신날', "Buddha's Birthday"],
  ['2026-05-25', '대체휴일', 'Substitute'],
  ['2026-06-03', '지방선거', 'Election Day'],
  ['2026-06-06', '현충일', 'Memorial Day'],
  ['2026-08-15', '광복절', 'Liberation Day'],
  ['2026-08-17', '대체휴일', 'Substitute'],
  ['2026-09-24', '추석 연휴', 'Chuseok Holiday'],
  ['2026-09-25', '추석', 'Chuseok'],
  ['2026-09-26', '추석 연휴', 'Chuseok Holiday'],
  ['2026-10-03', '개천절', 'National Foundation Day'],
  ['2026-10-05', '대체휴일', 'Substitute'],
  ['2026-10-09', '한글날', 'Hangul Day'],
  ['2026-12-25', '성탄절', 'Christmas Day'],
  // ===== 2027 =====
  ['2027-01-01', '신정', "New Year's Day"],
  ['2027-02-05', '설날 연휴', 'Seollal Holiday'],
  ['2027-02-06', '설날', 'Seollal'],
  ['2027-02-07', '설날 연휴', 'Seollal Holiday'],
  ['2027-02-08', '대체휴일', 'Substitute'],
  ['2027-03-01', '삼일절', 'Independence Movement Day'],
  ['2027-05-05', '어린이날', "Children's Day"],
  ['2027-05-13', '부처님오신날', "Buddha's Birthday"],
  ['2027-06-06', '현충일', 'Memorial Day'],
  ['2027-08-15', '광복절', 'Liberation Day'],
  ['2027-08-16', '대체휴일', 'Substitute'],
  ['2027-09-14', '추석 연휴', 'Chuseok Holiday'],
  ['2027-09-15', '추석', 'Chuseok'],
  ['2027-09-16', '추석 연휴', 'Chuseok Holiday'],
  ['2027-10-03', '개천절', 'National Foundation Day'],
  ['2027-10-04', '대체휴일', 'Substitute'],
  ['2027-10-09', '한글날', 'Hangul Day'],
  ['2027-10-11', '대체휴일', 'Substitute'],
  ['2027-12-25', '성탄절', 'Christmas Day'],
  ['2027-12-27', '대체휴일', 'Substitute'],
  // ===== 2028 =====
  ['2028-01-01', '신정', "New Year's Day"],
  ['2028-01-25', '설날 연휴', 'Seollal Holiday'],
  ['2028-01-26', '설날', 'Seollal'],
  ['2028-01-27', '설날 연휴', 'Seollal Holiday'],
  ['2028-03-01', '삼일절', 'Independence Movement Day'],
  ['2028-04-12', '선거일', 'Election Day'],
  ['2028-05-02', '부처님오신날', "Buddha's Birthday"],
  ['2028-05-05', '어린이날', "Children's Day"],
  ['2028-06-06', '현충일', 'Memorial Day'],
  ['2028-08-15', '광복절', 'Liberation Day'],
  ['2028-10-02', '추석 연휴', 'Chuseok Holiday'],
  ['2028-10-03', '추석·개천절', 'Chuseok'],
  ['2028-10-04', '추석 연휴', 'Chuseok Holiday'],
  ['2028-10-05', '대체휴일', 'Substitute'], // 개천절이 추석과 겹침
  ['2028-10-09', '한글날', 'Hangul Day'],
  ['2028-12-25', '성탄절', 'Christmas Day'],
  // ===== 2029 =====
  ['2029-01-01', '신정', "New Year's Day"],
  ['2029-02-12', '설날 연휴', 'Seollal Holiday'],
  ['2029-02-13', '설날', 'Seollal'],
  ['2029-02-14', '설날 연휴', 'Seollal Holiday'],
  ['2029-03-01', '삼일절', 'Independence Movement Day'],
  ['2029-05-05', '어린이날', "Children's Day"],
  ['2029-05-07', '대체휴일', 'Substitute'],
  ['2029-05-20', '부처님오신날', "Buddha's Birthday"],
  ['2029-05-21', '대체휴일', 'Substitute'],
  ['2029-06-06', '현충일', 'Memorial Day'],
  ['2029-08-15', '광복절', 'Liberation Day'],
  ['2029-09-21', '추석 연휴', 'Chuseok Holiday'],
  ['2029-09-22', '추석', 'Chuseok'],
  ['2029-09-23', '추석 연휴', 'Chuseok Holiday'],
  ['2029-09-24', '대체휴일', 'Substitute'],
  ['2029-10-03', '개천절', 'National Foundation Day'],
  ['2029-10-09', '한글날', 'Hangul Day'],
  ['2029-12-25', '성탄절', 'Christmas Day'],
  // ===== 2030 =====
  ['2030-01-01', '신정', "New Year's Day"],
  ['2030-02-02', '설날 연휴', 'Seollal Holiday'],
  ['2030-02-03', '설날', 'Seollal'],
  ['2030-02-04', '설날 연휴', 'Seollal Holiday'],
  ['2030-02-05', '대체휴일', 'Substitute'],
  ['2030-03-01', '삼일절', 'Independence Movement Day'],
  ['2030-05-05', '어린이날', "Children's Day"],
  ['2030-05-06', '대체휴일', 'Substitute'],
  ['2030-05-09', '부처님오신날', "Buddha's Birthday"],
  ['2030-06-06', '현충일', 'Memorial Day'],
  ['2030-08-15', '광복절', 'Liberation Day'],
  ['2030-09-11', '추석 연휴', 'Chuseok Holiday'],
  ['2030-09-12', '추석', 'Chuseok'],
  ['2030-09-13', '추석 연휴', 'Chuseok Holiday'],
  ['2030-10-03', '개천절', 'National Foundation Day'],
  ['2030-10-09', '한글날', 'Hangul Day'],
  ['2030-12-25', '성탄절', 'Christmas Day'],
];

let map: Map<string, KrHoliday> | null = null;
function getMap(): Map<string, KrHoliday> {
  if (!map) {
    map = new Map();
    for (const [date, name, nameEn] of RAW) map.set(date, { name, nameEn });
  }
  return map;
}

/** 'YYYY-MM-DD' → 공휴일 정보 (없으면 null) */
export function krHoliday(dateStr: string): KrHoliday | null {
  return getMap().get(dateStr) ?? null;
}

/**
 * 달력 셀 날짜 숫자 색 — 네이버 달력 룰: 일요일·공휴일 빨강, 토요일 파랑.
 * @param dayOfWeek 0(일)~6(토)
 * @returns Tailwind 클래스 ('' = 기본색 유지)
 */
export function calendarDayColor(dateStr: string, dayOfWeek: number): string {
  if (dayOfWeek === 0 || krHoliday(dateStr)) return 'text-red-500 dark:text-red-400';
  if (dayOfWeek === 6) return 'text-blue-500 dark:text-blue-400';
  return '';
}
