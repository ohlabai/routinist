import { registerPlugin } from '@capacitor/core';

interface WorkoutRouteData {
  startDate: string;
  endDate: string;
  distance: number; // meters
  duration: number; // seconds
  coordinates: [number, number, number][]; // [lng, lat, elevation]
}

interface GetRoutesResult {
  routes: WorkoutRouteData[];
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
