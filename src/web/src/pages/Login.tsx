import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// Login page — shown to unauthenticated users
// ---------------------------------------------------------------------------

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // After login, redirect to the page the user originally tried to visit (or /)
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#1a1d23',
    }}>
      <div style={{
        background: '#23272f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {/* Logo / brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📒</div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>
            Luca General Ledger
          </h1>
          <p style={{ color: '#6c757d', fontSize: 13, marginTop: 4 }}>
            Sign in to continue
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220,53,69,0.15)',
            border: '1px solid rgba(220,53,69,0.4)',
            borderRadius: 6,
            padding: '10px 14px',
            color: '#ff6b7a',
            fontSize: 13,
            marginBottom: 20,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', color: '#adb5bd', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              placeholder="you@yourcompany.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1a1d23',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#fff',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', color: '#adb5bd', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1a1d23',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#fff',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '11px',
              background: submitting ? '#495057' : '#0d6efd',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
