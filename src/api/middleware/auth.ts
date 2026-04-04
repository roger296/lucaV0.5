import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index';

// ---------------------------------------------------------------------------
// middleware/auth.ts — JWT authentication middleware
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;          // user ID
  email?: string;       // present for human users, absent for module tokens
  display_name?: string;
  roles?: string[];
  module_id?: string;   // set when the caller is a module (not a user)
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      userId: string;
      userEmail: string;
      userDisplayName: string;
      userRoles: string[];
      moduleId: string | null;
      jwtPayload: JwtPayload | null;
    }
  }
}

/**
 * JWT authentication middleware.
 *
 * Accepts:
 *   - Authorization: Bearer <jwt>   (production and tests with a real token)
 *   - X-API-Key: dev                (development/test shortcut — non-production only)
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Dev/test shortcut: any non-production environment can use the API key bypass.
  const apiKey = req.headers['x-api-key'];
  if (apiKey === config.dev.apiKey && config.env !== 'production') {
    req.userId = 'dev-user';
    req.userEmail = 'dev@system.internal';
    req.userDisplayName = 'Dev User';
    req.userRoles = ['ADMIN', 'FINANCE_MANAGER'];
    req.moduleId = null;
    req.jwtPayload = null;
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'MISSING_AUTH', message: 'Authentication required' },
    });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.userId = payload.sub;
    req.userEmail = payload.email ?? '';
    req.userDisplayName = payload.display_name ?? '';
    req.userRoles = payload.roles ?? [];
    req.moduleId = payload.module_id ?? null;
    req.jwtPayload = payload;
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }
}
