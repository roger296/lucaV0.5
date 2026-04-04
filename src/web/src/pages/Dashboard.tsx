import { Link } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { PeriodStatusBadge, TxTypeBadge } from '../components/StatusBadge';

function fmt(val: string | number | undefined | null): string {
  if (val == null) return '—';
  const n = parseFloat(String(val));
  return isNaN(n) ? String(val) : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Dashboard() {
  const { data, loading, error } = useDashboard();

  if (loading) return <div className="loading">Loading dashboard…</div>;
  if (error) return <div className="alert alert-error">Error: {error}</div>;
  if (!data) return null;

  const { current_period: period, pending_approval_count, recent_transactions, trial_balance_summary, transaction_counts } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">General Ledger overview</div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-4 mb-24">
        <div className="card stat-card">
          <div className="stat-label">Current Period</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {period ? period.period_id : '—'}
          </div>
          {period && (
            <div style={{ marginTop: 6 }}>
              <PeriodStatusBadge status={period.status} />
            </div>
          )}
        </div>

        <div className="card stat-card">
          <div className="stat-label">Pending Approval</div>
          <div
            className="stat-value"
            style={{ color: pending_approval_count > 0 ? '#dc3545' : '#198754' }}
          >
            {pending_approval_count}
          </div>
          {pending_approval_count > 0 && (
            <div style={{ marginTop: 6 }}>
              <Link to="/approvals" className="btn btn-sm btn-warning">
                Review →
              </Link>
            </div>
          )}
        </div>

        <div className="card stat-card">
          <div className="stat-label">Period Debits</div>
          <div className="stat-value mono">
            £{fmt(trial_balance_summary.total_debits)}
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-label">Period Credits</div>
          <div className="stat-value mono">
            £{fmt(trial_balance_summary.total_credits)}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* Recent Transactions */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Transactions</span>
            <Link to="/journal" className="btn btn-sm btn-ghost">View all</Link>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {recent_transactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">No transactions yet</td>
                  </tr>
                ) : (
                  recent_transactions.map((tx) => (
                    <tr key={tx.transaction_id}>
                      <td>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {tx.transaction_id}
                        </span>
                      </td>
                      <td>{tx.date}</td>
                      <td><TxTypeBadge type={tx.transaction_type} /></td>
                      <td
                        style={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {tx.description ?? tx.reference ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Transaction Mix */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Transaction Mix — Current Period</span>
          </div>
          <div className="card-body">
            {transaction_counts.length === 0 ? (
              <div className="empty">No transactions this period</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {transaction_counts.map((row) => {
                  const total = transaction_counts.reduce((s, r) => s + parseInt(r.count, 10), 0);
                  const pct = Math.round((parseInt(row.count, 10) / total) * 100);
                  return (
                    <div key={row.transaction_type}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                          fontSize: 13,
                        }}
                      >
                        <TxTypeBadge type={row.transaction_type} />
                        <span className="text-muted mono">{row.count}</span>
                      </div>
                      <div
                        style={{
                          height: 6,
                          background: '#e9ecef',
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: '#0d6efd',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Period info */}
          {period && (
            <>
              <div className="divider" style={{ margin: '0 20px' }} />
              <div className="card-body" style={{ paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 8 }}>
                  Current Period
                </div>
                <table style={{ fontSize: 13 }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingBottom: 4, width: 130, color: '#6c757d' }}>Period ID</td>
                      <td className="mono">{period.period_id}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingBottom: 4, color: '#6c757d' }}>Start</td>
                      <td>{period.start_date}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingBottom: 4, color: '#6c757d' }}>End</td>
                      <td>{period.end_date}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#6c757d' }}>Status</td>
                      <td><PeriodStatusBadge status={period.status} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
