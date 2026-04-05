import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// ProtectedRoute — redirects unauthenticated users to /login
// ---------------------------------------------------------------------------

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const location = useLocation();

  // While checking the stored token against /api/auth/me, show nothing (avoids flash)
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#1a1d23',
        color: '#6c757d',
        fontSize: 14,
      }}>
        Loading…
      </div>
    );
  }

  if (!token) {
    // Pass the current path so Login can redirect back after a successful sign-in
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
