/**
 * The minimap tile pack outside the tile tool (docs/research/map-atlas.md §23.3; D-049 O14; step
 * MM.6): the committed pointer, the strict tar reader, the pack's verification (a wrong SHA-256, a
 * NOTICE or manifest that is not the committed one, a tampered, missing, extra or misplaced tile),
 * installing the tiles, assembling the pack from built tiles, and obtaining it from a path, a
 * `file:` URL, `http:` on the loopback interface, `gh` and the cache. Nothing reaches the network.
 */
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../maps/lib/hash';
import { packAssetName, packFiles, packPointer, packTag, tarArchive, tarHeader, tilesTreeHash, type PackFile, type PackPointer } from '../../maps/lib/minimap-pack';
import { MINIMAP_DIR } from '../../maps/lib/minimap-params';
import { REPO_ROOT } from './fs';
import {
  assemblePack,
  cachePack,
  download,
  ghDownload,
  installTiles,
  listTree,
  PackError,
  parsePackSource,
  readCachedPack,
  readCommittedPack,
  readPackSource,
  readTar,
  releaseUrl,
  verifyPack,
  type CommittedPack,
} from './pack';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'frl-pack-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOTICE = '# Minimap tiles: notice\n\nBlizzard Entertainment.\n';
const TILES: PackFile[] = [
  { path: 't/0/1/0.webp', bytes: Buffer.from('tile 0/1/0') },
  { path: 't/-1/0/0.webp', bytes: Buffer.from('tile -1/0/0, a little longer') },
  { path: 't/0/0/0.webp', bytes: Buffer.alloc(700, 7) },
];
const tree = tilesTreeHash(TILES.map((t) => ({ path: t.path, sha256: sha256Hex(t.bytes) })));

const manifestText = (tiles: readonly PackFile[] = TILES): string =>
  `${JSON.stringify(
    {
      kind: 'map-minimap',
      pack: { treeHash: tree, contents: ['NOTICE.md', 'manifest.json', 't/'] },
      files: [{ path: 'index.json', bytes: 2, sha256: sha256Hex('{}') }, ...tiles.map((t) => ({ path: t.path, bytes: t.bytes.length, sha256: sha256Hex(t.bytes) }))],
    },
    null,
    2,
  )}\n`;

/** A committed folder (NOTICE, manifest, pointer; `withTiles` also the tiles) and its pack. */
function folder(options: { readonly withTiles?: boolean; readonly tar?: Buffer } = {}): { readonly root: string; readonly tar: Buffer; readonly pointer: PackPointer } {
  const root = join(dir, 'minimap');
  mkdirSync(root, { recursive: true });
  const tar = options.tar ?? tarArchive(packFiles(NOTICE, manifestText(), TILES));
  const pointer = packPointer(tar, tree, '1.60.1.70009');
  writeFileSync(join(root, 'NOTICE.md'), NOTICE);
  writeFileSync(join(root, 'manifest.json'), manifestText());
  writeFileSync(join(root, 'index.json'), '{}');
  writeFileSync(join(root, 'pack.json'), `${JSON.stringify(pointer)}\n`);
  if (options.withTiles === true) {
    for (const t of TILES) {
      mkdirSync(join(root, t.path, '..'), { recursive: true });
      writeFileSync(join(root, t.path), t.bytes);
    }
  }
  return { root, tar, pointer };
}

const committedOf = (root: string): CommittedPack => {
  const c = readCommittedPack(root);
  if (c === null) throw new Error('no committed folder');
  return c;
};

/** A pack re-pinned by its own pointer, so only the deeper checks can catch what is wrong with it. */
function repinned(tar: Buffer): CommittedPack {
  const { root } = folder({ tar });
  return committedOf(root);
}

const problemsOf = (fn: () => unknown): readonly string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof PackError) return error.problems;
    throw error;
  }
  return [];
};

describe('the committed pointer, manifest and NOTICE', () => {
  it('reads a consistent folder, and nothing when there is no folder (never built, or removed on request)', () => {
    expect(readCommittedPack(join(dir, 'absent'))).toBeNull();
    const { root, pointer } = folder();
    const c = committedOf(root);
    expect(c.pointer).toEqual(pointer);
    expect(c.tiles.map((t) => t.path)).toEqual(['t/-1/0/0.webp', 't/0/0/0.webp', 't/0/1/0.webp']);
    expect(c.notice.toString('utf8')).toBe(NOTICE);
  });

  it('reads CRLF copies of the text files as git stores them (LF)', () => {
    const { root, tar } = folder();
    writeFileSync(join(root, 'NOTICE.md'), NOTICE.replace(/\n/g, '\r\n'));
    writeFileSync(join(root, 'manifest.json'), manifestText().replace(/\n/g, '\r\n'));
    expect(verifyPack(tar, committedOf(root)).tiles).toHaveLength(3);
  });

  it('refuses a missing pointer, a tree hash that is not the manifest tiles\', and a pack record or asset name that disagrees', () => {
    const { root, pointer } = folder();
    const write = (p: Readonly<Record<string, unknown>>): void => writeFileSync(join(root, 'pack.json'), JSON.stringify({ ...pointer, ...p }));
    const other = sha256Hex('another tile set');
    write({ treeHash: other, asset: packAssetName(other, pointer.sha256), tag: packTag('1.60.1.70009', other, pointer.sha256) });
    expect(problemsOf(() => readCommittedPack(root)).join('\n')).toMatch(/the tree hash over the manifest's tiles .* is not pack\.json's/);
    write({ tag: 'minimap-1.0-000000000000' });
    expect(problemsOf(() => readCommittedPack(root))).toEqual([`pack.json: the release tag must be ${pointer.tag} (minimap-<client version>-<tree hash 12>-<pack SHA-256 12>)`]);
    // MD-02: the name carries the pack's SHA-256 as well as the tile set, so the old name is refused
    write({ asset: `minimap-tiles-${tree.slice(0, 12)}.tar` });
    expect(problemsOf(() => readCommittedPack(root))).toEqual([`pack.json: the asset must be named ${pointer.asset} (minimap-tiles-<tree hash 12>-<pack SHA-256 12>.tar)`]);
    write({ sha256: 'x' });
    expect(problemsOf(() => readCommittedPack(root))).toEqual(['pack.json: sha256 must be 64 hex digits', 'pack.json: the pointer needs a 64-hex treeHash, a 64-hex sha256 and a dotted client version']);
    write({ contents: ['manifest.json', 'NOTICE.md', 't/'] });
    expect(problemsOf(() => readCommittedPack(root))).toEqual(['pack.json: the contents must be NOTICE.md, manifest.json, t/']);
    write({});
    const manifest = JSON.parse(manifestText()) as { pack: Record<string, unknown> };
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ ...manifest, pack: { ...manifest.pack, asset: pointer.asset } }));
    expect(problemsOf(() => readCommittedPack(root))).toEqual(["the manifest's pack record names an asset or tag; only pack.json can, since they carry the pack's SHA-256"]);
    writeFileSync(join(root, 'manifest.json'), manifestText());
    rmSync(join(root, 'pack.json'));
    expect(problemsOf(() => readCommittedPack(root))).toEqual([`pack.json is missing from ${root}`]);
  });
});

describe('the strict tar reader', () => {
  const tar = tarArchive(packFiles(NOTICE, manifestText(), TILES));

  it('reads the pack tool\'s tar', () => {
    expect(readTar(tar).map((e) => e.path)).toEqual(['NOTICE.md', 'manifest.json', 't/-1/0/0.webp', 't/0/0/0.webp', 't/0/1/0.webp']);
    expect(readTar(tar)[3]?.data.equals(Buffer.alloc(700, 7))).toBe(true);
  });

  it('refuses a bad checksum, a link or directory entry, the prefix field, a truncated pack and bytes after the end', () => {
    const bad = Buffer.from(tar);
    bad[0] = (bad[0] ?? 0) + 1;
    expect(problemsOf(() => readTar(bad)).join()).toMatch(/header checksum/);
    const link = Buffer.from(tar);
    const h = tarHeader('NOTICE.md', NOTICE.length);
    h.write('2', 156, 'latin1');
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : (h[i] ?? 0);
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    h.copy(link, 0);
    expect(problemsOf(() => readTar(link)).join()).toMatch(/is not a regular file/);
    const prefixed = Buffer.from(tar);
    const p = tarHeader('NOTICE.md', NOTICE.length);
    p.write('x', 345, 'latin1');
    let sum2 = 0;
    for (let i = 0; i < 512; i += 1) sum2 += i >= 148 && i < 156 ? 32 : (p[i] ?? 0);
    p.write(`${sum2.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    p.copy(prefixed, 0);
    expect(problemsOf(() => readTar(prefixed)).join()).toMatch(/prefix field/);
    expect(problemsOf(() => readTar(tar.subarray(0, 1024))).join()).toMatch(/run past the end|two zero blocks/);
    const trailing = Buffer.from(tar);
    trailing[trailing.length - 1] = 1;
    expect(problemsOf(() => readTar(trailing)).join()).toMatch(/bytes after its end block/);
  });
});

describe('verifying a pack against the committed files', () => {
  it('passes the pinned pack and returns its tiles in path order', () => {
    const { root, tar } = folder();
    expect(verifyPack(tar, committedOf(root)).tiles.map((t) => t.path)).toEqual(['t/-1/0/0.webp', 't/0/0/0.webp', 't/0/1/0.webp']);
  });

  it('refuses a wrong SHA-256 or size', () => {
    const { root, tar } = folder();
    const flipped = Buffer.from(tar);
    flipped[600] = (flipped[600] ?? 0) + 1;
    expect(problemsOf(() => verifyPack(flipped, committedOf(root))).join()).toMatch(/the pack's SHA-256 is [0-9a-f]{64}; pack\.json pins/);
    expect(problemsOf(() => verifyPack(tar.subarray(0, tar.length - 512), committedOf(root))).join()).toMatch(/pack\.json pins \d+ B/);
  });

  it('refuses a pack whose NOTICE or manifest is not the committed one, even when the pointer pins that pack', () => {
    // the committed files are the folder's; the pack (and its pointer) carry other texts
    const otherNotice = repinned(tarArchive(packFiles(`${NOTICE}changed\n`, manifestText(), TILES)));
    expect(problemsOf(() => verifyPack(tarArchive(packFiles(`${NOTICE}changed\n`, manifestText(), TILES)), otherNotice))).toEqual(["the pack's NOTICE.md is not the committed one"]);
    const otherManifest = tarArchive(packFiles(NOTICE, manifestText().replace('map-minimap', 'map-minimap-x'), TILES));
    expect(problemsOf(() => verifyPack(otherManifest, repinned(otherManifest)))).toEqual(["the pack's manifest.json is not the committed one"]);
    // the notice must come first
    const swapped = tarArchive([{ path: 'manifest.json', bytes: Buffer.from(manifestText()) }, { path: 'NOTICE.md', bytes: Buffer.from(NOTICE) }, ...packFiles(NOTICE, manifestText(), TILES).slice(2)]);
    expect(problemsOf(() => verifyPack(swapped, repinned(swapped)))).toEqual(["the pack's first file is manifest.json, not NOTICE.md", "the pack's second file is NOTICE.md, not manifest.json"]);
  });

  it('checks every tile against the manifest: a tampered, missing, extra, misplaced or escaping tile fails', () => {
    const files = packFiles(NOTICE, manifestText(), TILES);
    const tampered = tarArchive(files.map((f) => (f.path === 't/0/0/0.webp' ? { ...f, bytes: Buffer.alloc(700, 8) } : f)));
    expect(problemsOf(() => verifyPack(tampered, repinned(tampered)))).toEqual(['t/0/0/0.webp: size or SHA-256 differs from the manifest']);
    const missing = tarArchive(files.filter((f) => f.path !== 't/0/1/0.webp'));
    expect(problemsOf(() => verifyPack(missing, repinned(missing)))).toEqual(['the pack holds 2 tiles; the manifest lists 3']);
    const extra = tarArchive([...files, { path: 't/0/2/0.webp', bytes: Buffer.from('x') }]);
    expect(problemsOf(() => verifyPack(extra, repinned(extra)))).toEqual([
      "the pack's tile 3 is t/0/2/0.webp; the manifest's is none (the tiles must be the manifest's, in path order)",
      'the pack holds 4 tiles; the manifest lists 3',
    ]);
    const misplaced = tarArchive([...files.slice(0, 2), ...files.slice(2).reverse()]);
    expect(problemsOf(() => verifyPack(misplaced, repinned(misplaced)))[0]).toMatch(/the pack's tile 0 is t\/0\/1\/0\.webp; the manifest's is t\/-1\/0\/0\.webp/);
    const escaping = tarArchive([...files.slice(0, 2), { path: '../../outside.webp', bytes: Buffer.from('x') }, ...files.slice(2)]);
    expect(problemsOf(() => verifyPack(escaping, repinned(escaping)))[0]).toBe('the pack holds "../../outside.webp", which is not a tile path under t/');
  });
});

describe('installing the tiles and assembling the pack from them', () => {
  it('writes the tiles, keeps unchanged ones, removes unlisted files and prunes empty folders', () => {
    const { root, tar } = folder();
    const { tiles } = verifyPack(tar, committedOf(root));
    mkdirSync(join(root, 't', '-3', '9'), { recursive: true });
    writeFileSync(join(root, 't', '-3', '9', '9.webp'), 'stale');
    expect(installTiles(root, tiles)).toEqual({ written: 3, kept: 0, removed: 1 });
    expect(listTree(join(root, 't'))).toEqual(['-1/0/0.webp', '0/0/0.webp', '0/1/0.webp']);
    expect(existsSync(join(root, 't', '-3'))).toBe(false);
    writeFileSync(join(root, 't', '0', '1', '0.webp'), 'changed');
    expect(installTiles(root, tiles)).toEqual({ written: 1, kept: 2, removed: 0 });
    expect(readFileSync(join(root, 't', '0', '1', '0.webp'), 'utf8')).toBe('tile 0/1/0');
    expect(problemsOf(() => installTiles(root, [{ path: '../x.webp', data: Buffer.from('x') }]))).toEqual(['refusing to write "../x.webp"']);
  });

  it('assembles, from the built tiles, the pack the pointer pins, byte for byte', () => {
    const { root, tar } = folder({ withTiles: true });
    expect(assemblePack(committedOf(root)).equals(tar)).toBe(true);
  });

  it('refuses to assemble from a missing, extra or tampered tile, or when the pointer pins another pack', () => {
    const { root } = folder({ withTiles: true });
    rmSync(join(root, 't', '0', '1', '0.webp'));
    expect(problemsOf(() => assemblePack(committedOf(root)))[0]).toMatch(/^1 of 3 tiles are missing under t\/ \(first t\/0\/1\/0\.webp\)/);
    writeFileSync(join(root, 't', '0', '1', '0.webp'), 'tampered');
    expect(problemsOf(() => assemblePack(committedOf(root)))).toEqual(['t/0/1/0.webp: size or SHA-256 differs from the manifest']);
    writeFileSync(join(root, 't', '0', '1', '0.webp'), 'tile 0/1/0');
    writeFileSync(join(root, 't', '0', '9.webp'), 'unlisted');
    expect(problemsOf(() => assemblePack(committedOf(root)))[0]).toMatch(/^1 files under t\/ are not in the manifest \(first t\/0\/9\.webp\)/);
    rmSync(join(root, 't', '0', '9.webp'));
    writeFileSync(join(root, 'NOTICE.md'), `${NOTICE}edited after the build\n`);
    expect(problemsOf(() => assemblePack(committedOf(root)))[0]).toMatch(/the assembled pack .* is not the one pack\.json pins/);
  });
});

describe('obtaining the pack', () => {
  let server: Server;
  let base = '';
  const served = new Map<string, Buffer>();
  beforeAll(async () => {
    server = createServer((request, response) => {
      const body = served.get(request.url ?? '');
      if (body === undefined) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/x-tar' }).end(body);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('names the release asset and parses the source forms', () => {
    const { pointer } = folder();
    expect(releaseUrl('laurencestokes/forever-route-lab', pointer)).toBe(`https://github.com/laurencestokes/forever-route-lab/releases/download/${pointer.tag}/${pointer.asset}`);
    expect(parsePackSource('gh', dir)).toEqual({ kind: 'gh' });
    expect(parsePackSource('https://example.invalid/p.tar', dir)).toEqual({ kind: 'url', url: 'https://example.invalid/p.tar' });
    expect(parsePackSource(pathToFileURL(join(dir, 'p.tar')).href, dir)).toEqual({ kind: 'path', path: join(dir, 'p.tar') });
    expect(parsePackSource('p.tar', dir)).toEqual({ kind: 'path', path: join(dir, 'p.tar') });
    expect(problemsOf(() => parsePackSource('ftp://example.invalid/p.tar', dir))[0]).toMatch(/only https:, http:, file: URLs, a path or "gh"/);
  });

  it('reads a path and a file: URL', async () => {
    const { root, tar, pointer } = folder();
    writeFileSync(join(dir, 'p.tar'), tar);
    const c = committedOf(root);
    expect((await readPackSource(parsePackSource(join(dir, 'p.tar'), dir), 'o/r', pointer)).equals(tar)).toBe(true);
    expect(verifyPack(await readPackSource(parsePackSource(pathToFileURL(join(dir, 'p.tar')).href, dir), 'o/r', pointer), c).tiles).toHaveLength(3);
    await expect(readPackSource(parsePackSource(join(dir, 'none.tar'), dir), 'o/r', pointer)).rejects.toThrow(/no such file/);
  });

  it('downloads over http from the loopback interface, and refuses a failed response or more than the pinned bytes', async () => {
    const { tar, pointer } = folder();
    served.set('/p.tar', tar);
    expect((await download(`${base}/p.tar`, pointer.bytes)).equals(tar)).toBe(true);
    await expect(download(`${base}/missing.tar`, pointer.bytes)).rejects.toThrow(/HTTP 404/);
    await expect(download(`${base}/p.tar`, pointer.bytes - 1)).rejects.toThrow(/more than the \d+ B the pointer pins/);
  });

  it('runs gh release download with the tag, repository and asset', () => {
    const { tar, pointer } = folder();
    const calls: (readonly string[])[] = [];
    const got = ghDownload('owner/repo', pointer, (file, args) => {
      calls.push([file, ...args]);
      const out = args[args.indexOf('--dir') + 1] ?? '';
      writeFileSync(join(out, pointer.asset), tar);
    });
    expect(got.equals(tar)).toBe(true);
    expect(calls[0]?.slice(0, 8)).toEqual(['gh', 'release', 'download', pointer.tag, '--repo', 'owner/repo', '--pattern', pointer.asset]);
  });

  it('uses the cached pack only when it has the pinned SHA-256', () => {
    const { tar, pointer } = folder();
    const cache = join(dir, 'cache');
    expect(readCachedPack(cache, pointer)).toBeNull();
    const path = cachePack(cache, pointer, tar);
    expect(path).toBe(join(cache, pointer.asset));
    expect(readCachedPack(cache, pointer)?.equals(tar)).toBe(true);
    writeFileSync(path, Buffer.concat([tar.subarray(0, 100), Buffer.alloc(tar.length - 100)]));
    expect(readCachedPack(cache, pointer)).toBeNull();
  });
});

describe('pnpm maps:minimap:fetch and maps:minimap:pack (the commands)', () => {
  const run = (script: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, [join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, MINIMAP_PACK_SOURCE: '', ...env } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('fetches from MINIMAP_PACK_SOURCE (a file: URL), then from the cache; refuses a bad pack and installs nothing', () => {
    const { root, tar } = folder();
    const cache = join(dir, 'cache');
    writeFileSync(join(dir, 'p.tar'), tar);
    const first = run('tools/build/minimap-fetch.ts', ['--dir', root, '--cache', cache], { MINIMAP_PACK_SOURCE: pathToFileURL(join(dir, 'p.tar')).href });
    expect(first.out).toMatch(/3 tiles match the manifest's sizes and SHA-256/);
    expect(first.status).toBe(0);
    expect(listTree(join(root, 't'))).toEqual(['-1/0/0.webp', '0/0/0.webp', '0/1/0.webp']);
    const again = run('tools/build/minimap-fetch.ts', ['--dir', root, '--cache', cache]);
    expect(again.status).toBe(0);
    expect(again.out).toMatch(/from the cache .*0 tiles written, 3 already there/s);
    rmSync(join(root, 't'), { recursive: true });
    const flipped = Buffer.from(tar);
    flipped[700] = (flipped[700] ?? 0) + 1;
    writeFileSync(join(dir, 'bad.tar'), flipped);
    const bad = run('tools/build/minimap-fetch.ts', ['--dir', root, '--cache', join(dir, 'cache2'), '--from', join(dir, 'bad.tar')]);
    expect(bad.status).toBe(1);
    expect(bad.out).toMatch(/minimap fetch: FAILED, nothing was installed: the pack's SHA-256 is/);
    expect(existsSync(join(root, 't'))).toBe(false);
    expect(existsSync(join(dir, 'cache2'))).toBe(false);
  }, 60_000);

  it('has nothing to fetch without a committed folder (the style removed on request), and assembles the pack from built tiles', () => {
    const none = run('tools/build/minimap-fetch.ts', ['--dir', join(dir, 'absent')]);
    expect(none.status).toBe(0);
    expect(none.out).toMatch(/nothing to fetch/);
    const { root, tar } = folder({ withTiles: true });
    const made = run('tools/build/minimap-pack.ts', ['--dir', root, '--out', join(dir, 'out.tar')]);
    expect(made.status).toBe(0);
    expect(made.out).toMatch(/nothing is published/);
    expect(readFileSync(join(dir, 'out.tar')).equals(tar)).toBe(true);
  }, 60_000);
});

const real = join(REPO_ROOT, MINIMAP_DIR);
describe.skipIf(!existsSync(join(real, 'manifest.json')))('the committed public/maps/minimap', () => {
  it('has a consistent pointer, manifest and NOTICE (no tiles needed)', () => {
    const c = committedOf(real);
    expect(c.tiles.length).toBeGreaterThan(0);
    expect(c.pointer.contents).toEqual(['NOTICE.md', 'manifest.json', 't/']);
  });

  it.skipIf(!existsSync(join(real, 't')))('assembles, from the tiles in the folder, the pack pack.json pins', () => {
    const c = committedOf(real);
    const tar = assemblePack(c);
    expect(sha256Hex(tar)).toBe(c.pointer.sha256);
  }, 120_000);
});
