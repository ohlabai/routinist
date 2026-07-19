import { registerPlugin } from '@capacitor/core';

interface WorkoutRouteData {
  startDate: string;
  endDate: string;
  distance: number; // meters
  duration: number; // seconds
  // build 151: timestamp 4번째 슬롯 (unix seconds) — MP4 페이스 매핑용. 옛 route 는 3-tuple.
  coordinates: ([number, number, number] | [number, number, number, number])[];
  /** 작성 앱 bundle id (iOS) / package (Android). 제3자 앱 라우트의 거리 보정 차단 근거.
   *  구버전 네이티브 빌드엔 없음 (undefined). */
  sourceId?: string;
}

interface GetRoutesResult {
  routes: WorkoutRouteData[];
  // native plugin 50s safety timeout 이 발사되면 partial=true. JS 측에서 인지해 좁은 chunk 로 재시도해야 함.
  partial?: boolean;
  reason?: string;
}

interface WorkoutRoutePlugin {
  requestAuthorization(): Promise<{ success: boolean }>;
  getRoutes(options: {
    startDate: string;
    endDate: string;
    limit?: number;
  }): Promise<GetRoutesResult>;
}

const WorkoutRoute = registerPlugin<WorkoutRoutePlugin>('WorkoutRoute');

export { WorkoutRoute, type WorkoutRouteData };
