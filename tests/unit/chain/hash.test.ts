import { canonicalJsonStringify, computeEntryHash } from '../../../src/chain/hash';
import type { ChainEntry } from '../../../src/chain/types';

describe('canonicalJsonStringify', () => {
  it('serialises null', () => {
    expect(canonicalJsonStringify(null)).toBe('null');
  });

  it('serialises undefined as null', () => {
    expect(canonicalJsonStringify(undefined)).toBe('null');
  });

  it('serialises booleans', () => {
    expect(canonicalJsonStringify(true)).toBe('true');
    expect(canonicalJsonStringify(false)).toBe('false');
  });

  it('serialises integers without decimal point', () => {
    expect(canonicalJsonStringify(1250)).toBe('1250');
    expect(canonicalJsonStringify(0)).toBe('0');
    expect(canonicalJsonStringify(-42)).toBe('-42');
  });

  it('serialises decimals without trailing zeros', () => {
    // 1250.00 and 1250 are the same number in JS
    expect(canonicalJsonStringify(1250.0)).toBe('1250');
    // 1250.5 has no redundant trailing zeros
    expect(canonicalJsonStringify(1250.5)).toBe('1250.5');
    expect(canonicalJsonStringify(46200.0)).toBe('46200');
    expect(canonicalJsonStringify(38500.0)).toBe('38500');
    expect(canonicalJsonStringify(7700.0)).toBe('7700');
  });

  it('serialises strings with proper JSON escaping', () => {
    expect(canonicalJsonStringify('hello')).toBe('"hello"');
    expect(canonicalJsonStringify('with "quotes"')).toBe('"with \\"quotes\\""');
    expect(canonicalJsonStringify('')).toBe('""');
  });

  it('serialises arrays preserving element order', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJsonStringify(['b', 'a'])).toBe('["b","a"]');
    expect(canonicalJsonStringify([])).toBe('[]');
  });

  it('sorts top-level object keys alphabetically', () => {
    const obj = { z: 1, a: 2, m: 3 };
    expect(canonicalJsonStringify(obj)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys alphabetically at every level', () => {
    const obj = { outer_z: { inner_b: 1, inner_a: 2 }, outer_a: 99 };
    expect(canonicalJsonStringify(obj)).toBe(
      '{"outer_a":99,"outer_z":{"inner_a":2,"inner_b":1}}',
    );
  });

  it('produces the same output regardless of key insertion order', () => {
    const obj1 = { b: 2, a: 1, c: 3 };
    const obj2 = { c: 3, a: 1, b: 2 };
    const obj3 = { a: 1, c: 3, b: 2 };
    expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
    expect(canonicalJsonStringify(obj2)).toBe(canonicalJsonStringify(obj3));
  });

  it('handles objects inside arrays without sorting array elements', () => {
    const arr = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
    expect(canonicalJsonStringify(arr)).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it('handles deeply nested structures', () => {
    const deep = { x: { y: { z: [1, 2, { w: 'v', q: 'r' }] } } };
    expect(canonicalJsonStringify(deep)).toBe(
      '{"x":{"y":{"z":[1,2,{"q":"r","w":"v"}]}}}',
    );
  });

  it('produces no whitespace', () => {
    const result = canonicalJsonStringify({ a: 1, b: 'hello', c: [1, 2] });
    expect(result).not.toMatch(/\s/);
  });
});

describe('computeEntryHash', () => {
  const sampleEntry: ChainEntry = {
    sequence: 1,
    timestamp: '2026-03-04T10:00:00.000Z',
    previous_hash: 'GENESIS',
    entry_hash: 'abc123',
    type: 'GENESIS',
    merkle_index: null,
    payload: { period_id: '2026-03', previous_period_id: null },
  };

  it('returns a 64-character lowercase hex string', () => {
    const hash = computeEntryHash(sampleEntry);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input always produces same hash', () => {
    expect(computeEntryHash(sampleEntry)).toBe(computeEntryHash(sampleEntry));
  });

  it('ignores the current value of entry_hash when computing (treats it as "")', () => {
    const withHash = { ...sampleEntry, entry_hash: 'somehash' };
    const withEmpty = { ...sampleEntry, entry_hash: '' };
    const withOther = { ...sampleEntry, entry_hash: 'completely_different' };
    // All three should produce identical hashes because entry_hash is zeroed out.
    expect(computeEntryHash(withHash)).toBe(computeEntryHash(withEmpty));
    expect(computeEntryHash(withEmpty)).toBe(computeEntryHash(withOther));
  });

  it('produces a different hash when sequence changes', () => {
    const modified = { ...sampleEntry, sequence: 2 };
    expect(computeEntryHash(sampleEntry)).not.toBe(computeEntryHash(modified));
  });

  it('produces a different hash when timestamp changes', () => {
    const modified = { ...sampleEntry, timestamp: '2026-03-04T11:00:00.000Z' };
    expect(computeEntryHash(sampleEntry)).not.toBe(computeEntryHash(modified));
  });

  it('produces a different hash when previous_hash changes', () => {
    const modified = { ...sampleEntry, previous_hash: 'different' };
    expect(computeEntryHash(sampleEntry)).not.toBe(computeEntryHash(modified));
  });

  it('produces a different hash when type changes', () => {
    const modified = { ...sampleEntry, type: 'TRANSACTION' as const };
    expect(computeEntryHash(sampleEntry)).not.toBe(computeEntryHash(modified));
  });

  it('produces a different hash when any payload field changes', () => {
    const modified = {
      ...sampleEntry,
      payload: { ...sampleEntry.payload, period_id: '2026-04' },
    };
    expect(computeEntryHash(sampleEntry)).not.toBe(computeEntryHash(modified));
  });

  it('is consistent across separate calls with identical data', () => {
    const entry1: ChainEntry = {
      sequence: 5,
      timestamp: '2026-03-15T09:30:00.000Z',
      previous_hash: 'a'.repeat(64),
      entry_hash: '',
      type: 'TRANSACTION',
      merkle_index: 4,
      payload: {
        transaction_id: 'TXN-2026-03-00005',
        debit: 1000,
        credit: 1000,
      },
    };
    const entry2: ChainEntry = { ...entry1 };
    expect(computeEntryHash(entry1)).toBe(computeEntryHash(entry2));
  });

  it('verifies its own output — stored hash matches recomputed hash', () => {
    const entry = { ...sampleEntry, entry_hash: '' };
    const hash = computeEntryHash(entry);
    const stored = { ...entry, entry_hash: hash };
    // Recomputing on the stored entry (which has entry_hash = hash) should
    // produce the same result because the algorithm zeroes entry_hash first.
    expect(computeEntryHash(stored)).toBe(hash);
  });
});
