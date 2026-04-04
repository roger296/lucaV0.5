import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import Decimal from 'decimal.js';
import { requirePermission } from './middleware/authorise';
import { setRate, getRate, getRates, deleteRate, getLatestRate } from '../db/queries/exchange_rates';

// ---------------------------------------------------------------------------
// exchange-rates.ts — REST endpoints for exchange rate management
// ---------------------------------------------------------------------------

export const exchangeRatesRouter = Router();

/** GET /api/exchange-rates?from_currency=&to_currency=&date= */
exchangeRatesRouter.get(
  '/',
  requirePermission('report:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from_currency, to_currency, date } = req.query as Record<string, string | undefined>;
      const rates = await getRates({ fromCurrency: from_currency, toCurrency: to_currency, date });
      res.json({ success: true, data: rates });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/exchange-rates — set a rate for a currency pair and date */
exchangeRatesRouter.post(
  '/',
  requirePermission('system:configure'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from_currency, to_currency, rate, effective_date, source } =
        req.body as Record<string, string | undefined>;

      if (!from_currency || !to_currency || !rate || !effective_date) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'from_currency, to_currency, rate, and effective_date are required',
          },
        });
        return;
      }

      // Validate rate is a positive number.
      let rateDecimal: Decimal;
      try {
        rateDecimal = new Decimal(rate);
      } catch {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_RATE', message: 'rate must be a valid number' },
        });
        return;
      }

      if (rateDecimal.lte(0)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_RATE', message: 'rate must be a positive number' },
        });
        return;
      }

      // Validate currency codes are 3-character alphabetic.
      const currencyRegex = /^[A-Za-z]{3}$/;
      if (!currencyRegex.test(from_currency) || !currencyRegex.test(to_currency)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_CURRENCY', message: 'Currency codes must be 3 alphabetic characters' },
        });
        return;
      }

      // Validate date format.
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(effective_date)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_DATE', message: 'effective_date must be YYYY-MM-DD' },
        });
        return;
      }

      const row = await setRate(from_currency, to_currency, rate, effective_date, source);
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/exchange-rates/latest?from_currency=&to_currency= */
exchangeRatesRouter.get(
  '/latest',
  requirePermission('report:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from_currency, to_currency } = req.query as Record<string, string | undefined>;

      if (!from_currency || !to_currency) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'from_currency and to_currency are required' },
        });
        return;
      }

      const row = await getLatestRate(from_currency, to_currency);
      if (!row) {
        res.status(404).json({
          success: false,
          error: {
            code: 'RATE_NOT_FOUND',
            message: `No rate found for ${from_currency}/${to_currency}`,
          },
        });
        return;
      }

      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/exchange-rates/lookup?from_currency=&to_currency=&date= */
exchangeRatesRouter.get(
  '/lookup',
  requirePermission('report:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from_currency, to_currency, date } = req.query as Record<string, string | undefined>;

      if (!from_currency || !to_currency || !date) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'from_currency, to_currency, and date are required' },
        });
        return;
      }

      const row = await getRate(from_currency, to_currency, date);
      if (!row) {
        res.status(404).json({
          success: false,
          error: {
            code: 'RATE_NOT_FOUND',
            message: `No rate found for ${from_currency}/${to_currency} on or before ${date}`,
          },
        });
        return;
      }

      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/exchange-rates/:id */
exchangeRatesRouter.delete(
  '/:id',
  requirePermission('system:configure'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      const deleted = await deleteRate(id);
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Exchange rate ${id} not found` },
        });
        return;
      }
      res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
      next(err);
    }
  },
);
