import { useState } from 'react';
import { useTrialBalance } from '../hooks/useTrialBalance';
import { usePeriods } from '../hooks/usePeriods';
import { DataFlagBadge } from '../components/StatusBadge';
import type { AccountType, TrialBalanceLine } from '../types';

function fmt(val: string | number | null | undefined): string {
  if (val == null) return '';
  const n = parseFloat(String(val));
  if (isNaN(n) || n === 0) return '';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTotal(val: string | number | null | undefined): string {
  if (val == null) return '0.00';
  const n = parseFloat(String(val));
  return isNaN(n) ? '0.00' : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export function TrialBalance() {
  const { data: periods } = usePeriods();
  const [periodId, setPeriodId] = useState('');

  const { data, loading, error } = useTrialBalance(periodId || undefined);

  // Group lines by type
  const grouped = new Map<AccountType, TrialBalanceLine[]>();
  if (data?.lines) {
    for (const t of TYPE_ORDER) {
      grouped.set(t, data.lines.filter((l) => l.type === t));
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Trial Balance</div>
          <div className="page-subtitle">Aggregate debit and credit balances by account</div>
        </div>
        <div className="toolbar">
          <select
            className="form-control"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="">All periods (cumulative)</option>
            {periods?.map((p) => (
              <option key={p.period_id} value={p.period_id}>{p.period_id}</option>
            ))}
          </select>
          {data?.period && (
            <DataFlagBadge flag={data.period.data_flag} />
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {data && !data.balanced && (
        <div className="alert alert-error mb-16">
          ⚠ Trial balance does not balance — Debits: £{fmtTotal(data.total_debits)}, Credits: £
          {fmtTotal(data.total_credits)}, Difference: £
          {fmtTotal(Math.abs(parseFloat(data.total_debits) - parseFloat(data.total_credits)))}
        </div>
      )}

      {data?.period && (
        <div className="alert alert-info mb-16" style={{ fontSize: 13 }}>
          Period <strong>{data.period.period_id}</strong>{' '}
          ({data.period.start_date} – {data.period.end_date}){' '}
          — {data.period.status.replace('_', ' ')}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading">Loading trial balance…</div>
        ) : !data?.lines?.length ? (
          <div className="empty">No transactions found for selected period</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account Name</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th className="num">Debit £</th>
                  <th className="num">Credit £</th>
                </tr>
              </thead>
              <tbody>
                {TYPE_ORDER.flatMap((type) => {
                  const rows = grouped.get(type) ?? [];
                  if (rows.length === 0) return [];

                  const subtotalDr = rows.reduce((s: number, r: TrialBalanceLine) => s + parseFloat(r.total_debits), 0);
                  const subtotalCr = rows.reduce((s: number, r: TrialBalanceLine) => s + parseFloat(r.total_credits), 0);

                  return [
                    // Type group header row
                    <tr
                      key={`header-${type}`}
                      style={{ background: '#f0f4ff' }}
                    >
                      <td
                        colSpan={6}
                        style={{
                          fontWeight: 700,
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          color: '#344563',
                          paddingTop: 14,
                          paddingBottom: 6,
                        }}
                      >
                        {type}
                      </td>
                    </tr>,

                    // Account rows
                    ...rows.map((line: TrialBalanceLine) => (
                      <tr key={line.code}>
                        <td className="mono" style={{ fontWeight: 600 }}>{line.code}</td>
                        <td>{line.name}</td>
                        <td>
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            {line.type}
                          </span>
                        </td>
                        <td className="text-muted">{line.category ?? '—'}</td>
                        <td className="num debit">{fmt(line.total_debits)}</td>
                        <td className="num credit">{fmt(line.total_credits)}</td>
                      </tr>
                    )),

                    // Subtotal row
                    <tr
                      key={`subtotal-${type}`}
                      style={{ background: '#f8f9fa' }}
                    >
                      <td colSpan={4} style={{ fontSize: 12, color: '#6c757d', paddingLeft: 20 }}>
                        {type} Subtotal
                      </td>
                      <td className="num font-bold debit">{fmt(String(subtotalDr))}</td>
                      <td className="num font-bold credit">{fmt(String(subtotalCr))}</td>
                    </tr>,
                  ];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="font-bold">Grand Total</td>
                  <td className="num font-bold debit" style={{ fontSize: 15 }}>
                    {fmtTotal(data.total_debits)}
                  </td>
                  <td className="num font-bold credit" style={{ fontSize: 15 }}>
                    {fmtTotal(data.total_credits)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} style={{ fontSize: 12, color: '#6c757d' }}>
                    {data.balanced ? (
                      <span style={{ color: '#198754' }}>✓ Balance checks out</span>
                    ) : (
                      <span style={{ color: '#dc3545' }}>✕ Out of balance</span>
                    )}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
