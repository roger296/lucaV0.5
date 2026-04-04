/**
 * Integration tests for multi-currency support.
 *
 * Tests:
 *  - Exchange rate CRUD via REST API
 *  - GBP (base currency) transactions: base amounts = transaction amounts
 *  - Foreign-currency transactions: base amounts computed from exchange rate
 *  - Auto-lookup of exchange rate from table when not provided inline
 *  - Validation errors for invalid rates (400 from API)
 *  - Trial balance includes base currency totals
 */

import request from 'supertest';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';
import { postTransaction } from '../../src/engine/post';
import { setRate } from '../../src/db/queries/exchange_rates';

const API_KEY = 'dev';
const AUTH = { 'X-API-Key': API_KEY };

const TEST_PERIOD = '2088-06';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanupPeriod(): Promise<void> {
  await db('transaction_lines')
    .whereIn(
      'transaction_id',
      db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'),
    )
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();
}

async function cleanupExchangeRates(): Promise<void> {
  await db('exchange_rates')
    .whereIn('from_currency', ['USD', 'EUR', 'JPY', 'CHF'])
    .del();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let chainWriter: import('../../src/chain/writer').ChainWriter;

beforeAll(async () => {
  await cleanupPeriod();
  await cleanupExchangeRates();

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2088-06-01',
    end_date: '2088-06-30',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  const { ChainWriter } = await import('../../src/chain/writer');
  chainWriter = new ChainWriter({
    chainDir: 'chains/default',
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods')
        .where('period_id', pid)
        .select('status')
        .first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
  await chainWriter.createPeriodFile(TEST_PERIOD, null, {});

  // Seed exchange rates used across multiple tests.
  await setRate('USD', 'GBP', '0.80', '2088-06-01');
  await setRate('EUR', 'GBP', '0.855', '2088-06-01');
});

afterAll(async () => {
  await cleanupPeriod();
  await cleanupExchangeRates();

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.join('chains/default', `${TEST_PERIOD}.chain.jsonl`);
  try { await fs.chmod(filePath, 0o644); } catch { /* ignore */ }
  try { await fs.unlink(filePath); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Exchange rate REST API
// ---------------------------------------------------------------------------

describe('Exchange rate REST API', () => {
  it('POST /api/exchange-rates — sets a CHF/GBP rate', async () => {
    const res = await request(app)
      .post('/api/exchange-rates')
      .set(AUTH)
      .send({ from_currency: 'CHF', to_currency: 'GBP', rate: '0.88', effective_date: '2088-06-01' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.from_currency).toBe('CHF');
    expect(res.body.data.to_currency).toBe('GBP');
  });

  it('POST /api/exchange-rates — upserts (same pair + date updates rate)', async () => {
    await request(app)
      .post('/api/exchange-rates')
      .set(AUTH)
      .send({ from_currency: 'CHF', to_currency: 'GBP', rate: '0.89', effective_date: '2088-06-01' });

    const res = await request(app)
      .get('/api/exchange-rates/lookup?from_currency=CHF&to_currency=GBP&date=2088-06-01')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.rate).toBe('0.89000000');
  });

  it('GET /api/exchange-rates — lists rates', async () => {
    const res = await request(app)
      .get('/api/exchange-rates')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /api/exchange-rates/latest — returns latest rate for pair', async () => {
    const res = await request(app)
      .get('/api/exchange-rates/latest?from_currency=USD&to_currency=GBP')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.from_currency).toBe('USD');
    expect(res.body.data.to_currency).toBe('GBP');
  });

  it('GET /api/exchange-rates/lookup — returns rate for pair+date', async () => {
    const res = await request(app)
      .get('/api/exchange-rates/lookup?from_currency=USD&to_currency=GBP&date=2088-06-15')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.data.rate)).toBeCloseTo(0.80, 2);
  });

  it('GET /api/exchange-rates/lookup — 404 when no rate found', async () => {
    const res = await request(app)
      .get('/api/exchange-rates/lookup?from_currency=JPY&to_currency=GBP&date=2088-06-01')
      .set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RATE_NOT_FOUND');
  });

  it('POST /api/exchange-rates — rejects non-positive rate', async () => {
    const res = await request(app)
      .post('/api/exchange-rates')
      .set(AUTH)
      .send({ from_currency: 'USD', to_currency: 'GBP', rate: '-0.5', effective_date: '2088-06-01' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RATE');
  });

  it('POST /api/exchange-rates — rejects invalid currency code length', async () => {
    const res = await request(app)
      .post('/api/exchange-rates')
      .set(AUTH)
      .send({ from_currency: 'US', to_currency: 'GBP', rate: '0.79', effective_date: '2088-06-01' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENCY');
  });

  it('POST /api/exchange-rates — rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/exchange-rates')
      .set(AUTH)
      .send({ from_currency: 'USD', to_currency: 'GBP' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELDS');
  });

  it('DELETE /api/exchange-rates/:id — deletes a rate', async () => {
    const create = await request(app)
      .post('/api/exchange-rates')
      .set(AUTH)
      .send({ from_currency: 'JPY', to_currency: 'GBP', rate: '0.0053', effective_date: '2088-06-01' });

    const id = create.body.data.id as string;

    const del = await request(app)
      .delete(`/api/exchange-rates/${id}`)
      .set(AUTH);

    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
  });

  it('DELETE /api/exchange-rates/:id — 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/exchange-rates/00000000-0000-0000-0000-000000000000')
      .set(AUTH);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Multi-currency posting — engine-level (bypasses approval, tests DB values)
// ---------------------------------------------------------------------------

describe('Multi-currency posting — engine', () => {
  it('GBP transaction: base_debit = debit, base_credit = credit', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-10',
        period_id: TEST_PERIOD,
        currency: 'GBP',
        description: 'GBP test entry',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 500, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 500 },
        ],
      },
      chainWriter,
    );

    // Auto-approved or staged — in either case assert no error thrown.
    expect(['COMMITTED', 'STAGED']).toContain(result.status);

    if (result.status === 'COMMITTED') {
      const lines = await db('transaction_lines').where(
        'transaction_id',
        (result as import('../../src/engine/types').CommittedResult).transaction_id,
      );
      for (const line of lines as Array<{ debit: string; credit: string; base_debit: string; base_credit: string }>) {
        expect(parseFloat(line.base_debit)).toBeCloseTo(parseFloat(line.debit), 2);
        expect(parseFloat(line.base_credit)).toBeCloseTo(parseFloat(line.credit), 2);
      }
    }
  });

  it('USD transaction with inline rate: base amounts = amount × rate', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-10',
        period_id: TEST_PERIOD,
        currency: 'USD',
        exchange_rate: '0.80',
        description: 'USD explicit rate test',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 1000, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 1000 },
        ],
      },
      chainWriter,
    );

    expect(['COMMITTED', 'STAGED']).toContain(result.status);

    if (result.status === 'COMMITTED') {
      const txId = (result as import('../../src/engine/types').CommittedResult).transaction_id;
      const lines = await db('transaction_lines').where('transaction_id', txId);
      const debitLine = (
        lines as Array<{ account_code: string; debit: string; base_debit: string; base_credit: string }>
      ).find((l) => parseFloat(l.debit) > 0);
      // 1000 USD × 0.80 = 800 GBP
      expect(parseFloat(debitLine!.base_debit)).toBeCloseTo(800, 2);

      const tx = await db('transactions')
        .where('transaction_id', txId)
        .first<{ exchange_rate: string; base_currency: string; currency: string }>();
      expect(tx?.currency).toBe('USD');
      expect(parseFloat(tx?.exchange_rate ?? '0')).toBeCloseTo(0.80, 3);
      expect(tx?.base_currency).toBe('GBP');
    }
  });

  it('USD transaction without inline rate: auto-looks up rate from table', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-10',
        period_id: TEST_PERIOD,
        currency: 'USD',
        // No explicit exchange_rate — should auto-lookup from exchange_rates table.
        description: 'USD auto-lookup test',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 500, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 500 },
        ],
      },
      chainWriter,
    );

    expect(['COMMITTED', 'STAGED']).toContain(result.status);

    if (result.status === 'COMMITTED') {
      const txId = (result as import('../../src/engine/types').CommittedResult).transaction_id;
      const lines = await db('transaction_lines').where('transaction_id', txId);
      const debitLine = (
        lines as Array<{ account_code: string; debit: string; base_debit: string; base_credit: string }>
      ).find((l) => parseFloat(l.debit) > 0);
      // 500 USD × 0.80 (from table) = 400 GBP
      expect(parseFloat(debitLine!.base_debit)).toBeCloseTo(400, 2);
    }
  });

  it('EUR transaction: base amounts computed correctly', async () => {
    const result = await postTransaction(
      {
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-15',
        period_id: TEST_PERIOD,
        currency: 'EUR',
        exchange_rate: '0.855',
        description: 'EUR entry to verify DB storage',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 2000, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 2000 },
        ],
      },
      chainWriter,
    );

    expect(['COMMITTED', 'STAGED']).toContain(result.status);

    if (result.status === 'COMMITTED') {
      const txId = (result as import('../../src/engine/types').CommittedResult).transaction_id;
      const lines = await db('transaction_lines').where('transaction_id', txId);
      const debitLine = (
        lines as Array<{ account_code: string; debit: string; base_debit: string; base_credit: string }>
      ).find((l) => parseFloat(l.debit) > 0);
      // 2000 EUR × 0.855 = 1710 GBP
      expect(parseFloat(debitLine!.base_debit)).toBeCloseTo(1710, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation errors via API
// ---------------------------------------------------------------------------

describe('Multi-currency validation — API', () => {
  it('Foreign currency without rate and no table entry → 400 EXCHANGE_RATE_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-10',
        period_id: TEST_PERIOD,
        currency: 'JPY',
        description: 'JPY without rate — should fail',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 10000, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 10000 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EXCHANGE_RATE_REQUIRED');
  });

  it('GBP transaction with exchange_rate != 1 → 400 CURRENCY_MISMATCH', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-10',
        period_id: TEST_PERIOD,
        currency: 'GBP',
        exchange_rate: '1.5',
        description: 'Invalid GBP rate',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 100, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 100 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CURRENCY_MISMATCH');
  });

  it('USD with auto-lookup succeeds (rate exists in table) → 201 or 202', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-06-10',
        period_id: TEST_PERIOD,
        currency: 'USD',
        description: 'USD auto-lookup via API',
        lines: [
          { account_code: '1000', description: 'Debit bank', debit: 200, credit: 0 },
          { account_code: '3000', description: 'Credit equity', debit: 0, credit: 200 },
        ],
      });

    // Should succeed (201 committed or 202 staged) — not 400 or 500.
    expect([201, 202]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trial balance — base currency totals
// ---------------------------------------------------------------------------

describe('Trial balance — base currency totals', () => {
  it('includes total_base_debits, total_base_credits, and base_balanced fields', async () => {
    const res = await request(app)
      .get(`/api/reports/trial-balance?period_id=${TEST_PERIOD}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total_base_debits');
    expect(res.body.data).toHaveProperty('total_base_credits');
    expect(res.body.data).toHaveProperty('base_balanced');
  });
});
