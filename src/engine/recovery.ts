import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import Decimal from 'decimal.js';
import { db } from '../db/connection';

// ---------------------------------------------------------------------------
// recovery.ts — Detect and replay chain entries missing from the database
// ---------------------------------------------------------------------------

export interface RecoveryResult {
  periods_checked: number;
  missing_transactions_found: number;
  transactions_recovered: number;
  errors: string[];
}

/**
 * Check for TRANSACTION chain entries that are not reflected in the database
 * and replay them into the database mirror.
 *
 * This is a targeted recovery mechanism (lighter than a full chain rebuild).
 * It only fills gaps — it does NOT reconstruct periods or period status.
 * Idempotent: running it twice is safe.
 */
export async function recoverMissingTransactions(chainDir: string): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    periods_checked: 0,
    missing_transactions_found: 0,
    transactions_recovered: 0,
    errors: [],
  };

  // Discover all chain files.
  let files: string[];
  try {
    const entries = await fs.readdir(chainDir);
    files = entries
      .filter((f) => f.endsWith('.chain.jsonl'))
      .sort();
  } catch (err) {
    result.errors.push(`Cannot read chain directory ${chainDir}: ${String(err)}`);
    return result;
  }

  for (const file of files) {
    const periodId = file.replace('.chain.jsonl', '');
    result.periods_checked++;

    const filePath = path.join(chainDir, file);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      result.errors.push(`Cannot read chain file ${file}: ${String(err)}`);
      continue;
    }

    const lines = content.split('\n').filter((l) => l.trim() !== '');

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Skip malformed lines (e.g., truncated after crash).
        continue;
      }

      // Only process TRANSACTION entries.
      if (entry['type'] !== 'TRANSACTION') continue;

      const payload = entry['payload'] as Record<string, unknown> | undefined;
      if (!payload) continue;

      // The transaction_id is stored in the chain payload if it was committed
      // via the normal posting engine. If not present, we can't recover.
      const transactionId = payload['transaction_id'] as string | undefined;
      if (!transactionId) continue;

      // Check if this transaction exists in the database.
      const existing = await db('transactions')
        .where('transaction_id', transactionId)
        .first<{ transaction_id: string } | undefined>();

      if (existing) continue; // Already in DB — nothing to do.

      result.missing_transactions_found++;

      // Try to recover this transaction.
      try {
        await recoverTransaction(periodId, entry, payload, transactionId);
        result.transactions_recovered++;
      } catch (err) {
        result.errors.push(
          `Failed to recover ${transactionId} from ${file}: ${String(err)}`,
        );
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function recoverTransaction(
  periodId: string,
  entry: Record<string, unknown>,
  payload: Record<string, unknown>,
  transactionId: string,
): Promise<void> {
  const lines = payload['lines'] as Array<{
    account_code: string;
    description: string;
    debit: number;
    credit: number;
    cost_centre?: string;
  }> | undefined;

  if (!lines || lines.length === 0) {
    throw new Error('Payload has no lines');
  }

  const currency = ((payload['currency'] as string | undefined) ?? 'GBP').toUpperCase();
  const exchangeRate = (payload['exchange_rate'] as string | undefined) ?? '1';
  const baseCurrency = 'GBP';
  const rateDecimal = new Decimal(exchangeRate);

  await db.transaction(async (trx) => {
    await trx('transactions').insert({
      transaction_id: transactionId,
      period_id: periodId,
      transaction_type: (payload['transaction_type'] as string) ?? 'MANUAL_JOURNAL',
      reference: (payload['reference'] as string | null) ?? null,
      date: payload['date'] as string,
      currency,
      description: (payload['description'] as string | null) ?? null,
      counterparty_trading_account_id:
        ((payload['counterparty'] as Record<string, string> | undefined)?.['trading_account_id']) ?? null,
      counterparty_contact_id:
        ((payload['counterparty'] as Record<string, string> | undefined)?.['contact_id']) ?? null,
      source_module_id:
        ((payload['source'] as Record<string, string> | undefined)?.['module_id']) ?? null,
      source_module_reference:
        ((payload['source'] as Record<string, string> | undefined)?.['module_reference']) ?? null,
      idempotency_key: (payload['idempotency_key'] as string | null) ?? null,
      status: 'COMMITTED',
      data_flag: 'PROVISIONAL',
      chain_sequence: entry['sequence'] as number,
      chain_period_id: periodId,
      chain_verified: false,
      exchange_rate: exchangeRate,
      base_currency: baseCurrency,
    });

    await trx('transaction_lines').insert(
      lines.map((line) => ({
        transaction_id: transactionId,
        period_id: periodId,
        account_code: line.account_code,
        description: line.description,
        debit: new Decimal(line.debit).toFixed(2),
        credit: new Decimal(line.credit).toFixed(2),
        base_debit: new Decimal(line.debit).mul(rateDecimal).toDecimalPlaces(4).toFixed(4),
        base_credit: new Decimal(line.credit).mul(rateDecimal).toDecimalPlaces(4).toFixed(4),
        cost_centre: line.cost_centre ?? null,
        data_flag: 'PROVISIONAL',
        chain_verified: false,
      })),
    );
  });
}
