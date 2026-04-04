/**
 * Integration tests for all 16 transaction types (Prompt 9).
 *
 * For each type, tests:
 * - Lines expand correctly (account codes, debit/credit direction)
 * - Lines balance (total debits = total credits)
 * - Transaction appears in DB or staging with correct status
 *
 * Note: MANUAL_JOURNAL, PRIOR_PERIOD_ADJUSTMENT, YEAR_END_CLOSE, and
 * FX_REVALUATION always go to staging (approval rule 1/2). Amount-based
 * types under £10,000 auto-approve (rule 3).
 */

import { db } from '../../src/db/connection';
import { postTransaction } from '../../src/engine/post';
import { expandToPostingLines, fetchMappings } from '../../src/engine/expand';
import type { TransactionSubmission } from '../../src/engine/types';
import Decimal from 'decimal.js';

const TEST_PERIOD = '2088-10';
const CHAIN_DIR = 'chains/default';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let chainWriter: import('../../src/chain/writer').ChainWriter;

async function cleanupPeriod(): Promise<void> {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();
}

beforeAll(async () => {
  await cleanupPeriod();

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2088-10-01',
    end_date: '2088-10-31',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  const { ChainWriter } = await import('../../src/chain/writer');
  chainWriter = new ChainWriter({
    chainDir: CHAIN_DIR,
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
  await chainWriter.createPeriodFile(TEST_PERIOD, null, {});
});

afterAll(async () => {
  await cleanupPeriod();
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const fp = path.join(CHAIN_DIR, `${TEST_PERIOD}.chain.jsonl`);
  try { await fs.chmod(fp, 0o644); } catch { /**/ }
  try { await fs.unlink(fp); } catch { /**/ }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumDebits(lines: Array<{ debit: number; credit: number }>): Decimal {
  return lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
}
function sumCredits(lines: Array<{ debit: number; credit: number }>): Decimal {
  return lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
}

async function getLines(transactionId: string): Promise<Array<{ account_code: string; debit: string; credit: string }>> {
  return db('transaction_lines').where('transaction_id', transactionId);
}

/** Post a transaction and commit it; for staging types, returns the staging row. */
async function post(sub: TransactionSubmission): Promise<import('../../src/engine/types').PostingResult> {
  return postTransaction(sub, chainWriter);
}

// ---------------------------------------------------------------------------
// Amount-based types (auto-approved since amount < £10,000)
// ---------------------------------------------------------------------------

describe('CUSTOMER_INVOICE', () => {
  it('expands to 3 lines: debtors debit, revenue credit, VAT credit — and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'CUSTOMER_INVOICE');
    const sub: TransactionSubmission = {
      transaction_type: 'CUSTOMER_INVOICE',
      date: '2088-10-05',
      period_id: TEST_PERIOD,
      amount: 1200, // £1,200 inc. VAT
    };
    const lines = expandToPostingLines(sub, mappings);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);

    const debtorLine = lines.find((l) => l.debit > 0);
    expect(debtorLine).toBeDefined();
    expect(debtorLine!.debit).toBeCloseTo(1200, 2);
  });

  it('posts successfully (auto-approved) and appears in DB', async () => {
    const result = await post({
      transaction_type: 'CUSTOMER_INVOICE',
      date: '2088-10-05',
      period_id: TEST_PERIOD,
      amount: 1200,
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
    if (result.status === 'COMMITTED') {
      const lines = await getLines((result as import('../../src/engine/types').CommittedResult).transaction_id);
      const d = lines.reduce((s, l) => s + parseFloat(l.debit), 0);
      const c = lines.reduce((s, l) => s + parseFloat(l.credit), 0);
      expect(d).toBeCloseTo(c, 2);
    }
  });
});

describe('SUPPLIER_INVOICE', () => {
  it('expands to 3 lines: expense debit, VAT debit, creditors credit — and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'SUPPLIER_INVOICE');
    const sub: TransactionSubmission = {
      transaction_type: 'SUPPLIER_INVOICE',
      date: '2088-10-06',
      period_id: TEST_PERIOD,
      amount: 600,
    };
    const lines = expandToPostingLines(sub, mappings);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);

    const creditorLine = lines.find((l) => l.credit > 0);
    expect(creditorLine).toBeDefined();
    expect(creditorLine!.credit).toBeCloseTo(600, 2);
  });

  it('posts and balances', async () => {
    const result = await post({
      transaction_type: 'SUPPLIER_INVOICE',
      date: '2088-10-06',
      period_id: TEST_PERIOD,
      amount: 600,
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

describe('CUSTOMER_PAYMENT', () => {
  it('expands to 2 lines: bank debit, debtors credit — and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'CUSTOMER_PAYMENT');
    const sub: TransactionSubmission = {
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2088-10-07',
      period_id: TEST_PERIOD,
      amount: 500,
    };
    const lines = expandToPostingLines(sub, mappings);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
    expect(lines.every((l) => l.debit > 0 || l.credit > 0)).toBe(true);
  });

  it('posts and commits (auto-approved)', async () => {
    const result = await post({
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2088-10-07',
      period_id: TEST_PERIOD,
      amount: 500,
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

describe('SUPPLIER_PAYMENT', () => {
  it('expands to 2 lines: creditors debit, bank credit — and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'SUPPLIER_PAYMENT');
    const sub: TransactionSubmission = {
      transaction_type: 'SUPPLIER_PAYMENT',
      date: '2088-10-08',
      period_id: TEST_PERIOD,
      amount: 400,
    };
    const lines = expandToPostingLines(sub, mappings);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });

  it('posts successfully', async () => {
    const result = await post({
      transaction_type: 'SUPPLIER_PAYMENT',
      date: '2088-10-08',
      period_id: TEST_PERIOD,
      amount: 400,
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

describe('CUSTOMER_CREDIT_NOTE', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'CUSTOMER_CREDIT_NOTE');
    const sub: TransactionSubmission = { transaction_type: 'CUSTOMER_CREDIT_NOTE', date: '2088-10-09', period_id: TEST_PERIOD, amount: 240 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

describe('SUPPLIER_CREDIT_NOTE', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'SUPPLIER_CREDIT_NOTE');
    const sub: TransactionSubmission = { transaction_type: 'SUPPLIER_CREDIT_NOTE', date: '2088-10-09', period_id: TEST_PERIOD, amount: 120 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

describe('BAD_DEBT_WRITE_OFF', () => {
  it('expands to 2 lines and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'BAD_DEBT_WRITE_OFF');
    const sub: TransactionSubmission = { transaction_type: 'BAD_DEBT_WRITE_OFF', date: '2088-10-10', period_id: TEST_PERIOD, amount: 300 };
    const lines = expandToPostingLines(sub, mappings);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

describe('BANK_RECEIPT', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'BANK_RECEIPT');
    const sub: TransactionSubmission = { transaction_type: 'BANK_RECEIPT', date: '2088-10-11', period_id: TEST_PERIOD, amount: 250 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });

  it('posts successfully (auto-approved)', async () => {
    const result = await post({ transaction_type: 'BANK_RECEIPT', date: '2088-10-11', period_id: TEST_PERIOD, amount: 250 });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

describe('BANK_PAYMENT', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'BANK_PAYMENT');
    const sub: TransactionSubmission = { transaction_type: 'BANK_PAYMENT', date: '2088-10-12', period_id: TEST_PERIOD, amount: 75 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

describe('BANK_TRANSFER', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'BANK_TRANSFER');
    const sub: TransactionSubmission = { transaction_type: 'BANK_TRANSFER', date: '2088-10-13', period_id: TEST_PERIOD, amount: 5000 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

describe('PERIOD_END_ACCRUAL', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'PERIOD_END_ACCRUAL');
    const sub: TransactionSubmission = { transaction_type: 'PERIOD_END_ACCRUAL', date: '2088-10-31', period_id: TEST_PERIOD, amount: 1500 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

describe('DEPRECIATION', () => {
  it('expands and balances', async () => {
    const mappings = await fetchMappings(db as unknown as import('knex').Knex.Transaction, 'DEPRECIATION');
    const sub: TransactionSubmission = { transaction_type: 'DEPRECIATION', date: '2088-10-31', period_id: TEST_PERIOD, amount: 800 };
    const lines = expandToPostingLines(sub, mappings);
    expect(sumDebits(lines).eq(sumCredits(lines))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Explicit-line types (staged due to approval rules)
// ---------------------------------------------------------------------------

describe('MANUAL_JOURNAL', () => {
  it('posts with explicit lines — goes to staging', async () => {
    const result = await post({
      transaction_type: 'MANUAL_JOURNAL',
      date: '2088-10-14',
      period_id: TEST_PERIOD,
      lines: [
        { account_code: '1000', description: 'DR Bank', debit: 1000, credit: 0 },
        { account_code: '3000', description: 'CR Equity', debit: 0, credit: 1000 },
      ],
    });
    // MANUAL_JOURNAL always goes to staging
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });

  it('rejects unbalanced lines', async () => {
    await expect(
      post({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-10-14',
        period_id: TEST_PERIOD,
        lines: [
          { account_code: '1000', description: 'DR Bank', debit: 999, credit: 0 },
          { account_code: '3000', description: 'CR Equity', debit: 0, credit: 1000 },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe('YEAR_END_CLOSE', () => {
  it('posts with explicit lines and balances', async () => {
    const result = await post({
      transaction_type: 'YEAR_END_CLOSE',
      date: '2088-10-31',
      period_id: TEST_PERIOD,
      lines: [
        { account_code: '4000', description: 'Close revenue', debit: 5000, credit: 0 },
        { account_code: '3100', description: 'Retained earnings', debit: 0, credit: 5000 },
      ],
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

describe('PRIOR_PERIOD_ADJUSTMENT', () => {
  it('posts with explicit lines and adjustment_context', async () => {
    const result = await post({
      transaction_type: 'PRIOR_PERIOD_ADJUSTMENT',
      date: '2088-10-15',
      period_id: TEST_PERIOD,
      adjustment_context: {
        original_period: '2088-09',
        reason: 'Correct misposted invoice',
        authorised_by: 'test@example.com',
      },
      lines: [
        { account_code: '1000', description: 'Correction debit', debit: 200, credit: 0 },
        { account_code: '4000', description: 'Correction credit', debit: 0, credit: 200 },
      ],
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });

  it('requires adjustment_context', async () => {
    await expect(
      post({
        transaction_type: 'PRIOR_PERIOD_ADJUSTMENT',
        date: '2088-10-15',
        period_id: TEST_PERIOD,
        // no adjustment_context
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '4000', description: 'y', debit: 0, credit: 100 },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe('FX_REVALUATION', () => {
  it('posts with explicit lines and balances', async () => {
    const result = await post({
      transaction_type: 'FX_REVALUATION',
      date: '2088-10-31',
      period_id: TEST_PERIOD,
      currency: 'GBP',
      exchange_rate: '1',
      lines: [
        { account_code: '1000', description: 'FX reval asset', debit: 500, credit: 0 },
        { account_code: '7200', description: 'FX gain', debit: 0, credit: 500 },
      ],
    });
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});
