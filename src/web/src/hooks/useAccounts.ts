import { useApi } from './useApi';
import type { Account } from '../types';

export function useAccounts(periodId?: string) {
  const url = periodId ? `/api/accounts?period_id=${periodId}` : '/api/accounts';
  return useApi<Account[]>(url);
}

export function useAccount(code: string | null) {
  return useApi<Account>(code ? `/api/accounts/${code}` : null);
}
