import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// merkle.ts — Merkle tree construction, proof generation, and verification
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Build a Merkle tree from an array of leaf hashes and return the root.
 *
 * If the number of leaves is odd, the last leaf is duplicated to form a pair.
 * An empty array returns the hash of the string 'EMPTY'.
 */
export function buildMerkleTree(entryHashes: string[]): string {
  if (entryHashes.length === 0) return sha256('EMPTY');

  let level = [...entryHashes];

  while (level.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left; // duplicate last if odd
      nextLevel.push(sha256(left + right));
    }
    level = nextLevel;
  }

  return level[0]!;
}

/** A single step in a Merkle inclusion proof. */
export interface MerkleProofStep {
  hash: string;
  position: 'left' | 'right';
}

/**
 * Generate a Merkle inclusion proof for the leaf at `targetIndex`.
 *
 * The proof is an ordered array of sibling hashes that, together with the
 * leaf hash, allow anyone to reconstruct the Merkle root and verify inclusion.
 *
 * @throws Error if targetIndex is out of range.
 */
export function generateMerkleProof(
  entryHashes: string[],
  targetIndex: number,
): MerkleProofStep[] {
  if (targetIndex < 0 || targetIndex >= entryHashes.length) {
    throw new Error(
      `Index ${targetIndex} out of range [0, ${entryHashes.length})`,
    );
  }

  const proof: MerkleProofStep[] = [];
  let level = [...entryHashes];
  let index = targetIndex;

  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

    if (siblingIndex < level.length) {
      proof.push({
        hash: level[siblingIndex]!,
        position: index % 2 === 0 ? 'right' : 'left',
      });
    } else {
      // Odd level — last element is duplicated; sibling is itself.
      proof.push({
        hash: level[index]!,
        position: 'right',
      });
    }

    // Advance to the next level.
    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      nextLevel.push(sha256(left + right));
    }
    level = nextLevel;
    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * Verify a Merkle inclusion proof.
 *
 * Given a leaf hash, its proof, and the expected Merkle root, returns true if
 * the proof demonstrates that the leaf is included in the tree.
 */
export function verifyMerkleProof(
  entryHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): boolean {
  let currentHash = entryHash;

  for (const step of proof) {
    if (step.position === 'left') {
      currentHash = sha256(step.hash + currentHash);
    } else {
      currentHash = sha256(currentHash + step.hash);
    }
  }

  return currentHash === expectedRoot;
}
