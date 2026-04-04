/**
 * Integration tests for period management (softClosePeriod / hardClosePeriod).
 *
 * Each describe block that involves closing a period creates its own isolated
 * DB periods and chain file directory so the tests do not interfere with each
 * other or with the existing 2026-03 seed data.
 *
 * Prerequisites (already applied by the posting integration suite):
 *   NODE_ENV=test migrations + seeds on gl_ledger_test.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChainReader } from '../../src/chain/reader';
import { ChainWriter } from '../../src/chain/writer';
import { db } from '../../src/db/connection';
import { postTransaction } from '../../src/engine/post';
import {
  InvalidPeriodStateError,
  PeriodNotEndedError,
  PeriodNotFoundError,
  PeriodSequenceError,
  StagingNotClearError,
  computeNextPeriodId,
  computePeriodDates,
  hardClosePeriod,
  softClosePeriod,
} from '../../src/engine/periods';
import { PeriodClosedError } from '../../src/chain/types';

// ---------------------------------------------------------------------------
// Global helpers
// ---------------------------------------------------------------------------

/** Unique suffix so parallel test runs don't collide on period IDs. */
let _counter = 0;
function uniquePeriod(): string {
  _counter++;
  // Use a far-future year so we never collide with seed data.
  const month = String((_counter % 12) + 1).padStart(2, '0');
  const year = 2090 + Math.floor(_counter / 13);
  return `${year}-${month}`;
}

interface PeriodFixture {
  periodId: string;
  chainDir: string;
  chainWriter: ChainWriter;
  /** Call to clean up — removes chain files and DB rows. */
  cleanup: () => Promise<void>;
}

/**
 * Creates a period in the DB plus its chain file genesis entry.
 * Returns a fixture with helpers for the test.
 */
async function createPeriod(
  periodId: string,
  chainDir: string,
  previousPeriodId: string | null = null,
): Promise<void> {
  const { startDate, endDate } = computePeriodDates(periodId);
  await db('periods')
    .insert({
      period_id: periodId,
      start_date: startDate,
      end_date: endDate,
      status: 'OPEN',
      data_flag: 'PROVISIONAL',
      opened_at: new Date().toISOString(),
    })
    .onConflict('period_id')
    .ignore();
}

/**
 * Full fixture: creates a period DB row + chain genesis, returns cleanup.
 */
async function makeFixture(previousPeriodId: string | null = null): Promise<PeriodFixture> {
  const periodId = uniquePeriod();
  const chainDir = await fs.mkdtemp(path.join(os.tmpdir(), `gl-periods-${periodId}-`));

  const chainWriter = new ChainWriter({
    chainDir,
    getPeriodStatus: async (pid) => {
      const row = await db('periods')
        .where('period_id', pid)
        .select('status')
        .first<{ status: string } | undefined>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });

  await createPeriod(periodId, chainDir, previousPeriodId);
  await chainWriter.createPeriodFile(periodId, previousPeriodId, {});

  const cleanup = async (): Promise<void> => {
    // Make chain files writable before deletion.
    try {
      const entries = await fs.readdir(chainDir, { withFileTypes: true });
      for (const e of entries) {
        await fs.chmod(path.join(chainDir, e.name), 0o666).catch(() => undefined);
      }
    } catch { /* ignore */ }
    await fs.rm(chainDir, { recursive: true, force: true });
    // Remove test DB data (child rows first due to FK constraints).
    await db('transaction_lines').whereIn(
      'transaction_id',
      db('transactions').where('period_id', periodId).select('transaction_id'),
    ).del();
    await db('transactions').where('period_id', periodId).del();
    await db('staging').where('period_id', periodId).del();
    await db('periods').where('period_id', periodId).del();
  };

  return { periodId, chainDir, chainWriter, cleanup };
}

// ---------------------------------------------------------------------------
// Helpers for committing a balanced CUSTOMER_PAYMENT into a period
// ---------------------------------------------------------------------------

async function commitPayment(
  periodId: string,
  chainWriter: ChainWriter,
  amount = 500,
): Promise<void> {
  await postTransaction(
    {
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2090-01-15',
      period_id: periodId,
      amount,
    },
    chainWriter,
  );
}

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
// computeNextPeriodId / computePeriodDates — pure helpers
// ---------------------------------------------------------------------------

describe('computeNextPeriodId', () => {
  it('increments month within a year', () => {
    expect(computeNextPeriodId('2026-03')).toBe('2026-04');
    expect(computeNextPeriodId('2026-11')).toBe('2026-12');
  });

  it('wraps December to January of next year', () => {
    expect(computeNextPeriodId('2026-12')).toBe('2027-01');
  });
});

describe('computePeriodDates', () => {
  it('returns correct start and end for March', () => {
    const { startDate, endDate } = computePeriodDates('2026-03');
    expect(startDate).toBe('2026-03-01');
    expect(endDate).toBe('2026-03-31');
  });

  it('returns correct end for February in a non-leap year', () => {
    const { endDate } = computePeriodDates('2026-02');
    expect(endDate).toBe('2026-02-28');
  });

  it('returns correct end for February in a leap year', () => {
    const { endDate } = computePeriodDates('2028-02');
    expect(endDate).toBe('2028-02-29');
  });

  it('returns correct end for a 30-day month', () => {
    const { endDate } = computePeriodDates('2026-04');
    expect(endDate).toBe('2026-04-30');
  });
});

// ---------------------------------------------------------------------------
// softClosePeriod
// ---------------------------------------------------------------------------

describe('softClosePeriod', () => {
  let fx: PeriodFixture;
  beforeAll(async () => { fx = await makeFixture(); });
  afterAll(async () => { await fx.cleanup(); });

  it('transitions OPEN → SOFT_CLOSE when end date has passed', async () => {
    const result = await softClosePeriod(fx.periodId, '2099-12-31');
    expect(result.status).toBe('SOFT_CLOSE');
    expect(result.period_id).toBe(fx.periodId);
  });

  it('persists SOFT_CLOSE status in the DB', async () => {
    const row = await db('periods').where('period_id', fx.periodId).first();
    expect(row.status).toBe('SOFT_CLOSE');
    expect(row.soft_closed_at).not.toBeNull();
  });

  it('throws PeriodNotFoundError for a non-existent period', async () => {
    await expect(softClosePeriod('9999-99', '2099-12-31')).rejects.toThrow(PeriodNotFoundError);
  });

  it('throws PeriodNotEndedError when end date has not yet passed', async () => {
    const fx2 = await makeFixture();
    try {
      // Use a "today" before the period's end date.
      await expect(softClosePeriod(fx2.periodId, '2089-01-01')).rejects.toThrow(
        PeriodNotEndedError,
      );
    } finally {
      await fx2.cleanup();
    }
  });

  it('throws InvalidPeriodStateError when period is already SOFT_CLOSE', async () => {
    await expect(softClosePeriod(fx.periodId, '2099-12-31')).rejects.toThrow(
      InvalidPeriodStateError,
    );
  });

  it('throws InvalidPeriodStateError when trying to soft-close an already HARD_CLOSE period', async () => {
    const fx3 = await makeFixture();
    try {
      await softClosePeriod(fx3.periodId, '2099-12-31');
      await hardClosePeriod(fx3.periodId, {
        closedBy: 'test@test.com',
        chainWriter: fx3.chainWriter,
      });
      await expect(softClosePeriod(fx3.periodId, '2099-12-31')).rejects.toThrow(
        InvalidPeriodStateError,
      );
    } finally {
      // Cleanup both this period AND the auto-created next period.
      const nextId = computeNextPeriodId(fx3.periodId);
      await db('periods').where('period_id', nextId).del();
      await fx3.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// hardClosePeriod — happy path
// ---------------------------------------------------------------------------

describe('hardClosePeriod — happy path', () => {
  let fx: PeriodFixture;
  let nextPeriodId: string;

  beforeAll(async () => {
    fx = await makeFixture();
    // Commit a balanced transaction so the trial balance has something.
    await commitPayment(fx.periodId, fx.chainWriter);
    // Soft-close first.
    await softClosePeriod(fx.periodId, '2099-12-31');
  });

  afterAll(async () => {
    // Remove auto-created next period.
    if (nextPeriodId) {
      await db('periods').where('period_id', nextPeriodId).del();
    }
    await fx.cleanup();
  });

  it('transitions SOFT_CLOSE → HARD_CLOSE', async () => {
    const result = await hardClosePeriod(fx.periodId, {
      closedBy: 'controller@example.com',
      chainWriter: fx.chainWriter,
    });
    nextPeriodId = result.next_period_id;
    expect(result.status).toBe('HARD_CLOSE');
    expect(result.closing_chain_hash).toHaveLength(64);
  });

  it('persists HARD_CLOSE status in the DB', async () => {
    const row = await db('periods').where('period_id', fx.periodId).first();
    expect(row.status).toBe('HARD_CLOSE');
    expect(row.data_flag).toBe('AUTHORITATIVE');
    expect(row.hard_closed_at).not.toBeNull();
    expect(row.closed_by).toBe('controller@example.com');
    expect(row.closing_chain_hash).toHaveLength(64);
  });

  it('flags all transactions for the period as AUTHORITATIVE', async () => {
    const txns = await db('transactions').where('period_id', fx.periodId);
    expect(txns.every((t: { data_flag: string }) => t.data_flag === 'AUTHORITATIVE')).toBe(true);
  });

  it('flags all transaction_lines for the period as AUTHORITATIVE', async () => {
    const lines = await db('transaction_lines').where('period_id', fx.periodId);
    expect(lines.every((l: { data_flag: string }) => l.data_flag === 'AUTHORITATIVE')).toBe(true);
  });

  it('writes a PERIOD_CLOSE entry to the chain file', async () => {
    const reader = new ChainReader(fx.chainDir);
    const entries = await reader.readAllEntries(fx.periodId);
    const closeEntry = entries.find((e) => e.type === 'PERIOD_CLOSE');
    expect(closeEntry).toBeDefined();
    expect(closeEntry?.payload['closed_by']).toBe('controller@example.com');
  });

  it('makes the chain file read-only', async () => {
    const filePath = path.join(fx.chainDir, `${fx.periodId}.chain.jsonl`);
    await expect(fs.open(filePath, 'a')).rejects.toThrow(/EACCES|EPERM|permission/i);
  });

  it('the chain file is valid after sealing', async () => {
    const reader = new ChainReader(fx.chainDir);
    const result = await reader.verifyChain(fx.periodId);
    expect(result.valid).toBe(true);
  });

  it('creates the next period in the DB', async () => {
    const row = await db('periods').where('period_id', nextPeriodId).first();
    expect(row).toBeDefined();
    expect(row.status).toBe('OPEN');
    expect(row.data_flag).toBe('PROVISIONAL');
  });

  it('creates the next period chain file with a linked GENESIS entry', async () => {
    const reader = new ChainReader(fx.chainDir);
    const genesis = await reader.readEntry(nextPeriodId, 1);
    expect(genesis).not.toBeNull();
    expect(genesis?.type).toBe('GENESIS');

    // The genesis previous_hash must equal the PERIOD_CLOSE entry_hash.
    const closingHash = (await db('periods').where('period_id', fx.periodId).first())
      ?.closing_chain_hash;
    expect(genesis?.previous_hash).toBe(closingHash);
  });
});

// ---------------------------------------------------------------------------
// Closed period rejects new postings
// ---------------------------------------------------------------------------

describe('closed period rejects new postings', () => {
  let fx: PeriodFixture;
  let nextPeriodId: string;

  beforeAll(async () => {
    fx = await makeFixture();
    await softClosePeriod(fx.periodId, '2099-12-31');
    const result = await hardClosePeriod(fx.periodId, {
      closedBy: 'test@test.com',
      chainWriter: fx.chainWriter,
    });
    nextPeriodId = result.next_period_id;
  });

  afterAll(async () => {
    await db('periods').where('period_id', nextPeriodId).del();
    await fx.cleanup();
  });

  it('appendEntry throws PeriodClosedError for a HARD_CLOSE period', async () => {
    await expect(
      fx.chainWriter.appendEntry(fx.periodId, 'TRANSACTION', { test: true }),
    ).rejects.toThrow(PeriodClosedError);
  });

  it('postTransaction rejects a new posting to a hard-closed period', async () => {
    await expect(
      postTransaction(
        {
          transaction_type: 'CUSTOMER_PAYMENT',
          date: '2090-06-01',
          period_id: fx.periodId,
          amount: 100,
        },
        fx.chainWriter,
      ),
    ).rejects.toThrow(PeriodClosedError);
  });

  it('hardClosePeriod throws InvalidPeriodStateError when already closed', async () => {
    await expect(
      hardClosePeriod(fx.periodId, {
        closedBy: 'test@test.com',
        chainWriter: fx.chainWriter,
      }),
    ).rejects.toThrow(InvalidPeriodStateError);
  });
});

// ---------------------------------------------------------------------------
// Sequential ordering — cannot close out-of-order
// ---------------------------------------------------------------------------

describe('sequential ordering', () => {
  let fxFeb: PeriodFixture;
  let fxMar: PeriodFixture;

  beforeAll(async () => {
    // Create two periods where Feb must be closed before Mar.
    fxFeb = await makeFixture();
    fxMar = await makeFixture();

    // Artificially make fxFeb appear before fxMar by adjusting their dates.
    // We do this by updating the DB rows — they were created with computePeriodDates
    // based on counter-derived IDs, so we just need fxFeb.end_date < fxMar.start_date.
    const { startDate: marStart, endDate: marEnd } = computePeriodDates(fxMar.periodId);
    await db('periods').where('period_id', fxFeb.periodId).update({
      start_date: '2088-02-01',
      end_date: '2088-02-28',
    });
    await db('periods').where('period_id', fxMar.periodId).update({
      start_date: '2088-03-01',
      end_date: '2088-03-31',
    });

    // Soft-close Feb (not hard-closed yet) and Mar.
    await softClosePeriod(fxFeb.periodId, '2099-12-31');
    await softClosePeriod(fxMar.periodId, '2099-12-31');
  });

  afterAll(async () => {
    await fxFeb.cleanup();
    await fxMar.cleanup();
  });

  it('throws PeriodSequenceError when trying to hard-close Mar before Feb', async () => {
    await expect(
      hardClosePeriod(fxMar.periodId, {
        closedBy: 'test@test.com',
        chainWriter: fxMar.chainWriter,
      }),
    ).rejects.toThrow(PeriodSequenceError);
  });

  it('hard-closes Feb successfully, then Mar succeeds', async () => {
    await hardClosePeriod(fxFeb.periodId, {
      closedBy: 'test@test.com',
      chainWriter: fxFeb.chainWriter,
    });

    // Now Mar should be closeable — but Mar's chain writer doesn't know about
    // fxFeb's next period, so we skip the next-period chain file creation by
    // just verifying the state transition, not the full hard-close chain.
    const febRow = await db('periods').where('period_id', fxFeb.periodId).first();
    expect(febRow.status).toBe('HARD_CLOSE');

    // Hard-close Mar — this will create a new next period on fxMar's chainWriter.
    const result = await hardClosePeriod(fxMar.periodId, {
      closedBy: 'test@test.com',
      chainWriter: fxMar.chainWriter,
    });
    expect(result.status).toBe('HARD_CLOSE');
    // Cleanup the auto-created next period for Mar.
    await db('periods').where('period_id', result.next_period_id).del();
    // Cleanup Feb's auto-created next period.
    await db('periods')
      .where('period_id', computeNextPeriodId(fxFeb.periodId))
      .del();
  });
});

// ---------------------------------------------------------------------------
// Staging area must be clear before hard close
// ---------------------------------------------------------------------------

describe('staging area must be clear', () => {
  let fx: PeriodFixture;

  beforeAll(async () => {
    fx = await makeFixture();
    // Post a MANUAL_JOURNAL — always goes to staging (PENDING).
    await postTransaction(
      {
        transaction_type: 'MANUAL_JOURNAL',
        date: '2090-01-10',
        period_id: fx.periodId,
        lines: [
          { account_code: '1000', debit: 200, credit: 0 },
          { account_code: '2000', debit: 0, credit: 200 },
        ],
      },
      fx.chainWriter,
    );
    await softClosePeriod(fx.periodId, '2099-12-31');
  });

  afterAll(async () => { await fx.cleanup(); });

  it('throws StagingNotClearError when PENDING staging entries exist', async () => {
    await expect(
      hardClosePeriod(fx.periodId, {
        closedBy: 'test@test.com',
        chainWriter: fx.chainWriter,
      }),
    ).rejects.toThrow(StagingNotClearError);
  });

  it('succeeds after the staged entry is resolved', async () => {
    // Approve the staged entry (set status to APPROVED).
    await db('staging').where('period_id', fx.periodId).update({ status: 'APPROVED' });

    const result = await hardClosePeriod(fx.periodId, {
      closedBy: 'test@test.com',
      chainWriter: fx.chainWriter,
    });
    expect(result.status).toBe('HARD_CLOSE');
    await db('periods').where('period_id', result.next_period_id).del();
  });
});

// ---------------------------------------------------------------------------
// Cannot skip soft close
// ---------------------------------------------------------------------------

describe('cannot skip soft close', () => {
  let fx: PeriodFixture;
  beforeAll(async () => { fx = await makeFixture(); });
  afterAll(async () => { await fx.cleanup(); });

  it('throws InvalidPeriodStateError when trying to hard-close an OPEN period', async () => {
    await expect(
      hardClosePeriod(fx.periodId, {
        closedBy: 'test@test.com',
        chainWriter: fx.chainWriter,
      }),
    ).rejects.toThrow(InvalidPeriodStateError);
  });
});

// ---------------------------------------------------------------------------
// Opening balances carried forward correctly
// ---------------------------------------------------------------------------

describe('opening balances carried forward', () => {
  let fx: PeriodFixture;
  let nextPeriodId: string;

  beforeAll(async () => {
    fx = await makeFixture();

    // Post a CUSTOMER_PAYMENT: Dr 1000 (ASSET), Cr 1100 (ASSET) — both balance sheet.
    // Amount £500: Dr 1000 = £500, Cr 1100 = £500.
    await commitPayment(fx.periodId, fx.chainWriter, 500);

    await softClosePeriod(fx.periodId, '2099-12-31');
    const result = await hardClosePeriod(fx.periodId, {
      closedBy: 'test@test.com',
      chainWriter: fx.chainWriter,
    });
    nextPeriodId = result.next_period_id;
  });

  afterAll(async () => {
    await db('periods').where('period_id', nextPeriodId).del();
    await fx.cleanup();
  });

  it('creates the next period with opening_balances in the genesis payload', async () => {
    const reader = new ChainReader(fx.chainDir);
    const genesis = await reader.readEntry(nextPeriodId, 1);
    expect(genesis).not.toBeNull();
    const ob = genesis?.payload['opening_balances'] as Record<
      string,
      { debit: number; credit: number }
    >;
    // Account 1000 (Bank): net debit £500 — should carry forward as debit.
    expect(ob['1000']).toEqual({ debit: 500, credit: 0 });
    // Account 1100 (Trade Debtors): net credit £500 — should carry forward as credit.
    expect(ob['1100']).toEqual({ debit: 0, credit: 500 });
  });

  it('revenue/expense accounts are NOT in opening balances', async () => {
    const reader = new ChainReader(fx.chainDir);
    const genesis = await reader.readEntry(nextPeriodId, 1);
    const ob = genesis?.payload['opening_balances'] as Record<string, unknown>;
    // Accounts 4000 (REVENUE) and 5000 (EXPENSE) should not appear.
    expect(ob['4000']).toBeUndefined();
    expect(ob['5000']).toBeUndefined();
  });

  it('cross-period chain link: genesis previous_hash = PERIOD_CLOSE entry_hash', async () => {
    const reader = new ChainReader(fx.chainDir);
    const genesis = await reader.readEntry(nextPeriodId, 1);
    const closingHash = (await db('periods').where('period_id', fx.periodId).first())
      ?.closing_chain_hash;
    expect(genesis?.previous_hash).toBe(closingHash);
    expect(genesis?.payload['previous_period_closing_hash']).toBe(closingHash);
    expect(genesis?.payload['previous_period_id']).toBe(fx.periodId);
  });

  it('next period chain file verifies as valid', async () => {
    const reader = new ChainReader(fx.chainDir);
    const result = await reader.verifyChain(nextPeriodId);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(1); // just genesis
  });
});
