import { NavLink, useNavigate } from 'react-router-dom';
import { useStaging } from '../hooks/useStaging';
import { useAuth } from '../context/AuthContext';

function NavItem({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
    >
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span
          style={{
            marginLeft: 'auto',
            background: '#dc3545',
            color: '#fff',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: stagingItems } = useStaging();
  const pendingCount = stagingItems?.length ?? 0;
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-layout">
      <nav className="app-nav">
        <div className="nav-brand">
          <h1>General Ledger</h1>
          <small>GL MVP — Single Tenant</small>
        </div>

        <div className="nav-section-label">Overview</div>
        <NavItem to="/" icon="📊" label="Dashboard" />

        <div className="nav-section-label">Ledger</div>
        <NavItem to="/journal" icon="📖" label="Journal" />
        <NavItem to="/accounts" icon="🗂" label="Chart of Accounts" />
        <NavItem to="/trial-balance" icon="⚖️" label="Trial Balance" />

        <div className="nav-section-label">Workflow</div>
        <NavItem
          to="/approvals"
          icon="✅"
          label="Approval Queue"
          badge={pendingCount}
        />

        <div className="nav-section-label">Admin</div>
        <NavItem to="/periods" icon="📅" label="Periods" />

        <div style={{ flex: 1 }} />

        {/* Logged-in user + logout */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {user && (
            <div style={{
              fontSize: 11,
              color: '#6c757d',
              marginBottom: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {user.display_name || user.email}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-ghost"
              style={{ flex: 1, fontSize: 11, color: '#6c757d' }}
              onClick={() => navigate(0)}
            >
              ↺ Refresh
            </button>
            <button
              className="btn btn-ghost"
              style={{ flex: 1, fontSize: 11, color: '#6c757d' }}
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="app-main">{children}</main>
    </div>
  );
}
