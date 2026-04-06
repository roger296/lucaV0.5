import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { db } from '../db/connection';
import { requirePermission } from './middleware/authorise';

// ---------------------------------------------------------------------------
// accounts.ts — Chart of Accounts REST endpoints
// ---------------------------------------------------------------------------

export const accountsRouter = Router();

/** GET /api/accounts?period_id=2026-03 */
accountsRouter.get('/', requirePermission('account:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period_id } = req.query as Record<string, string | undefined>;

    const balanceSubquery = db('transaction_lines')
      .select(
        'account_code',
        db.raw('COALESCE(SUM(debit), 0) as balance_debit'),
        db.raw('COALESCE(SUM(credit), 0) as balance_credit'),
      )
      .groupBy('account_code');
    if (period_id) balanceSubquery.where('period_id', period_id);

    const rows = await db('accounts')
      .leftJoin(balanceSubquery.as('bal'), 'bal.account_code', 'accounts.code')
      .select(
        'accounts.code',
        'accounts.name',
        'accounts.type',
        'accounts.category',
        'accounts.active',
        db.raw('COALESCE(bal.balance_debit, 0) as balance_debit'),
        db.raw('COALESCE(bal.balance_credit, 0) as balance_credit'),
      )
      .orderBy('accounts.code');

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/** GET /api/accounts/:code */
accountsRouter.get('/:code', requirePermission('account:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params as { code: string };
    const account = await db('accounts').where('code', code).first();
    if (!account) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Account ${code} not found` } });
      return;
    }
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

/** POST /api/accounts */
accountsRouter.post('/', requirePermission('account:create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, type, category } = req.body as Record<string, string>;
    if (!code || !name || !type) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'code, name, and type are required' } });
      return;
    }
    await db('accounts').insert({ code, name, type, category: category ?? null, active: true });
    const account = await db('accounts').where('code', code).first();
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/accounts/:code */
accountsRouter.put('/:code', requirePermission('account:update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params as { code: string };
    const { name, category, active } = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates['name'] = name;
    if (category !== undefined) updates['category'] = category;
    if (active !== undefined) updates['active'] = active;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      return;
    }
    const count = await db('accounts').where('code', code).update(updates);
    if (count === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Account ${code} not found` } });
      return;
    }
    const account = await db('accounts').where('code', code).first();
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});
