/**
 * Integration tests for the transaction recovery engine (Prompt 8).
 *
 * Scenario: simulates a crash after a chain write but before the DB mirror
 * write by inserting chain entries directly and then NOT mirroring them.
 * Recovery should detect and restore the missing transactions.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { db } from '../../src/db/connection';
import { ChainWriter } from '../../src/chain/writer';
import { recoverMissingTransactions } from '../../src/engine/recovery';

const RECOVERY_PERIOD = '2091-09';
const CHAIN_DIR = 'chains/default';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let writer: ChainWriter;

async function cleanupPeriod(): Promise<void> {
  await db('transaction_lines')
    .whereIn(
      'transaction_id',
      db('transactions').where('period_id', RECOVERY_PERIOD).select('transaction_id'),
    )
    .del();
  await db('transactions').where('period_id', RECOVERY_PERIOD).del();
  await db('staging').where('period_id', RECOVERY_PERIOD).del();
  await db('periods').where('period_id', RECOVERY_PERIOD).del();

  const filePath = path.join(CHAIN_DIR, `${RECOVERY_PERIOD}.chain.jsonl`);
  try { await fs.chmod(filePath, 0o644); } catch { /* ignore */ }
  try { await fs.unlink(filePath); } catch { /* ignore */ }
}

beforeAll(async () => {
  await cleanupPeriod();

  await db('periods').insert({
    period_id: RECOVERY_PERIOD,
    start_date: '2091-09-01',
    end_date: '2091-09-30',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  writer = new ChainWriter({
    chainDir: CHAIN_DIR,
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });

  await writer.createPeriodFile(RECOVERY_PERIOD, null, {});

  // Write 3 chain entries (simulating the chain write without DB mirror).
  // Only entry 1 and 2 will be mirrored to the DB.
  // Entry 3 will be "missing" — simulating a crash after chain write.

  for (let i = 1; i <= 3; i++) {
    const amount = i * 100;
    const transactionId = `TXN-${RECOVERY_PERIOD}-RECOV-${String(i).padStart(5, '0')}`;

    const entry = await writer.appendEntry(RECOVERY_PERIOD, 'TRANSACTION', {
      transaction_id: transactionId,
      transaction_type: 'MANUAL_JOURNAL',
      reference: null,
      date: '2091-09-15',
      currency: 'GBP',
      description: `Recovery test transaction ${i}`,
      lines: [
        { account_code: '1000', description: 'Debit bank', debit: amount, credit: 0 },
        { account_code: '3000', description: 'Credit equity', debit: 0, credit: amount },
      ],
    });

    // Mirror transactions 1 and 2 to the DB — but NOT transaction 3 (simulating crash).
    if (i < 3) {
      await db('transactions').insert({
        transaction_id: transactionId,
        period_id: RECOVERY_PERIOD,
        transaction_type: 'MANUAL_JOURNAL',
        reference: null,
        date: '2091-09-15',
        currency: 'GBP',
        description: `Recovery test transaction ${i}`,
        status: 'COMMITTED',
        data_flag: 'PROVISIONAL',
        chain_sequence: entry.sequence,
        chain_period_id: RECOVERY_PERIOD,
        chain_verified: false,
        exchange_rate: '1',
        base_currency: 'GBP',
      });

      await db('transaction_lines').insert([
        {
          transaction_id: transactionId,
          period_id: RECOVERY_PERIOD,
          account_code: '1000',
          description: 'Debit bank',
          debit: amount.toFixed(2),
          credit: '0.00',
          base_debit: amount.toFixed(4),
          base_credit: '0.0000',
          data_flag: 'PROVISIONAL',
          chain_verified: false,
        },
        {
          transaction_id: transactionId,
          period_id: RECOVERY_PERIOD,
          account_code: '3000',
          description: 'Credit equity',
          debit: '0.00',
          credit: amount.toFixed(2),
          base_debit: '0.0000',
          base_credit: amount.toFixed(4),
          data_flag: 'PROVISIONAL',
          chain_verified: false,
        },
      ]);
    }
  }
});

afterAll(async () => {
  await cleanupPeriod();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recoverMissingTransactions', () => {
  const missingTxId = `TXN-${RECOVERY_PERIOD}-RECOV-00003`;

  it('initial state: 2 transactions in DB, 1 missing', async () => {
    const count = await db('transactions')
      .where('period_id', RECOVERY_PERIOD)
      .count<[{ count: string }]>('transaction_id as count')
      .first();
    expect(parseInt(count?.count ?? '0', 10)).toBe(2);

    const missing = await db('transactions').where('transaction_id', missingTxId).first();
    expect(missing).toBeUndefined();
  });

  it('recoverMissingTransactions detects 1 missing transaction and restores it', async () => {
    const result = await recoverMissingTransactions(CHAIN_DIR);

    expect(result.periods_checked).toBeGreaterThanOrEqual(1);
    expect(result.missing_transactions_found).toBeGreaterThanOrEqual(1);
    expect(result.transactions_recovered).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it('after recovery: 3 transactions in DB', async () => {
    const count = await db('transactions')
      .where('period_id', RECOVERY_PERIOD)
      .count<[{ count: string }]>('transaction_id as count')
      .first();
    expect(parseInt(count?.count ?? '0', 10)).toBe(3);
  });

  it('recovered transaction has correct data', async () => {
    const tx = await db('transactions')
      .where('transaction_id', missingTxId)
      .first<{
        transaction_id: string;
        period_id: string;
        currency: string;
        status: string;
      }>();

    expect(tx).toBeDefined();
    expect(tx!.transaction_id).toBe(missingTxId);
    expect(tx!.period_id).toBe(RECOVERY_PERIOD);
    expect(tx!.currency).toBe('GBP');
    expect(tx!.status).toBe('COMMITTED');
  });

  it('recovered transaction has correct lines (2 lines)', async () => {
    const lines = await db('transaction_lines').where('transaction_id', missingTxId);
    expect(lines).toHaveLength(2);

    const debitLine = (lines as Array<{ account_code: string; debit: string }>)
      .find((l) => parseFloat(l.debit) > 0);
    expect(debitLine?.account_code).toBe('1000');
    expect(parseFloat(debitLine!.debit)).toBeCloseTo(300, 1); // 3rd transaction = 3 × 100
  });

  it('other 2 transactions are unaffected — no duplicates', async () => {
    for (let i = 1; i <= 2; i++) {
      const txId = `TXN-${RECOVERY_PERIOD}-RECOV-${String(i).padStart(5, '0')}`;
      const count = await db('transactions')
        .where('transaction_id', txId)
        .count<[{ count: string }]>('transaction_id as count')
        .first();
      expect(parseInt(count?.count ?? '0', 10)).toBe(1); // exactly 1, no duplicate
    }
  });

  it('running recovery again is idempotent — finds 0 missing transactions in this period', async () => {
    const result = await recoverMissingTransactions(CHAIN_DIR);

    // The 3 transactions in RECOVERY_PERIOD should all be present now.
    // missing_transactions_found may be > 0 for other periods (from other tests),
    // but for our period it should be 0.
    // Check that our transaction is not "found" again.
    expect(result.transactions_recovered).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
