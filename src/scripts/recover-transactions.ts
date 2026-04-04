/**
 * recover-transactions.ts
 *
 * Detects chain entries that are missing from the database mirror and replays
 * them. Run this after a crash or unexpected shutdown to heal the DB mirror.
 *
 * Usage:
 *   npx tsx src/scripts/recover-transactions.ts
 *   # or via package.json:
 *   npm run chain:recover
 */

import { recoverMissingTransactions } from '../engine/recovery';
import { db } from '../db/connection';
import { config } from '../config';

async function main(): Promise<void> {
  console.log(`Recovering missing transactions from chain directory: ${config.chainDir}`);

  const result = await recoverMissingTransactions(config.chainDir);

  console.log('');
  console.log('Recovery complete:');
  console.log(`  Periods checked:              ${result.periods_checked}`);
  console.log(`  Missing transactions found:   ${result.missing_transactions_found}`);
  console.log(`  Transactions recovered:       ${result.transactions_recovered}`);

  if (result.errors.length > 0) {
    console.error('');
    console.error('Errors encountered:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
  }

  await db.destroy();

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error during recovery:', err);
  process.exit(1);
});
