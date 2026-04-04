import { useApi } from './useApi';
import type { StagingEntry } from '../types';

export function useStaging(status = 'PENDING', periodId?: string) {
  const params = new URLSearchParams({ status });
  if (periodId) params.set('period_id', periodId);
  return useApi<StagingEntry[]>(`/api/staging?${params.toString()}`);
}
