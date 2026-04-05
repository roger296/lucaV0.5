import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'luca_token';
const USER_KEY = 'luca_user';

// ---------------------------------------------------------------------------
// Helpers — read/write localStorage safely
// ---------------------------------------------------------------------------

function readStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}

function storeSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);
  const [loading, setLoading] = useState(true);

  // On mount: validate the stored token is still good by calling /api/auth/me
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      setLoading(false);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          clearSession();
          setToken(null);
          setUser(null);
          return;
        }
        const json = await res.json() as { success: boolean; data: AuthUser };
        if (json.success) {
          setToken(stored);
          setUser(json.data);
          localStorage.setItem(USER_KEY, JSON.stringify(json.data));
        } else {
          clearSession();
          setToken(null);
          setUser(null);
        }
      })
      .catch(() => {
        // Network error — keep stored session so the UI isn't broken offline,
        // the next real API call will get a 401 and trigger logout.
      })
      .finally(() => setLoading(false));
  }, []);

  // Listen for 401 events dispatched by useApi when any API call fails auth
  useEffect(() => {
    const handleUnauthorized = () => {
      clearSession();
      setToken(null);
      setUser(null);
    };
    window.addEventListener('luca:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('luca:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json() as {
      success: boolean;
      data?: { token: string; user: AuthUser; expires_at: string };
      error?: { code: string; message: string };
    };

    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error?.message ?? 'Login failed');
    }

    storeSession(json.data.token, json.data.user);
    setToken(json.data.token);
    setUser(json.data.user);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
