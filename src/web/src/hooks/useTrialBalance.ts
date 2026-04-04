import { useApi } from './useApi';
import type { TrialBalanceLine, Period } from '../types';

interface TrialBalanceData {
  period: Period | null;
  lines: TrialBalanceLine[];
  total_debits: string;
  total_credits: string;
  balanced: boolean;
}

export function useTrialBalance(periodId?: string) {
  const url = periodId
    ? `/api/reports/trial-balance?period_id=${periodId}`
    : '/api/reports/trial-balance';
  return useApi<TrialBalanceData>(url);
}
