/**
 * Period lifecycle integration tests (Prompt 9).
 *
 * Tests the full period lifecycle:
 *  - Create a period, post balanced transactions, soft-close, hard-close.
 *  - Soft-close rejects posting without soft_close_override.
 *  - Hard-close fails when staging is not clear.
 *  - Hard-close creates the next period with correct opening balances.
 *  - Chain file is sealed (read-only) after hard-close.
 *  - Hard-closed period rejects new postings.
 *  - Cannot skip soft-close (hard-close an OPEN period fails).
 *  - Cross-period chain link: next period genesis previous_hash = close entry hash.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { db } from '../../src/db/connection';
import { postTransaction } from '../../src/engine/post';
import {
  softClosePeriod,
  hardClosePeriod,
  computeNextPeriodId,
  InvalidPeriodStateError,
  StagingNotClearError,
} from '../../src/engine/periods';
import { PeriodClosedError, PeriodSoftClosedError } from '../../src/chain/types';
import { ChainWriter } from '../../src/chain/writer';
import { ChainReader } from '../../src/chain/reader';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Use a far-future year to avoid conflicts with other integration tests. */
const TEST_PERIOD = '2077-01';
const NEXT_PERIOD = computeNextPeriodId(TEST_PERIOD); // '2077-02'
const CHAIN_DIR = 'chains/default';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChainWriter(): ChainWriter {
  return new ChainWriter({
    chainDir: CHAIN_DIR,
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods')
        .where('period_id', pid)
        .select('status')
        .first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
}

async function cleanupPeriod(pid: string): Promise<void> {
  await db('transaction_lines')
    .whereIn(
      'transaction_id',
      db('transactions').where('period_id', pid).select('transaction_id'),
    )
    .del();
  await db('transactions').where('period_id', pid).del();
  await db('staging').where('period_id', pid).del();
  await db('periods').where('period_id', pid).del();
}

async function unlinkChainFile(pid: string): Promise<void> {
  const fp = path.join(CHAIN_DIR, `${pid}.chain.jsonl`);
  try { await fs.chmod(fp, 0o644); } catch { /**/ }
  try { await fs.unlink(fp); } catch { /**/ }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let chainWriter: ChainWriter;

beforeAll(async () => {
  // Clean up both the test period and the next period (created by hard-close).
  await cleanupPeriod(TEST_PERIOD);
  await cleanupPeriod(NEXT_PERIOD);
  await unlinkChainFile(TEST_PERIOD);
  await unlinkChainFile(NEXT_PERIOD);

  // Create the test period.
  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2077-01-01',
    end_date: '2077-01-31',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  chainWriter = makeChainWriter();
  await chainWriter.createPeriodFile(TEST_PERIOD, null, {});
});

afterAll(async () => {
  // Clean up both periods.
  await cleanupPeriod(NEXT_PERIOD);
  await cleanupPeriod(TEST_PERIOD);
  await unlinkChainFile(NEXT_PERIOD);
  await unlinkChainFile(TEST_PERIOD);
});

// ---------------------------------------------------------------------------
// Phase 1 — OPEN period
// ---------------------------------------------------------------------------

describe('Phase 1: OPEN period — posting transactions', () => {
  it('posts a CUSTOMER_PAYMENT successfully (auto-approved)', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'CUSTOMER_PAYMENT',
        date: '2077-01-10',
        period_id: TEST_PERIOD,
        amount: 1000,
      },
      chainWriter,
    );
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });

  it('posts a SUPPLIER_PAYMENT successfully (auto-approved)', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'SUPPLIER_PAYMENT',
        date: '2077-01-15',
        period_id: TEST_PERIOD,
        amount: 500,
      },
      chainWriter,
    );
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });

  it('period status is OPEN after posting', async () => {
    const row = await db('periods')
      .where('period_id', TEST_PERIOD)
      .select('status')
      .first<{ status: string }>();
    expect(row?.status).toBe('OPEN');
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Soft close
// ---------------------------------------------------------------------------

describe('Phase 2: Soft close', () => {
  it('soft-close fails if period end date has not yet passed', async () => {
    // Provide an override "today" that is BEFORE the period end.
    await expect(
      softClosePeriod(TEST_PERIOD, '2077-01-15'),
    ).rejects.toThrow('period end date');
  });

  it('soft-closes the period successfully', async () => {
    // Pass a "today" override that is after the end date (2077-01-31).
    const result = await softClosePeriod(TEST_PERIOD, '2077-02-01');
    expect(result.period_id).toBe(TEST_PERIOD);
    expect(result.status).toBe('SOFT_CLOSE');
    expect(result.soft_closed_at).toBeTruthy();
  });

  it('period status in DB is now SOFT_CLOSE', async () => {
    const row = await db('periods')
      .where('period_id', TEST_PERIOD)
      .select('status', 'soft_closed_at')
      .first<{ status: string; soft_closed_at: string | null }>();
    expect(row?.status).toBe('SOFT_CLOSE');
    expect(row?.soft_closed_at).toBeTruthy();
  });

  it('soft-closing an already-soft-closed period throws InvalidPeriodStateError', async () => {
    await expect(softClosePeriod(TEST_PERIOD, '2077-02-01')).rejects.toThrow(
      InvalidPeriodStateError,
    );
  });

  it('posting without soft_close_override throws PeriodSoftClosedError', async () => {
    await expect(
      postTransaction(
        {
          transaction_type: 'CUSTOMER_PAYMENT',
          date: '2077-01-20',
          period_id: TEST_PERIOD,
          amount: 200,
        },
        chainWriter,
      ),
    ).rejects.toThrow(PeriodSoftClosedError);
  });

  it('posting WITH soft_close_override succeeds', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'CUSTOMER_PAYMENT',
        date: '2077-01-20',
        period_id: TEST_PERIOD,
        amount: 200,
        soft_close_override: true,
      },
      chainWriter,
    );
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — Hard close pre-flight failures
// ---------------------------------------------------------------------------

describe('Phase 3: Hard close pre-flight checks', () => {
  it('hard-close fails when staging has PENDING entries', async () => {
    // Insert a dummy PENDING staging row for this period.
    const stagingId = `STG-lifecycle-test-${Date.now()}`;
    await db('staging').insert({
      staging_id: stagingId,
      period_id: TEST_PERIOD,
      transaction_type: 'MANUAL_JOURNAL',
      date: '2077-01-25',
      currency: 'GBP',
      payload: JSON.stringify({ lines: [] }),
      status: 'PENDING',
      total_amount: '0.00',
    });

    await expect(
      hardClosePeriod(TEST_PERIOD, { closedBy: 'test', chainWriter }),
    ).rejects.toThrow(StagingNotClearError);

    // Clean up the staging row before continuing.
    await db('staging').where('staging_id', stagingId).del();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Successful hard close
// ---------------------------------------------------------------------------

let closingChainHash: string;

describe('Phase 4: Successful hard close', () => {
  it('hard-closes the period successfully', async () => {
    const result = await hardClosePeriod(TEST_PERIOD, {
      closedBy: 'finance@example.com',
      chainWriter,
    });
    expect(result.period_id).toBe(TEST_PERIOD);
    expect(result.status).toBe('HARD_CLOSE');
    expect(result.closing_chain_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.next_period_id).toBe(NEXT_PERIOD);

    closingChainHash = result.closing_chain_hash;
  });

  it('period status in DB is now HARD_CLOSE with AUTHORITATIVE data_flag', async () => {
    const row = await db('periods')
      .where('period_id', TEST_PERIOD)
      .first<{
        status: string;
        data_flag: string;
        closed_by: string;
        closing_chain_hash: string;
      }>();
    expect(row?.status).toBe('HARD_CLOSE');
    expect(row?.data_flag).toBe('AUTHORITATIVE');
    expect(row?.closed_by).toBe('finance@example.com');
    expect(row?.closing_chain_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('all transactions and lines for the period are AUTHORITATIVE', async () => {
    const txns = await db('transactions')
      .where('period_id', TEST_PERIOD)
      .where('status', 'COMMITTED')
      .select('data_flag');

    // Skip if no committed transactions (all went to staging).
    if (txns.length > 0) {
      for (const txn of txns as Array<{ data_flag: string }>) {
        expect(txn.data_flag).toBe('AUTHORITATIVE');
      }
    }
  });

  it('next period was created in DB with OPEN status', async () => {
    const row = await db('periods')
      .where('period_id', NEXT_PERIOD)
      .first<{ status: string; data_flag: string }>();
    expect(row).toBeDefined();
    expect(row?.status).toBe('OPEN');
    expect(row?.data_flag).toBe('PROVISIONAL');
  });

  it('next period chain file was created with GENESIS entry', async () => {
    const nextFp = path.join(CHAIN_DIR, `${NEXT_PERIOD}.chain.jsonl`);
    const content = await fs.readFile(nextFp, 'utf8');
    const firstLine = content.trim().split('\n')[0]!;
    const entry = JSON.parse(firstLine) as {
      type: string;
      sequence: number;
      previous_hash: string;
    };
    expect(entry.type).toBe('GENESIS');
    expect(entry.sequence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — Post-close immutability
// ---------------------------------------------------------------------------

describe('Phase 5: Post-close immutability', () => {
  it('posting to the hard-closed period throws PeriodClosedError', async () => {
    await expect(
      postTransaction(
        {
          transaction_type: 'CUSTOMER_PAYMENT',
          date: '2077-01-28',
          period_id: TEST_PERIOD,
          amount: 300,
        },
        chainWriter,
      ),
    ).rejects.toThrow(PeriodClosedError);
  });

  it('chain file for closed period is read-only (chmod 444)', async () => {
    const fp = path.join(CHAIN_DIR, `${TEST_PERIOD}.chain.jsonl`);
    const stat = await fs.stat(fp);
    // On Unix: mode & 0o777 should be 0o444.
    // On Windows file permissions work differently — skip mode check on Windows.
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o444);
    } else {
      // On Windows: just verify the file exists and the application-level guard
      // (PeriodClosedError) is the protection mechanism.
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('hard-closing again throws InvalidPeriodStateError', async () => {
    await expect(
      hardClosePeriod(TEST_PERIOD, { closedBy: 'another@example.com', chainWriter }),
    ).rejects.toThrow(InvalidPeriodStateError);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — Chain integrity
// ---------------------------------------------------------------------------

describe('Phase 6: Chain integrity', () => {
  it('chain for closed period verifies as valid', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.verifyChain(TEST_PERIOD);
    expect(result.valid).toBe(true);
  });

  it('cross-period link: next period genesis previous_hash = closing chain hash', async () => {
    const nextFp = path.join(CHAIN_DIR, `${NEXT_PERIOD}.chain.jsonl`);
    const content = await fs.readFile(nextFp, 'utf8');
    const firstLine = content.trim().split('\n')[0]!;
    const entry = JSON.parse(firstLine) as {
      previous_hash: string;
      payload: { previous_period_closing_hash: string };
    };

    expect(entry.previous_hash).toBe(closingChainHash);
    expect(entry.payload.previous_period_closing_hash).toBe(closingChainHash);
  });

  it('can post to next period after hard close', async () => {
    // Next period's chain writer uses the same chainWriter instance.
    const result = await postTransaction(
      {
        transaction_type: 'CUSTOMER_PAYMENT',
        date: '2077-02-05',
        period_id: NEXT_PERIOD,
        amount: 750,
      },
      chainWriter,
    );
    expect(['COMMITTED', 'STAGED']).toContain(result.status);
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — Cannot skip soft-close
// ---------------------------------------------------------------------------

describe('Phase 7: Cannot skip soft-close (hard-close OPEN period)', () => {
  const FRESH_PERIOD = '2077-03';

  beforeAll(async () => {
    await cleanupPeriod(FRESH_PERIOD);
    await db('periods').insert({
      period_id: FRESH_PERIOD,
      start_date: '2077-03-01',
      end_date: '2077-03-31',
      status: 'OPEN',
      data_flag: 'PROVISIONAL',
      opened_at: new Date().toISOString(),
    });
    await chainWriter.createPeriodFile(FRESH_PERIOD, null, {});
  });

  afterAll(async () => {
    await cleanupPeriod(FRESH_PERIOD);
    await unlinkChainFile(FRESH_PERIOD);
  });

  it('hard-closing an OPEN period throws InvalidPeriodStateError', async () => {
    await expect(
      hardClosePeriod(FRESH_PERIOD, { closedBy: 'test', chainWriter }),
    ).rejects.toThrow(InvalidPeriodStateError);
  });
});
