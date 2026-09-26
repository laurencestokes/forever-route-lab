import { describe, expect, it } from 'vitest';
import { nodeSha256 } from '../../tests/support/fake-fetch';
import { sha256Bytes, sha256Hex } from './sha256';
import { REPLACEMENT_CHARACTER as R, utf8Decode, utf8Encode } from './text';

const webHex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await nodeSha256.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

describe('sha256 (pure, no bitwise operators)', () => {
  it('matches the FIPS 180-4 example vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with WebCrypto on every length around the block and padding boundaries', async () => {
    for (let length = 0; length <= 200; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + length * 7) % 256);
      expect(sha256Bytes(bytes), `length ${String(length)}`).toBe(await webHex(bytes));
    }
  });

  it('hashes strings as UTF-8, including astral characters and lone surrogates', async () => {
    for (const text of ['Übersetzung / 翻译 / перевод', '🐗 boar', 'a\ud800b', '\r\n\t']) {
      expect(sha256Hex(text)).toBe(await webHex(new TextEncoder().encode(text)));
    }
  });
});

describe('utf8', () => {
  it('round-trips and replaces invalid sequences', () => {
    const text = 'Aé翻🐗';
    expect(utf8Decode([...utf8Encode(text)])).toBe(text);
    expect([...utf8Encode(text)]).toEqual([...new TextEncoder().encode(text)]);
    expect(utf8Decode([0xc3])).toBe(R);
    expect(utf8Decode([0xff, 0x41])).toBe(`${R}A`);
    expect(utf8Decode([0xe0, 0x80, 0x80])).toBe(R.repeat(3));
  });
});
