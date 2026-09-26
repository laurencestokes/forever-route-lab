import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { connectorProblems, endpointWorld, observedRows, parseConnectors, resolveConnectors, type ConnectorFile } from './connectors';
import { MAP_ORIGIN_YD } from './formats/grid';
import { buildMapMesh } from './link';
import { navRevision, seamEntry } from './manifest';
import { blockOf, PARAMS, square, tileOf } from './nav-test-support';
import { parsePassages, tagPassages } from './passages';
import { parseReviewed } from './review';
import { parseBuildConfig, readBuildConfig, REPO_ROOT, TERRAIN_DIR } from './settings';
import { snapIndex } from './snap';
import { loadGeometry } from './spawns';
import { moduleClosure, toolTreeHash } from './tool-tree';

const { geometry } = loadGeometry(REPO_ROOT);
const inputs = (name: string): unknown => JSON.parse(readFileSync(join(TERRAIN_DIR, 'inputs', name), 'utf8')) as unknown;

describe('the committed inputs parse and validate (G15)', () => {
  it('build.json', () => {
    const c = readBuildConfig();
    expect(c.pin).toEqual({ product: 'wow_classic_beta', version: '1.60.1.70009', buildKey: '05215079e3905ef5922ae0b03ffefb73' });
    expect(c.settings.name).toBe('c05r1+n12+e5+s60');
    expect(c.recastNavigation).toBe('0.43.1');
    expect(() => parseBuildConfig({ ...c, settings: { ...c.settings, tileVoxels: 300 } })).toThrow(/multiple/);
    expect(() => parseBuildConfig({ ...c, extra: 1 })).toThrow();
  });

  it('connectors.json: the template rows, Mulgore as UiMap 1412 (RC-12), nothing observed yet', () => {
    const file = parseConnectors(inputs('connectors.json'));
    expect(file.connectors.map((c) => [c.id, c.type, c.status])).toEqual([
      ['thunder-bluff-elevator-west', 'elevator', 'todo'],
      ['rutheran-to-darnassus-portal', 'teleport', 'todo'],
    ]);
    expect(file.connectors[0]?.a.uiMapId).toBe(1412);
    expect(connectorProblems(file, geometry)).toEqual([]);
    expect(observedRows(file)).toEqual([]);
  });

  it('passages.json and census-reviewed.json', () => {
    const p = parsePassages(inputs('passages.json'));
    expect(p.passages.map((x) => [x.id, x.map, x.status])).toEqual([
      ['undercity-west-tunnel', 0, 'unverified'],
      ['ironforge-mountain-top', 0, 'unverified'],
    ]);
    expect(() => parseReviewed(inputs('census-reviewed.json'))).not.toThrow();
  });
});

describe('connector validation (G15, RC-12) and resolution (§11.2)', () => {
  const base = parseConnectors(inputs('connectors.json'));
  const row = (patch: Record<string, unknown>): ConnectorFile => ({ ...base, connectors: [{ ...(base.connectors[0] as ConnectorFile['connectors'][number]), ...patch }] });

  it("rejects a UiMap that is not a UiMap of the connector's map, such as Mulgore's AreaTable id 215", () => {
    const a = { ...base.connectors[0]?.a, uiMapId: 215 };
    expect(connectorProblems(row({ a }), geometry).join()).toMatch(/UiMap 215 has no UiMapAssignment row on map 1/);
    expect(connectorProblems(row({ map: 0 }), geometry).join()).toMatch(/UiMap 1412 has no UiMapAssignment row on map 0/);
  });

  it('needs castSeconds on teleport rows and complete observed rows', () => {
    const tp = base.connectors[1] as ConnectorFile['connectors'][number];
    expect(connectorProblems({ ...base, connectors: [{ ...tp, castSeconds: undefined, rideSeconds: tp.castSeconds }] }, geometry).join()).toMatch(/needs castSeconds/);
    const problems = connectorProblems(row({ status: 'observed' }), geometry).join('\n');
    expect(problems).toMatch(/needs x and y/);
    expect(problems).toMatch(/ride seconds/);
    expect(problems).toMatch(/date and build/);
    expect(() => parseConnectors({ ...base, connectors: [...base.connectors, base.connectors[0]] })).toThrow(/duplicate/);
  });

  it('resolves an observed row to directed links between the chosen floors', () => {
    // two squares on Durotar's world rectangle: find the tile under a /way point first
    const w = endpointWorld({ uiMapId: 1411, x: 50, y: 50, floor: 'lowest' }, geometry);
    expect(w).not.toBeNull();
    const T = PARAMS.tileYd;
    const tx = Math.floor(((w?.x ?? 0) + MAP_ORIGIN_YD) / T);
    const tz = Math.floor((MAP_ORIGIN_YD - (w?.y ?? 0)) / T);
    const vx = Math.round(((w?.x ?? 0) + MAP_ORIGIN_YD - tx * T) / PARAMS.cs);
    const vz = Math.round((MAP_ORIGIN_YD - (w?.y ?? 0) - tz * T) / PARAMS.cs);
    const lo = Math.max(0, Math.min(vx, vz) - 20);
    const hi = Math.min(256, Math.max(vx, vz) + 20);
    const tile = tileOf(tx, tz, [square(lo, lo, hi, hi, 40), square(lo, lo, hi, hi, 120)]);
    const row0 = Math.floor((63 - Math.floor(tx / 4)) / 4) * 4;
    const col0 = Math.floor(Math.floor(tz / 4) / 4) * 4;
    const mesh = buildMapMesh([blockOf(row0, col0, [tile])], PARAMS);
    const observed = row({
      status: 'observed',
      a: { uiMapId: 1411, x: 50, y: 50, floor: 'lowest' },
      b: { uiMapId: 1411, x: 50, y: 50, floor: 'highest' },
      rideSeconds: { value: 12.5, basis: 'reported' },
      waitSeconds: { value: 30, basis: 'reported', stat: 'max' },
      observed: { date: '2026-09-26', build: '1.60.1.70009', by: 'owner' },
    });
    expect(connectorProblems(observed, geometry)).toEqual([]);
    const r = resolveConnectors(observed, 1, geometry, snapIndex(mesh));
    expect(r.links).toEqual([
      { connector: 0, from: 0, to: 1, costTenths: 425 },
      { connector: 0, from: 1, to: 0, costTenths: 425 },
    ]);
    expect(resolveConnectors(observed, 0, geometry, snapIndex(mesh)).links).toEqual([]);
    const only = row({ ...observed.connectors[0], a: { uiMapId: 1411, x: 50, y: 50, floor: 'only' } });
    expect(() => resolveConnectors({ ...observed, connectors: only.connectors }, 1, geometry, snapIndex(mesh))).toThrow(/floor "only"/);
  });
});

describe('passages (RC-09)', () => {
  it('tags the polygons whose centroid is in the box and zone, and refuses a null box or verified-block', () => {
    const tile = tileOf(0, 0, [square(0, 0, 10, 10, 40), square(20, 20, 30, 30, 40)]);
    const g = buildMapMesh([blockOf(60, 0, [tile], [1497, 85])], PARAMS);
    const cx = g.cx[0] ?? 0;
    const cy = g.cy[0] ?? 0;
    const file = parsePassages({
      schema: 1,
      kind: 'nav-passages',
      passages: [
        { id: 'a', map: 1, status: 'unverified', zone: null, box: { xMin: cx - 100, xMax: cx + 100, yMin: cy - 100, yMax: cy + 100, zMin: 0, zMax: 20 }, check: 'walk it' },
        { id: 'b', map: 1, status: 'unverified', zone: 1497, box: { xMin: cx - 100, xMax: cx + 100, yMin: cy - 100, yMax: cy + 100, zMin: 0, zMax: 20 }, check: 'walk it' },
        { id: 'c', map: 1, status: 'verified-pass', zone: null, box: null, check: 'walked' },
      ],
    });
    expect(tagPassages(file, 1, g)).toEqual([
      { passage: 0, polygons: [0, 1] },
      { passage: 1, polygons: [0] },
    ]);
    expect(tagPassages(file, 0, g)).toEqual([]);
    const bad = (p: Record<string, unknown>): unknown => ({ schema: 1, kind: 'nav-passages', passages: [{ id: 'x', map: 0, status: 'unverified', zone: null, box: null, check: 'c', ...p }] });
    expect(() => parsePassages(bad({}))).toThrow(/needs a box/);
    expect(() => parsePassages(bad({ status: 'verified-block', box: { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1 } }))).toThrow(/not implemented/);
  });
});

describe('manifest helpers and the tool tree hash', () => {
  it('navRevision does not depend on file order; seamEntry rounds', () => {
    const a = { path: '1/0_0.bin', sha256: 'a' };
    const b = { path: '0/map.bin', sha256: 'b' };
    expect(navRevision([a, b])).toBe(navRevision([b, a]));
    expect(navRevision([a, b])).not.toBe(navRevision([{ ...a, sha256: 'c' }, b]));
    expect(seamEntry({ inner: { len: 100, matched: 98 }, block: { len: 50, matched: 48.9 } })).toEqual({ innerPct: 2, blockPct: 2.2, deltaPp: 0.2 });
  });

  const dir = mkdtempSync(join(tmpdir(), 'nav-tree-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('follows relative imports and hashes LF-normalised bytes', () => {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'main.ts'), "import { a } from './lib/a';\nexport { b } from './lib/b';\nimport x from 'node:fs';\nvoid x; void a;\n");
    writeFileSync(join(dir, 'lib', 'a.ts'), "import type { B } from './b';\nexport const a = 1 as unknown as B;\n");
    writeFileSync(join(dir, 'lib', 'b.ts'), 'export type B = number;\r\nexport const b = 2;\r\n');
    writeFileSync(join(dir, 'lib', 'unused.ts'), 'export const u = 3;\n');
    expect(moduleClosure([join(dir, 'main.ts')]).map((f) => f.slice(dir.length + 1).split('\\').join('/'))).toEqual(['lib/a.ts', 'lib/b.ts', 'main.ts']);
    const h1 = toolTreeHash(dir, [join(dir, 'main.ts')]);
    writeFileSync(join(dir, 'lib', 'b.ts'), 'export type B = number;\nexport const b = 2;\n');
    expect(toolTreeHash(dir, [join(dir, 'main.ts')]).hash).toBe(h1.hash);
    writeFileSync(join(dir, 'lib', 'b.ts'), 'export type B = number;\nexport const b = 3;\n');
    expect(toolTreeHash(dir, [join(dir, 'main.ts')]).hash).not.toBe(h1.hash);
    writeFileSync(join(dir, 'broken.ts'), "import { z } from './missing';\n");
    expect(() => moduleClosure([join(dir, 'broken.ts')])).toThrow(/cannot resolve/);
  });

  it('covers the extractor, the worker, tools/casc and the src modules they read, not tests', () => {
    const t = toolTreeHash(REPO_ROOT, [join(TERRAIN_DIR, 'extract.ts'), join(TERRAIN_DIR, 'lib', 'worker.ts')]);
    expect(t.files).toContain('tools/terrain/lib/recast.ts');
    expect(t.files).toContain('tools/casc/casc.ts');
    expect(t.files).toContain('src/geo/resolve.ts');
    expect(t.files.some((f) => f.endsWith('.test.ts') || f.includes('byproducts'))).toBe(false);
  });
});
