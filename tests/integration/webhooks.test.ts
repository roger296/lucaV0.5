/**
 * Integration tests for the webhook subscription management API.
 *
 * Requires the test PostgreSQL database (port 5433).
 * Run with NODE_ENV=test.
 *
 * Note: Actual HTTP delivery to external URLs is NOT tested here — that
 * requires a live callback endpoint.  These tests verify the REST API for
 * managing subscriptions (CRUD) and the signature utility.
 */

import request from 'supertest';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';
import { signPayload } from '../../src/engine/webhooks';

// Dev API key has ADMIN + FINANCE_MANAGER permissions (system:configure)
const AUTH = { 'X-API-Key': 'dev' };

// Track created subscriptions for cleanup
const CREATED_IDS: string[] = [];

afterAll(async () => {
  if (CREATED_IDS.length > 0) {
    await db('webhook_deliveries').whereIn('subscription_id', CREATED_IDS).del();
    await db('webhook_subscriptions').whereIn('id', CREATED_IDS).del();
  }
});

// ---------------------------------------------------------------------------
// signPayload utility
// ---------------------------------------------------------------------------

describe('signPayload utility', () => {
  it('produces a sha256= prefixed HMAC', () => {
    const sig = signPayload('hello world', 'secret');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce same signature', () => {
    const a = signPayload('payload', 'my-secret');
    const b = signPayload('payload', 'my-secret');
    expect(a).toBe(b);
  });

  it('differs when secret changes', () => {
    const a = signPayload('payload', 'secret-a');
    const b = signPayload('payload', 'secret-b');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Authentication / authorisation guards
// ---------------------------------------------------------------------------

describe('Webhook endpoint authentication', () => {
  it('GET /api/webhooks without auth → 401', async () => {
    const res = await request(app).get('/api/webhooks');
    expect(res.status).toBe(401);
  });

  it('GET /api/webhooks with VIEWER token → 403', async () => {
    // Create a VIEWER user and log in
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('password', 10);
    const email = `webhook-viewer-${Date.now()}@example.com`;
    const [userRow] = await db('users')
      .insert({ email, password_hash: hash, display_name: 'Viewer', roles: ['VIEWER'], is_active: true })
      .returning('id');
    const userId = (userRow as { id: string }).id;

    const loginRes = await request(app).post('/api/auth/login').send({ email, password: 'password' });
    const token = loginRes.body.data.token as string;

    const res = await request(app).get('/api/webhooks').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);

    // Cleanup
    await db('users').where('id', userId).del();
  });
});

// ---------------------------------------------------------------------------
// CRUD happy path (using dev API key which has system:configure)
// ---------------------------------------------------------------------------

describe('Webhook CRUD', () => {
  let createdId: string;

  it('POST /api/webhooks — creates a subscription', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set(AUTH)
      .send({
        callback_url: 'https://example.com/webhook',
        event_types: ['TRANSACTION_POSTED', 'PERIOD_CLOSED'],
        secret: 'my-super-secret',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.callback_url).toBe('https://example.com/webhook');
    expect(res.body.data.event_types).toEqual(['TRANSACTION_POSTED', 'PERIOD_CLOSED']);
    // Secret must be masked in the response
    expect(res.body.data.secret).not.toBe('my-super-secret');
    expect(res.body.data.secret).toMatch(/^my-s\*{4}$/);
    expect(res.body.data.is_active).toBe(true);

    createdId = res.body.data.id as string;
    CREATED_IDS.push(createdId);
  });

  it('GET /api/webhooks — lists subscriptions including the new one', async () => {
    const res = await request(app).get('/api/webhooks').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const found = (res.body.data as Array<{ id: string }>).find((s) => s.id === createdId);
    expect(found).toBeDefined();
  });

  it('GET /api/webhooks/:id/deliveries — returns delivery history (empty)', async () => {
    const res = await request(app).get(`/api/webhooks/${createdId}/deliveries`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // No deliveries yet
    expect(res.body.data).toHaveLength(0);
  });

  it('DELETE /api/webhooks/:id — deletes the subscription', async () => {
    const res = await request(app).delete(`/api/webhooks/${createdId}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);
    expect(res.body.data.id).toBe(createdId);

    // Verify it's gone
    const listRes = await request(app).get('/api/webhooks').set(AUTH);
    const found = (listRes.body.data as Array<{ id: string }>).find((s) => s.id === createdId);
    expect(found).toBeUndefined();

    // Remove from cleanup list since already deleted
    const idx = CREATED_IDS.indexOf(createdId);
    if (idx !== -1) CREATED_IDS.splice(idx, 1);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe('Webhook validation', () => {
  it('POST /api/webhooks without required fields → 400', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set(AUTH)
      .send({ callback_url: 'https://example.com/hook' });
    // Missing event_types and secret
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/webhooks with empty event_types array → 400', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set(AUTH)
      .send({ callback_url: 'https://example.com/hook', event_types: [], secret: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/webhooks with invalid event type → 400', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set(AUTH)
      .send({ callback_url: 'https://example.com/hook', event_types: ['NOT_A_REAL_EVENT'], secret: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /api/webhooks/:id with non-existent id → 404', async () => {
    const res = await request(app)
      .delete('/api/webhooks/00000000-0000-0000-0000-000000000000')
      .set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WEBHOOK_NOT_FOUND');
  });

  it('GET /api/webhooks/:id/deliveries with non-existent id → 404', async () => {
    const res = await request(app)
      .get('/api/webhooks/00000000-0000-0000-0000-000000000000/deliveries')
      .set(AUTH);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// All valid event types are accepted
// ---------------------------------------------------------------------------

describe('Valid event types', () => {
  const VALID = [
    'TRANSACTION_POSTED',
    'TRANSACTION_STAGED',
    'TRANSACTION_APPROVED',
    'TRANSACTION_REJECTED',
    'PERIOD_SOFT_CLOSED',
    'PERIOD_CLOSED',
    'APPROVAL_ESCALATED',
  ];

  it('accepts all valid event types in a single subscription', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set(AUTH)
      .send({
        callback_url: 'https://example.com/all-events',
        event_types: VALID,
        secret: 'all-events-secret',
      });

    expect(res.status).toBe(201);
    CREATED_IDS.push(res.body.data.id as string);
  });
});
