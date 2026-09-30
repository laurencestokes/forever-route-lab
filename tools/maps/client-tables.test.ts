import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { flightMasterIdsOf } from '../../src/app/dataset-source';
import { createDatasetView, prepareDataset } from '../../src/infra/data/dataset-view';
import { identityOf } from '../../src/infra/data/manifest';
import {
  parseClientDungeons,
  parseClientTablesManifest,
  parseClientTaxi,
  parseClientZones,
  type ClientDungeons,
  type ClientTablesManifest,
  type ClientTaxi,
  type ClientZones,
} from '../../src/infra/maps/client-tables';
import { publicSite } from '../../tests/support/fake-fetch';
import { placeholderGeometry, siteFiles, siteManifest } from '../../tests/support/fixture-dataset';
import { REPO_ROOT } from '../build/lib/fs';
import { WOWDBDEFS_COMMIT } from '../casc/layout-source';
import { CLIENT_TABLES_BUDGET_GZIP_BYTES, CLIENT_TABLES_DIR, CLIENT_TABLES_PIN } from './lib/client-data/constants';
import { CLIENT_LAYOUTS_FILE, clientLayoutSourcesPresent, readClientLayoutSources, renderClientLayoutsModule } from './lib/client-data/layout-source';
import { CLIENT_PIN } from './lib/constants';

/*
 * The committed client tables (public/maps/client/; map-presentation.md §9, §10, §12.6, §8.4,
 * §16; D-039 B, C and E; step MP.5a), checked offline: the manifest against the files, the counts
 * of the MP.5a row, every row's shape, the column recorded for every value, individual decoded
 * values cited by table, build and row (D-022), and the dataset's flight masters against the nodes.
 * Byte-identical regeneration from the client is client-tables.client.test.ts.
 */

const dir = join(REPO_ROOT, CLIENT_TABLES_DIR);
const bytesOf = (name: string): Buffer => readFileSync(join(dir, name));
const jsonOf = (name: string): unknown => JSON.parse(bytesOf(name).toString('utf8')) as unknown;
type Json = Readonly<Record<string, unknown>>;

function load(): { manifest: ClientTablesManifest; taxi: ClientTaxi; zones: ClientZones; dungeons: ClientDungeons } {
  const manifest = parseClientTablesManifest(jsonOf('manifest.json'), './');
  if (typeof manifest === 'string') throw new Error(manifest);
  const taxi = parseClientTaxi(jsonOf('taxi.json'), manifest.files.taxi, manifest.build);
  const zones = parseClientZones(jsonOf('zones.json'), manifest.files.zones, manifest.build);
  const dungeons = parseClientDungeons(jsonOf('dungeons.json'), manifest.files.dungeons, manifest.build);
  for (const result of [taxi, zones, dungeons]) if (typeof result === 'string') throw new Error(result);
  return { manifest, taxi: taxi as ClientTaxi, zones: zones as ClientZones, dungeons: dungeons as ClientDungeons };
}

const { manifest, taxi, zones, dungeons } = load();
const rawManifest = jsonOf('manifest.json') as Json;

describe('the manifest (D-039: FileDataIDs, CKeys, build, WoWDBDefs commit, tool tree hash)', () => {
  it('lists every file with its SHA-256, and the folder holds nothing else', () => {
    const files = rawManifest['files'] as readonly Json[];
    for (const entry of files) {
      const bytes = bytesOf(entry['path'] as string);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry['sha256']);
      expect(bytes.length).toBe(entry['bytes']);
    }
    expect(readdirSync(dir).sort()).toEqual(['NOTICE.md', 'dungeons.json', 'manifest.json', 'taxi.json', 'zones.json']);
  });

  it('records the pinned build, the WoWDBDefs commit, the tool tree hash and every table read with its columns', () => {
    expect(rawManifest['client']).toEqual(CLIENT_PIN);
    expect(CLIENT_TABLES_PIN).toEqual(CLIENT_PIN);
    expect(manifest.build).toBe('1.60.1.70009');
    expect((rawManifest['layouts'] as Json)['wowdbdefs']).toMatchObject({ commit: WOWDBDEFS_COMMIT });
    const tool = rawManifest['tool'] as Json;
    expect(Object.entries(tool['toolTreeHash'] as Json)).toEqual([['tools/maps/client-tables.ts', expect.stringMatching(/^[0-9a-f]{64}$/) as unknown]]);
    const tables = rawManifest['tables'] as readonly Json[];
    expect(tables.map((t) => [t['table'], t['fileDataId']])).toEqual([
      ['TaxiPathNode', 1000437],
      ['TaxiPath', 1067802],
      ['TaxiNodes', 1068100],
      ['Map', 1349477],
      ['AreaTable', 1353545],
      ['LFGDungeons', 1361033],
      ['UiMapAssignment', 1957219],
      ['ContentTuning', 1962930],
    ]);
    for (const t of tables) {
      expect(t['ckey']).toMatch(/^[0-9a-f]{32}$/);
      expect((t['columns'] as readonly string[]).length).toBeGreaterThan(0);
    }
    // No mount creature ids (review MP-R19): only the columns used are read and shipped.
    expect(JSON.stringify(tables)).not.toContain('MountCreatureID');
  });

  it('stays within the folder’s 40 kB gzip-6 budget (map-presentation.md §16)', () => {
    const total = readdirSync(dir).reduce((sum, name) => sum + gzipSync(bytesOf(name), { level: 6 }).length, 0);
    expect(total).toBeLessThanOrEqual(CLIENT_TABLES_BUDGET_GZIP_BYTES);
  });
});

describe('the counts of the MP.5a row', () => {
  it('has 65 nodes, 143 pairs, 286 flights, 14 transport paths and 30 LFG rows', () => {
    expect(taxi.nodes).toHaveLength(65);
    expect(taxi.flights).toHaveLength(286);
    expect(new Set(taxi.flights.map((f) => `${String(Math.min(f.from, f.to))}-${String(Math.max(f.from, f.to))}`)).size).toBe(143);
    expect(taxi.transports).toHaveLength(14);
    expect(dungeons.lfg).toHaveLength(30);
    expect(manifest.files.taxi.counts).toMatchObject({ nodes: 65, flights: 286, pairs: 143, transports: 14, stops: 29, paidPaths: 288 });
    expect(manifest.files.dungeons.counts).toMatchObject({ lfgRows: 30 });
    expect(zones.zones).toHaveLength(54);
  });

  it('says which paid paths it leaves out and why', () => {
    const counts = (rawManifest['files'] as readonly Json[])[0]?.['counts'] as Json;
    expect(counts['excludedPaidPaths']).toEqual([
      { pathId: 314, reason: 'its nodes are on maps 0 and 30' },
      { pathId: 383, reason: 'its nodes are on maps 0 and 30' },
    ]);
  });
});

describe('rows (taxi, D-039 B)', () => {
  const nodes = new Map(taxi.nodes.map((n) => [n.id, n]));

  it('flies both ways between every pair, on maps 0 and 1, from and to nodes it lists', () => {
    const directed = new Set(taxi.flights.map((f) => `${String(f.from)}>${String(f.to)}`));
    for (const f of taxi.flights) expect(directed.has(`${String(f.to)}>${String(f.from)}`)).toBe(true);
    expect(new Set(taxi.nodes.map((n) => n.point.mapId))).toEqual(new Set([0, 1]));
    const endpoints = new Set(taxi.flights.flatMap((f) => [f.from, f.to]));
    expect(taxi.nodes.every((n) => endpoints.has(n.id))).toBe(true);
  });

  it('starts and ends each shape at its nodes, and is never shorter than the straight line', () => {
    for (const f of taxi.flights) {
      const from = nodes.get(f.from);
      const to = nodes.get(f.to);
      const first = f.shape[0];
      const last = f.shape[f.shape.length - 1];
      if (from === undefined || to === undefined || first === undefined || last === undefined) throw new Error(`flight ${String(f.pathId)}`);
      expect(Math.hypot(first.x - from.point.x, first.y - from.point.y)).toBeLessThan(25);
      expect(Math.hypot(last.x - to.point.x, last.y - to.point.y)).toBeLessThan(25);
      const straight = Math.hypot(from.point.x - to.point.x, from.point.y - to.point.y);
      // SIMULATION TIME-5's evidence: L3D / straight line runs from 1.04 to 3.53 over these flights.
      expect(f.l3dYards / straight).toBeGreaterThan(1);
      expect(f.l3dYards / straight).toBeLessThan(3.6);
    }
    const points = taxi.flights.reduce((n, f) => n + f.shape.length, 0);
    expect(points).toBe(manifest.files.taxi.counts['shapePoints']);
    expect(points).toBeLessThan(manifest.files.taxi.counts['rawPathPoints'] ?? 0);
  });

  it('keeps transport stops on their paths’ maps, with the client’s delays, including the two Zephras Isle paths', () => {
    expect(taxi.transports.reduce((n, t) => n + t.stops.length, 0)).toBe(29);
    for (const t of taxi.transports) for (const stop of t.stops) expect([30, 60]).toContain(stop.delaySeconds);
    expect(taxi.transports.filter((t) => t.maps.some((m) => m === 2991)).map((t) => t.pathId)).toEqual([11398, 11457]);
  });
});

describe('decoded values (cited: table, build 1.60.1.70009, row; D-022)', () => {
  it('reads the TaxiNodes faction bits (INFERRED decode)', () => {
    const node = (id: number) => taxi.nodes.find((n) => n.id === id);
    expect(node(2)).toMatchObject({ name: 'Stormwind, Elwynn', alliance: true, horde: false });
    expect(node(23)).toMatchObject({ alliance: false, horde: true });
    // Powderfuse Port has no faction bit but two paid paths (data.md §3).
    expect(node(3275)).toMatchObject({ name: 'Powderfuse Port, Riverglades', alliance: false, horde: false });
  });

  it('reads AreaTable.FactionGroupMask and the sanctuary bit (INFERRED decodes)', () => {
    const counts: Record<string, number> = {};
    for (const z of zones.zones) counts[String(z.factionGroupMask)] = (counts[String(z.factionGroupMask)] ?? 0) + 1;
    expect(counts).toEqual({ '0': 37, '2': 9, '4': 8 });
    const zone = (id: number) => zones.zones.find((z) => z.areaId === id);
    expect(zone(14)).toMatchObject({ name: 'Durotar', mapId: 1, factionGroupMask: 4, sanctuary: false });
    expect(zone(1)).toMatchObject({ name: 'Dun Morogh', factionGroupMask: 2 });
    expect(zones.zones.filter((z) => z.sanctuary).map((z) => [z.areaId, z.mapId])).toEqual([[16593, 2991]]);
  });

  it('reads LFGDungeons → ContentTuning as they are, including the row that disagrees with itself', () => {
    const row = (id: number) => dungeons.lfg.find((r) => r.id === id);
    expect(row(1)).toMatchObject({ name: 'Wailing Caverns', contentTuningId: 5254, minLevelSquish: 17, lfgMinLevel: 0 });
    expect(row(3)).toMatchObject({ name: 'Ragefire Chasm', minLevelSquish: 13 });
    expect(row(45)).toMatchObject({ name: 'Onyxia', contentTuningId: 4509, minLevelSquish: 60 });
    expect(row(3272)).toMatchObject({ name: 'Ruins of Lordaeron', contentTuningId: 5256, minLevelSquish: 15, maxLevelSquish: 15, lfgMinLevel: 27, lfgMaxLevel: 27 });
    expect(row(3274)).toMatchObject({ name: 'Excavation Site: Wetlands', contentTuningId: 6874, minLevelSquish: 26 });
    expect(dungeons.lfg.every((r) => r.minLevelSquish === r.maxLevelSquish)).toBe(true);
  });

  it('reads the dungeon and raid maps with their InstanceType, and counts the rows it could not read', () => {
    const map = (id: number) => dungeons.instanceMaps.find((m) => m.id === id);
    for (const id of [249, 309, 409, 469, 509, 531, 533]) expect(map(id)?.instanceType).toBe(2);
    expect(map(43)).toMatchObject({ name: 'Wailing Caverns', instanceType: 1, areaIds: [718] });
    expect(map(2959)).toMatchObject({ name: 'City of Dalaran', instanceType: 1 });
    expect(dungeons.undecodedRows).toEqual({ AreaTable: 46, LFGDungeons: 5, Map: 8 });
  });
});

describe('the column of every value (review MP-R30)', () => {
  it('names a table and column for every field of every row', () => {
    const files: readonly [string, readonly string[]][] = [
      ['taxi.json', ['nodes', 'flights', 'transports']],
      ['zones.json', ['zones']],
      ['dungeons.json', ['lfg', 'instanceMaps']],
    ];
    for (const [name, arrays] of files) {
      const file = jsonOf(name) as Json;
      const columns = file['columns'] as Readonly<Record<string, string>>;
      const entry = (rawManifest['files'] as readonly Json[]).find((f) => f['path'] === name);
      const tables = entry?.['tables'] as readonly string[];
      for (const array of arrays) {
        for (const row of file[array] as readonly Json[]) {
          for (const key of Object.keys(row)) {
            const column = columns[`${array}[].${key}`];
            expect(column, `${name} ${array}[].${key}`).toBeDefined();
            expect(tables.some((t) => column?.includes(`${t}.`)), `${name} ${array}[].${key}: ${String(column)}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('dataset flight masters against the nodes (data.md §3)', () => {
  const site = publicSite();
  const prepared = prepareDataset(siteFiles(site), identityOf(siteManifest(site)), placeholderGeometry(site));
  const ids = flightMasterIdsOf(prepared);

  it('finds a node within 12 yd of every flight master, except the three whose node flies only unpaid paths', () => {
    expect(ids).toHaveLength(63);
    const matched = new Set<number>();
    const unmatched = new Set<number>();
    let farthest = 0;
    for (const faction of ['Alliance', 'Horde'] as const) {
      const view = createDatasetView(prepared, { faction, class: 'WARRIOR', customQuests: [], questOverrides: {} });
      for (const id of ids) {
        for (const spawn of view.spawns({ kind: 'npc', id })) {
          const world = spawn.world;
          if (world === null) throw new Error(`flight master ${String(id)} has no world position`);
          const best = Math.min(...taxi.nodes.filter((n) => n.point.mapId === world.mapId).map((n) => Math.hypot(n.point.x - world.x, n.point.y - world.y)));
          if (best <= 12) {
            matched.add(id);
            farthest = Math.max(farthest, best);
          } else unmatched.add(id);
        }
      }
    }
    // Vesprystus (Rut'theran Village, TaxiNodes 27) and the Nighthaven druid flight masters (TaxiNodes
    // 62 and 63) fly only TaxiPath rows with Cost 0 (101, 102, 315, 316), which the file does not carry.
    expect([...unmatched].sort((a, b) => a - b)).toEqual([3838, 11798, 11800]);
    expect(matched.size).toBe(60);
    expect(farthest).toBeLessThan(12);
    expect(manifest.files.taxi.counts).toBeDefined();
    const unpaid = ((rawManifest['files'] as readonly Json[])[0]?.['counts'] as Json)['unpaidPathsWithoutStops'] as readonly number[];
    expect(unpaid).toEqual(expect.arrayContaining([101, 102, 315, 316]));
  });

  it('leaves only the new Forever nodes and Powderfuse Port without a dataset flight master', () => {
    const masters: { mapId: number; x: number; y: number }[] = [];
    for (const faction of ['Alliance', 'Horde'] as const) {
      const view = createDatasetView(prepared, { faction, class: 'WARRIOR', customQuests: [], questOverrides: {} });
      for (const id of ids) for (const s of view.spawns({ kind: 'npc', id })) if (s.world !== null) masters.push(s.world);
    }
    const lonely = taxi.nodes.filter((n) => !masters.some((m) => m.mapId === n.point.mapId && Math.hypot(m.x - n.point.x, m.y - n.point.y) <= 12)).map((n) => n.id);
    expect(lonely).toEqual([559, 3203, 3242, 3275, 3276]);
  });
});

describe('the notice', () => {
  it('names Blizzard Entertainment, D-039 and non-affiliation, and no local path', () => {
    const notice = bytesOf('NOTICE.md').toString('utf8');
    expect(notice).toContain("Blizzard Entertainment's, © Blizzard Entertainment, Inc.");
    expect(notice).toContain('D-039');
    expect(notice).toContain('not affiliated with or endorsed by Blizzard Entertainment');
    expect(notice).not.toMatch(/\.cache|[A-Z]:\\/);
  });
});

describe('the layouts module', () => {
  const present = clientLayoutSourcesPresent(REPO_ROOT);
  it('has its WoWDBDefs research copies, or says loudly why the comparison is skipped', () => {
    if (!present) process.stderr.write(`
SKIPPED: ${CLIENT_LAYOUTS_FILE} against the WoWDBDefs research copies (not under .cache/experiments/maps or .cache/map-presentation/data/dbd)
`);
    expect(true).toBe(true);
  });
  it.skipIf(!present)('equals the generator’s output from the research copies', () => {
    const committed = readFileSync(join(REPO_ROOT, CLIENT_LAYOUTS_FILE), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderClientLayoutsModule(readClientLayoutSources(REPO_ROOT)));
  });
});

describe('command line', () => {
  const tsx = (args: readonly string[]): { readonly status: number; readonly output: string } => {
    try {
      const output = execFileSync(process.execPath, [join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...args], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  it('refuses unknown options and --layouts with --out, before touching the client', () => {
    expect(tsx(['tools/maps/client-tables.ts', '--bogus'])).toMatchObject({ status: 1, output: expect.stringContaining('unknown option --bogus') as unknown });
    expect(tsx(['tools/maps/client-tables.ts', '--layouts', '--out', 'x'])).toMatchObject({ status: 1, output: expect.stringContaining('--out does not apply') as unknown });
  }, 60_000);
});
