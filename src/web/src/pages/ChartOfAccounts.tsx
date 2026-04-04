import { useState } from 'react';
import { useAccounts } from '../hooks/useAccounts';
import { usePeriods } from '../hooks/usePeriods';
import { apiPost, apiPut } from '../hooks/useApi';
import type { Account, AccountType } from '../types';

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

function fmt(val: string | undefined | null): string {
  if (!val || val === '0' || val === '0.00') return '—';
  const n = parseFloat(val);
  return isNaN(n) ? val : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function typeColor(type: AccountType): string {
  return (
    { ASSET: '#0d6efd', LIABILITY: '#fd7e14', EQUITY: '#6f42c1', REVENUE: '#198754', EXPENSE: '#dc3545' }[type] ?? '#6c757d'
  );
}

interface EditState {
  mode: 'none' | 'add' | 'edit';
  account?: Account;
}

export function ChartOfAccounts() {
  const { data: periods } = usePeriods();
  const [periodId, setPeriodId] = useState('');
  const { data: accounts, loading, error, refetch } = useAccounts(periodId || undefined);
  const [edit, setEdit] = useState<EditState>({ mode: 'none' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('ASSET');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState(true);

  function openAdd() {
    setCode(''); setName(''); setType('ASSET'); setCategory(''); setActive(true);
    setFormError('');
    setEdit({ mode: 'add' });
  }

  function openEdit(account: Account) {
    setCode(account.code);
    setName(account.name);
    setType(account.type);
    setCategory(account.category ?? '');
    setActive(account.active);
    setFormError('');
    setEdit({ mode: 'edit', account });
  }

  async function handleSave() {
    setSaving(true);
    setFormError('');
    try {
      if (edit.mode === 'add') {
        await apiPost('/api/accounts', { code, name, type, category: category || undefined });
      } else {
        await apiPut(`/api/accounts/${code}`, { name, category: category || null, active });
      }
      setEdit({ mode: 'none' });
      refetch();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Group accounts by type
  const grouped = TYPES.reduce<Record<string, Account[]>>((acc, t) => {
    acc[t] = accounts?.filter((a) => a.type === t) ?? [];
    return acc;
  }, {} as Record<string, Account[]>);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Chart of Accounts</div>
          <div className="page-subtitle">Account definitions with period balances</div>
        </div>
        <div className="toolbar">
          <select
            className="form-control"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="">All time balances</option>
            {periods?.map((p) => (
              <option key={p.period_id} value={p.period_id}>{p.period_id}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Account</button>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↺</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Inline add/edit form */}
      {edit.mode !== 'none' && (
        <div className="card mb-16">
          <div className="card-header">
            <span className="card-title">{edit.mode === 'add' ? 'New Account' : `Edit ${code}`}</span>
          </div>
          <div className="card-body">
            {formError && <div className="alert alert-error mb-8">{formError}</div>}
            <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>Code *</div>
                <input
                  className="form-control"
                  style={{ width: 100 }}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={edit.mode === 'edit'}
                  placeholder="e.g. 1000"
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>Name *</div>
                <input
                  className="form-control"
                  style={{ width: '100%' }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Account name"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>Type *</div>
                <select
                  className="form-control"
                  value={type}
                  onChange={(e) => setType(e.target.value as AccountType)}
                  disabled={edit.mode === 'edit'}
                >
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>Category</div>
                <input
                  className="form-control"
                  style={{ width: 160 }}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. CURRENT_ASSET"
                />
              </div>
              {edit.mode === 'edit' && (
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    Active
                  </label>
                </div>
              )}
            </div>
            <div className="form-row mt-16">
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ mode: 'none' })}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading accounts…</div>
      ) : (
        TYPES.map((t) => {
          const rows = grouped[t];
          if (!rows || rows.length === 0) return null;
          const totalDr = rows.reduce((s, a) => s + parseFloat(a.balance_debit ?? '0'), 0);
          const totalCr = rows.reduce((s, a) => s + parseFloat(a.balance_credit ?? '0'), 0);

          return (
            <div className="card mb-16" key={t}>
              <div className="card-header">
                <span
                  className="card-title"
                  style={{ color: typeColor(t), display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: typeColor(t),
                      display: 'inline-block',
                    }}
                  />
                  {t}
                </span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {rows.length} account{rows.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th className="num">Debit £</th>
                      <th className="num">Credit £</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.code} style={{ opacity: a.active ? 1 : 0.5 }}>
                        <td className="mono" style={{ fontWeight: 600 }}>{a.code}</td>
                        <td>{a.name}</td>
                        <td className="text-muted">{a.category ?? '—'}</td>
                        <td>
                          <span className={`badge ${a.active ? 'badge-open' : 'badge-hard'}`}>
                            {a.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="num debit">{fmt(a.balance_debit)}</td>
                        <td className="num credit">{fmt(a.balance_credit)}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEdit(a)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {(totalDr > 0 || totalCr > 0) && (
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="font-bold" style={{ fontSize: 12 }}>
                          {t} Total
                        </td>
                        <td className="num debit font-bold">{fmt(String(totalDr))}</td>
                        <td className="num credit font-bold">{fmt(String(totalCr))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
