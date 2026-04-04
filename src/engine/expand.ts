import Decimal from 'decimal.js';
import type { Knex } from 'knex';
import type { MappingRow, PostingLine, TransactionSubmission } from './types';
import { PostingEngineError } from './types';

// ---------------------------------------------------------------------------
// expand.ts — expand human-friendly transaction types into posting lines
// ---------------------------------------------------------------------------

/**
 * VAT rate for the MVP (UK standard rate 20%).
 * Applied to CUSTOMER_INVOICE and SUPPLIER_INVOICE.
 */
const VAT_RATE = new Decimal('0.20');

/**
 * Computes net and VAT amounts from a gross (VAT-inclusive) amount.
 *
 * gross = net + VAT = net * 1.20
 * net   = gross / 1.20
 * vat   = gross - net
 *
 * Both values are rounded to 2 decimal places (half-even / banker's rounding).
 */
export function splitGrossAmount(gross: Decimal): { net: Decimal; vat: Decimal } {
  const divisor = new Decimal(1).plus(VAT_RATE);
  const net = gross.div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const vat = gross.minus(net);
  return { net, vat };
}

/**
 * Fetches the active account mappings for a transaction type from the database.
 */
export async function fetchMappings(
  trx: Knex | Knex.Transaction,
  transactionType: string,
): Promise<MappingRow[]> {
  const rows = await trx<MappingRow>('transaction_type_mappings')
    .where('transaction_type', transactionType)
    .where('active', true)
    .select('transaction_type', 'line_role', 'account_code', 'direction', 'description');

  if (rows.length === 0) {
    throw new PostingEngineError(
      `No active account mappings found for transaction type: ${transactionType}`,
    );
  }

  return rows;
}

/**
 * Expands a submission's `amount` field into posting lines using the
 * account mappings from the database.
 *
 * CUSTOMER_INVOICE / SUPPLIER_INVOICE:
 *   The `amount` is the gross (VAT-inclusive) amount.
 *   VAT is computed at 20%; the net is gross ÷ 1.20.
 *
 * CUSTOMER_PAYMENT / SUPPLIER_PAYMENT:
 *   The `amount` is the full payment amount (no VAT split).
 *   Each mapped line uses the full amount.
 *
 * Line roles determine which direction (DEBIT/CREDIT) each account receives.
 * For VAT-bearing types, roles 'VAT_OUTPUT' and 'VAT_INPUT' receive the VAT
 * amount; the non-VAT debit/credit roles receive the net (REVENUE/EXPENSE) or
 * gross (DEBTORS/CREDITORS) amounts according to standard accounting.
 *
 * DEBTORS / CREDITORS = gross (full invoice amount inc. VAT)
 * REVENUE / EXPENSE   = net
 * VAT_OUTPUT / VAT_INPUT = VAT portion
 */
export function expandToPostingLines(
  submission: TransactionSubmission,
  mappings: MappingRow[],
): PostingLine[] {
  const grossAmount = new Decimal(submission.amount!);
  const { transaction_type } = submission;

  const isVatBearing =
    transaction_type === 'CUSTOMER_INVOICE' ||
    transaction_type === 'SUPPLIER_INVOICE' ||
    transaction_type === 'CUSTOMER_CREDIT_NOTE' ||
    transaction_type === 'SUPPLIER_CREDIT_NOTE';

  const { net, vat } = isVatBearing
    ? splitGrossAmount(grossAmount)
    : { net: grossAmount, vat: new Decimal(0) };

  const lines: PostingLine[] = mappings.map((mapping) => {
    let lineAmount: Decimal;

    if (isVatBearing) {
      // Gross roles
      if (mapping.line_role === 'DEBTORS' || mapping.line_role === 'CREDITORS') {
        lineAmount = grossAmount;
      } else if (mapping.line_role === 'VAT_OUTPUT' || mapping.line_role === 'VAT_INPUT') {
        lineAmount = vat;
      } else {
        // REVENUE, EXPENSE — net amount
        lineAmount = net;
      }
    } else {
      // Payment types — full amount for every line
      lineAmount = grossAmount;
    }

    const amount = lineAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();

    return {
      account_code: mapping.account_code,
      description: mapping.description ?? `${transaction_type} — ${mapping.line_role}`,
      debit: mapping.direction === 'DEBIT' ? amount : 0,
      credit: mapping.direction === 'CREDIT' ? amount : 0,
    };
  });

  return lines;
}
