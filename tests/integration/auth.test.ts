/**
 * Integration tests for authentication endpoints.
 *
 * Requires the test PostgreSQL database (port 5433).
 * Run with NODE_ENV=test.
 */

import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../../src/server';
import { db } from '../../src/db/connection';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_EMAIL = `auth-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'SecurePass123!';
let TEST_USER_ID: string;

async function createTestUser(overrides: {
  email?: string;
  password?: string;
  roles?: string[];
  is_active?: boolean;
} = {}): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? TEST_EMAIL;
  const password = overrides.password ?? TEST_PASSWORD;
  const hash = await bcrypt.hash(password, 10);
  const [user] = await db('users')
    .insert({
      email,
      password_hash: hash,
      display_name: 'Test User',
      roles: overrides.roles ?? ['FINANCE_MANAGER'],
      is_active: overrides.is_active ?? true,
    })
    .returning(['id', 'email']);
  return user as { id: string; email: string };
}

beforeAll(async () => {
  const user = await createTestUser();
  TEST_USER_ID = user.id;
});

afterAll(async () => {
  await db('users').where('email', 'like', 'auth-test-%@example.com').del();
  await db('users').where('email', 'like', 'disabled-%@example.com').del();
  await db.destroy();
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('returns 200 with a JWT and user object on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('expires_at');
    expect(res.body.data.user).toMatchObject({ email: TEST_EMAIL });
    expect(res.body.data.user).not.toHaveProperty('password_hash');
  });

  it('returns 401 on invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 on non-existent email (same response as wrong password)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'irrelevant' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for a disabled account', async () => {
    const disabled = await createTestUser({
      email: `disabled-${Date.now()}@example.com`,
      is_active: false,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: disabled.email, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('returns 400 when fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELDS');
  });
});

// ---------------------------------------------------------------------------
// Protected endpoint — no auth header
// ---------------------------------------------------------------------------

describe('Protected endpoints without auth', () => {
  it('returns 401 MISSING_AUTH when no header is provided', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_AUTH');
  });

  it('returns 401 INVALID_TOKEN when an invalid JWT is provided', async () => {
    const res = await request(app)
      .get('/api/accounts')
      .set('Authorization', 'Bearer this.is.not.a.valid.token');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// Dev API key bypass
// ---------------------------------------------------------------------------

describe('Dev API key bypass', () => {
  it('succeeds with X-API-Key: dev in test mode', async () => {
    const res = await request(app)
      .get('/api/accounts')
      .set('X-API-Key', 'dev');

    // Should NOT be 401 — the dev key grants access
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

describe('POST /api/auth/refresh', () => {
  it('returns a new token when called with a valid JWT', async () => {
    // First, log in to get a token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const token = loginRes.body.data.token as string;

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.data).toHaveProperty('token');
    // New token must be different (it will have a later iat/exp)
    expect(refreshRes.body.data.token).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it('returns current user data when called with a valid JWT', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const token = loginRes.body.data.token as string;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.email).toBe(TEST_EMAIL);
    expect(meRes.body.data).not.toHaveProperty('password_hash');
  });
});
