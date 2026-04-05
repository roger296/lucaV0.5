import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import {
  createOAuthClient,
  listOAuthClients,
  revokeOAuthClient,
} from '../engine/oauth';

// ---------------------------------------------------------------------------
// api/oauth-clients.ts — manage OAuth clients (admin only)
// ---------------------------------------------------------------------------

export const oauthClientsRouter = Router();

/** GET /api/oauth-clients — list all clients */
oauthClientsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await listOAuthClients();
    res.json({ success: true, data: clients });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/oauth-clients — create a new client
 * The client_secret is returned ONCE in this response and never again.
 */
oauthClientsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'name is required' },
      });
      return;
    }

    const client = await createOAuthClient(name.trim());
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/oauth-clients/:id — revoke a client */
oauthClientsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    const ok = await revokeOAuthClient(id);
    if (!ok) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Client ${id} not found` },
      });
      return;
    }
    res.json({ success: true, data: { revoked: true } });
  } catch (err) {
    next(err);
  }
});
