import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as webhooksDb from '../db/queries/webhooks';
import { signPayload } from '../engine/webhooks';
import { requirePermission } from './middleware/authorise';

// ---------------------------------------------------------------------------
// webhooks.ts — Webhook subscription management endpoints (ADMIN / system:configure)
// ---------------------------------------------------------------------------

export const webhooksRouter = Router();

const VALID_EVENT_TYPES = [
  'TRANSACTION_POSTED',
  'TRANSACTION_STAGED',
  'TRANSACTION_APPROVED',
  'TRANSACTION_REJECTED',
  'PERIOD_SOFT_CLOSED',
  'PERIOD_CLOSED',
  'APPROVAL_ESCALATED',
];

/** GET /api/webhooks — list all webhook subscriptions */
webhooksRouter.get('/', requirePermission('system:configure'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const subscriptions = await webhooksDb.listSubscriptions();

    // Mask secrets before returning — only expose the first 4 chars
    const masked = subscriptions.map((s) => ({
      ...s,
      secret: s.secret.slice(0, 4) + '****',
    }));

    res.json({ success: true, data: masked });
  } catch (err) {
    next(err);
  }
});

/** POST /api/webhooks — create a new webhook subscription */
webhooksRouter.post('/', requirePermission('system:configure'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { callback_url, event_types, secret } = req.body as {
      callback_url?: string;
      event_types?: string[];
      secret?: string;
    };

    if (!callback_url || !event_types || !secret) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'callback_url, event_types, and secret are required',
        },
      });
      return;
    }

    if (!Array.isArray(event_types) || event_types.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'event_types must be a non-empty array' },
      });
      return;
    }

    const invalidTypes = event_types.filter((t) => !VALID_EVENT_TYPES.includes(t));
    if (invalidTypes.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid event types: ${invalidTypes.join(', ')}. Valid types: ${VALID_EVENT_TYPES.join(', ')}`,
        },
      });
      return;
    }

    const subscription = await webhooksDb.insertSubscription({ callback_url, event_types, secret });

    // Mask secret in response
    res.status(201).json({
      success: true,
      data: {
        ...subscription,
        secret: subscription.secret.slice(0, 4) + '****',
      },
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/webhooks/:id — delete a webhook subscription */
webhooksRouter.delete('/:id', requirePermission('system:configure'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };

    const subscription = await webhooksDb.getSubscription(id);
    if (!subscription) {
      res.status(404).json({
        success: false,
        error: { code: 'WEBHOOK_NOT_FOUND', message: `Webhook subscription ${id} not found` },
      });
      return;
    }

    await webhooksDb.deleteSubscription(id);

    res.json({ success: true, data: { deleted: true, id } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/webhooks/:id/deliveries — list delivery history for a subscription */
webhooksRouter.get('/:id/deliveries', requirePermission('system:configure'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };

    const subscription = await webhooksDb.getSubscription(id);
    if (!subscription) {
      res.status(404).json({
        success: false,
        error: { code: 'WEBHOOK_NOT_FOUND', message: `Webhook subscription ${id} not found` },
      });
      return;
    }

    const deliveries = await webhooksDb.listDeliveriesForSubscription(id);

    res.json({ success: true, data: deliveries });
  } catch (err) {
    next(err);
  }
});

/** POST /api/webhooks/:id/test — send a test delivery to a subscription */
webhooksRouter.post('/:id/test', requirePermission('system:configure'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    const subscription = await webhooksDb.getSubscription(id);
    if (!subscription) {
      res.status(404).json({
        success: false,
        error: { code: 'WEBHOOK_NOT_FOUND', message: `Webhook subscription ${id} not found` },
      });
      return;
    }

    const testPayload = JSON.stringify({
      event_id: uuidv4(),
      event_type: 'TEST',
      timestamp: new Date().toISOString(),
      data: { message: 'Test delivery from GL MVP' },
    });

    const signature = signPayload(testPayload, subscription.secret);
    let reachable = false;
    let statusCode: number | null = null;
    let error: string | null = null;

    try {
      const resp = await fetch(subscription.callback_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GL-Signature': signature,
          'X-GL-Event': 'TEST',
        },
        body: testPayload,
        signal: AbortSignal.timeout(10_000),
      });
      reachable = resp.ok;
      statusCode = resp.status;
    } catch (fetchErr: unknown) {
      error = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    }

    res.json({ success: true, data: { reachable, status_code: statusCode, error } });
  } catch (err) {
    next(err);
  }
});
