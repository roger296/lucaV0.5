import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Token helpers — read from localStorage; the AuthContext writes here
// ---------------------------------------------------------------------------

function getToken(): string | null {
  try { return localStorage.getItem('luca_token'); } catch { return null; }
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return token
    ? { Authorization: `Bearer ${token}`, ...extra }
    : { ...extra };
}

/** Dispatch a global event so AuthContext can clear the session and redirect. */
function dispatchUnauthorized() {
  window.dispatchEvent(new Event('luca:unauthorized'));
}

// ---------------------------------------------------------------------------
// useApi — generic fetch hook (GET / auto-refresh)
// ---------------------------------------------------------------------------

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(url: string | null, options?: RequestInit): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetch(url, {
      ...options,
      headers: authHeaders(options?.headers),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          dispatchUnauthorized();
          throw new Error('Authentication required');
        }
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message ?? `HTTP ${res.status}`);
        }
        setData(json.data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);

  return { data, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// apiPost — authenticated POST helper
// ---------------------------------------------------------------------------

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    dispatchUnauthorized();
    throw new Error('Authentication required');
  }
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// apiPut — authenticated PUT helper
// ---------------------------------------------------------------------------

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    dispatchUnauthorized();
    throw new Error('Authentication required');
  }
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// apiDelete — authenticated DELETE helper
// ---------------------------------------------------------------------------

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) {
    dispatchUnauthorized();
    throw new Error('Authentication required');
  }
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}
