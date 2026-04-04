import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../db/connection';
import { requirePermission } from './middleware/authorise';
import { registerBankAccount, importBankStatementCSV, importBankStatementJSON } from '../engine/bank-import';
import { runAutoMatch, confirmMatch, postAndMatch, excludeLine, getReconciliationStatus } from '../engine/bank-reconciliation';

export const bankRouter = Router();

/** POST /api/bank-accounts */
bankRouter.post('/', requirePermission('transaction:post'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await registerBankAccount(req.body as Parameters<typeof registerBankAccount>[0]);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** GET /api/bank-accounts */
bankRouter.get('/', requirePermission('report:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('bank_accounts').where('is_active', true).orderBy('id');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /api/bank-accounts/confirm-match */
bankRouter.post('/confirm-match', requirePermission('transaction:post'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await confirmMatch({ ...req.body, confirmed_by: 'api-user' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** POST /api/bank-accounts/post-and-match */
bankRouter.post('/post-and-match', requirePermission('transaction:post'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await postAndMatch({ ...req.body, confirmed_by: 'api-user' });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

/** POST /api/bank-accounts/exclude-line */
bankRouter.post('/exclude-line', requirePermission('transaction:post'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await excludeLine({ ...req.body, excluded_by: 'api-user' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** POST /api/bank-accounts/:id/import */
bankRouter.post('/:id/import', requirePermission('transaction:post'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bank_account_id = req.params['id'] as string;
    const { format, csv_content, column_mapping, date_format, lines } = req.body as {
      format: 'CSV' | 'JSON';
      csv_content?: string;
      column_mapping?: Record<string, string>;
      date_format?: string;
      lines?: Array<{ date: string; description: string; amount: number; balance?: number; reference?: string; transaction_type?: string; counterparty_name?: string }>;
    };

    let result;
    if (format === 'CSV') {
      if (!csv_content || !column_mapping) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'csv_content and column_mapping required for CSV' } });
        return;
      }
      result = await importBankStatementCSV({
        bank_account_id,
        csv_content,
        column_mapping: {
          date: column_mapping['date']!,
          description: column_mapping['description']!,
          amount: column_mapping['amount'],
          credit: column_mapping['credit'],
          debit: column_mapping['debit'],
          balance: column_mapping['balance'],
          reference: column_mapping['reference'],
        },
        date_format,
        imported_by: 'api',
      });
    } else {
      if (!lines) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'lines required for JSON' } });
        return;
      }
      result = await importBankStatementJSON({ bank_account_id, lines, imported_by: 'api' });
    }
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** GET /api/bank-accounts/:id/statement-lines */
bankRouter.get('/:id/statement-lines', requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bank_account_id = req.params['id'] as string;
    const { import_batch_id, match_status, date_from, date_to } = req.query as Record<string, string | undefined>;

    let query = db('bank_statement_lines').where('bank_account_id', bank_account_id).orderBy('date', 'desc');
    if (import_batch_id) query = query.where('import_batch_id', import_batch_id);
    if (match_status) query = query.where('match_status', match_status);
    if (date_from) query = query.where('date', '>=', date_from);
    if (date_to) query = query.where('date', '<=', date_to);

    const rows = await query;
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /api/bank-accounts/:id/reconcile */
bankRouter.post('/:id/reconcile', requirePermission('transaction:post'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runAutoMatch({ bank_account_id: req.params['id'] as string, ...req.body });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

/** GET /api/bank-accounts/:id/reconciliation-status */
bankRouter.get('/:id/reconciliation-status', requirePermission('report:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getReconciliationStatus({ bank_account_id: req.params['id'] as string, ...req.query as Record<string, string | undefined> });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});
