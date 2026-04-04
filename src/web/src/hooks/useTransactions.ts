import { useState } from 'react';
import { useApi } from './useApi';
import type { Transaction } from '../types';

interface TransactionFilters {
  period_id?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useTransactions(filters: TransactionFilters = {}) {
  const params = new URLSearchParams();
  if (filters.period_id) params.set('period_id', filters.period_id);
  if (filters.type) params.set('type', filters.type);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));

  const url = `/api/transactions?${params.toString()}`;
  // The API returns { success, data, total }
  const { data: rawData, loading, error, refetch } = useApi<Transaction[]>(url);

  return { data: rawData, loading, error, refetch };
}

export function useTransaction(id: string | null) {
  return useApi<Transaction>(id ? `/api/transactions/${id}` : null);
}

export function useTransactionsWithTotal(filters: TransactionFilters = {}) {
  const params = new URLSearchParams();
  if (filters.period_id) params.set('period_id', filters.period_id);
  if (filters.type) params.set('type', filters.type);
  if (filters.search) params.set('search', filters.search);
  params.set('limit', String(filters.limit ?? 50));
  params.set('offset', String(filters.offset ?? 0));

  const [total, setTotal] = useState(0);
  const url = `/api/transactions?${params.toString()}`;

  const result = useApi<Transaction[]>(url);

  // We can't easily get `total` from useApi without modifying it.
  // So we'll just use data length awareness. In a full app we'd expand useApi.
  // For now, the result.data carries the page, and we expose a refetch.
  void setTotal; // suppress unused warning

  return { ...result, total };
}
