/**
 * Integration tests for chain verification: verifyChain, verifyChainSequence,
 * and getMerkleProof.
 *
 * Requires the test PostgreSQL database (port 5433) and the filesystem.
 * Run with NODE_ENV=test.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as readline from 'node:readline';
import { db } from '../../src/db/connection';
import { ChainWriter } from '../../src/chain/writer';
import { ChainReader } from '../../src/chain/reader';
import { buildMerkleTree, verifyMerkleProof } from '../../src/chain/merkle';

const CHAIN_DIR = 'chains/default';
const VERIFY_PERIOD_A = '2091-01';
const VERIFY_PERIOD_B = '2091-02';

async function cleanupPeriod(periodId: string): Promise<void> {
  await db('transaction_lines')
    .whereIn('transaction_id', db('transactions').where('period_id', periodId).select('transaction_id'))
    .del();
  await db('transactions').where('period_id', periodId).del();
  await db('staging').where('period_id', periodId).del();
  await db('periods').where('period_id', periodId).del();

  const filePath = path.join(CHAIN_DIR, `${periodId}.chain.jsonl`);
  try {
    await fs.chmod(filePath, 0o644);
  } catch { /* ignore */ }
  try {
    await fs.unlink(filePath);
  } catch { /* ignore */ }
}

function getChainWriter(): ChainWriter {
  return new ChainWriter({
    chainDir: CHAIN_DIR,
    getPeriodStatus: async (pid) => {
      const row = await db('periods').where('period_id', pid).select('status').first<{ status: string }>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });
}

beforeAll(async () => {
  await cleanupPeriod(VERIFY_PERIOD_A);
  await cleanupPeriod(VERIFY_PERIOD_B);
});

afterAll(async () => {
  await cleanupPeriod(VERIFY_PERIOD_A);
  await cleanupPeriod(VERIFY_PERIOD_B);
});

// ---------------------------------------------------------------------------
// verifyChain — single period
// ---------------------------------------------------------------------------

describe('verifyChain — single period', () => {
  beforeAll(async () => {
    // Set up period A with 3 transaction entries
    await db('periods').insert({
      period_id: VERIFY_PERIOD_A,
      start_date: '2091-01-01',
      end_date: '2091-01-31',
      status: 'OPEN',
      data_flag: 'PROVISIONAL',
      opened_at: new Date().toISOString(),
    });

    const writer = getChainWriter();
    await writer.createPeriodFile(VERIFY_PERIOD_A, null, {});

    // Write 3 TRANSACTION entries directly via the writer (no DB mirror needed for chain tests)
    for (let i = 0; i < 3; i++) {
      await writer.appendEntry(VERIFY_PERIOD_A, 'TRANSACTION', {
        transaction_type: 'MANUAL_JOURNAL',
        date: '2091-01-10',
        currency: 'GBP',
        description: `Test transaction ${i}`,
        lines: [
          { account_code: '1000', description: 'Dr', debit: 100, credit: 0 },
          { account_code: '3000', description: 'Cr', debit: 0, credit: 100 },
        ],
      });
    }
  });

  it('returns valid=true for a well-formed chain', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.verifyChain(VERIFY_PERIOD_A);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(4); // GENESIS + 3 TRANSACTION
  });

  it('returns valid=true with entries=0 for a non-existent period', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.verifyChain('9999-99');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });

  it('detects tampering — returns valid=false with an error message', async () => {
    // Copy the chain file to a temp location, tamper with it, run verify
    const origPath = path.join(CHAIN_DIR, `${VERIFY_PERIOD_A}.chain.jsonl`);
    const tamperedPath = path.join(CHAIN_DIR, `tampered-${VERIFY_PERIOD_A}.chain.jsonl`);

    const content = await fs.readFile(origPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());

    // Tamper with the second line (first TRANSACTION entry at index 1)
    const tampered = lines.map((line, idx) => {
      if (idx === 1) {
        return line.replace(/"entry_hash":"[0-9a-f]{64}"/, '"entry_hash":"' + '0'.repeat(64) + '"');
      }
      return line;
    });

    // Write the tampered file with a fake period name
    await fs.writeFile(tamperedPath, tampered.join('\n') + '\n', 'utf8');

    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.verifyChain(`tampered-${VERIFY_PERIOD_A}`);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();

    // Cleanup
    try { await fs.unlink(tamperedPath); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// getMerkleProof
// ---------------------------------------------------------------------------

describe('getMerkleProof', () => {
  it('returns a valid proof for each transaction', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const entries = await reader.readAllEntries(VERIFY_PERIOD_A);
    const txEntries = entries.filter((e) => e.type === 'TRANSACTION');
    const txHashes = txEntries.map((e) => e.entry_hash);
    const expectedRoot = buildMerkleTree(txHashes);

    for (const txEntry of txEntries) {
      const proofData = await reader.getMerkleProof(VERIFY_PERIOD_A, txEntry.sequence);
      expect(proofData).not.toBeNull();

      expect(proofData!.merkle_root).toBe(expectedRoot);
      expect(proofData!.entry_hash).toBe(txEntry.entry_hash);

      // Verify the proof
      const valid = verifyMerkleProof(
        proofData!.entry_hash,
        proofData!.proof,
        proofData!.merkle_root,
      );
      expect(valid).toBe(true);
    }
  });

  it('returns null for a non-existent sequence', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.getMerkleProof(VERIFY_PERIOD_A, 9999);
    expect(result).toBeNull();
  });

  it('returns null for a GENESIS entry (not a TRANSACTION)', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    // Sequence 1 is the GENESIS entry — not a TRANSACTION
    const result = await reader.getMerkleProof(VERIFY_PERIOD_A, 1);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyChainSequence — cross-period
// ---------------------------------------------------------------------------

describe('verifyChainSequence — cross-period', () => {
  beforeAll(async () => {
    // Seal period A and create period B linked to it
    const writer = getChainWriter();

    // First soft-close then hard-close period A
    await db('periods').where('period_id', VERIFY_PERIOD_A).update({
      status: 'SOFT_CLOSE',
      soft_closed_at: new Date().toISOString(),
    });

    await writer.sealPeriod(VERIFY_PERIOD_A, {
      period_id: VERIFY_PERIOD_A,
      closing_trial_balance: {},
      total_transactions: 3,
      total_debits: 300,
      total_credits: 300,
      closed_by: 'test',
    });

    await db('periods').where('period_id', VERIFY_PERIOD_A).update({
      status: 'HARD_CLOSE',
      data_flag: 'AUTHORITATIVE',
      hard_closed_at: new Date().toISOString(),
      closing_chain_hash: 'test',
    });

    // Create period B linked to period A
    await db('periods').insert({
      period_id: VERIFY_PERIOD_B,
      start_date: '2091-02-01',
      end_date: '2091-02-28',
      status: 'OPEN',
      data_flag: 'PROVISIONAL',
      opened_at: new Date().toISOString(),
    });

    await writer.createPeriodFile(VERIFY_PERIOD_B, VERIFY_PERIOD_A, {});

    // Write one transaction in period B
    await writer.appendEntry(VERIFY_PERIOD_B, 'TRANSACTION', {
      transaction_type: 'MANUAL_JOURNAL',
      date: '2091-02-10',
      currency: 'GBP',
      description: 'Period B transaction',
      lines: [
        { account_code: '1000', description: 'Dr', debit: 50, credit: 0 },
        { account_code: '3000', description: 'Cr', debit: 0, credit: 50 },
      ],
    });
  });

  it('verifies both periods individually', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const resultA = await reader.verifyChain(VERIFY_PERIOD_A);
    const resultB = await reader.verifyChain(VERIFY_PERIOD_B);
    expect(resultA.valid).toBe(true);
    expect(resultB.valid).toBe(true);
  });

  it('verifyChainSequence verifies the cross-period link', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const result = await reader.verifyChainSequence([VERIFY_PERIOD_A, VERIFY_PERIOD_B]);

    expect(result.valid).toBe(true);
    expect(result.periods_verified).toBe(2);
  });

  it('cross-period link: period B genesis previous_hash matches period A closing hash', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const entriesA = await reader.readAllEntries(VERIFY_PERIOD_A);
    const entriesB = await reader.readAllEntries(VERIFY_PERIOD_B);

    const closeA = entriesA.find((e) => e.type === 'PERIOD_CLOSE');
    const genesisB = entriesB.find((e) => e.type === 'GENESIS');

    expect(closeA).toBeDefined();
    expect(genesisB).toBeDefined();
    expect(genesisB!.previous_hash).toBe(closeA!.entry_hash);
  });

  it('PERIOD_CLOSE entry includes merkle_root in payload', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const entries = await reader.readAllEntries(VERIFY_PERIOD_A);
    const closeEntry = entries.find((e) => e.type === 'PERIOD_CLOSE');
    expect(closeEntry).toBeDefined();
    expect(closeEntry!.payload).toHaveProperty('merkle_root');
    expect(typeof closeEntry!.payload['merkle_root']).toBe('string');
    expect((closeEntry!.payload['merkle_root'] as string)).toHaveLength(64);
  });

  it('TRANSACTION entries have merkle_index set', async () => {
    const reader = new ChainReader(CHAIN_DIR);
    const entries = await reader.readAllEntries(VERIFY_PERIOD_B);
    const txEntries = entries.filter((e) => e.type === 'TRANSACTION');
    expect(txEntries.length).toBeGreaterThan(0);
    for (const tx of txEntries) {
      expect(tx.merkle_index).not.toBeNull();
      expect(typeof tx.merkle_index).toBe('number');
    }
  });
});
