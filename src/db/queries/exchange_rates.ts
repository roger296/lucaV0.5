import { db } from '../connection';

// ---------------------------------------------------------------------------
// exchange_rates.ts — DB query functions for exchange rates
// ---------------------------------------------------------------------------

export interface ExchangeRateRow {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: string; // DECIMAL returned as string by Knex
  effective_date: string;
  source: string | null;
  created_at: string;
}

/** Insert or update an exchange rate for a given pair and date. */
export async function setRate(
  fromCurrency: string,
  toCurrency: string,
  rate: string,
  effectiveDate: string,
  source?: string,
): Promise<ExchangeRateRow> {
  const [row] = await db('exchange_rates')
    .insert({
      from_currency: fromCurrency.toUpperCase(),
      to_currency: toCurrency.toUpperCase(),
      rate,
      effective_date: effectiveDate,
      source: source ?? null,
    })
    .onConflict(['from_currency', 'to_currency', 'effective_date'])
    .merge({ rate, source: source ?? null })
    .returning('*');
  return row as ExchangeRateRow;
}

/** Get the most recent rate on or before the given date. */
export async function getRate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<ExchangeRateRow | null> {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
    // Synthetic "1" rate for same-currency pairs
    return {
      id: 'synthetic',
      from_currency: fromCurrency.toUpperCase(),
      to_currency: toCurrency.toUpperCase(),
      rate: '1',
      effective_date: date,
      source: 'system',
      created_at: new Date().toISOString(),
    };
  }

  const row = await db('exchange_rates')
    .where('from_currency', fromCurrency.toUpperCase())
    .where('to_currency', toCurrency.toUpperCase())
    .where('effective_date', '<=', date)
    .orderBy('effective_date', 'desc')
    .first<ExchangeRateRow | undefined>();

  return row ?? null;
}

/** List rates with optional filters. */
export async function getRates(filters: {
  fromCurrency?: string;
  toCurrency?: string;
  date?: string;
}): Promise<ExchangeRateRow[]> {
  let query = db<ExchangeRateRow>('exchange_rates').orderBy('effective_date', 'desc');

  if (filters.fromCurrency) {
    query = query.where('from_currency', filters.fromCurrency.toUpperCase());
  }
  if (filters.toCurrency) {
    query = query.where('to_currency', filters.toCurrency.toUpperCase());
  }
  if (filters.date) {
    query = query.where('effective_date', '<=', filters.date);
  }

  return query.limit(100);
}

/** Delete an exchange rate by ID. */
export async function deleteRate(id: string): Promise<boolean> {
  const deleted = await db('exchange_rates').where('id', id).del();
  return deleted > 0;
}

/** Get the latest rate for a pair (no date filter). */
export async function getLatestRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<ExchangeRateRow | null> {
  const row = await db<ExchangeRateRow>('exchange_rates')
    .where('from_currency', fromCurrency.toUpperCase())
    .where('to_currency', toCurrency.toUpperCase())
    .orderBy('effective_date', 'desc')
    .first();
  return row ?? null;
}
