/**
 * Unit tests for the Merkle tree implementation.
 */

import {
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from '../../../src/chain/merkle';

// ---------------------------------------------------------------------------
// buildMerkleTree
// ---------------------------------------------------------------------------

describe('buildMerkleTree', () => {
  it('returns hash of "EMPTY" for an empty array', () => {
    const root = buildMerkleTree([]);
    expect(root).toHaveLength(64);
    // Should be sha256("EMPTY") — just verify it is deterministic
    expect(buildMerkleTree([])).toBe(root);
  });

  it('returns the hash itself for a single-element tree', () => {
    const hash = 'a'.repeat(64);
    const root = buildMerkleTree([hash]);
    expect(root).toHaveLength(64);
    // With one element, the root is sha256(hash + hash)
    expect(buildMerkleTree([hash])).toBe(root);
  });

  it('produces a deterministic result for 2 elements', () => {
    const hashes = ['a'.repeat(64), 'b'.repeat(64)];
    const root1 = buildMerkleTree(hashes);
    const root2 = buildMerkleTree(hashes);
    expect(root1).toBe(root2);
    expect(root1).toHaveLength(64);
  });

  it('produces a deterministic result for 3 elements (odd — last duplicated)', () => {
    const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
    const root = buildMerkleTree(hashes);
    expect(root).toHaveLength(64);
    expect(buildMerkleTree(hashes)).toBe(root);
  });

  it('produces a deterministic result for 4 elements', () => {
    const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];
    const root = buildMerkleTree(hashes);
    expect(root).toHaveLength(64);
    expect(buildMerkleTree(hashes)).toBe(root);
  });

  it('produces a deterministic result for 7 elements', () => {
    const hashes = Array.from({ length: 7 }, (_, i) => String(i).repeat(64).slice(0, 64));
    const root = buildMerkleTree(hashes);
    expect(root).toHaveLength(64);
    expect(buildMerkleTree(hashes)).toBe(root);
  });

  it('different inputs produce different roots', () => {
    const hashesA = ['a'.repeat(64), 'b'.repeat(64)];
    const hashesB = ['a'.repeat(64), 'c'.repeat(64)];
    expect(buildMerkleTree(hashesA)).not.toBe(buildMerkleTree(hashesB));
  });

  it('order matters — swapping elements produces a different root', () => {
    const hashesA = ['a'.repeat(64), 'b'.repeat(64)];
    const hashesB = ['b'.repeat(64), 'a'.repeat(64)];
    expect(buildMerkleTree(hashesA)).not.toBe(buildMerkleTree(hashesB));
  });
});

// ---------------------------------------------------------------------------
// generateMerkleProof + verifyMerkleProof
// ---------------------------------------------------------------------------

describe('generateMerkleProof and verifyMerkleProof', () => {
  const HASHES_7 = Array.from({ length: 7 }, (_, i) =>
    // Use real SHA-256-length hex strings for realism.
    Buffer.from(`entry-${i}`).toString('hex').padEnd(64, '0').slice(0, 64),
  );
  const ROOT_7 = buildMerkleTree(HASHES_7);

  it('verifies proof for every entry in a 7-entry tree', () => {
    for (let i = 0; i < HASHES_7.length; i++) {
      const proof = generateMerkleProof(HASHES_7, i);
      const valid = verifyMerkleProof(HASHES_7[i]!, proof, ROOT_7);
      expect(valid).toBe(true);
    }
  });

  it('verifies proof for a single-entry tree', () => {
    const hashes = ['a'.repeat(64)];
    const root = buildMerkleTree(hashes);
    const proof = generateMerkleProof(hashes, 0);
    expect(verifyMerkleProof(hashes[0]!, proof, root)).toBe(true);
  });

  it('verifies proof for a 2-entry tree', () => {
    const hashes = ['a'.repeat(64), 'b'.repeat(64)];
    const root = buildMerkleTree(hashes);
    expect(verifyMerkleProof(hashes[0]!, generateMerkleProof(hashes, 0), root)).toBe(true);
    expect(verifyMerkleProof(hashes[1]!, generateMerkleProof(hashes, 1), root)).toBe(true);
  });

  it('verifies proof for a 4-entry tree', () => {
    const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];
    const root = buildMerkleTree(hashes);
    for (let i = 0; i < hashes.length; i++) {
      const proof = generateMerkleProof(hashes, i);
      expect(verifyMerkleProof(hashes[i]!, proof, root)).toBe(true);
    }
  });

  it('tampered entry hash → proof verification fails', () => {
    const hashes = [...HASHES_7];
    const proof = generateMerkleProof(hashes, 3);
    const tamperedHash = 'f'.repeat(64); // Different from HASHES_7[3]
    expect(verifyMerkleProof(tamperedHash, proof, ROOT_7)).toBe(false);
  });

  it('tampered root → proof verification fails', () => {
    const proof = generateMerkleProof(HASHES_7, 0);
    const wrongRoot = '0'.repeat(64);
    expect(verifyMerkleProof(HASHES_7[0]!, proof, wrongRoot)).toBe(false);
  });

  it('throws for out-of-range index', () => {
    expect(() => generateMerkleProof(HASHES_7, -1)).toThrow();
    expect(() => generateMerkleProof(HASHES_7, HASHES_7.length)).toThrow();
  });

  it('proof from wrong tree → fails against correct root', () => {
    const altHashes = [...HASHES_7];
    altHashes[3] = 'x'.repeat(64); // Tamper with one hash
    const altRoot = buildMerkleTree(altHashes);

    const proofFromCorrect = generateMerkleProof(HASHES_7, 3);
    // This proof is for the original tree — it should fail against the alt root
    expect(verifyMerkleProof(HASHES_7[3]!, proofFromCorrect, altRoot)).toBe(false);
  });
});
