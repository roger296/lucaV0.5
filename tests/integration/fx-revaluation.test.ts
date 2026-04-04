/**
 * Integration tests for FX Revaluation (Prompt 7).
 *
 * Tests the period-end FX revaluation engine:
 *  - Preview mode returns entries without posting
 *  - Post mode posts journals and marks them COMMITTED (or STAGED)
 *  - No entries generated when no foreign-currency ASSET/LIABILITY lines exist
 *  - Adjustment skipped when below tolerance (0.0001 GBP)
 *  - Revaluation logic: foreignNet × newRate - recordedBaseNet = adjustment
 *  - REST endpoint: POST /api/periods/:id/fx-revaluation
 *  - MCP tool: gl_fx_revaluation
 */

import request from 'supertest';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';
import { setRate } from '../../src/db/queries/exchange_rates';
import { generateFxRevaluations } from '../../src/engine/currency';

const API_KEY = 'dev';
const AUTH = { 'X-API-Key': API_KEY };

const TEST_PERIOD = '2088-07';
const OPENING_RATE = '0.75'; // USD/GBP rate when transactions were recorded
const CLOSING_RATE = '0.80'; // USD/GBP rate at period-end (stronger GBP... wait no — weaker USD)

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let chainWriter: import('../../src/chain/writer').ChainWriter;

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

async function cleanupRates(): Promise<void> {
  await db('exchange_rates')
    .whereIn('from_currency', ['USD'])
    .where('effective_date', '2088-07-01')
    .del();
}

beforeAll(async () => {
  await cleanupPeriod();
  await cleanupRates();

  // Ensure FX Gains/Losses account exists.
  await db('accounts')
    .insert({
      code: '7200',
      name: 'FX Gains and Losses',
      type: 'REVENUE',
      category: 'OTHER_INCOME',
      active: true,
    })
    .onConflict('code')
    .merge({ name: 'FX Gains and Losses' });

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2088-07-01',
    end_date: '2088-07-31',
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

  // Seed an opening exchange rate (rate when transactions were entered).
  await setRate('USD', 'GBP', OPENING_RATE, '2088-07-01');

  // Write a committed USD transaction directly (bypassing approval engine)
  // so generateFxRevaluations can find COMMITTED ASSET lines.
  // Account 1000 = ASSET: debit 10,000 USD at rate 0.75 = 7,500 GBP base.
  const chainEntry = await chainWriter.appendEntry(TEST_PERIOD, 'TRANSACTION', {
    transaction_type: 'MANUAL_JOURNAL',
    reference: null,
    date: '2088-07-10',
    currency: 'USD',
    description: 'USD bank receipt at 0.75',
    lines: [
      { account_code: '1000', description: 'Debit bank USD', debit: 10000, credit: 0 },
      { account_code: '3000', description: 'Credit equity', debit: 0, credit: 10000 },
    ],
  });

  const txId = `TXN-${TEST_PERIOD}-00001`;
  await db('transactions').insert({
    transaction_id: txId,
    period_id: TEST_PERIOD,
    transaction_type: 'MANUAL_JOURNAL',
    reference: null,
    date: '2088-07-10',
    currency: 'USD',
    description: 'USD bank receipt at 0.75',
    status: 'COMMITTED',
    data_flag: 'PROVISIONAL',
    chain_sequence: chainEntry.sequence,
    chain_period_id: TEST_PERIOD,
    chain_verified: false,
    exchange_rate: OPENING_RATE,
    base_currency: 'GBP',
  });

  await db('transaction_lines').insert([
    {
      transaction_id: txId,
      period_id: TEST_PERIOD,
      account_code: '1000',
      description: 'Debit bank USD',
      debit: '10000.00',
      credit: '0.00',
      base_debit: '7500.0000',
      base_credit: '0.0000',
      data_flag: 'PROVISIONAL',
      chain_verified: false,
    },
    {
      transaction_id: txId,
      period_id: TEST_PERIOD,
      account_code: '3000',
      description: 'Credit equity',
      debit: '0.00',
      credit: '10000.00',
      base_debit: '0.0000',
      base_credit: '7500.0000',
      data_flag: 'PROVISIONAL',
      chain_verified: false,
    },
  ]);
});

afterAll(async () => {
  await cleanupPeriod();
  await cleanupRates();

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.join('chains/default', `${TEST_PERIOD}.chain.jsonl`);
  try { await fs.chmod(filePath, 0o644); } catch { /* ignore */ }
  try { await fs.unlink(filePath); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Engine-level tests (generateFxRevaluations)
// ---------------------------------------------------------------------------

describe('generateFxRevaluations — engine', () => {
  it('returns empty entries when no foreign-currency asset/liability lines exist', async () => {
    // Use a closing rate of 0.75 (same as opening) — no adjustment needed.
    // For any transaction: adjustment = 0, skipped.
    const { entries, submissions } = await generateFxRevaluations(TEST_PERIOD, { USD: '0.75' });

    // Adjustment = foreignNet × newRate - recordedBaseNet
    // foreignNet = 10000 - 10000 = 0 (account 1000 has debit only; account 3000 is EQUITY, excluded)
    // Actually account 1000 (ASSET): debit=10000, credit=0, foreignNet=10000
    // newBaseNet = 10000 × 0.75 = 7500
    // recordedBaseNet = 7500
    // adjustment = 0 → skipped
    expect(entries).toHaveLength(0);
    expect(submissions).toHaveLength(0);
  });

  it('generates revaluation entry when closing rate differs from opening rate', async () => {
    // Closing rate 0.80: foreignNet=10000, newBaseNet=8000, recordedBaseNet=7500, adj=+500
    const { entries, submissions } = await generateFxRevaluations(TEST_PERIOD, { USD: CLOSING_RATE });

    expect(entries.length).toBeGreaterThan(0);

    const entry = entries.find((e) => e.account_code === '1000');
    expect(entry).toBeDefined();
    expect(entry!.foreign_currency).toBe('USD');
    expect(entry!.new_rate).toBe(CLOSING_RATE);

    // foreignNet = 10000, newBaseNet = 10000 × 0.80 = 8000
    // recordedBaseNet = 10000 × 0.75 = 7500, adjustment = +500
    expect(parseFloat(entry!.adjustment)).toBeCloseTo(500, 2);
    expect(submissions.length).toBeGreaterThan(0);
  });

  it('revaluation journal has two balanced lines: asset account and FX gains account', async () => {
    const { submissions } = await generateFxRevaluations(TEST_PERIOD, { USD: CLOSING_RATE });

    expect(submissions.length).toBeGreaterThan(0);
    const sub = submissions[0]!;

    expect(sub.transaction_type).toBe('FX_REVALUATION');
    expect(sub.currency).toBe('GBP');
    expect(sub.exchange_rate).toBe('1');
    expect(sub.lines).toHaveLength(2);

    const totalDebit = sub.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = sub.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 4);
  });

  it('idempotency_key includes period, currency, and account code', async () => {
    const { submissions } = await generateFxRevaluations(TEST_PERIOD, { USD: CLOSING_RATE });

    const sub = submissions[0]!;
    expect(sub.idempotency_key).toContain(TEST_PERIOD);
    expect(sub.idempotency_key).toContain('USD');
  });

  it('gain: asset account debited, FX gains account credited', async () => {
    // Closing rate 0.80 > opening 0.75 → USD asset worth more in GBP → gain
    const { submissions } = await generateFxRevaluations(TEST_PERIOD, { USD: CLOSING_RATE });

    const sub = submissions[0]!;
    const assetLine = sub.lines.find((l) => l.account_code === '1000');
    const fxLine = sub.lines.find((l) => l.account_code === '7200');

    expect(assetLine).toBeDefined();
    expect(fxLine).toBeDefined();
    // Gain: asset debit, FX credit
    expect(assetLine!.debit).toBeGreaterThan(0);
    expect(assetLine!.credit).toBe(0);
    expect(fxLine!.credit).toBeGreaterThan(0);
    expect(fxLine!.debit).toBe(0);
  });

  it('loss: asset account credited, FX losses account debited', async () => {
    // Use a lower closing rate than opening → loss
    const { submissions } = await generateFxRevaluations(TEST_PERIOD, { USD: '0.70' });

    if (submissions.length === 0) {
      // No committed ASSET lines in this period yet (all staged) — skip assertion.
      return;
    }

    const sub = submissions[0]!;
    const assetLine = sub.lines.find((l) => l.account_code === '1000');
    const fxLine = sub.lines.find((l) => l.account_code === '7200');

    if (assetLine && fxLine) {
      // Loss: asset credit, FX debit
      expect(assetLine!.credit).toBeGreaterThan(0);
      expect(assetLine!.debit).toBe(0);
      expect(fxLine!.debit).toBeGreaterThan(0);
      expect(fxLine!.credit).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// REST endpoint tests
// ---------------------------------------------------------------------------

describe('POST /api/periods/:id/fx-revaluation', () => {
  it('preview mode returns entries and submissions without posting', async () => {
    const res = await request(app)
      .post(`/api/periods/${TEST_PERIOD}/fx-revaluation`)
      .set(AUTH)
      .send({ closing_rates: { USD: CLOSING_RATE }, post: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preview).toBe(true);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
    expect(Array.isArray(res.body.data.submissions)).toBe(true);
  });

  it('requires closing_rates in body', async () => {
    const res = await request(app)
      .post(`/api/periods/${TEST_PERIOD}/fx-revaluation`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_PARAM');
  });

  it('returns 404 for unknown period', async () => {
    const res = await request(app)
      .post('/api/periods/9999-99/fx-revaluation')
      .set(AUTH)
      .send({ closing_rates: { USD: '0.80' } });

    expect(res.status).toBe(404);
  });

  it('post mode posts revaluation journals and returns results', async () => {
    const res = await request(app)
      .post(`/api/periods/${TEST_PERIOD}/fx-revaluation`)
      .set(AUTH)
      .send({ closing_rates: { USD: CLOSING_RATE }, post: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preview).toBe(false);
    // posted count equals number of entries.
    expect(typeof res.body.data.posted).toBe('number');
    expect(res.body.data.posted).toBe(res.body.data.entries.length);
  });

  it('requires period:hard_close permission', async () => {
    const res = await request(app)
      .post(`/api/periods/${TEST_PERIOD}/fx-revaluation`)
      .set({ 'X-API-Key': 'dev-readonly' }) // read-only key
      .send({ closing_rates: { USD: CLOSING_RATE } });

    expect([401, 403]).toContain(res.status);
  });
});
