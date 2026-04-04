/**
 * One-shot script: rebuild the database mirror from chain files and exit.
 * Usage: tsx src/scripts/rebuild-from-chain.ts
 *    or: NODE_ENV=production node dist/scripts/rebuild-from-chain.js
 */
import { rebuildFromChain } from '../chain/rebuild';
import { config } from '../config';
import { db } from '../db/connection';

async function main(): Promise<void> {
  console.log('[rebuild] Starting chain rebuild from:', config.chainDir);
  const result = await rebuildFromChain(config.chainDir);
  console.log('[rebuild] Rebuild complete:', JSON.stringify(result, null, 2));
  await db.destroy();
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('[rebuild] Fatal error:', err);
  process.exit(1);
});
