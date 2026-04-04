/**
 * Integration tests for the year-end close engine.
 *
 * Requires the test PostgreSQL database (port 5433).
 * Run with NODE_ENV=test.
 *
 * Prerequisites:
 *   NODE_ENV=test node_modules/.bin/tsx node_modules/knex/bin/cli.js migrate:latest --knexfile knexfile.ts
 *   NODE_ENV=test node_modules/.bin/tsx node_modules/knex/bin/cli.js seed:run --knexfile knexfile.ts
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Decimal from 'decimal.js';
import { ChainWriter } from '../../src/chain/writer';
import { db } from '../../src/db/connection';
import { postTransaction } from '../../src/engine/post';
import {
  InvalidPeriodStateError,
  computePeriodDates,
  hardClosePeriod,
  softClosePeriod,
} from '../../src/engine/periods';
import { executeYearEndClose, YearEndError } from '../../src/engine/year-end';
import type { CommittedResult } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let chainDir: string;
let chainWriter: ChainWriter;

let _counter = 0;
function uniquePeriod(): string {
  _counter++;
  const month = String((_counter % 12) + 1).padStart(2, '0');
  const year = 3500 + Math.floor(_counter / 13);
  return `${year}-${month}`;
}

async function createPeriod(periodId: string, previousPeriodId: string | null = null): Promise<void> {
  const { startDate, endDate } = computePeriodDates(periodId);
  await db('periods')
    .insert({ period_id: periodId, start_date: startDate, end_date: endDate, status: 'OPEN', data_flag: 'PROVISIONAL', opened_at: new Date().toISOString() })
    .onConflict('period_id').ignore();
  if (chainWriter) {
    await chainWriter.createPeriodFile(periodId, previousPeriodId, {});
  }
}

async function deletePeriod(periodId: string): Promise<void> {
  // Make chain files writable first
  const filePath = path.join(chainDir, `${periodId}.chain.jsonl`);
  await fs.chmod(filePath, 0o666).catch(() => undefined);

  await db('transaction_lines').whereIn('transaction_id', db('transactions').where('period_id', periodId).select('transaction_id')).del();
  await db('transactions').where('period_id', periodId).del();
  await db('staging').where('period_id', periodId).del();
  await db('periods').where('period_id', periodId).del();
}

function post(submission: Parameters<typeof postTransaction>[0]): ReturnType<typeof postTransaction> {
  return postTransaction(submission, chainWriter);
}

beforeAll(async () => {
  chainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-yearend-'));
  chainWriter = new ChainWriter({
    chainDir,
    getPeriodStatus: async (periodId) => {
      const row = await db('periods').where('period_id', periodId).select('status').first<{ status: string } | undefined>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
});

afterAll(async () => {
  if (chainDir) {
    try {
      const entries = await fs.readdir(chainDir, { withFileTypes: true });
      for (const e of entries) {
        await fs.chmod(path.join(chainDir, e.name), 0o666).catch(() => undefined);
      }
    } catch { /* ignore */ }
    await fs.rm(chainDir, { recursive: true, force: true });
  }
  await db.destroy();
});

// ---------------------------------------------------------------------------
// Helper: soft-close and hard-close a period
// ---------------------------------------------------------------------------

async function closeperiod(periodId: string, endDateOverride?: string): Promise<void> {
  await softClosePeriod(periodId, endDateOverride ?? '9999-12-31');
  await hardClosePeriod(periodId, { closedBy: 'test@example.com', chainWriter });
}

// ---------------------------------------------------------------------------
// Year-end close — happy path
// ---------------------------------------------------------------------------

describe('executeYearEndClose — happy path', () => {
  let yearEndPeriod: string;
  let newYearPeriod: string;

  beforeAll(async () => {
    yearEndPeriod = uniquePeriod();
    newYearPeriod = uniquePeriod();

    await createPeriod(yearEndPeriod);

    // CUSTOMER_INVOICE: gross 1200 → revenue 1000, VAT output 200, debtors 1200
    await post({
      transaction_type: 'CUSTOMER_INVOICE',
      date: `${yearEndPeriod}-10`,
      period_id: yearEndPeriod,
      amount: 1200,
      idempotency_key: `ye-ci-${yearEndPeriod}`,
    });

    // SUPPLIER_INVOICE: gross 600 → COGS 500, VAT input 100, creditors 600
    await post({
      transaction_type: 'SUPPLIER_INVOICE',
      date: `${yearEndPeriod}-15`,
      period_id: yearEndPeriod,
      amount: 600,
      idempotency_key: `ye-si-${yearEndPeriod}`,
    });

    // Hard-close the year-end period
    await closeperiod(yearEndPeriod);

    // The next period is auto-created by hardClosePeriod — delete it and recreate cleanly
    const autoNextPeriod = (() => {
      const [y, m] = yearEndPeriod.split('-').map(Number) as [number, number];
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      return `${ny}-${String(nm).padStart(2, '0')}`;
    })();

    // Delete the auto-created next period and create our named newYearPeriod instead
    await deletePeriod(autoNextPeriod);
    await fs.chmod(path.join(chainDir, `${autoNextPeriod}.chain.jsonl`), 0o666).catch(() => undefined);
    await fs.unlink(path.join(chainDir, `${autoNextPeriod}.chain.jsonl`)).catch(() => undefined);

    // Create newYearPeriod
    await createPeriod(newYearPeriod);

    // Execute year-end close — pass the test chain writer so it can write to newYearPeriod.
    // Scope to yearEndPeriod only (from_period = yearEndPeriod) to avoid picking up
    // P&L from other test periods in the shared test database.
    await executeYearEndClose(yearEndPeriod, newYearPeriod, chainWriter, { from_period: yearEndPeriod });
  });

  afterAll(async () => {
    await deletePeriod(yearEndPeriod);
    await deletePeriod(newYearPeriod);
  });

  it('a YEAR_END_CLOSE transaction was created in the new year period', async () => {
    const txns = await db('transactions')
      .where('period_id', newYearPeriod)
      .where('transaction_type', 'YEAR_END_CLOSE');
    expect(txns.length).toBeGreaterThanOrEqual(1);
  });

  it('the YEAR_END_CLOSE transaction balances (debits = credits)', async () => {
    const txn = await db('transactions')
      .where('period_id', newYearPeriod)
      .where('transaction_type', 'YEAR_END_CLOSE')
      .first<{ transaction_id: string }>();

    expect(txn).toBeDefined();

    const lines = await db('transaction_lines').where('transaction_id', txn!.transaction_id);
    const totalDebit = lines.reduce((s: Decimal, l: { debit: string }) => s.plus(l.debit), new Decimal(0));
    const totalCredit = lines.reduce((s: Decimal, l: { credit: string }) => s.plus(l.credit), new Decimal(0));
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });

  it('zeroes the revenue account (4000) in the year-end close lines', async () => {
    const txn = await db('transactions')
      .where('period_id', newYearPeriod)
      .where('transaction_type', 'YEAR_END_CLOSE')
      .first<{ transaction_id: string }>();

    const revLine = await db('transaction_lines')
      .where('transaction_id', txn!.transaction_id)
      .where('account_code', '4000')
      .first<{ debit: string; credit: string }>();

    // Revenue has a credit balance; to zero: debit it
    expect(revLine).toBeDefined();
    expect(parseFloat(revLine!.debit)).toBe(1000); // net revenue from invoice
  });

  it('zeroes the expense account (5000) in the year-end close lines', async () => {
    const txn = await db('transactions')
      .where('period_id', newYearPeriod)
      .where('transaction_type', 'YEAR_END_CLOSE')
      .first<{ transaction_id: string }>();

    const expLine = await db('transaction_lines')
      .where('transaction_id', txn!.transaction_id)
      .where('account_code', '5000')
      .first<{ debit: string; credit: string }>();

    // Expense has a debit balance; to zero: credit it
    expect(expLine).toBeDefined();
    expect(parseFloat(expLine!.credit)).toBe(500); // net expense from supplier invoice
  });

  it('posts net profit to Retained Earnings (3100)', async () => {
    const txn = await db('transactions')
      .where('period_id', newYearPeriod)
      .where('transaction_type', 'YEAR_END_CLOSE')
      .first<{ transaction_id: string }>();

    const retLine = await db('transaction_lines')
      .where('transaction_id', txn!.transaction_id)
      .where('account_code', '3100')
      .first<{ debit: string; credit: string }>();

    // Revenue 1000 - Expense 500 = net profit 500 → credit Retained Earnings
    expect(retLine).toBeDefined();
    expect(parseFloat(retLine!.credit)).toBe(500);
  });

  it('trial balance for all periods up to new year still balances', async () => {
    const allPeriods = [yearEndPeriod, newYearPeriod];
    const result = await db('transaction_lines')
      .whereIn('period_id', allPeriods)
      .select(
        db.raw('COALESCE(SUM(debit), 0) as total_debits'),
        db.raw('COALESCE(SUM(credit), 0) as total_credits'),
      )
      .first<{ total_debits: string; total_credits: string }>();

    expect(new Decimal(result!.total_debits).toFixed(2)).toBe(new Decimal(result!.total_credits).toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// Year-end close — error cases
// ---------------------------------------------------------------------------

describe('executeYearEndClose — error cases', () => {
  it('throws YearEndError when financial_year_end period does not exist', async () => {
    await expect(executeYearEndClose('9999-99', '9999-99')).rejects.toThrow(YearEndError);
  });

  it('throws YearEndError when financial_year_end is not HARD_CLOSE', async () => {
    const openPeriod = uniquePeriod();
    const nextPeriod = uniquePeriod();
    await createPeriod(openPeriod);
    await createPeriod(nextPeriod);

    try {
      await expect(executeYearEndClose(openPeriod, nextPeriod)).rejects.toThrow(YearEndError);
    } finally {
      await deletePeriod(openPeriod);
      await deletePeriod(nextPeriod);
    }
  });
});
