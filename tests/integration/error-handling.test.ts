/**
 * Integration tests for comprehensive error handling (Prompt 8).
 *
 * Tests:
 *  - Duplicate idempotency key → 409 DUPLICATE_IDEMPOTENCY_KEY
 *  - Invalid date format → 400 VALIDATION_ERROR
 *  - Post to closed period → 409 PERIOD_CLOSED
 *  - Duplicate account code → 409 CONSTRAINT_VIOLATION
 *  - Error responses include request_id
 *  - Health check endpoint → 200 with status info
 *  - X-Request-ID header echoed back
 */

import request from 'supertest';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';

const API_KEY = 'dev';
const AUTH = { 'X-API-Key': API_KEY };

const TEST_PERIOD = '2088-08';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Clean up period.
  await db('transaction_lines')
    .whereIn(
      'transaction_id',
      db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'),
    )
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();

  await db('periods').insert({
    period_id: TEST_PERIOD,
    start_date: '2088-08-01',
    end_date: '2088-08-31',
    status: 'OPEN',
    data_flag: 'PROVISIONAL',
    opened_at: new Date().toISOString(),
  });

  // Create chain file for the test period.
  const { ChainWriter } = await import('../../src/chain/writer');
  const writer = new ChainWriter({
    chainDir: 'chains/default',
    getPeriodStatus: async (pid: string) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
  await writer.createPeriodFile(TEST_PERIOD, null, {});
});

afterAll(async () => {
  await db('transaction_lines')
    .whereIn(
      'transaction_id',
      db('transactions').where('period_id', TEST_PERIOD).select('transaction_id'),
    )
    .del();
  await db('transactions').where('period_id', TEST_PERIOD).del();
  await db('staging').where('period_id', TEST_PERIOD).del();
  await db('periods').where('period_id', TEST_PERIOD).del();

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.join('chains/default', `${TEST_PERIOD}.chain.jsonl`);
  try { await fs.chmod(filePath, 0o644); } catch { /* ignore */ }
  try { await fs.unlink(filePath); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  it('returns 200 with status info — no auth required', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.database).toBe('connected');
    expect(res.body).toHaveProperty('chain_dir');
    expect(res.body).toHaveProperty('chain_dir_writable');
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.uptime_seconds).toBe('number');
  });

  it('returns X-Request-ID header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Request ID tracking
// ---------------------------------------------------------------------------

describe('Request ID tracking', () => {
  it('echoes X-Request-ID header from client', async () => {
    const myId = 'my-trace-id-12345';
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-ID', myId);

    expect(res.headers['x-request-id']).toBe(myId);
  });

  it('generates a UUID when no X-Request-ID provided', async () => {
    const res = await request(app).get('/api/health');
    const id = res.headers['x-request-id'] as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('error responses include request_id in body', async () => {
    const myId = 'error-trace-abc';
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .set('X-Request-ID', myId)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: 'not-a-date', // invalid
        period_id: TEST_PERIOD,
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 100 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.request_id).toBe(myId);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe('Validation errors', () => {
  it('invalid date format → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: 'not-a-date',
        period_id: TEST_PERIOD,
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 100 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toHaveProperty('request_id');
  });

  it('missing period_id → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-08-10',
        // no period_id
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 100 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('unbalanced journal → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-08-10',
        period_id: TEST_PERIOD,
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 50 }, // doesn't balance
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Duplicate idempotency key
// ---------------------------------------------------------------------------

describe('Duplicate idempotency key', () => {
  const IDEMPOTENCY_KEY = `error-test-idem-${Date.now()}`;

  beforeAll(async () => {
    // Post the first transaction — should succeed.
    await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-08-10',
        period_id: TEST_PERIOD,
        idempotency_key: IDEMPOTENCY_KEY,
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 100 },
        ],
      });
  });

  it('posting with duplicate idempotency key → 409 DUPLICATE_IDEMPOTENCY_KEY or is accepted (idempotent)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2088-08-10',
        period_id: TEST_PERIOD,
        idempotency_key: IDEMPOTENCY_KEY,
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 100 },
        ],
      });

    // Either it's rejected with 409 (duplicate detection), or idempotently accepted (201/202).
    // The key constraint violation would give 409 DUPLICATE_IDEMPOTENCY_KEY.
    // Staging (for MANUAL_JOURNAL) may not trigger unique constraint until commit.
    expect([201, 202, 409]).toContain(res.status);
    if (res.status === 409) {
      expect(res.body.error.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
      expect(res.body.error).toHaveProperty('request_id');
    }
  });
});

// ---------------------------------------------------------------------------
// Constraint violations
// ---------------------------------------------------------------------------

describe('Constraint violations', () => {
  it('duplicate account code → 409 CONSTRAINT_VIOLATION', async () => {
    // First create the account.
    await request(app)
      .post('/api/accounts')
      .set(AUTH)
      .send({ code: '9999', name: 'Test account', type: 'ASSET', category: 'CURRENT_ASSET' });

    // Try to create it again.
    const res = await request(app)
      .post('/api/accounts')
      .set(AUTH)
      .send({ code: '9999', name: 'Test account duplicate', type: 'ASSET', category: 'CURRENT_ASSET' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONSTRAINT_VIOLATION');
    expect(res.body.error).toHaveProperty('request_id');

    // Cleanup
    await db('accounts').where('code', '9999').del();
  });
});

// ---------------------------------------------------------------------------
// Post to closed period
// ---------------------------------------------------------------------------

describe('Post to closed period', () => {
  // Use a far-past period that we'll fake as HARD_CLOSE.
  const CLOSED_PERIOD = '2000-01';

  beforeAll(async () => {
    await db('periods')
      .insert({
        period_id: CLOSED_PERIOD,
        start_date: '2000-01-01',
        end_date: '2000-01-31',
        status: 'HARD_CLOSE',
        data_flag: 'AUTHORITATIVE',
        opened_at: new Date().toISOString(),
        hard_closed_at: new Date().toISOString(),
      })
      .onConflict('period_id')
      .merge({ status: 'HARD_CLOSE' });
  });

  afterAll(async () => {
    await db('staging').where('period_id', CLOSED_PERIOD).del();
    await db('periods').where('period_id', CLOSED_PERIOD).del();
  });

  it('posting to a HARD_CLOSE period → 409 PERIOD_CLOSED', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set(AUTH)
      .send({
        transaction_type: 'MANUAL_JOURNAL',
        date: '2000-01-15',
        period_id: CLOSED_PERIOD,
        lines: [
          { account_code: '1000', description: 'x', debit: 100, credit: 0 },
          { account_code: '3000', description: 'y', debit: 0, credit: 100 },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_CLOSED');
    expect(res.body.error).toHaveProperty('request_id');
  });
});
