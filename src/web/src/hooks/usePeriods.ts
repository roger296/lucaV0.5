import { useApi } from './useApi';
import type { Period, PeriodDetail } from '../types';

export function usePeriods() {
  return useApi<Period[]>('/api/periods');
}

export function useCurrentPeriod() {
  return useApi<Period>('/api/periods/current');
}

export function usePeriod(id: string | null) {
  return useApi<PeriodDetail>(id ? `/api/periods/${id}` : null);
}
