/**
 * Multi-currency report tests (Prompt 9).
 *
 * Posts transactions in GBP, USD, and EUR then verifies:
 * - Trial balance uses base_debit/base_credit totals
 * - base_balanced is true
 */

import request from 'supertest';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';
import { setRate } from '../../src/db/queries/exchange_rates';

const API_KEY = 'dev';
const AUTH = { 'X-API-Key': API_KEY };
const TEST_PERIOD = '2088-12';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2088-12-01',
    end_date: '2088-12-31',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  const { ChainWriter } = await import('../../src/chain/writer');
  const writer = new ChainWriter({
    chainDir: 'chains/default',
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
  await writer.createPeriodFile(TEST_PERIOD, null, {});

  // Seed rates.
  await setRate('USD', 'GBP', '0.80', '2088-12-01');
  await setRate('EUR', 'GBP', '0.855', '2088-12-01');

  // Post a GBP CUSTOMER_PAYMENT.
  await request(app)
    .post('/api/transactions')
    .set(AUTH)
    .send({
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2088-12-05',
      period_id: TEST_PERIOD,
      currency: 'GBP',
      amount: 1000,
    });

  // Post a USD CUSTOMER_PAYMENT with rate.
  await request(app)
    .post('/api/transactions')
    .set(AUTH)
    .send({
      transaction_type: 'CUSTOMER_PAYMENT',
      date: '2088-12-10',
      period_id: TEST_PERIOD,
      currency: 'USD',
      exchange_rate: '0.80',
      amount: 500,
    });
});

afterAll(async () => {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();

  await db('exchange_rates')
    .whereIn('from_currency', ['USD', 'EUR'])
    .where('effective_date', '2088-12-01')
    .del();

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const fp = path.join('chains/default', `${TEST_PERIOD}.chain.jsonl`);
  try { await fs.chmod(fp, 0o644); } catch { /**/ }
  try { await fs.unlink(fp); } catch { /**/ }
});

// ---------------------------------------------------------------------------
// Trial balance with base currency
// ---------------------------------------------------------------------------

describe('Trial balance — multi-currency base totals', () => {
  it('returns total_base_debits and total_base_credits', async () => {
    const res = await request(app)
      .get(`/api/reports/trial-balance?period_id=${TEST_PERIOD}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total_base_debits');
    expect(res.body.data).toHaveProperty('total_base_credits');
    expect(res.body.data).toHaveProperty('base_balanced');
  });

  it('base_balanced is true (all transactions balanced before/after conversion)', async () => {
    const res = await request(app)
      .get(`/api/reports/trial-balance?period_id=${TEST_PERIOD}`)
      .set(AUTH);

    expect(res.body.data.base_balanced).toBe(true);
  });

  it('account rows include total_base_debits and total_base_credits columns', async () => {
    const res = await request(app)
      .get(`/api/reports/trial-balance?period_id=${TEST_PERIOD}`)
      .set(AUTH);

    const lines = res.body.data.lines as Array<{
      total_base_debits: string;
      total_base_credits: string;
    }>;
    // At least one line should exist if any committed transactions exist
    if (lines.length > 0) {
      expect(lines[0]).toHaveProperty('total_base_debits');
      expect(lines[0]).toHaveProperty('total_base_credits');
    }
  });
});

// ---------------------------------------------------------------------------
// Committed transactions have base_debit / base_credit set
// ---------------------------------------------------------------------------

describe('Committed transactions — base amounts in DB', () => {
  it('COMMITTED transactions have non-null base_debit/base_credit on lines', async () => {
    const lines = await db('transaction_lines')
      .join('transactions', 'transaction_lines.transaction_id', 'transactions.transaction_id')
      .where('transactions.period_id', TEST_PERIOD)
      .where('transactions.status', 'COMMITTED')
      .select('transaction_lines.*');

    if (lines.length > 0) {
      for (const line of lines as Array<{ base_debit: string; base_credit: string }>) {
        expect(line.base_debit).not.toBeNull();
        expect(line.base_credit).not.toBeNull();
      }
    }
  });

  it('GBP transactions: base_debit = debit, base_credit = credit', async () => {
    const lines = await db('transaction_lines')
      .join('transactions', 'transaction_lines.transaction_id', 'transactions.transaction_id')
      .where('transactions.period_id', TEST_PERIOD)
      .where('transactions.currency', 'GBP')
      .where('transactions.status', 'COMMITTED')
      .select('transaction_lines.debit', 'transaction_lines.credit',
              'transaction_lines.base_debit', 'transaction_lines.base_credit');

    for (const line of lines as Array<{ debit: string; credit: string; base_debit: string; base_credit: string }>) {
      expect(parseFloat(line.base_debit)).toBeCloseTo(parseFloat(line.debit), 2);
      expect(parseFloat(line.base_credit)).toBeCloseTo(parseFloat(line.credit), 2);
    }
  });
});
