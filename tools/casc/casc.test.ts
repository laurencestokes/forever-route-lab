import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCasc } from './casc';
import { CascError } from './errors';
import { archivePath, configPath, DEFAULT_WOW_INSTALL, indexPath, resolveInstall } from './paths';
import { CONTENT_ENCRYPTED } from './root';
import { SYNTH_PRODUCT, SYNTH_VERSION, writeSyntheticInstall, type SynthFile } from './test-support';

let install = '';

beforeEach(() => {
  install = mkdtempSync(join(tmpdir(), 'frl-casc-'));
});

afterEach(() => {
  rmSync(install, { recursive: true, force: true });
});

const text = (s: string): Buffer => Buffer.from(s, 'utf8');
const big = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7) % 251));

const FILES: readonly SynthFile[] = [
  { fileDataId: 775971, content: text('a WDT, one zlib chunk') },
  { fileDataId: 10, content: big(5000), chunks: [{ mode: 'N', data: big(5000).subarray(0, 1000) }, { mode: 'Z', data: big(5000).subarray(1000) }] },
  { fileDataId: 11, content: text('stored without the local header'), headerless: true },
  { fileDataId: 12, content: text('single chunk, no table'), table: false },
  { fileDataId: 13, content: text('plain header|secret section|plain tail'), chunks: [{ mode: 'N', data: text('plain header|') }, { mode: 'E', data: text('secret section'), keyName: 'aabbccdd00112233' }, { mode: 'N', data: text('|plain tail') }], flags: [0, CONTENT_ENCRYPTED, 0] },
  { fileDataId: 14, content: text('not downloaded yet'), zeroPlaceholder: true },
  { fileDataId: 15, content: text('known to root and encoding, absent from the indices'), notIndexed: true },
  { fileDataId: 16, content: text('German only'), locale: 0x10 },
];

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CascError) return error.code;
    throw error;
  }
  return 'no error';
};

describe('LocalCasc on a synthetic install', () => {
  it('opens through .build.info, the build config, indices, encoding and root, and reads files by FileDataID', () => {
    const synth = writeSyntheticInstall(install, FILES);
    const casc = LocalCasc.open({ install, product: SYNTH_PRODUCT, pin: { product: SYNTH_PRODUCT, version: SYNTH_VERSION, buildKey: synth.buildKey } });
    try {
      expect(casc.build).toEqual({ product: SYNTH_PRODUCT, version: SYNTH_VERSION, buildKey: synth.buildKey, cdnKey: synth.cdnKey });
      expect(casc.buildConfig.rootCKey).toBe(synth.rootCKey);
      expect(casc.stats.root.fileDataIds).toBe(7);
      expect(casc.stats.indexFiles).toHaveLength(16);
      expect(casc.stats.indexFiles.every((name) => name.endsWith('00000002.idx'))).toBe(true);
      for (const id of [775971, 10, 11, 12]) {
        const f = casc.file(id);
        const source = FILES.find((x) => x.fileDataId === id);
        expect(f.data.equals(source?.content ?? Buffer.alloc(0))).toBe(true);
        expect(f.verified).toBe(true);
        expect(f.ckey).toBe(synth.ckeys.get(id));
        expect(casc.ckeyOf(id)).toBe(f.ckey);
      }
      expect(casc.file(11).headerless).toBe(true);
      expect(casc.file(10).headerless).toBe(false);
      expect(casc.headerlessEntries).toBe(2);
      expect(casc.has(16)).toBe(false);
      expect([...casc.fileDataIds()]).toEqual([10, 11, 12, 13, 14, 15, 775971]);
    } finally {
      casc.close();
    }
  });

  it('refuses encrypted files unless zero-fill is asked for, and then reports the zeroed range', () => {
    writeSyntheticInstall(install, FILES);
    const casc = LocalCasc.open({ install, product: SYNTH_PRODUCT });
    try {
      expect(code(() => casc.file(13))).toBe('encrypted');
      const f = casc.file(13, { encrypted: 'zero-fill' });
      expect(f.verified).toBe(false);
      expect(f.encryptedRanges).toEqual([{ start: 13, end: 27 }]);
      expect(f.keyNames).toEqual(['aabbccdd00112233']);
      expect(f.data.subarray(0, 13).toString()).toBe('plain header|');
      expect(f.data.subarray(13, 27).every((b) => b === 0)).toBe(true);
      expect(casc.encryptedFlag(13)).toBe(true);
    } finally {
      casc.close();
    }
  });

  it('fails closed on missing files: not in root, not indexed, or a zero-filled placeholder', () => {
    writeSyntheticInstall(install, FILES);
    const casc = LocalCasc.open({ install, product: SYNTH_PRODUCT });
    try {
      expect(code(() => casc.file(999))).toBe('missing');
      expect(code(() => casc.file(16))).toBe('missing'); // deDE only
      expect(code(() => casc.file(15))).toBe('missing');
      expect(code(() => casc.file(14))).toBe('missing');
    } finally {
      casc.close();
    }
  });

  it('detects corrupted archive bytes through the chunk or file checksum', () => {
    writeSyntheticInstall(install, [{ fileDataId: 1, content: text('checksummed content'), chunks: [{ mode: 'N', data: text('checksummed content') }] }]);
    const archive = archivePath(install, 0);
    const bytes = readFileSync(archive);
    const at = bytes.indexOf(Buffer.from('checksummed'));
    bytes.writeUInt8(bytes.readUInt8(at) + 1, at);
    writeFileSync(archive, bytes);
    const casc = LocalCasc.open({ install, product: SYNTH_PRODUCT });
    try {
      expect(code(() => casc.file(1))).toBe('integrity');
    } finally {
      casc.close();
    }
  });

  it('refuses a pin mismatch, an unknown product and a missing build config', () => {
    const synth = writeSyntheticInstall(install, FILES);
    expect(code(() => LocalCasc.open({ install, product: SYNTH_PRODUCT, pin: { product: SYNTH_PRODUCT, version: '9.9.9.9', buildKey: synth.buildKey } }))).toBe('pin');
    expect(code(() => LocalCasc.open({ install, product: 'wow' }))).toBe('missing');
    rmSync(configPath(install, synth.buildKey));
    expect(() => LocalCasc.open({ install, product: SYNTH_PRODUCT })).toThrow(/ENOENT/);
  });

  it('touches only .build.info and Data/{config,data} of the install', () => {
    writeSyntheticInstall(install, FILES);
    const top = readdirSync(install).sort();
    expect(top).toEqual(['.build.info', 'Data']);
    expect(readdirSync(join(install, 'Data')).sort()).toEqual(['config', 'data']);
  });
});

describe('install paths', () => {
  it('uses WOW_INSTALL, else the Battle.net default', () => {
    expect(resolveInstall({ WOW_INSTALL: 'D:\\Games\\WoW' })).toBe('D:\\Games\\WoW');
    expect(resolveInstall({})).toBe(DEFAULT_WOW_INSTALL);
    expect(resolveInstall({ WOW_INSTALL: '  ' })).toBe(DEFAULT_WOW_INSTALL);
  });

  it('builds only validated names under Data/config and Data/data', () => {
    expect(configPath('X', 'ab'.repeat(16))).toBe(join('X', 'Data', 'config', 'ab', 'ab', 'ab'.repeat(16)));
    expect(code(() => configPath('X', '../../WTF'))).toBe('path');
    expect(code(() => indexPath('X', '..\\x.idx'))).toBe('path');
    expect(indexPath('X', '0a0000002f.idx')).toBe(join('X', 'Data', 'data', '0a0000002f.idx'));
    expect(archivePath('X', 7)).toBe(join('X', 'Data', 'data', 'data.007'));
    expect(code(() => archivePath('X', -1))).toBe('path');
  });
});

describe('tools/casc source discipline', () => {
  const dir = new URL('.', import.meta.url);
  const readers = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts' && name !== 'make-layouts.ts');

  it('never writes files and never names another install folder', () => {
    expect(readers.length).toBeGreaterThan(8);
    for (const name of readers) {
      const source = readFileSync(new URL(name, dir), 'utf8');
      expect(source, name).not.toMatch(/\b(?:writeFile|writeFileSync|appendFile|createWriteStream|mkdir|rmSync|unlink|rename)\w*\(/);
      expect(source, name).not.toMatch(/openSync\([^)]*,\s*'(?!r')/);
      expect(source, name).not.toMatch(/['"`](?:Cache|WTF|Logs|Interface)['"`/\\]/);
      expect(source, name).not.toMatch(/\bfetch\(|node:https?|node:net\b/);
    }
  });
});
