import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// ---------------------------------------------------------------------------
// request-id.ts — Attaches a unique request ID to every inbound request
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Middleware that attaches a request ID to every request.
 *
 * - If the caller provides `X-Request-ID`, that value is used (allowing
 *   end-to-end request tracing across services).
 * - Otherwise a fresh UUID is generated.
 * - The ID is echoed back in the `X-Request-ID` response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
