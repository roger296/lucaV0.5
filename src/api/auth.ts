import type { Request, Response } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '../config/index';
import { findUserByEmail, findUserById, recordLogin } from '../db/queries/users';
import { authenticate } from './middleware/auth';

// ---------------------------------------------------------------------------
// auth.ts — authentication endpoints (login, refresh, me)
// ---------------------------------------------------------------------------

// Dummy hash used for timing-attack-safe comparison when the user is not found.
const DUMMY_HASH = '$2b$10$dummyhashfortimingprotectionXXXXXXXXXXXXXXXXXXXXXX';

function issueToken(user: {
  id: string;
  email: string;
  roles: string[];
  display_name: string;
}): { token: string; expires_at: string } {
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles,
    display_name: user.display_name,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign(payload, config.jwt.secret as string, {
    expiresIn: config.jwt.expiresIn as any,
  });
  const decoded = jwt.decode(token) as { exp: number };
  const expires_at = new Date(decoded.exp * 1000).toISOString();
  return { token, expires_at };
}

function safeUser(user: {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
}) {
  return { id: user.id, email: user.email, display_name: user.display_name, roles: user.roles };
}

// ---------------------------------------------------------------------------
// Handlers (exported for testability)
// ---------------------------------------------------------------------------

export async function handleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'email and password are required' },
      });
      return;
    }

    const user = await findUserByEmail(email);

    // Always run bcrypt even when user is not found to prevent timing attacks.
    const hashToCheck = user ? user.password_hash : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !passwordMatch) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({
        success: false,
        error: { code: 'ACCOUNT_DISABLED', message: 'This account has been disabled' },
      });
      return;
    }

    await recordLogin(user.id);
    const { token, expires_at } = issueToken(user);

    res.json({ success: true, data: { token, user: safeUser(user), expires_at } });
  } catch (err) {
    console.error('[auth] Login error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
    });
  }
}

export async function handleRefresh(req: Request, res: Response): Promise<void> {
  try {
    const user = await findUserById(req.userId);

    if (!user || !user.is_active) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'User not found or account disabled' },
      });
      return;
    }

    const { token, expires_at } = issueToken(user);
    res.json({ success: true, data: { token, user: safeUser(user), expires_at } });
  } catch (err) {
    console.error('[auth] Refresh error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
    });
  }
}

export async function handleMe(req: Request, res: Response): Promise<void> {
  try {
    const user = await findUserById(req.userId);

    if (!user || !user.is_active) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'User not found or account disabled' },
      });
      return;
    }

    res.json({ success: true, data: safeUser(user) });
  } catch (err) {
    console.error('[auth] Me error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const authRouter = Router();

// POST /api/auth/login — public, no auth required
authRouter.post('/login', handleLogin);

// POST /api/auth/refresh — requires a valid JWT
authRouter.post('/refresh', authenticate, handleRefresh);

// GET /api/auth/me — requires a valid JWT
authRouter.get('/me', authenticate, handleMe);

export default authRouter;
