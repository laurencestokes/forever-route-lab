import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inputHash, inputListText } from './input-hash';

describe('input hashes of derived files (terrain-navigation.md §13.3, §13.4)', () => {
  const a = { fileDataId: 775971, ckey: '0'.repeat(31) + '1' };
  const b = { fileDataId: 1349477, ckey: 'f'.repeat(32) };

  it('is SHA-256 over "<FileDataID> <CKey>" lines in FileDataID order, each file once', () => {
    expect(inputListText([b, a, a])).toBe(`775971 ${a.ckey}\n1349477 ${b.ckey}\n`);
    expect(inputHash([b, a])).toBe(createHash('sha256').update(`775971 ${a.ckey}\n1349477 ${b.ckey}\n`).digest('hex'));
    expect(inputHash([a, b])).toBe(inputHash([b, a]));
    expect(inputHash([a])).not.toBe(inputHash([{ ...a, ckey: 'e'.repeat(32) }]));
  });

  it('refuses malformed CKeys, bad FileDataIDs and a file listed with two CKeys', () => {
    expect(() => inputHash([{ fileDataId: 1, ckey: 'ABC' }])).toThrow(/not 32 lowercase hex/);
    expect(() => inputHash([{ fileDataId: 0, ckey: b.ckey }])).toThrow(/not a positive integer/);
    expect(() => inputHash([a, { ...a, ckey: b.ckey }])).toThrow(/listed with two CKeys/);
  });
});
