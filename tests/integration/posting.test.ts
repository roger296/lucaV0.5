/**
 * Integration tests for the full posting engine flow.
 *
 * Requires the test PostgreSQL database (port 5433) and a writable
 * chain directory.  Run with NODE_ENV=test.
 *
 * Prerequisites (run once before the test suite):
 *   NODE_ENV=test node_modules/.bin/tsx node_modules/knex/bin/cli.js migrate:latest --knexfile knexfile.ts
 *   NODE_ENV=test node_modules/.bin/tsx node_modules/knex/bin/cli.js seed:run --knexfile knexfile.ts
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChainReader } from '../../src/chain/reader';
import { ChainWriter } from '../../src/chain/writer';
import { db } from '../../src/db/connection';
import { postTransaction } from '../../src/engine/post';
import type { CommittedResult, StagedResult } from '../../src/engine/types';
import { ValidationError } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let chainDir: string;
let chainWriter: ChainWriter;

const PERIOD_ID = '2026-03';

beforeAll(async () => {
  // Create a temp directory for chain files so tests are isolated.
  chainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-integration-'));

  chainWriter = new ChainWriter({
    chainDir,
    getPeriodStatus: async (periodId) => {
      const row = await db('periods')
        .where('period_id', periodId)
        .select('status')
        .first<{ status: string } | undefined>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });

  // Create the chain file for the test period.
  await chainWriter.createPeriodFile(PERIOD_ID, null, {});
});

afterAll(async () => {
  // Clean up chain files.
  if (chainDir) {
    try {
      const entries = await fs.readdir(chainDir, { withFileTypes: true });
      for (const e of entries) {
        await fs.chmod(path.join(chainDir, e.name), 0o666).catch(() => undefined);
      }
    } catch { /* ignore */ }
    await fs.rm(chainDir, { recursive: true, force: true });
  }

  // Roll back DB changes created by this test run.
  await db('transaction_lines').del();
  await db('transactions').del();
  await db('staging').del();

  await db.destroy();
});

// ---------------------------------------------------------------------------
// Helper: make a postTransaction call wired to our test chain writer.
// ---------------------------------------------------------------------------

function post(
  submission: Parameters<typeof postTransaction>[0],
): ReturnType<typeof postTransaction> {
  return postTransaction(submission, chainWriter);
}

// ---------------------------------------------------------------------------
// 1. Happy path — auto-approved CUSTOMER_INVOICE (amount <= £10,000)
// ---------------------------------------------------------------------------

describe('auto-approved CUSTOMER_INVOICE (amount <= £10,000)', () => {
  let result: CommittedResult;

  beforeAll(async () => {
    result = (await post({
      transaction_type: 'CUSTOMER_INVOICE',
      date: '2026-03-05',
      period_id: PERIOD_ID,
      amount: 1200, // £1,200 gross — below auto-approve threshold
      reference: 'INV-001',
      description: 'Test customer invoice',
      idempotency_key: 'test-inv-001',
    })) as CommittedResult;
  });

  it('returns status COMMITTED', () => {
    expect(result.status).toBe('COMMITTED');
  });

  it('returns a transaction_id in TXN-YYYY-MM-NNNNN format', () => {
    expect(result.transaction_id).toMatch(/^TXN-\d{4}-\d{2}-\d+$/);
  });

  it('returns the correct period_id', () => {
    expect(result.period_id).toBe(PERIOD_ID);
  });

  it('writes a transaction row to the database', async () => {
    const row = await db('transactions').where('transaction_id', result.transaction_id).first();
    expect(row).toBeDefined();
    expect(row.transaction_type).toBe('CUSTOMER_INVOICE');
    expect(row.reference).toBe('INV-001');
    expect(row.chain_sequence).toBe(result.chain_sequence);
  });

  it('writes 3 transaction_lines to the database', async () => {
    const lines = await db('transaction_lines').where('transaction_id', result.transaction_id);
    expect(lines).toHaveLength(3);
  });

  it('transaction_lines balance (debits = credits)', async () => {
    const lines = await db('transaction_lines').where('transaction_id', result.transaction_id);
    const totalDebit = lines.reduce((s: number, l: { debit: string }) => s + parseFloat(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: { credit: string }) => s + parseFloat(l.credit), 0);
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });

  it('writes a TRANSACTION entry to the chain file', async () => {
    const reader = new ChainReader(chainDir);
    const entries = await reader.readAllEntries(PERIOD_ID);
    const txEntry = entries.find((e) => e.sequence === result.chain_sequence);
    expect(txEntry).toBeDefined();
    expect(txEntry?.type).toBe('TRANSACTION');
  });

  it('chain remains valid after the write', async () => {
    const reader = new ChainReader(chainDir);
    const verifyResult = await reader.verifyChain(PERIOD_ID);
    expect(verifyResult.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Auto-approved CUSTOMER_PAYMENT (2 lines, no VAT)
// ---------------------------------------------------------------------------

describe('auto-approved CUSTOMER_PAYMENT (2 posting lines)', () => {
  let result: CommittedResult;

  beforeAll(async () => {
    result = (await post({
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2026-03-10',
      period_id: PERIOD_ID,
      amount: 1200,
      description: 'Payment on account',
      idempotency_key: 'test-pay-001',
    })) as CommittedResult;
  });

  it('is committed', () => {
    expect(result.status).toBe('COMMITTED');
  });

  it('writes exactly 2 transaction_lines', async () => {
    const lines = await db('transaction_lines').where('transaction_id', result.transaction_id);
    expect(lines).toHaveLength(2);
  });

  it('lines balance', async () => {
    const lines = await db('transaction_lines').where('transaction_id', result.transaction_id);
    const totalDebit = lines.reduce((s: number, l: { debit: string }) => s + parseFloat(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: { credit: string }) => s + parseFloat(l.credit), 0);
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });

  it('chain remains valid', async () => {
    const reader = new ChainReader(chainDir);
    const verifyResult = await reader.verifyChain(PERIOD_ID);
    expect(verifyResult.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. MANUAL_JOURNAL — always staged for review (priority-10 rule)
// ---------------------------------------------------------------------------

describe('MANUAL_JOURNAL — always staged for review', () => {
  let result: StagedResult;

  beforeAll(async () => {
    result = (await post({
      transaction_type: 'MANUAL_JOURNAL',
      date: '2026-03-10',
      period_id: PERIOD_ID,
      description: 'Correcting journal',
      lines: [
        { account_code: '6100', debit: 500, credit: 0, description: 'Rent expense' },
        { account_code: '1000', debit: 0, credit: 500, description: 'Bank payment' },
      ],
    })) as StagedResult;
  });

  it('returns status STAGED', () => {
    expect(result.status).toBe('STAGED');
  });

  it('returns a staging_id', () => {
    expect(result.staging_id).toMatch(/^STG-/);
  });

  it('writes a PENDING row to the staging table', async () => {
    const row = await db('staging').where('staging_id', result.staging_id).first();
    expect(row).toBeDefined();
    expect(row.status).toBe('PENDING');
    expect(row.transaction_type).toBe('MANUAL_JOURNAL');
  });

  it('does NOT write to the transactions table', async () => {
    const rows = await db('transactions').where('description', 'Correcting journal');
    expect(rows).toHaveLength(0);
  });

  it('does NOT write a chain entry for the staged transaction', async () => {
    // Chain should still contain exactly genesis + 2 committed TXNs from above.
    const reader = new ChainReader(chainDir);
    const entries = await reader.readAllEntries(PERIOD_ID);
    const txEntries = entries.filter((e) => e.type === 'TRANSACTION');
    expect(txEntries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. CUSTOMER_INVOICE above auto-approve threshold (£60k) — staged
// ---------------------------------------------------------------------------

describe('CUSTOMER_INVOICE above auto-approve threshold — staged', () => {
  let result: StagedResult;

  beforeAll(async () => {
    result = (await post({
      transaction_type: 'CUSTOMER_INVOICE',
      date: '2026-03-15',
      period_id: PERIOD_ID,
      amount: 60000, // above the £10,000 auto-approve limit
      reference: 'INV-BIG',
      description: 'Large customer invoice',
    })) as StagedResult;
  });

  it('returns status STAGED', () => {
    expect(result.status).toBe('STAGED');
  });

  it('stores the staging row with the correct total_amount', async () => {
    const row = await db('staging').where('staging_id', result.staging_id).first();
    expect(parseFloat(row.total_amount)).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// 5. Idempotency key prevents duplicate commits
// ---------------------------------------------------------------------------

describe('idempotency key', () => {
  it('throws when the same idempotency_key is submitted a second time', async () => {
    const submission = {
      transaction_type: 'CUSTOMER_PAYMENT' as const,
      date: '2026-03-20',
      period_id: PERIOD_ID,
      amount: 500,
      idempotency_key: 'idem-test-001',
    };

    await post(submission); // First — should succeed.

    // Second — DB unique constraint on idempotency_key should cause an error.
    await expect(post(submission)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Validation errors are surfaced
// ---------------------------------------------------------------------------

describe('validation errors', () => {
  it('throws ValidationError when debits ≠ credits', async () => {
    await expect(
      post({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2026-03-10',
        period_id: PERIOD_ID,
        lines: [
          { account_code: '1000', debit: 100, credit: 0 },
          { account_code: '4000', debit: 0, credit: 200 }, // imbalance
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for an unknown transaction type', async () => {
    await expect(
      post({
        // @ts-expect-error testing invalid type
        transaction_type: 'UNKNOWN',
        date: '2026-03-10',
        period_id: PERIOD_ID,
        amount: 100,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// 7. PRIOR_PERIOD_ADJUSTMENT — always staged
// ---------------------------------------------------------------------------

describe('PRIOR_PERIOD_ADJUSTMENT', () => {
  it('is always staged for review', async () => {
    const result = await post({
      transaction_type: 'PRIOR_PERIOD_ADJUSTMENT',
      date: '2026-04-01',
      period_id: PERIOD_ID,
      lines: [
        { account_code: '1000', debit: 100, credit: 0 },
        { account_code: '4000', debit: 0, credit: 100 },
      ],
      adjustment_context: {
        original_period: '2026-02',
        reason: 'Missed invoice',
        authorised_by: 'controller@company.com',
      },
    });
    expect(result.status).toBe('STAGED');
  });
});

// ---------------------------------------------------------------------------
// 8. Chain integrity after multiple writes
// ---------------------------------------------------------------------------

describe('chain integrity after multiple writes', () => {
  it('verifies the entire chain is valid at the end of the test suite', async () => {
    const reader = new ChainReader(chainDir);
    const result = await reader.verifyChain(PERIOD_ID);
    expect(result.valid).toBe(true);
    // genesis + at least the committed transactions from the above tests
    expect(result.entries).toBeGreaterThanOrEqual(3);
  });
});
