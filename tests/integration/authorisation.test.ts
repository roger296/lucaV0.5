/**
 * Integration tests for role-based access control.
 *
 * Requires the test PostgreSQL database (port 5433).
 * Run with NODE_ENV=test.
 */

import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';

// ---------------------------------------------------------------------------
// Helper — create a user with the given roles and return a Bearer token
// ---------------------------------------------------------------------------

const USERS_CREATED: string[] = [];

async function createUserAndLogin(roles: string[]): Promise<string> {
  const email = `rbac-${roles.join('-')}-${Date.now()}@example.com`;
  const hash = await bcrypt.hash('password', 10);
  const [user] = await db('users')
    .insert({
      email,
      password_hash: hash,
      display_name: `Test ${roles.join('+')}`,
      roles,
      is_active: true,
    })
    .returning('id');
  USERS_CREATED.push((user as { id: string }).id);

  const res = await request(app).post('/api/auth/login').send({ email, password: 'password' });
  return res.body.data.token as string;
}

afterAll(async () => {
  if (USERS_CREATED.length) {
    await db('users').whereIn('id', USERS_CREATED).del();
  }
  // Don't call db.destroy() — auth.test.ts already does it. Jest isolates modules per file.
});

// ---------------------------------------------------------------------------
// VIEWER role — can read, cannot post/approve/close
// ---------------------------------------------------------------------------

describe('VIEWER role', () => {
  let token: string;

  beforeAll(async () => {
    token = await createUserAndLogin(['VIEWER']);
  });

  it('can GET /api/transactions (transaction:view)', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });

  it('cannot POST /api/transactions (transaction:post) → 403', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ transaction_type: 'MANUAL_JOURNAL', date: '2026-04-01', period_id: '2026-04', lines: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot POST /api/staging/:id/approve → 403', async () => {
    const res = await request(app)
      .post('/api/staging/fake-id/approve')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('cannot POST /api/periods/:id/soft-close → 403', async () => {
    const res = await request(app)
      .post('/api/periods/2026-04/soft-close')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('cannot GET /api/users (user:manage) → 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// APPROVER role — can view + approve, cannot post or close
// ---------------------------------------------------------------------------

describe('APPROVER role', () => {
  let token: string;

  beforeAll(async () => {
    token = await createUserAndLogin(['APPROVER']);
  });

  it('cannot POST /api/transactions → 403', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ transaction_type: 'CUSTOMER_INVOICE', date: '2026-04-01', period_id: '2026-04', amount: 100 });
    expect(res.status).toBe(403);
  });

  it('can POST /api/staging/:id/approve (returns 404 for fake ID, not 403)', async () => {
    const res = await request(app)
      .post('/api/staging/non-existent-id/approve')
      .set('Authorization', `Bearer ${token}`);
    // 404 or 500 means the permission check passed; 403 would mean it failed
    expect(res.status).not.toBe(403);
  });

  it('can GET /api/reports/trial-balance (report:view)', async () => {
    const res = await request(app)
      .get('/api/reports/trial-balance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// FINANCE_MANAGER role — can post and approve
// ---------------------------------------------------------------------------

describe('FINANCE_MANAGER role', () => {
  let token: string;

  beforeAll(async () => {
    token = await createUserAndLogin(['FINANCE_MANAGER']);
  });

  it('can GET /api/transactions', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });

  it('can access period management endpoints (not 403)', async () => {
    // Soft-close may fail for business reasons (period not ended, etc.) but NOT 403
    const res = await request(app)
      .post('/api/periods/9999-01/soft-close')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });

  it('cannot GET /api/users → 403 (no user:manage permission)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// ADMIN role — full access including user management
// ---------------------------------------------------------------------------

describe('ADMIN role', () => {
  let token: string;

  beforeAll(async () => {
    token = await createUserAndLogin(['ADMIN']);
  });

  it('can GET /api/users (user:manage)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('can POST /api/users (create a user)', async () => {
    const email = `admin-created-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email, password: 'pass123', display_name: 'New User', roles: ['VIEWER'] });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data).not.toHaveProperty('password_hash');
    // Clean up
    await db('users').where('email', email).del();
  });

  it('can access all protected routes without 403', async () => {
    const routes = [
      { method: 'get', path: '/api/accounts' },
      { method: 'get', path: '/api/transactions' },
      { method: 'get', path: '/api/staging' },
      { method: 'get', path: '/api/periods' },
      { method: 'get', path: '/api/reports/trial-balance' },
    ];
    for (const route of routes) {
      const res = await (request(app) as any)[route.method](route.path).set('Authorization', `Bearer ${token}`);
      expect(res.status).not.toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// getUserPermissions — unit-level check via the API response
// ---------------------------------------------------------------------------

describe('Dev API key (ADMIN+FINANCE_MANAGER permissions)', () => {
  it('can access all authenticated routes', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('X-API-Key', 'dev');
    expect(res.status).toBe(200);
  });
});
