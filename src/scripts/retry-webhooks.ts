/**
 * One-shot script: process the webhook retry queue and exit.
 * Usage: tsx src/scripts/retry-webhooks.ts
 *    or: NODE_ENV=production node dist/scripts/retry-webhooks.js
 */
import { processRetryQueue } from '../engine/webhooks';
import { db } from '../db/connection';

async function main(): Promise<void> {
  console.log('[retry-webhooks] Processing retry queue...');
  await processRetryQueue();
  console.log('[retry-webhooks] Done.');
  await db.destroy();
}

main().catch((err: unknown) => {
  console.error('[retry-webhooks] Error:', err);
  process.exit(1);
});
