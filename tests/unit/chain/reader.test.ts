import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeEntryHash } from '../../../src/chain/hash';
import { ChainReader } from '../../../src/chain/reader';
import { ChainWriter } from '../../../src/chain/writer';
import type { ChainEntry } from '../../../src/chain/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-reader-test-'));
});

afterEach(async () => {
  // Make all files writable before deletion (sealed files are read-only).
  try {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      await fs.chmod(path.join(tmpDir, entry.name), 0o666).catch(() => undefined);
    }
  } catch {
    // ignore
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** A writer with a mock status checker that always returns OPEN. */
function makeWriter(): ChainWriter {
  return new ChainWriter({
    chainDir: tmpDir,
    getPeriodStatus: () => Promise.resolve('OPEN'),
  });
}

/** Builds a fresh chain with the given number of TRANSACTION entries after genesis. */
async function buildChain(periodId: string, transactionCount: number): Promise<ChainEntry[]> {
  const writer = makeWriter();
  await writer.createPeriodFile(periodId, null, {});
  for (let i = 1; i <= transactionCount; i++) {
    await writer.appendEntry(periodId, 'TRANSACTION', { n: i });
  }
  return new ChainReader(tmpDir).readAllEntries(periodId);
}

// ---------------------------------------------------------------------------
// readAllEntries
// ---------------------------------------------------------------------------

describe('readAllEntries', () => {
  it('returns all entries in sequence order', async () => {
    await buildChain('2026-03', 3);
    const reader = new ChainReader(tmpDir);
    const entries = await reader.readAllEntries('2026-03');
    expect(entries).toHaveLength(4); // genesis + 3 transactions
    entries.forEach((e, i) => expect(e.sequence).toBe(i + 1));
  });

  it('returns empty array for a period with no chain file', async () => {
    const reader = new ChainReader(tmpDir);
    const entries = await reader.readAllEntries('9999-99');
    expect(entries).toEqual([]);
  });

  it('skips truncated last line (partial JSON from a crash)', async () => {
    await buildChain('2026-03', 2);
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');
    // Append a broken line simulating a crash mid-write.
    await fs.appendFile(filePath, '{"sequence":4,"broken":\n');

    const reader = new ChainReader(tmpDir);
    const entries = await reader.readAllEntries('2026-03');
    expect(entries).toHaveLength(3); // genesis + 2 valid transactions
  });
});

// ---------------------------------------------------------------------------
// readEntry
// ---------------------------------------------------------------------------

describe('readEntry', () => {
  it('returns the entry with the requested sequence number', async () => {
    await buildChain('2026-03', 3);
    const reader = new ChainReader(tmpDir);
    const entry = await reader.readEntry('2026-03', 3);
    expect(entry).not.toBeNull();
    expect(entry?.sequence).toBe(3);
    expect(entry?.payload['n']).toBe(2); // sequence 3 = second transaction (n=2)
  });

  it('returns the genesis entry for sequence 1', async () => {
    await buildChain('2026-03', 0);
    const reader = new ChainReader(tmpDir);
    const entry = await reader.readEntry('2026-03', 1);
    expect(entry?.type).toBe('GENESIS');
  });

  it('returns null for a sequence number beyond the chain length', async () => {
    await buildChain('2026-03', 2);
    const reader = new ChainReader(tmpDir);
    expect(await reader.readEntry('2026-03', 99)).toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    const reader = new ChainReader(tmpDir);
    expect(await reader.readEntry('9999-99', 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLastEntry
// ---------------------------------------------------------------------------

describe('getLastEntry', () => {
  it('returns the last entry in the chain', async () => {
    await buildChain('2026-03', 3);
    const reader = new ChainReader(tmpDir);
    const last = await reader.getLastEntry('2026-03');
    expect(last?.sequence).toBe(4); // genesis + 3 txns
    expect(last?.payload['n']).toBe(3);
  });

  it('returns the genesis entry when no transactions have been appended', async () => {
    await buildChain('2026-03', 0);
    const reader = new ChainReader(tmpDir);
    const last = await reader.getLastEntry('2026-03');
    expect(last?.type).toBe('GENESIS');
    expect(last?.sequence).toBe(1);
  });

  it('returns null when the file does not exist', async () => {
    const reader = new ChainReader(tmpDir);
    expect(await reader.getLastEntry('9999-99')).toBeNull();
  });

  it('returns null for an empty file', async () => {
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');
    await fs.writeFile(filePath, '', 'utf8');
    const reader = new ChainReader(tmpDir);
    expect(await reader.getLastEntry('2026-03')).toBeNull();
  });

  it('returns the second-to-last valid entry when the last line is truncated', async () => {
    const writer = makeWriter();
    await writer.createPeriodFile('2026-03', null, {});
    const txn = await writer.appendEntry('2026-03', 'TRANSACTION', { ref: 'last-valid' });

    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');
    await fs.appendFile(filePath, '{"partial":\n'); // broken line

    const reader = new ChainReader(tmpDir);
    const last = await reader.getLastEntry('2026-03');
    expect(last?.entry_hash).toBe(txn.entry_hash);
  });
});

// ---------------------------------------------------------------------------
// verifyChain
// ---------------------------------------------------------------------------

describe('verifyChain', () => {
  it('returns valid: true for a correct single-entry chain', async () => {
    await buildChain('2026-03', 0); // genesis only
    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(1);
  });

  it('returns valid: true for a multi-entry chain', async () => {
    await buildChain('2026-03', 5);
    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(6); // genesis + 5 transactions
  });

  it('returns valid: true, entries: 0 for a non-existent period', async () => {
    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('9999-99');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });

  it('detects a tampered entry_hash', async () => {
    await buildChain('2026-03', 2);
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    // Tamper: change the entry_hash of the second entry to a bad value.
    const entry2 = JSON.parse(lines[1]!) as ChainEntry;
    entry2.entry_hash = 'f'.repeat(64); // wrong hash
    lines[1] = JSON.stringify(entry2);
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequence 2/);
  });

  it('detects a tampered payload field (hash mismatch)', async () => {
    await buildChain('2026-03', 2);
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    // Tamper: modify the payload of entry 3 but leave its entry_hash unchanged.
    const entry3 = JSON.parse(lines[2]!) as ChainEntry;
    (entry3.payload as Record<string, unknown>)['n'] = 999; // was 2, now 999
    // Do NOT update entry_hash — the verifier should catch the mismatch.
    lines[2] = JSON.stringify(entry3);
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequence 3/);
  });

  it('detects a broken hash link (previous_hash does not match)', async () => {
    await buildChain('2026-03', 2);
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    // Tamper: break the hash chain on entry 3 by changing its previous_hash
    // AND recomputing its entry_hash so its own hash passes, but the link fails.
    const entry3 = JSON.parse(lines[2]!) as ChainEntry;
    entry3.previous_hash = 'a'.repeat(64); // points to the wrong place
    entry3.entry_hash = computeEntryHash(entry3); // hash is self-consistent but link is broken
    lines[2] = JSON.stringify(entry3);
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Hash link broken at sequence 3/);
  });

  it('detects a wrong sequence number', async () => {
    await buildChain('2026-03', 2);
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    // Change entry 2's sequence from 2 to 5.
    const entry2 = JSON.parse(lines[1]!) as ChainEntry;
    entry2.sequence = 5;
    entry2.entry_hash = computeEntryHash(entry2);
    lines[1] = JSON.stringify(entry2);
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Sequence mismatch/);
  });

  it('includes PERIOD_CLOSE entry in the verified count', async () => {
    const writer = makeWriter();
    await writer.createPeriodFile('2026-03', null, {});
    await writer.appendEntry('2026-03', 'TRANSACTION', { n: 1 });
    await writer.sealPeriod('2026-03', { period_id: '2026-03' });

    // Re-open the sealed file for reading (make it temporarily writable for cleanup)
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');
    await fs.chmod(filePath, 0o444); // ensure it's still read-only

    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3); // genesis + transaction + period_close
  });

  it('reports 0 verified entries when chain file is empty', async () => {
    const filePath = path.join(tmpDir, '2026-03.chain.jsonl');
    await fs.writeFile(filePath, '', 'utf8');
    const reader = new ChainReader(tmpDir);
    const result = await reader.verifyChain('2026-03');
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });
});
