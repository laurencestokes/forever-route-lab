import { describe, expect, it } from 'vitest';
import { decodeBlte } from './blte';
import { checkPin, parseBuildInfo, selectProduct } from './buildinfo';
import { float32FromBits, hasFlag, readBits, signExtend, xorByte } from './bytes';
import { parseBuildConfig, parseConfig } from './config';
import { EncodingTable } from './encoding';
import { CascError } from './errors';
import { bucketOfEKey, LocalIndex, parseIndexFile } from './idx';
import { CONTENT_ENCRYPTED, CONTENT_LOW_VIOLENCE, CONTENT_NO_NAME_HASH, RootManifest } from './root';
import { blte, encodingTable, indexFile, rootManifest } from './test-support';

const key = (n: number): Buffer => {
  const b = Buffer.alloc(16);
  b.writeUInt32BE(n, 0);
  b.writeUInt32BE(n * 7 + 3, 12);
  return b;
};

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CascError) return error.code;
    throw error;
  }
  return 'no error';
};

describe('byte helpers (no bitwise operators)', () => {
  it('xorByte, hasFlag, readBits, signExtend and float bits', () => {
    expect(xorByte(0b1100_1010, 0b1010_0110)).toBe(0b0110_1100);
    expect(xorByte(0xff, 0xff)).toBe(0);
    expect(hasFlag(0x10000, 0x10000)).toBe(true);
    expect(hasFlag(0x0ffff, 0x10000)).toBe(false);
    // the little-endian word is 0b1011_0110_1010_1100; its bits 3..11 are 0b0_1101_0101 = 213
    const b = Buffer.from([0b1010_1100, 0b1011_0110]);
    expect(readBits(b, 0, 3, 9)).toBe(0b0_1101_0101);
    expect(readBits(b, 0, 0, 16)).toBe(0b1011_0110_1010_1100);
    expect(() => readBits(b, 0, 10, 8)).toThrow(CascError);
    expect(signExtend(0x3ffff, 18)).toBe(-1);
    expect(signExtend(0x1ffff, 18)).toBe(0x1ffff);
    expect(signExtend(0x20000, 18)).toBe(-0x20000);
    expect(float32FromBits(0x3f800000)).toBe(1);
  });
});

describe('.build.info', () => {
  const text = [
    'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|CDN Hosts!STRING:0|Tags!STRING:0|Version!STRING:0|Product!STRING:0',
    `eu|1|${'a'.repeat(32)}|${'b'.repeat(32)}|host.invalid|enUS speech?:|1.60.1.70009|wow_classic_beta`,
    `eu|0|${'c'.repeat(32)}|${'b'.repeat(32)}|host.invalid|old|1.60.1.1|wow_classic_beta`,
    `eu|1|${'d'.repeat(32)}|${'e'.repeat(32)}|host.invalid|x|1.15.9.1|wow_classic_era`,
  ].join('\r\n');

  it('keeps only product, version, build key and CDN key of the active rows', () => {
    const rows = parseBuildInfo(text);
    expect(rows).toEqual([
      { product: 'wow_classic_beta', version: '1.60.1.70009', buildKey: 'a'.repeat(32), cdnKey: 'b'.repeat(32) },
      { product: 'wow_classic_era', version: '1.15.9.1', buildKey: 'd'.repeat(32), cdnKey: 'e'.repeat(32) },
    ]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['buildKey', 'cdnKey', 'product', 'version']);
    expect(JSON.stringify(rows)).not.toMatch(/host|speech|Tags/);
  });

  it('selects one product and checks the pin', () => {
    const row = selectProduct(parseBuildInfo(text), 'wow_classic_beta');
    expect(row.version).toBe('1.60.1.70009');
    expect(code(() => selectProduct(parseBuildInfo(text), 'wow'))).toBe('missing');
    const pin = { product: 'wow_classic_beta', version: '1.60.1.70009', buildKey: 'a'.repeat(32) };
    expect(() => checkPin(row, pin)).not.toThrow();
    expect(code(() => checkPin(row, { ...pin, version: '1.60.1.70010' }))).toBe('pin');
    expect(code(() => checkPin(row, { ...pin, buildKey: 'f'.repeat(32) }))).toBe('pin');
  });

  it('fails closed on ragged rows, bad keys and duplicate active rows', () => {
    const header = 'Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0|Product!STRING:0';
    expect(code(() => parseBuildInfo(`${header}\n1|${'a'.repeat(32)}|x|1.0|p`))).toBe('format');
    expect(code(() => parseBuildInfo(`${header}\n1|${'a'.repeat(32)}`))).toBe('format');
    expect(code(() => parseBuildInfo('Product!STRING:0\nx'))).toBe('format');
    const twice = parseBuildInfo(`${header}\n1|${'a'.repeat(32)}|${'b'.repeat(32)}|1.0|p\n1|${'c'.repeat(32)}|${'b'.repeat(32)}|1.1|p`);
    expect(code(() => selectProduct(twice, 'p'))).toBe('format');
  });
});

describe('build config', () => {
  it('reads root and encoding keys', () => {
    const text = `# Build Configuration\n\nroot = ${'1'.repeat(32)}\nencoding = ${'2'.repeat(32)} ${'3'.repeat(32)}\nencoding-size = 10 20\n`;
    expect(parseConfig(text).get('encoding-size')).toBe('10 20');
    expect(parseBuildConfig(text)).toEqual({ rootCKey: '1'.repeat(32), encodingCKey: '2'.repeat(32), encodingEKey: '3'.repeat(32) });
    expect(code(() => parseBuildConfig(`root = ${'1'.repeat(32)}\nencoding = ${'2'.repeat(32)}\n`))).toBe('format');
    expect(code(() => parseBuildConfig('encoding = a b\n'))).toBe('format');
  });
});

describe('local indices', () => {
  it('computes the bucket as the folded XOR of the first nine key bytes', () => {
    expect(bucketOfEKey(Buffer.from([0x01, 0x02, 0, 0, 0, 0, 0, 0, 0, 0xff]))).toBe(0x3);
    expect(bucketOfEKey(Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0x0);
    // 0x12 ^ 0x34 = 0x26, ^ 0x56 = 0x70, ^ 0x78 = 0x08, ^ 0x9a = 0x92; then 0x9 ^ 0x2 = 0xb
    expect(bucketOfEKey(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0, 0, 0, 0]))).toBe(0xb);
  });

  it('finds entries by binary search, splitting the 40-bit offset into archive and offset', () => {
    const keys = Array.from({ length: 40 }, (_, i) => key(i * 977));
    const bucket = bucketOfEKey(keys[0] ?? Buffer.alloc(16));
    const same = keys.filter((k) => bucketOfEKey(k) === bucket);
    const entries = same.map((ekey, i) => ({ ekey, archive: i % 3, offset: 2 ** 29 + i * 100, size: 50 + i }));
    const file = parseIndexFile(indexFile(bucket, entries));
    expect(file.count).toBe(entries.length);
    const index = LocalIndex.fromFiles(new Map([[`${bucket.toString(16).padStart(2, '0')}00000003.idx`, indexFile(bucket, entries)]]));
    for (const e of entries) expect(index.lookup(e.ekey)).toEqual({ archive: e.archive, offset: e.offset, size: e.size });
    expect(index.lookup(e0Missing(same))).toBeNull();
    expect(index.entryCount).toBe(entries.length);
  });

  it('refuses a wrong version, a bucket that disagrees with the file name, and no files', () => {
    const bytes = indexFile(2, []);
    bytes.writeUInt16LE(6, 8);
    expect(code(() => parseIndexFile(bytes))).toBe('format');
    expect(code(() => LocalIndex.fromFiles(new Map([['0300000001.idx', indexFile(2, [])]])))).toBe('format');
    expect(code(() => LocalIndex.fromFiles(new Map()))).toBe('missing');
  });
});

/** A key in the same bucket as `keys` that is not one of them. */
function e0Missing(keys: readonly Buffer[]): Buffer {
  const bucket = bucketOfEKey(keys[0] ?? Buffer.alloc(16));
  for (let n = 1; ; n += 1) {
    const k = key(n * 13 + 5);
    if (bucketOfEKey(k) === bucket && !keys.some((x) => x.subarray(0, 9).equals(k.subarray(0, 9)))) return k;
  }
}

describe('BLTE', () => {
  const plain = Buffer.from('plain chunk|');
  const zipped = Buffer.from('zlib chunk, repeated repeated repeated|');
  const secret = Buffer.from('encrypted chunk bytes');

  it('decodes N and Z chunks, and zero-fills and reports E chunks', () => {
    const r = decodeBlte(
      blte([
        { mode: 'N', data: plain },
        { mode: 'Z', data: zipped },
        { mode: 'E', data: secret, keyName: 'fa505078126acb3e' },
        { mode: 'N', data: plain },
      ]),
    );
    expect(r.data.subarray(0, plain.length + zipped.length).toString()).toBe(`${plain.toString()}${zipped.toString()}`);
    const start = plain.length + zipped.length;
    expect(r.encryptedRanges).toEqual([{ start, end: start + secret.length }]);
    expect(r.data.subarray(start, start + secret.length).every((b) => b === 0)).toBe(true);
    expect(r.data.subarray(start + secret.length).toString()).toBe(plain.toString());
    expect(r.keyNames).toEqual(['fa505078126acb3e']);
    expect(r.chunks.map((c) => c.mode)).toEqual(['N', 'Z', 'E', 'N']);
  });

  it('decodes a single chunk without a table, and refuses an encrypted one', () => {
    expect(decodeBlte(blte([{ mode: 'Z', data: zipped }], { table: false })).data.toString()).toBe(zipped.toString());
    expect(code(() => decodeBlte(blte([{ mode: 'E', data: secret }], { table: false })))).toBe('encrypted');
  });

  it('fails closed on a bad checksum, a nested frame, truncation and trailing bytes', () => {
    const stream = blte([{ mode: 'N', data: plain }]);
    const tampered = Buffer.from(stream);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) + 1, tampered.length - 1);
    expect(code(() => decodeBlte(tampered))).toBe('integrity');
    expect(decodeBlte(tampered, { verifyChunks: false }).data.length).toBe(plain.length);
    expect(code(() => decodeBlte(blte([{ mode: 'F', data: plain }])))).toBe('format');
    expect(code(() => decodeBlte(stream.subarray(0, stream.length - 2)))).toBe('format');
    expect(code(() => decodeBlte(Buffer.concat([stream, Buffer.from([0])])))).toBe('format');
    expect(code(() => decodeBlte(Buffer.from('NOPE0000')))).toBe('format');
  });
});

describe('encoding table', () => {
  const entries = Array.from({ length: 70 }, (_, i) => ({ ckey: key(i * 31 + 1), ekey: key(100000 + i), size: 1000 + i }));

  it('finds every key across several pages and reports absent keys', () => {
    const table = EncodingTable.parse(encodingTable(entries));
    expect(table.pageCount).toBe(3);
    for (const e of entries) expect(table.lookup(e.ckey)).toEqual({ ekey: e.ekey.toString('hex'), size: e.size });
    expect(table.lookup(key(2))).toBeNull();
    expect(table.lookup(Buffer.alloc(16))).toBeNull();
  });

  it('checks a page against its MD5 when the page is first used', () => {
    const bytes = encodingTable(entries);
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 10) + 1, bytes.length - 10);
    const table = EncodingTable.parse(bytes);
    const last = [...entries].sort((a, b) => Buffer.compare(a.ckey, b.ckey)).at(-1);
    expect(code(() => table.lookup(last?.ckey ?? Buffer.alloc(16)))).toBe('integrity');
    expect(code(() => EncodingTable.parse(Buffer.from('XX')))).toBe('format');
  });
});

describe('root manifest (MFST v2)', () => {
  it('keeps the first enUS, non-LowViolence entry per FileDataID and flags encrypted blocks', () => {
    const bytes = rootManifest(
      [
        { locale: 0x10, flags: [0, 0, 0], entries: [{ fileDataId: 5, ckey: key(1) }] }, // deDE only
        { locale: 0x2, flags: [CONTENT_LOW_VIOLENCE, 0, 0], entries: [{ fileDataId: 5, ckey: key(2) }] },
        { locale: 0xffffffff, flags: [0, 0, 0], entries: [{ fileDataId: 5, ckey: key(3) }, { fileDataId: 9, ckey: key(4) }, { fileDataId: 4000000, ckey: key(5) }] },
        { locale: 0x2, flags: [0, CONTENT_ENCRYPTED, 0], entries: [{ fileDataId: 9, ckey: key(6) }, { fileDataId: 12, ckey: key(7) }] },
        { locale: 0x2, flags: [0, CONTENT_NO_NAME_HASH, 0], entries: [{ fileDataId: 13, ckey: key(8) }], noNameHashes: true },
      ],
      { total: 8, named: 7 },
    );
    const root = RootManifest.parse(bytes);
    expect(root.size).toBe(5);
    expect([...root.fileDataIds()]).toEqual([5, 9, 12, 13, 4000000]);
    expect(root.ckey(5)).toBe(key(3).toString('hex'));
    expect(root.ckey(9)).toBe(key(4).toString('hex'));
    expect(root.ckey(12)).toBe(key(7).toString('hex'));
    expect(root.ckey(13)).toBe(key(8).toString('hex'));
    expect(root.ckey(6)).toBeNull();
    expect(root.encryptedFlag(12)).toBe(true);
    expect(root.encryptedFlag(9)).toBe(false);
    expect(root.stats).toEqual({ blocks: 5, entries: 8, fileDataIds: 5, encryptedFlagFileDataIds: 2 });
  });

  it('reads name hashes when every file is named, even with the NoNameHash flag', () => {
    const bytes = rootManifest([{ locale: 0x2, flags: [CONTENT_NO_NAME_HASH, 0, 0], entries: [{ fileDataId: 1, ckey: key(1) }] }], { total: 1, named: 1 });
    expect(RootManifest.parse(bytes).ckey(1)).toBe(key(1).toString('hex'));
  });

  it('refuses other versions and truncated blocks', () => {
    const bytes = rootManifest([{ locale: 0x2, flags: [0, 0, 0], entries: [{ fileDataId: 1, ckey: key(1) }] }], { total: 1, named: 1 });
    const v1 = Buffer.from(bytes);
    v1.writeUInt32LE(1, 8);
    expect(code(() => RootManifest.parse(v1))).toBe('format');
    expect(code(() => RootManifest.parse(bytes.subarray(0, bytes.length - 4)))).toBe('format');
    expect(code(() => RootManifest.parse(Buffer.alloc(40)))).toBe('format');
  });
});
