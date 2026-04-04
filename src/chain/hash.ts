import { createHash } from 'node:crypto';
import type { ChainEntry } from './types';

/**
 * Produces a canonical JSON string with keys sorted alphabetically at every
 * level of nesting, no whitespace, and numbers serialised without trailing
 * zeros (JavaScript's native number serialisation already satisfies this).
 *
 * This serialisation MUST be deterministic and reproducible — any deviation
 * will produce a different hash and break chain verification.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  // Primitives: delegate to JSON.stringify which handles escaping and
  // number formatting (no trailing zeros, scientific notation as needed).
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    const items = (value as unknown[]).map(canonicalJsonStringify);
    return '[' + items.join(',') + ']';
  }

  // Plain object: sort keys alphabetically, recurse on values.
  const obj = value as Record<string, unknown>;
  const pairs = Object.keys(obj)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes the entry_hash for a chain entry.
 *
 * Algorithm (per spec):
 * 1. Copy the entry with entry_hash set to "" (empty string)
 * 2. Canonically serialise (alphabetically sorted keys, no whitespace)
 * 3. SHA-256 the UTF-8 bytes
 * 4. Return as lowercase hex (64 characters)
 */
export function computeEntryHash(entry: ChainEntry): string {
  const hashInput: ChainEntry = { ...entry, entry_hash: '' };
  const canonical = canonicalJsonStringify(hashInput);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
