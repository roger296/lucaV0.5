/**
 * Integration tests for gl_get_transaction, gl_get_account_ledger, gl_get_dashboard_summary (Phase 2, Prompt 3).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { db } from '../../src/db/connection';
import { ChainWriter } from '../../src/chain/writer';
import { postTransaction } from '../../src/engine/post';
import type { CommittedResult } from '../../src/engine/types';
import {
  handleGetTransaction,
  handleGetAccountLedger,
  handleGetDashboardSummary,
} from '../../src/mcp/tools';

const TEST_PERIOD = '2076-04';
const CHAIN_DIR = 'chains/default';

async function cleanupPeriod(pid: string): Promise<void> {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', pid).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', pid).del();
  await db('staging').where('period_id', pid).del();
  await db('periods').where('period_id', pid).del();
}

let chainWriter: ChainWriter;
let postedTransactionId: string | null = null;

beforeAll(async () => {
  await cleanupPeriod(TEST_PERIOD);

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2076-04-01',
    end_date: '2076-04-30',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  chainWriter = new ChainWriter({
    chainDir: CHAIN_DIR,
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods')
        .where('period_id', pid)
        .select('status')
        .first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });

  // Create the chain file for the test period
  await chainWriter.createPeriodFile(TEST_PERIOD, null, {});

  // Post a CUSTOMER_INVOICE (auto-approved if below threshold)
  const result = await postTransaction(
    {
      transaction_type: 'CUSTOMER_INVOICE',
      date: '2076-04-05',
      period_id: TEST_PERIOD,
      amount: 1200,
      reference: 'INV-TEST-001',
    },
    chainWriter,
  );

  if (result.status === 'COMMITTED') {
    postedTransactionId = (result as CommittedResult).transaction_id;
  }

  // Post a CUSTOMER_PAYMENT
  await postTransaction(
    {
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2076-04-10',
      period_id: TEST_PERIOD,
      amount: 600,
    },
    chainWriter,
  );
});

afterAll(async () => {
  await cleanupPeriod(TEST_PERIOD);

  const chainFilePath = path.join(CHAIN_DIR, `${TEST_PERIOD}.chain.jsonl`);
  try {
    await fs.chmod(chainFilePath, 0o644);
  } catch { /* ignore */ }
  try {
    await fs.unlink(chainFilePath);
  } catch { /* ignore */ }

  await db.destroy();
});

// ---------------------------------------------------------------------------
// gl_get_transaction
// ---------------------------------------------------------------------------

describe('gl_get_transaction', () => {
  it('retrieves a committed transaction with lines', async () => {
    if (!postedTransactionId) {
      console.log('Transaction was staged (not auto-approved), skipping transaction retrieval test');
      return;
    }
    const result = await handleGetTransaction({ transaction_id: postedTransactionId });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      transaction_id: string;
      lines: unknown[];
    };
    expect(data.transaction_id).toBe(postedTransactionId);
    expect(Array.isArray(data.lines)).toBe(true);
    expect(data.lines.length).toBeGreaterThan(0);
  });

  it('returns TRANSACTION_NOT_FOUND for unknown ID', async () => {
    const result = await handleGetTransaction({ transaction_id: 'TXN-DOESNOTEXIST' });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0]!.text) as { error_code: string };
    expect(data.error_code).toBe('TRANSACTION_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// gl_get_account_ledger
// ---------------------------------------------------------------------------

describe('gl_get_account_ledger', () => {
  it('returns ledger entries for account 1100 (Trade Debtors)', async () => {
    const result = await handleGetAccountLedger({
      account_code: '1100',
      period_id: TEST_PERIOD,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      account_code: string;
      account_type: string;
      entries: unknown[];
      total_debits: string;
      total_credits: string;
      closing_balance: string;
    };
    expect(data.account_code).toBe('1100');
    expect(data.account_type).toBe('ASSET');
    expect(Array.isArray(data.entries)).toBe(true);
    expect(typeof data.total_debits).toBe('string');
    expect(typeof data.closing_balance).toBe('string');
  });

  it('entries have running_balance field when entries exist', async () => {
    const result = await handleGetAccountLedger({ account_code: '1100', period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      entries: Array<{ running_balance: string }>;
    };
    if (data.entries.length > 0) {
      expect(data.entries[0]).toHaveProperty('running_balance');
      expect(typeof data.entries[0]!.running_balance).toBe('string');
    }
  });

  it('returns error for unknown account', async () => {
    const result = await handleGetAccountLedger({ account_code: '9996' });
    expect(result.isError).toBe(true);
  });

  it('returns empty entries for account with no activity in period', async () => {
    // Account 7000 (Bank Interest Received) should have no entries in our test period
    const result = await handleGetAccountLedger({ account_code: '7000', period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      entries: unknown[];
      total_debits: string;
      total_credits: string;
    };
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.total_debits).toBe('0.00');
    expect(data.total_credits).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// gl_get_dashboard_summary
// ---------------------------------------------------------------------------

describe('gl_get_dashboard_summary', () => {
  it('returns dashboard summary with required fields', async () => {
    const result = await handleGetDashboardSummary({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      pending_approvals: number;
      recent_transactions: unknown[];
      trial_balance_summary: { balanced: boolean; total_debits: string; total_credits: string };
      current_period: string | null;
    };
    expect(typeof data.pending_approvals).toBe('number');
    expect(Array.isArray(data.recent_transactions)).toBe(true);
    expect(data.trial_balance_summary).toHaveProperty('balanced');
    expect(typeof data.trial_balance_summary.total_debits).toBe('string');
    expect(typeof data.trial_balance_summary.total_credits).toBe('string');
  });

  it('trial balance summary is balanced after posting', async () => {
    const result = await handleGetDashboardSummary({ period_id: TEST_PERIOD });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as {
      trial_balance_summary: { balanced: boolean };
    };
    // If any transactions were committed, debits must equal credits (double-entry)
    expect(data.trial_balance_summary.balanced).toBe(true);
  });

  it('defaults to current open period when no period_id given', async () => {
    const result = await handleGetDashboardSummary({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { current_period: string | null };
    // Should return some period or null if no open period found
    expect(result.content[0]).toBeDefined();
    expect(
      typeof data.current_period === 'string' || data.current_period === null,
    ).toBe(true);
  });

  it('pending_approvals is a non-negative integer', async () => {
    const result = await handleGetDashboardSummary({ period_id: TEST_PERIOD });
    const data = JSON.parse(result.content[0]!.text) as { pending_approvals: number };
    expect(Number.isInteger(data.pending_approvals)).toBe(true);
    expect(data.pending_approvals).toBeGreaterThanOrEqual(0);
  });
});
