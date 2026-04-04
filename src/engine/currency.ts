import Decimal from 'decimal.js';
import { db } from '../db/connection';

// ---------------------------------------------------------------------------
// currency.ts — Multi-currency support for the posting engine
// ---------------------------------------------------------------------------

/** Returns the base currency of the system. GBP for MVP (single-tenant). */
export async function getBaseCurrency(): Promise<string> {
  // For MVP (single tenant), base currency is always GBP.
  // In a multi-tenant system, this would query the company_settings table.
  return 'GBP';
}

/**
 * Look up the most recent exchange rate on or before the given date.
 * Returns '1' if from === to. Returns null if no rate is found.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<string | null> {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return '1';

  const row = await db('exchange_rates')
    .where('from_currency', fromCurrency.toUpperCase())
    .where('to_currency', toCurrency.toUpperCase())
    .where('effective_date', '<=', date)
    .orderBy('effective_date', 'desc')
    .select('rate')
    .first<{ rate: string } | undefined>();

  return row ? String(row.rate) : null;
}

/**
 * Convert an amount from transaction currency to base currency.
 *
 * Result is rounded to 4 decimal places.
 */
export function convertToBase(amount: Decimal, exchangeRate: Decimal): Decimal {
  return amount.mul(exchangeRate).toDecimalPlaces(4);
}

/**
 * Ensure an exchange rate is available for the given currency pair.
 *
 * - If currency === baseCurrency, returns '1'.
 * - If exchangeRate is provided, returns it as-is.
 * - Otherwise throws ExchangeRateRequiredError.
 */
export function requireExchangeRate(
  currency: string,
  baseCurrency: string,
  exchangeRate?: string,
): string {
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) return '1';
  if (exchangeRate && exchangeRate.trim() !== '') return exchangeRate;
  throw new ExchangeRateRequiredError(currency, baseCurrency);
}

/**
 * Validate that the exchange rate is logically sound.
 *
 * - For same-currency transactions, rate must be 1 (or absent).
 * - For foreign-currency transactions, rate must be present and positive.
 */
export function validateExchangeRate(
  currency: string,
  baseCurrency: string,
  exchangeRate: string | null | undefined,
): void {
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) {
    // Same currency — if a rate is provided it must be 1.
    if (exchangeRate != null && exchangeRate !== '') {
      const r = new Decimal(exchangeRate);
      if (!r.eq(1)) {
        throw new CurrencyMismatchError(
          `Exchange rate for same-currency transaction must be 1, got ${exchangeRate}`,
        );
      }
    }
    return;
  }

  // Foreign currency — rate must be provided and positive.
  if (!exchangeRate || exchangeRate.trim() === '') {
    throw new ExchangeRateRequiredError(currency, baseCurrency);
  }

  const r = new Decimal(exchangeRate);
  if (r.lte(0)) {
    throw new CurrencyValidationError(
      `Exchange rate must be a positive number, got ${exchangeRate}`,
    );
  }
}

/**
 * Validate that both the transaction-currency totals and the base-currency
 * totals balance (debits = credits within a small tolerance for rounding).
 */
export function validateDualBalance(
  lines: Array<{ debit: string | number; credit: string | number; base_debit: string | number; base_credit: string | number }>,
): {
  transactionBalanced: boolean;
  baseBalanced: boolean;
  transactionDiff: string;
  baseDiff: string;
} {
  let txDebit = new Decimal(0);
  let txCredit = new Decimal(0);
  let baseDebit = new Decimal(0);
  let baseCredit = new Decimal(0);

  for (const line of lines) {
    txDebit = txDebit.plus(new Decimal(String(line.debit)));
    txCredit = txCredit.plus(new Decimal(String(line.credit)));
    baseDebit = baseDebit.plus(new Decimal(String(line.base_debit)));
    baseCredit = baseCredit.plus(new Decimal(String(line.base_credit)));
  }

  const tolerance = new Decimal('0.0001');
  const txDiff = txDebit.minus(txCredit).abs();
  const baseDiff = baseDebit.minus(baseCredit).abs();

  return {
    transactionBalanced: txDiff.lte(tolerance),
    baseBalanced: baseDiff.lte(tolerance),
    transactionDiff: txDiff.toFixed(4),
    baseDiff: baseDiff.toFixed(4),
  };
}

// ---------------------------------------------------------------------------
// FX Revaluation (used by Prompt 7 — period-end adjustments)
// ---------------------------------------------------------------------------

export const FX_GAINS_LOSSES_ACCOUNT = '7200';

export interface FxRevaluationEntry {
  account_code: string;
  foreign_currency: string;
  foreign_net_balance: string;
  recorded_base_net_balance: string;
  new_rate: string;
  new_base_net_balance: string;
  adjustment: string;
}

/**
 * Generate FX revaluation journal entries for a period.
 *
 * For each foreign currency in `closingRates`, finds all posted transaction
 * lines on ASSET or LIABILITY accounts and computes the FX adjustment needed
 * to bring the recorded base value in line with the closing rate.
 */
export async function generateFxRevaluations(
  periodId: string,
  closingRates: Record<string, string>,
): Promise<{
  entries: FxRevaluationEntry[];
  submissions: Array<{
    transaction_type: string;
    date: string;
    period_id: string;
    description: string;
    currency: string;
    exchange_rate: string;
    lines: Array<{ account_code: string; description: string; debit: number; credit: number }>;
    idempotency_key: string;
    source?: { module_id: string; module_reference: string };
  }>;
}> {
  const baseCurrency = await getBaseCurrency();
  const entries: FxRevaluationEntry[] = [];
  const submissions: Array<{
    transaction_type: string;
    date: string;
    period_id: string;
    description: string;
    currency: string;
    exchange_rate: string;
    lines: Array<{ account_code: string; description: string; debit: number; credit: number }>;
    idempotency_key: string;
    source?: { module_id: string; module_reference: string };
  }> = [];

  const today = new Date().toISOString().slice(0, 10);

  for (const [foreignCurrency, newRateStr] of Object.entries(closingRates)) {
    if (foreignCurrency.toUpperCase() === baseCurrency.toUpperCase()) continue;

    const newRate = new Decimal(newRateStr);

    const rows = await db('transaction_lines as tl')
      .join('transactions as t', 't.transaction_id', 'tl.transaction_id')
      .join('accounts as a', 'a.code', 'tl.account_code')
      .where('t.period_id', periodId)
      .where('t.currency', foreignCurrency.toUpperCase())
      .where('t.status', 'COMMITTED')
      .whereIn('a.type', ['ASSET', 'LIABILITY'])
      .groupBy('tl.account_code')
      .select(
        'tl.account_code',
        db.raw('SUM(tl.debit::numeric)::text AS sum_debit'),
        db.raw('SUM(tl.credit::numeric)::text AS sum_credit'),
        db.raw('SUM(tl.base_debit::numeric)::text AS sum_base_debit'),
        db.raw('SUM(tl.base_credit::numeric)::text AS sum_base_credit'),
      );

    for (const row of rows as Array<Record<string, string>>) {
      const accountCode = row['account_code']!;
      const sumDebit = new Decimal(row['sum_debit'] ?? '0');
      const sumCredit = new Decimal(row['sum_credit'] ?? '0');
      const sumBaseDebit = new Decimal(row['sum_base_debit'] ?? '0');
      const sumBaseCredit = new Decimal(row['sum_base_credit'] ?? '0');

      const foreignNet = sumDebit.minus(sumCredit);
      const recordedBaseNet = sumBaseDebit.minus(sumBaseCredit);
      const newBaseNet = foreignNet.mul(newRate).toDecimalPlaces(4);
      const adjustment = newBaseNet.minus(recordedBaseNet);

      if (adjustment.abs().lte(new Decimal('0.0001'))) continue;

      entries.push({
        account_code: accountCode,
        foreign_currency: foreignCurrency,
        foreign_net_balance: foreignNet.toFixed(4),
        recorded_base_net_balance: recordedBaseNet.toFixed(4),
        new_rate: newRateStr,
        new_base_net_balance: newBaseNet.toFixed(4),
        adjustment: adjustment.toFixed(4),
      });

      // Build balanced journal lines in base currency (GBP)
      const absAdj = adjustment.abs().toNumber();
      const isGain = adjustment.gt(0);

      let assetDebit: number;
      let assetCredit: number;
      let gainDebit: number;
      let gainCredit: number;

      if (isGain) {
        // Asset increases in base value → debit asset, credit FX gains
        assetDebit = absAdj;
        assetCredit = 0;
        gainDebit = 0;
        gainCredit = absAdj;
      } else {
        // Asset decreases in base value → credit asset, debit FX losses
        assetDebit = 0;
        assetCredit = absAdj;
        gainDebit = absAdj;
        gainCredit = 0;
      }

      submissions.push({
        transaction_type: 'FX_REVALUATION',
        date: today,
        period_id: periodId,
        description: `FX revaluation: ${foreignCurrency}/${baseCurrency} @ ${newRateStr} (period ${periodId})`,
        currency: baseCurrency,
        exchange_rate: '1',
        lines: [
          {
            account_code: accountCode,
            description: `FX revaluation - ${foreignCurrency}/${baseCurrency}`,
            debit: assetDebit,
            credit: assetCredit,
          },
          {
            account_code: FX_GAINS_LOSSES_ACCOUNT,
            description: `FX ${isGain ? 'gain' : 'loss'} - ${foreignCurrency}/${baseCurrency}`,
            debit: gainDebit,
            credit: gainCredit,
          },
        ],
        idempotency_key: `fx-reval-${periodId}-${foreignCurrency}-${accountCode}`,
        source: {
          module_id: 'system',
          module_reference: `FX-REVAL-${periodId}-${foreignCurrency}`,
        },
      });
    }
  }

  return { entries, submissions };
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ExchangeRateRequiredError extends Error {
  constructor(currency: string, baseCurrency: string) {
    super(
      `Exchange rate required for ${currency} → ${baseCurrency}. ` +
        `Provide exchange_rate in the submission or add a rate to the exchange_rates table.`,
    );
    this.name = 'ExchangeRateRequiredError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyMismatchError';
  }
}

export class CurrencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyValidationError';
  }
}
