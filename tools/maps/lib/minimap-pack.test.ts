/**
 * The tile pack and its pointer (docs/research/map-atlas.md §18.2 step 10, §23.3; A17, MM-06): a
 * deterministic ustar tar of NOTICE.md, manifest.json and t/, in that order.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';
import { packAssetName, packFiles, packPointer, packTag, pointerNameProblems, TAR_BLOCK, TAR_RECORD, tarArchive, tarEntries, tilesTreeHash } from './minimap-pack';

const tiles = [
  { path: 't/0/1/0.webp', bytes: Buffer.from('tile b') },
  { path: 't/-1/0/0.webp', bytes: Buffer.from('tile a, a little longer') },
  { path: 't/0/0/0.webp', bytes: Buffer.alloc(700, 7) },
];

describe('the tile pack', () => {
  const files = packFiles('# notice\n', '{"kind":"map-minimap"}\n', tiles);
  const tar = tarArchive(files);

  it('holds NOTICE.md, manifest.json and the tiles under t/ in path order', () => {
    expect(tarEntries(tar).map((e) => e.path)).toEqual(['NOTICE.md', 'manifest.json', 't/-1/0/0.webp', 't/0/0/0.webp', 't/0/1/0.webp']);
    const e = tarEntries(tar).find((x) => x.path === 't/0/0/0.webp');
    expect(e?.size).toBe(700);
    expect(Buffer.from(tar.subarray(e?.offset ?? 0, (e?.offset ?? 0) + 700)).equals(Buffer.alloc(700, 7))).toBe(true);
  });

  it('is byte-identical for the same files, in whole 10,240-byte records with valid header checksums', () => {
    expect(tarArchive(packFiles('# notice\n', '{"kind":"map-minimap"}\n', [...tiles].reverse())).equals(tar)).toBe(true);
    expect(tar.length % TAR_RECORD).toBe(0);
    const h = tar.subarray(0, TAR_BLOCK);
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i += 1) sum += i >= 148 && i < 156 ? 32 : (h[i] ?? 0);
    expect(parseInt(h.toString('latin1', 148, 154), 8)).toBe(sum);
    expect(h.toString('latin1', 100, 107)).toBe('0000644');
    expect(h.toString('latin1', 136, 147)).toBe('00000000000');
    expect(h.toString('latin1', 257, 262)).toBe('ustar');
  });

  it('refuses a tile outside t/', () => {
    expect(() => packFiles('n', 'm', [{ path: 'x.webp', bytes: Buffer.alloc(1) }])).toThrow(/not under t\//);
  });

  it('is read by the system tar, when there is one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frl-pack-'));
    try {
      writeFileSync(join(dir, 'p.tar'), tar);
      let listed: string;
      try {
        listed = execFileSync('tar', ['-tf', 'p.tar'], { cwd: dir, encoding: 'utf8' });
      } catch {
        return; // no tar on this machine: the reader above is the check
      }
      expect(listed.split(/\r?\n/).filter((l) => l !== '')).toEqual(['NOTICE.md', 'manifest.json', 't/-1/0/0.webp', 't/0/0/0.webp', 't/0/1/0.webp']);
      execFileSync('tar', ['-xf', 'p.tar'], { cwd: dir });
      expect(readFileSync(join(dir, 'NOTICE.md'), 'utf8')).toBe('# notice\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is named and pinned by the tiles\' tree hash and its own SHA-256', () => {
    const tree = tilesTreeHash(tiles.map((t) => ({ path: t.path, sha256: sha256Hex(t.bytes) })));
    expect(tree).toBe(tilesTreeHash([...tiles].reverse().map((t) => ({ path: t.path, sha256: sha256Hex(t.bytes) }))));
    const p = packPointer(tar, tree, '1.60.1.70009');
    const id = `${tree.slice(0, 12)}-${sha256Hex(tar).slice(0, 12)}`;
    expect(p).toEqual({ asset: `minimap-tiles-${id}.tar`, tag: `minimap-1.60.1.70009-${id}`, bytes: tar.length, sha256: sha256Hex(tar), treeHash: tree, client: '1.60.1.70009', contents: ['NOTICE.md', 'manifest.json', 't/'] });
    expect(packAssetName(tree, p.sha256)).toBe(p.asset);
    expect(packTag('1.60.1.70009', tree, p.sha256)).toBe(p.tag);
    expect(pointerNameProblems(p)).toEqual([]);
  });

  it('gives two packs of the same tiles with different bytes different names and tags (MD-02: a release is never replaced)', () => {
    const tree = tilesTreeHash(tiles.map((t) => ({ path: t.path, sha256: sha256Hex(t.bytes) })));
    // the same tiles; only the manifest differs (another tool tree hash, Node or platform)
    const a = packPointer(tarArchive(packFiles('# notice\n', '{"tool":"a"}\n', tiles)), tree, '1.60.1.70009');
    const b = packPointer(tarArchive(packFiles('# notice\n', '{"tool":"b"}\n', tiles)), tree, '1.60.1.70009');
    expect(a.treeHash).toBe(b.treeHash);
    expect(a.bytes).toBe(b.bytes);
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.asset).not.toBe(b.asset);
    expect(a.tag).not.toBe(b.tag);
    expect(a.asset.startsWith(`minimap-tiles-${tree.slice(0, 12)}-`)).toBe(true);
  });

  it('refuses a pointer named by the tree hash alone, a tag of another client, other contents or malformed hashes', () => {
    const tree = tilesTreeHash(tiles.map((t) => ({ path: t.path, sha256: sha256Hex(t.bytes) })));
    const p = packPointer(tar, tree, '1.60.1.70009');
    expect(pointerNameProblems({ ...p, asset: `minimap-tiles-${tree.slice(0, 12)}.tar` })).toEqual([`the asset must be named ${p.asset} (minimap-tiles-<tree hash 12>-<pack SHA-256 12>.tar)`]);
    expect(pointerNameProblems({ ...p, client: '1.60.1.70010' })).toHaveLength(1);
    expect(pointerNameProblems({ ...p, contents: ['t/'] })).toEqual(['the contents must be NOTICE.md, manifest.json, t/']);
    expect(pointerNameProblems({ ...p, sha256: '0'.repeat(63) })).toEqual(['the pointer needs a 64-hex treeHash, a 64-hex sha256 and a dotted client version']);
    expect(pointerNameProblems({ ...p, client: 'nope' })).toEqual(['the pointer needs a 64-hex treeHash, a 64-hex sha256 and a dotted client version']);
  });
});
