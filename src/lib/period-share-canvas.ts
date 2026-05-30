// 주간·월간 공유카드 데이터 타입 (build 195 origin).
// build 209에서 PeriodShareCard가 ShareCard wrapper로 전환되며 자체 canvas draw 코드는 모두 제거됨.
// 이 파일은 PeriodChartData 인터페이스만 export. fetch는 period-share-data.ts, render는 ShareCard.

export interface PeriodChartData {
  period: 'week' | 'month';
  userName: string;
  periodLabel: string;            // "이번 주 (5/19 ~ 5/25)" 또는 "이번 달 (5월)"
  bars: number[];                 // 일별 거리 km (주=7, 월=가변 28~31). build 213: ShareCard 가 monthlyActivities 로 자체 계산 → 사실상 미사용 (호환성 유지).
  barLabels: string[];            // 일별 라벨. build 213: 동일 사유로 사실상 미사용.
  totalKm: number;                // 이번 기간 합계
  prevTotalKm: number;            // 직전 동기간 합계
  totalDurationSec: number;
  avgPaceSec: number | null;
  runs: number;
  rankLine: string | null;        // "8위 · 강남구 50명" 또는 "강남구 50대 남성 이번 주 1위 ✨" 등
  // build 208 #1: 일간 ShareCard 와 동일 폼 — quote + map + region + handle 합쳐 전달.
  quote?: { text: string; author: string } | null;
  routes?: Array<Array<[number, number]>>;  // 기간 내 모든 활동 GPS 경로 ([lng, lat])
  regionLabel?: string | null;
  userHandle?: string | null;
  totalCalories?: number;
  totalDays?: number;
}
