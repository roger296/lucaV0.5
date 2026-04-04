/**
 * Integration tests for the chain rebuild engine.
 *
 * Requires the test PostgreSQL database (port 5433) and the filesystem.
 * Run with NODE_ENV=test.
 *
 * Approach: write chain entries directly via ChainWriter (bypassing the posting
 * engine) and insert DB mirror rows manually.  Then delete the DB rows and
 * rebuild to verify idempotent restoration.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { db } from '../../src/db/connection';
import { ChainWriter } from '../../src/chain/writer';
import { ChainReader } from '../../src/chain/reader';
import { rebuildFromChain } from '../../src/chain/rebuild';

// Use a far-future period to avoid conflicts with other tests
const REBUILD_PERIOD = '2090-03';
const CHAIN_DIR = 'chains/default';

// Track the chain entries we write so we can verify them after rebuild
const writtenTransactions: Array<{ sequence: number; amount: number }> = [];

async function cleanupPeriod(): Promise<void> {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', REBUILD_PERIOD).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', REBUILD_PERIOD).del();
  await db('staging').where('period_id', REBUILD_PERIOD).del();
  await db('periods').where('period_id', REBUILD_PERIOD).del();

  const filePath = path.join(CHAIN_DIR, `${REBUILD_PERIOD}.chain.jsonl`);
  try {
    await fs.chmod(filePath, 0o644);
  } catch { /* ignore */ }
  try {
    await fs.unlink(filePath);
  } catch { /* ignore */ }
}

beforeAll(async () => {
  await cleanupPeriod();

  // Create the period in the DB
  await db('periods').insert({
    period_id: REBUILD_PERIOD,
    start_date: '2090-03-01',
    end_date: '2090-03-31',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  // Create the chain file
  const writer = new ChainWriter({
    chainDir: CHAIN_DIR,
    getPeriodStatus: async (pid) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });

  await writer.createPeriodFile(REBUILD_PERIOD, null, {});

  // Write 3 TRANSACTION entries directly via the writer and mirror to DB
  for (let i = 0; i < 3; i++) {
    const amount = 100 + i * 50;
    const entry = await writer.appendEntry(REBUILD_PERIOD, 'TRANSACTION', {
      transaction_type: 'MANUAL_JOURNAL',
      reference: null,
      date: '2090-03-15',
      currency: 'GBP',
      description: `Test transaction ${i + 1}`,
      lines: [
        { account_code: '1000', description: 'Debit bank', debit: amount, credit: 0 },
        { account_code: '3000', description: 'Credit equity', debit: 0, credit: amount },
      ],
    });

    writtenTransactions.push({ sequence: entry.sequence, amount });

    // Mirror to DB (what the posting engine normally does)
    const transactionId = `TXN-${REBUILD_PERIOD}-${String(i + 1).padStart(5, '0')}`;
    await db('transactions').insert({
      transaction_id: transactionId,
      period_id: REBUILD_PERIOD,
      transaction_type: 'MANUAL_JOURNAL',
      reference: null,
      date: '2090-03-15',
      currency: 'GBP',
      description: `Test transaction ${i + 1}`,
      status: 'COMMITTED',
      data_flag: 'PROVISIONAL',
      chain_sequence: entry.sequence,
      chain_period_id: REBUILD_PERIOD,
      chain_verified: false,
    });

    await db('transaction_lines').insert([
      {
        transaction_id: transactionId,
        period_id: REBUILD_PERIOD,
        account_code: '1000',
        description: 'Debit bank',
        debit: amount.toFixed(2),
        credit: '0.00',
        data_flag: 'PROVISIONAL',
        chain_verified: false,
      },
      {
        transaction_id: transactionId,
        period_id: REBUILD_PERIOD,
        account_code: '3000',
        description: 'Credit equity',
        debit: '0.00',
        credit: amount.toFixed(2),
        data_flag: 'PROVISIONAL',
        chain_verified: false,
      },
    ]);
  }
});

afterAll(async () => {
  await cleanupPeriod();
});

// ---------------------------------------------------------------------------

describe('rebuildFromChain', () => {
  it('verifies 3 transactions are in the DB after setup', async () => {
    const count = await db('transactions').where('period_id', REBUILD_PERIOD).count<[{ count: string }]>('transaction_id as count').first();
    expect(parseInt(count?.count ?? '0', 10)).toBe(3);
  });

  it('deletes transactions from DB (simulating data loss)', async () => {
    await db('transaction_lines')
      .whereIn(
        'transaction_id',
        db('transactions').where('period_id', REBUILD_PERIOD).select('transaction_id'),
      )
      .del();
    await db('transactions').where('period_id', REBUILD_PERIOD).del();

    const count = await db('transactions').where('period_id', REBUILD_PERIOD).count<[{ count: string }]>('transaction_id as count').first();
    expect(parseInt(count?.count ?? '0', 10)).toBe(0);
  });

  it('rebuilds from chain and restores 3 transactions', async () => {
    const result = await rebuildFromChain(CHAIN_DIR);

    // There should be no errors related to this period
    const periodErrors = result.errors.filter((e) => e.includes(REBUILD_PERIOD));
    expect(periodErrors).toHaveLength(0);

    const count = await db('transactions').where('period_id', REBUILD_PERIOD).count<[{ count: string }]>('transaction_id as count').first();
    expect(parseInt(count?.count ?? '0', 10)).toBe(3);
  });

  it('verifies restored transactions have correct line data', async () => {
    const lines = await db('transaction_lines')
      .join('transactions', 'transaction_lines.transaction_id', 'transactions.transaction_id')
      .where('transactions.period_id', REBUILD_PERIOD)
      .select('transaction_lines.*');

    // 3 transactions × 2 lines = 6 lines
    expect(lines).toHaveLength(6);

    // All lines should be for account codes 1000 or 3000
    const accountCodes = new Set(lines.map((l: { account_code: string }) => l.account_code));
    expect(accountCodes.has('1000')).toBe(true);
    expect(accountCodes.has('3000')).toBe(true);
  });

  it('running rebuild again does not create duplicates', async () => {
    // Run rebuild a second time
    await rebuildFromChain(CHAIN_DIR);

    const count = await db('transactions').where('period_id', REBUILD_PERIOD).count<[{ count: string }]>('transaction_id as count').first();
    // Still exactly 3 — no duplicates
    expect(parseInt(count?.count ?? '0', 10)).toBe(3);
  });

  it('verifies the chain file is intact', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.verifyChain(REBUILD_PERIOD);
    expect(result.valid).toBe(true);
    // GENESIS + 3 TRANSACTION entries = 4 entries
    expect(result.entries).toBe(4);
  });

  it('restored transactions have chain_sequence set correctly', async () => {
    const txRows = await db('transactions')
      .where('period_id', REBUILD_PERIOD)
      .orderBy('chain_sequence', 'asc')
      .select('chain_sequence', 'chain_period_id');

    expect(txRows).toHaveLength(3);
    for (const row of txRows as Array<{ chain_sequence: number; chain_period_id: string }>) {
      expect(row.chain_period_id).toBe(REBUILD_PERIOD);
      expect(row.chain_sequence).toBeGreaterThan(0);
    }
  });
});
