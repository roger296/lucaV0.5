import Decimal from 'decimal.js';
import { ChainWriter } from '../chain/writer';
import { db } from '../db/connection';
import { postTransaction } from './post';
import type { JournalLine, PostingResult } from './types';

// ---------------------------------------------------------------------------
// year-end.ts — year-end closing entries
// ---------------------------------------------------------------------------

export class YearEndError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YearEndError';
  }
}

export interface YearEndResult {
  financial_year_end: string;
  new_year_first_period: string;
  posting_result: PostingResult;
  lines_count: number;
  net_profit: string;
}

export interface YearEndCloseOptions {
  /** Earliest period (inclusive) to include in the P&L sweep. Defaults to all periods. */
  from_period?: string;
}

/**
 * Executes year-end closing entries.
 *
 * Reads the cumulative balances of all REVENUE and EXPENSE accounts up to and
 * including the financial year-end period, then posts a YEAR_END_CLOSE
 * transaction in the new year's first period that:
 *   - Zeroes out all REVENUE accounts (debit each revenue account)
 *   - Zeroes out all EXPENSE accounts (credit each expense account)
 *   - Posts the net profit/loss to Retained Earnings (3100)
 */
export async function executeYearEndClose(
  financialYearEnd: string,
  newYearFirstPeriod: string,
  chainWriterOverride?: ChainWriter,
  options?: YearEndCloseOptions,
): Promise<YearEndResult> {
  // ── Validate period states ────────────────────────────────────────────────
  const yearEndPeriod = await db('periods')
    .where('period_id', financialYearEnd)
    .first<{ status: string } | undefined>();

  if (!yearEndPeriod) {
    throw new YearEndError(`Period ${financialYearEnd} not found`);
  }
  if (yearEndPeriod.status !== 'HARD_CLOSE') {
    throw new YearEndError(
      `Period ${financialYearEnd} must be HARD_CLOSE before year-end close (currently ${yearEndPeriod.status})`,
    );
  }

  const newPeriod = await db('periods')
    .where('period_id', newYearFirstPeriod)
    .first<{ status: string; start_date: string } | undefined>();

  if (!newPeriod) {
    throw new YearEndError(`Period ${newYearFirstPeriod} not found`);
  }
  if (newPeriod.status !== 'OPEN') {
    throw new YearEndError(
      `Period ${newYearFirstPeriod} must be OPEN for year-end close entries (currently ${newPeriod.status})`,
    );
  }

  // ── Query cumulative P&L balances up to year-end ──────────────────────────
  // We look at all periods up to and including financialYearEnd.
  // If from_period is supplied, restrict to periods >= from_period (useful for
  // test isolation and multi-year scoping where prior years have already been closed).
  const pnlQuery = db('transaction_lines')
    .join('accounts', 'transaction_lines.account_code', 'accounts.code')
    .whereIn('accounts.type', ['REVENUE', 'EXPENSE'])
    .where('transaction_lines.period_id', '<=', financialYearEnd);

  if (options?.from_period) {
    pnlQuery.where('transaction_lines.period_id', '>=', options.from_period);
  }

  const pnlRows = await pnlQuery.select(
      'accounts.code',
      'accounts.name',
      'accounts.type',
      db.raw('COALESCE(SUM(transaction_lines.debit), 0) as total_debit'),
      db.raw('COALESCE(SUM(transaction_lines.credit), 0) as total_credit'),
    )
    .groupBy('accounts.code', 'accounts.name', 'accounts.type')
    .orderBy('accounts.code');

  // ── Build closing journal lines ───────────────────────────────────────────
  const lines: JournalLine[] = [];
  let netProfit = new Decimal(0); // positive = profit, negative = loss

  for (const row of pnlRows) {
    const d = new Decimal((row as { total_debit: string }).total_debit);
    const c = new Decimal((row as { total_credit: string }).total_credit);

    if ((row as { type: string }).type === 'REVENUE') {
      // Natural credit balance: net = credits - debits
      const balance = c.minus(d);
      if (balance.isZero()) continue;
      // To zero out: debit the revenue account
      lines.push({
        account_code: (row as { code: string }).code,
        description: `Year-end close — zero out ${(row as { name: string }).name}`,
        debit: balance.toNumber(),
        credit: 0,
      });
      netProfit = netProfit.plus(balance);
    } else {
      // EXPENSE — natural debit balance: net = debits - credits
      const balance = d.minus(c);
      if (balance.isZero()) continue;
      // To zero out: credit the expense account
      lines.push({
        account_code: (row as { code: string }).code,
        description: `Year-end close — zero out ${(row as { name: string }).name}`,
        debit: 0,
        credit: balance.toNumber(),
      });
      netProfit = netProfit.minus(balance);
    }
  }

  if (lines.length === 0) {
    throw new YearEndError(
      `No P&L balances found for periods up to ${financialYearEnd}. Nothing to close.`,
    );
  }

  // ── Add Retained Earnings entry ───────────────────────────────────────────
  // net_profit > 0: profit → credit Retained Earnings
  // net_profit < 0: loss → debit Retained Earnings
  if (netProfit.greaterThan(0)) {
    lines.push({
      account_code: '3100',
      description: `Year-end close — transfer net profit to retained earnings`,
      debit: 0,
      credit: netProfit.toNumber(),
    });
  } else if (netProfit.lessThan(0)) {
    lines.push({
      account_code: '3100',
      description: `Year-end close — transfer net loss to retained earnings`,
      debit: netProfit.abs().toNumber(),
      credit: 0,
    });
  }

  // ── Post the YEAR_END_CLOSE transaction ───────────────────────────────────
  const postingResult = await postTransaction(
    {
      transaction_type: 'YEAR_END_CLOSE',
      date: newPeriod.start_date,
      period_id: newYearFirstPeriod,
      reference: `YEAR-END-CLOSE-${financialYearEnd}`,
      description: 'Year-end closing entries — transfer P&L balances to retained earnings',
      lines,
      submitted_by: 'system',
    },
    chainWriterOverride,
  );

  return {
    financial_year_end: financialYearEnd,
    new_year_first_period: newYearFirstPeriod,
    posting_result: postingResult,
    lines_count: lines.length,
    net_profit: netProfit.toFixed(2),
  };
}
