import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Decimal from 'decimal.js';
import { ChainReader } from './reader';
import { db } from '../db/connection';

// ---------------------------------------------------------------------------
// rebuild.ts — Rebuild the database mirror from chain files
// ---------------------------------------------------------------------------

export interface RebuildResult {
  periods_rebuilt: number;
  transactions_restored: number;
  errors: string[];
}

/**
 * Rebuild the entire database from chain files.
 *
 * This function is idempotent — running it twice on the same chain files will
 * not create duplicate records.  It uses `INSERT ... ON CONFLICT DO NOTHING`
 * wherever possible and checks existence before creating period rows.
 *
 * @param chainDir - directory containing `*.chain.jsonl` files.
 */
export async function rebuildFromChain(chainDir: string): Promise<RebuildResult> {
  const reader = new ChainReader(chainDir);
  const errors: string[] = [];
  let periodsRebuilt = 0;
  let transactionsRestored = 0;

  // Discover all chain files, sorted chronologically.
  let files: string[];
  try {
    const dirEntries = await fs.readdir(chainDir);
    files = dirEntries
      .filter((f) => f.endsWith('.chain.jsonl'))
      .map((f) => f.replace('.chain.jsonl', ''))
      .sort();
  } catch (err) {
    errors.push(`Cannot read chain directory ${chainDir}: ${String(err)}`);
    return { periods_rebuilt: 0, transactions_restored: 0, errors };
  }

  for (const periodId of files) {
    try {
      // ── Verify chain integrity before rebuilding ───────────────────────────
      const integrity = await reader.verifyChain(periodId);
      if (!integrity.valid) {
        errors.push(`Period ${periodId}: chain integrity check failed — ${integrity.error ?? 'unknown error'}. Skipping.`);
        continue;
      }

      const entries = await reader.readAllEntries(periodId);
      if (entries.length === 0) continue;

      // ── Parse GENESIS entry ───────────────────────────────────────────────
      const genesis = entries[0];
      if (!genesis || genesis.type !== 'GENESIS') {
        errors.push(`Period ${periodId}: first entry is not GENESIS. Skipping.`);
        continue;
      }

      const genesisPayload = genesis.payload as {
        period_id: string;
        previous_period_id: string | null;
        previous_period_closing_hash: string | null;
        opening_balances: Record<string, { debit: number; credit: number }>;
      };

      // ── Create or verify period row in DB ─────────────────────────────────
      const existingPeriod = await db('periods')
        .where('period_id', periodId)
        .first<{ period_id: string; status: string } | undefined>();

      if (!existingPeriod) {
        // Compute start/end dates from period_id (YYYY-MM).
        const [yearStr, monthStr] = periodId.split('-') as [string, string];
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const startDate = `${periodId}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${periodId}-${String(lastDay).padStart(2, '0')}`;

        await db('periods')
          .insert({
            period_id: periodId,
            start_date: startDate,
            end_date: endDate,
            status: 'OPEN',
            data_flag: 'PROVISIONAL',
            opened_at: genesis.timestamp,
          })
          .onConflict('period_id')
          .ignore();
      }

      periodsRebuilt++;

      // ── Process TRANSACTION entries ───────────────────────────────────────
      let transactionCounter = 0;

      for (const entry of entries) {
        if (entry.type !== 'TRANSACTION') continue;

        try {
          // Check idempotency: skip if already in DB by chain_sequence.
          const exists = await db('transactions')
            .where('chain_sequence', entry.sequence)
            .where('chain_period_id', periodId)
            .first<{ transaction_id: string } | undefined>();

          if (exists) continue; // Already restored.

          transactionCounter++;
          const transactionId = `TXN-${periodId}-${String(transactionCounter).padStart(5, '0')}`;

          const payload = entry.payload as {
            transaction_type?: string;
            reference?: string | null;
            date?: string;
            currency?: string;
            description?: string | null;
            counterparty?: { trading_account_id?: string; contact_id?: string };
            source?: { module_id?: string; module_reference?: string };
            idempotency_key?: string;
            lines?: Array<{
              account_code: string;
              description?: string;
              debit: number;
              credit: number;
              cost_centre?: string;
            }>;
          };

          // Determine data_flag from the period's current status.
          const periodRow = await db('periods').where('period_id', periodId).first<{ status: string }>();
          const dataFlag = periodRow?.status === 'HARD_CLOSE' ? 'AUTHORITATIVE' : 'PROVISIONAL';

          await db('transactions')
            .insert({
              transaction_id: transactionId,
              period_id: periodId,
              transaction_type: payload.transaction_type ?? 'MANUAL_JOURNAL',
              reference: payload.reference ?? null,
              date: payload.date ?? genesis.timestamp.slice(0, 10),
              currency: payload.currency ?? 'GBP',
              description: payload.description ?? null,
              counterparty_trading_account_id: payload.counterparty?.trading_account_id ?? null,
              counterparty_contact_id: payload.counterparty?.contact_id ?? null,
              source_module_id: payload.source?.module_id ?? null,
              source_module_reference: payload.source?.module_reference ?? null,
              idempotency_key: payload.idempotency_key ?? null,
              status: 'COMMITTED',
              data_flag: dataFlag,
              chain_sequence: entry.sequence,
              chain_period_id: periodId,
              chain_verified: true, // We just verified the chain above.
            })
            .onConflict('transaction_id')
            .ignore();

          if (payload.lines && payload.lines.length > 0) {
            const lineInserts = payload.lines.map((line) => ({
              transaction_id: transactionId,
              period_id: periodId,
              account_code: line.account_code,
              description: line.description ?? null,
              debit: new Decimal(line.debit).toFixed(2),
              credit: new Decimal(line.credit).toFixed(2),
              cost_centre: line.cost_centre ?? null,
              data_flag: dataFlag,
              chain_verified: true,
            }));

            // Insert lines; ignore FK errors if accounts don't exist.
            try {
              await db('transaction_lines').insert(lineInserts);
            } catch (lineErr) {
              errors.push(
                `Period ${periodId} seq ${entry.sequence}: failed to insert lines — ${String(lineErr)}`,
              );
            }
          }

          transactionsRestored++;
        } catch (txErr) {
          errors.push(
            `Period ${periodId} seq ${entry.sequence}: ${String(txErr)}`,
          );
        }
      }

      // ── Handle PERIOD_CLOSE entry ─────────────────────────────────────────
      const closeEntry = entries.find((e) => e.type === 'PERIOD_CLOSE');
      if (closeEntry) {
        const closingPayload = closeEntry.payload as {
          closed_by?: string;
        };
        await db('periods')
          .where('period_id', periodId)
          .where('status', '!=', 'HARD_CLOSE') // Don't re-close if already closed.
          .update({
            status: 'HARD_CLOSE',
            data_flag: 'AUTHORITATIVE',
            hard_closed_at: closeEntry.timestamp,
            closed_by: closingPayload.closed_by ?? 'chain-rebuild',
            closing_chain_hash: closeEntry.entry_hash,
          });

        // Flag all transactions as AUTHORITATIVE.
        await db('transactions')
          .where('period_id', periodId)
          .update({ data_flag: 'AUTHORITATIVE', chain_verified: true });
        await db('transaction_lines')
          .whereIn(
            'transaction_id',
            db('transactions').where('period_id', periodId).select('transaction_id'),
          )
          .update({ data_flag: 'AUTHORITATIVE', chain_verified: true });
      }
    } catch (periodErr) {
      errors.push(`Period ${periodId}: unexpected error — ${String(periodErr)}`);
    }
  }

  return { periods_rebuilt: periodsRebuilt, transactions_restored: transactionsRestored, errors };
}

/**
 * List all period IDs that have chain files in the given directory.
 */
export async function listChainPeriods(chainDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(chainDir);
    return files
      .filter((f) => f.endsWith('.chain.jsonl'))
      .map((f) => f.replace('.chain.jsonl', ''))
      .sort();
  } catch {
    return [];
  }
}
