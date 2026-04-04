import Decimal from 'decimal.js';
import { expandToPostingLines, splitGrossAmount } from '../../../src/engine/expand';
import type { MappingRow, TransactionSubmission } from '../../../src/engine/types';

// ---------------------------------------------------------------------------
// splitGrossAmount
// ---------------------------------------------------------------------------

describe('splitGrossAmount', () => {
  it('correctly splits a standard gross amount (20% VAT)', () => {
    const { net, vat } = splitGrossAmount(new Decimal('1200'));
    expect(net.toFixed(2)).toBe('1000.00');
    expect(vat.toFixed(2)).toBe('200.00');
  });

  it('net + vat equals the original gross', () => {
    const gross = new Decimal('555.50');
    const { net, vat } = splitGrossAmount(gross);
    expect(net.plus(vat).toFixed(2)).toBe(gross.toFixed(2));
  });

  it('rounds to 2 decimal places correctly', () => {
    // Gross £100 → net £83.33, vat £16.67
    const { net, vat } = splitGrossAmount(new Decimal('100'));
    expect(net.toFixed(2)).toBe('83.33');
    expect(vat.toFixed(2)).toBe('16.67');
  });

  it('handles round amounts with no pence', () => {
    const { net, vat } = splitGrossAmount(new Decimal('60'));
    expect(net.toFixed(2)).toBe('50.00');
    expect(vat.toFixed(2)).toBe('10.00');
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — CUSTOMER_INVOICE
// ---------------------------------------------------------------------------

describe('expandToPostingLines — CUSTOMER_INVOICE', () => {
  const customerInvoiceMappings: MappingRow[] = [
    { transaction_type: 'CUSTOMER_INVOICE', line_role: 'DEBTORS', account_code: '1100', direction: 'DEBIT', description: 'Trade debtors' },
    { transaction_type: 'CUSTOMER_INVOICE', line_role: 'REVENUE', account_code: '4000', direction: 'CREDIT', description: 'Sales revenue' },
    { transaction_type: 'CUSTOMER_INVOICE', line_role: 'VAT_OUTPUT', account_code: '2100', direction: 'CREDIT', description: 'VAT output' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'CUSTOMER_INVOICE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 1200,
  };

  it('produces 3 posting lines', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    expect(lines).toHaveLength(3);
  });

  it('DEBTORS line = gross amount (1200)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const debtors = lines.find((l) => l.account_code === '1100');
    expect(debtors?.debit).toBe(1200);
    expect(debtors?.credit).toBe(0);
  });

  it('REVENUE line = net amount (1000)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const revenue = lines.find((l) => l.account_code === '4000');
    expect(revenue?.credit).toBe(1000);
    expect(revenue?.debit).toBe(0);
  });

  it('VAT_OUTPUT line = VAT amount (200)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const vat = lines.find((l) => l.account_code === '2100');
    expect(vat?.credit).toBe(200);
    expect(vat?.debit).toBe(0);
  });

  it('expanded lines balance (debits = credits)', () => {
    const lines = expandToPostingLines(submission, customerInvoiceMappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — SUPPLIER_INVOICE
// ---------------------------------------------------------------------------

describe('expandToPostingLines — SUPPLIER_INVOICE', () => {
  const supplierInvoiceMappings: MappingRow[] = [
    { transaction_type: 'SUPPLIER_INVOICE', line_role: 'EXPENSE', account_code: '5000', direction: 'DEBIT', description: 'COGS' },
    { transaction_type: 'SUPPLIER_INVOICE', line_role: 'VAT_INPUT', account_code: '1200', direction: 'DEBIT', description: 'VAT input' },
    { transaction_type: 'SUPPLIER_INVOICE', line_role: 'CREDITORS', account_code: '2000', direction: 'CREDIT', description: 'Trade creditors' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'SUPPLIER_INVOICE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 600,
  };

  it('CREDITORS line = gross (600)', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const creditors = lines.find((l) => l.account_code === '2000');
    expect(creditors?.credit).toBe(600);
  });

  it('EXPENSE line = net (500)', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const expense = lines.find((l) => l.account_code === '5000');
    expect(expense?.debit).toBe(500);
  });

  it('VAT_INPUT line = VAT (100)', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const vat = lines.find((l) => l.account_code === '1200');
    expect(vat?.debit).toBe(100);
  });

  it('expanded lines balance', () => {
    const lines = expandToPostingLines(submission, supplierInvoiceMappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(new Decimal(totalDebit).toFixed(2)).toBe(new Decimal(totalCredit).toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — CUSTOMER_CREDIT_NOTE
// ---------------------------------------------------------------------------

describe('expandToPostingLines — CUSTOMER_CREDIT_NOTE', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'CUSTOMER_CREDIT_NOTE', line_role: 'DEBTORS', account_code: '1100', direction: 'CREDIT', description: 'Trade debtors — credit note' },
    { transaction_type: 'CUSTOMER_CREDIT_NOTE', line_role: 'REVENUE', account_code: '4000', direction: 'DEBIT', description: 'Sales revenue — credit note reversal' },
    { transaction_type: 'CUSTOMER_CREDIT_NOTE', line_role: 'VAT_OUTPUT', account_code: '2100', direction: 'DEBIT', description: 'VAT output — credit note reversal' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'CUSTOMER_CREDIT_NOTE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 1200,
  };

  it('produces 3 posting lines', () => {
    expect(expandToPostingLines(submission, mappings)).toHaveLength(3);
  });

  it('DEBTORS line (1100): credit = 1200 (gross), debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const debtors = lines.find((l) => l.account_code === '1100');
    expect(debtors?.credit).toBe(1200);
    expect(debtors?.debit).toBe(0);
  });

  it('REVENUE line (4000): debit = 1000 (net), credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const revenue = lines.find((l) => l.account_code === '4000');
    expect(revenue?.debit).toBe(1000);
    expect(revenue?.credit).toBe(0);
  });

  it('VAT_OUTPUT line (2100): debit = 200 (VAT), credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const vat = lines.find((l) => l.account_code === '2100');
    expect(vat?.debit).toBe(200);
    expect(vat?.credit).toBe(0);
  });

  it('lines balance (total debits = total credits)', () => {
    const lines = expandToPostingLines(submission, mappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — SUPPLIER_CREDIT_NOTE
// ---------------------------------------------------------------------------

describe('expandToPostingLines — SUPPLIER_CREDIT_NOTE', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'SUPPLIER_CREDIT_NOTE', line_role: 'CREDITORS', account_code: '2000', direction: 'DEBIT', description: 'Trade creditors — credit note' },
    { transaction_type: 'SUPPLIER_CREDIT_NOTE', line_role: 'EXPENSE', account_code: '5000', direction: 'CREDIT', description: 'Cost of goods sold — credit note reversal' },
    { transaction_type: 'SUPPLIER_CREDIT_NOTE', line_role: 'VAT_INPUT', account_code: '1200', direction: 'CREDIT', description: 'VAT input — credit note reversal' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'SUPPLIER_CREDIT_NOTE',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 600,
  };

  it('CREDITORS line (2000): debit = 600 (gross), credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const creditors = lines.find((l) => l.account_code === '2000');
    expect(creditors?.debit).toBe(600);
    expect(creditors?.credit).toBe(0);
  });

  it('EXPENSE line (5000): credit = 500 (net), debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const expense = lines.find((l) => l.account_code === '5000');
    expect(expense?.credit).toBe(500);
    expect(expense?.debit).toBe(0);
  });

  it('VAT_INPUT line (1200): credit = 100 (VAT), debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const vat = lines.find((l) => l.account_code === '1200');
    expect(vat?.credit).toBe(100);
    expect(vat?.debit).toBe(0);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(new Decimal(totalDebit).toFixed(2)).toBe(new Decimal(totalCredit).toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — BAD_DEBT_WRITE_OFF
// ---------------------------------------------------------------------------

describe('expandToPostingLines — BAD_DEBT_WRITE_OFF', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'BAD_DEBT_WRITE_OFF', line_role: 'EXPENSE', account_code: '6700', direction: 'DEBIT', description: 'Bad debts written off' },
    { transaction_type: 'BAD_DEBT_WRITE_OFF', line_role: 'DEBTORS', account_code: '1100', direction: 'CREDIT', description: 'Trade debtors — bad debt write-off' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'BAD_DEBT_WRITE_OFF',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 500,
  };

  it('produces 2 posting lines', () => {
    expect(expandToPostingLines(submission, mappings)).toHaveLength(2);
  });

  it('EXPENSE line (6700): debit = 500, credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const expense = lines.find((l) => l.account_code === '6700');
    expect(expense?.debit).toBe(500);
    expect(expense?.credit).toBe(0);
  });

  it('DEBTORS line (1100): credit = 500, debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    const debtors = lines.find((l) => l.account_code === '1100');
    expect(debtors?.credit).toBe(500);
    expect(debtors?.debit).toBe(0);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — BANK_RECEIPT
// ---------------------------------------------------------------------------

describe('expandToPostingLines — BANK_RECEIPT', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'BANK_RECEIPT', line_role: 'BANK', account_code: '1000', direction: 'DEBIT', description: 'Bank — receipt' },
    { transaction_type: 'BANK_RECEIPT', line_role: 'INCOME', account_code: '4100', direction: 'CREDIT', description: 'Other income — bank receipt' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'BANK_RECEIPT',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 250,
  };

  it('BANK line (1000): debit = 250, credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '1000')?.debit).toBe(250);
  });

  it('INCOME line (4100): credit = 250, debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '4100')?.credit).toBe(250);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — BANK_PAYMENT
// ---------------------------------------------------------------------------

describe('expandToPostingLines — BANK_PAYMENT', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'BANK_PAYMENT', line_role: 'EXPENSE', account_code: '6200', direction: 'DEBIT', description: 'Expense — bank payment' },
    { transaction_type: 'BANK_PAYMENT', line_role: 'BANK', account_code: '1000', direction: 'CREDIT', description: 'Bank — payment' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'BANK_PAYMENT',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 75,
  };

  it('EXPENSE line (6200): debit = 75, credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '6200')?.debit).toBe(75);
  });

  it('BANK line (1000): credit = 75, debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '1000')?.credit).toBe(75);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — BANK_TRANSFER
// ---------------------------------------------------------------------------

describe('expandToPostingLines — BANK_TRANSFER', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'BANK_TRANSFER', line_role: 'BANK_TO', account_code: '1010', direction: 'DEBIT', description: 'Bank deposit account — transfer in' },
    { transaction_type: 'BANK_TRANSFER', line_role: 'BANK_FROM', account_code: '1000', direction: 'CREDIT', description: 'Bank current account — transfer out' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'BANK_TRANSFER',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 5000,
  };

  it('BANK_TO line (1010): debit = 5000, credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '1010')?.debit).toBe(5000);
  });

  it('BANK_FROM line (1000): credit = 5000, debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '1000')?.credit).toBe(5000);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — PERIOD_END_ACCRUAL
// ---------------------------------------------------------------------------

describe('expandToPostingLines — PERIOD_END_ACCRUAL', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'PERIOD_END_ACCRUAL', line_role: 'EXPENSE', account_code: '5000', direction: 'DEBIT', description: 'Expense — period-end accrual' },
    { transaction_type: 'PERIOD_END_ACCRUAL', line_role: 'ACCRUAL', account_code: '2300', direction: 'CREDIT', description: 'Accruals — period-end accrual' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'PERIOD_END_ACCRUAL',
    date: '2026-03-31',
    period_id: '2026-03',
    amount: 1500,
  };

  it('EXPENSE line (5000): debit = 1500, credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '5000')?.debit).toBe(1500);
  });

  it('ACCRUAL line (2300): credit = 1500, debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '2300')?.credit).toBe(1500);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — DEPRECIATION
// ---------------------------------------------------------------------------

describe('expandToPostingLines — DEPRECIATION', () => {
  const mappings: MappingRow[] = [
    { transaction_type: 'DEPRECIATION', line_role: 'EXPENSE', account_code: '6600', direction: 'DEBIT', description: 'Depreciation expense' },
    { transaction_type: 'DEPRECIATION', line_role: 'CONTRA_ASSET', account_code: '1310', direction: 'CREDIT', description: 'Accumulated depreciation' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'DEPRECIATION',
    date: '2026-03-31',
    period_id: '2026-03',
    amount: 800,
  };

  it('EXPENSE line (6600): debit = 800, credit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '6600')?.debit).toBe(800);
  });

  it('CONTRA_ASSET line (1310): credit = 800, debit = 0', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.find((l) => l.account_code === '1310')?.credit).toBe(800);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, mappings);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});

// ---------------------------------------------------------------------------
// expandToPostingLines — CUSTOMER_PAYMENT
// ---------------------------------------------------------------------------

describe('expandToPostingLines — CUSTOMER_PAYMENT', () => {
  const paymentMappings: MappingRow[] = [
    { transaction_type: 'CUSTOMER_PAYMENT', line_role: 'BANK', account_code: '1000', direction: 'DEBIT', description: 'Bank' },
    { transaction_type: 'CUSTOMER_PAYMENT', line_role: 'DEBTORS', account_code: '1100', direction: 'CREDIT', description: 'Debtors' },
  ];

  const submission: TransactionSubmission = {
    transaction_type: 'CUSTOMER_PAYMENT',
    date: '2026-03-15',
    period_id: '2026-03',
    amount: 1200,
  };

  it('both lines use the full payment amount', () => {
    const lines = expandToPostingLines(submission, paymentMappings);
    expect(lines.find((l) => l.account_code === '1000')?.debit).toBe(1200);
    expect(lines.find((l) => l.account_code === '1100')?.credit).toBe(1200);
  });

  it('lines balance', () => {
    const lines = expandToPostingLines(submission, paymentMappings);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});
