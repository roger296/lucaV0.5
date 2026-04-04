import { useApi } from './useApi';
import type { DashboardData } from '../types';

export function useDashboard() {
  return useApi<DashboardData>('/api/reports/dashboard');
}
