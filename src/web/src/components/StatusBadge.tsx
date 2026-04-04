import type { PeriodStatus, DataFlag } from '../types';

export function PeriodStatusBadge({ status }: { status: PeriodStatus }) {
  const map: Record<PeriodStatus, { cls: string; label: string }> = {
    OPEN: { cls: 'badge badge-open', label: 'Open' },
    SOFT_CLOSE: { cls: 'badge badge-soft', label: 'Soft Close' },
    HARD_CLOSE: { cls: 'badge badge-hard', label: 'Hard Close' },
  };
  const { cls, label } = map[status];
  return <span className={cls}>{label}</span>;
}

export function DataFlagBadge({ flag }: { flag: DataFlag }) {
  return (
    <span className={`badge badge-${flag.toLowerCase()}`}>
      {flag === 'AUTHORITATIVE' ? 'Authoritative' : 'Provisional'}
    </span>
  );
}

export function StagingStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'badge badge-pending',
    APPROVED: 'badge badge-approved',
    REJECTED: 'badge badge-rejected',
  };
  return <span className={map[status] ?? 'badge'}>{status}</span>;
}

export function TxTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    MANUAL_JOURNAL: 'Journal',
    CUSTOMER_INVOICE: 'Cust. Invoice',
    SUPPLIER_INVOICE: 'Supp. Invoice',
    CUSTOMER_PAYMENT: 'Cust. Payment',
    SUPPLIER_PAYMENT: 'Supp. Payment',
    PRIOR_PERIOD_ADJUSTMENT: 'Prior Period Adj.',
  };
  return (
    <span className="badge badge-committed" style={{ fontSize: 11 }}>
      {labels[type] ?? type}
    </span>
  );
}
