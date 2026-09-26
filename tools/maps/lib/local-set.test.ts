import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGeometryFile } from '../../../src/geo/geometry';
import type { MapGeometry } from '../../../src/geo/types';
import { pngImage, webpImage } from '../../../src/infra/maps/test-images';
import { LOCAL_ONLY_MARKER } from '../../build/lib/patterns';
import { passed } from './checks';
import { REFERENCE_FRAME_HASH } from './constants';
import { lfBytes, sha256Hex } from './hash';
import { formatJson } from './json';
import {
  activate,
  activationManifest,
  deactivate,
  LOCAL_GEOMETRY_FILE,
  LOCAL_MANIFEST_FILE,
  parseSetSource,
  validateLocalSet,
  type LocalSetResult,
} from './local-set';
import { committedGeometryJson, tempDir, writeFile } from './test-support';

type Json = Record<string, unknown>;
const BUILD = '1.60.1.70123';

const committed: MapGeometry = (() => {
  const parsed = parseGeometryFile(committedGeometryJson());
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
})();

/** The committed rows re-exported as a developer's local extraction, plus one new UiMap (2999). */
function localGeometryJson(): Json {
  const source = committedGeometryJson();
  const maps: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(source['maps'] as Record<string, Json>)) {
    maps[key] = {
      ...entry,
      nameSource: 'local-db2',
      assignments: (entry['assignments'] as Json[]).map((row) => ({ ...row, id: Number(row['id']) + 100000, source: 'local-db2', build: BUILD })),
    };
  }
  maps['2999'] = {
    name: 'Synthetic Test Isle',
    nameSource: 'local-db2',
    type: 3,
    parent: 947,
    assignments: [
      { id: 99999, mapId: 2991, areaId: 1, orderIndex: 0, xMin: 2000, xMax: 3000, yMin: 0, yMax: 1500, uiMin: [0, 0], uiMax: [1, 1], source: 'local-db2', build: BUILD },
    ],
  };
  return {
    schema: 1,
    kind: 'local',
    redistribution: 'local-only',
    product: 'wow_classic_beta',
    build: BUILD,
    inputs: { tables: { UiMapAssignment: { rows: 62, sha256: 'a'.repeat(64) } } },
    maps,
    eraToForever: {},
  };
}

const SOURCE = {
  product: 'wow_classic_beta',
  build: BUILD,
  buildKey: '0123456789abcdef0123456789abcdef',
  method: 'tacttool-local',
  tools: { TACTTool: 'a507ff7b', DBC2CSV: '1e4aaa46' },
  wowdbdefs: 'cf84e010f84ba9c8d48fd61730f92bf0d8f2b1cd',
};

/** TaxiNodes 2, 5, 22, 23, 67, 68 at their cited 1.60.1.70009 positions (coordinates.md §9). */
const TAXI_CSV = [
  'ID,ContinentID,Pos_0,Pos_1',
  '2,0,-8832.76953125,478.62298583984',
  '5,0,-9429.099609375,-2231.3999023438',
  '22,1,-1197.2099609375,29.70999908447',
  '23,1,1677.5899658203,-4315.7099609375',
  '67,0,2271.0900878906,-5340.7998046875',
  '68,0,2327.4099121094,-5286.8901367188',
  '',
].join('\n');

let dir = '';
let dispose = (): void => undefined;
beforeEach(() => {
  ({ dir, dispose } = tempDir('frl-local-maps-'));
});
afterEach(() => dispose());

const writeGeometry = (json: Json): void => {
  writeFile(dir, LOCAL_GEOMETRY_FILE, formatJson(json));
};
const validate = (taxiNodesCsv: string | null = null, activeManifest: 'check' | 'ignore' = 'ignore'): LocalSetResult =>
  validateLocalSet({ dir, committed, committedFrameHash: REFERENCE_FRAME_HASH, taxiNodesCsv, activeManifest });
/** `validate.ts --local`: a report that also compares an existing manifest (L8). */
const report = (): LocalSetResult => validate(null, 'check');
const failing = (result: LocalSetResult): readonly string[] => result.checks.filter((c) => c.problems.length > 0).map((c) => c.id);
const mapOf = (json: Json, id: string): Json => (json['maps'] as Record<string, Json>)[id] as Json;
const rowOf = (json: Json, id: string): Json => (mapOf(json, id)['assignments'] as Json[])[0] as Json;
const facts = { source: parseSetSource(JSON.stringify(SOURCE)), repoCommit: 'c'.repeat(40), nodeMajor: 22 };

describe('validateLocalSet', () => {
  it('accepts a frame-compatible set that only adds UiMaps; L5/L6 are recorded as not run without TaxiNodes', () => {
    writeGeometry(localGeometryJson());
    const result = validate();
    expect(result.passed).toBe(true);
    expect(result.checks.map((c) => `${c.id}:${passed(c) ? 'pass' : c.skipped === null ? 'fail' : 'skip'}`)).toEqual([
      'L0:pass', 'L1:pass', 'L2:pass', 'L3:pass', 'L4:pass', 'L5:skip', 'L6:skip', 'L7:pass',
    ]);
    expect(result.frameHash).toBe(REFERENCE_FRAME_HASH);
    expect(result.merge).toMatchObject({ kind: 'merged', added: [2999] });
    expect(result.build).toBe(BUILD);
  });

  it('runs L5 and L6 with a local TaxiNodes CSV: the cited landmarks are within 30 yd', () => {
    writeGeometry(localGeometryJson());
    const result = validate(TAXI_CSV);
    expect(result.passed).toBe(true);
    expect(result.checks.filter((c) => c.id === 'L5' || c.id === 'L6').every(passed)).toBe(true);
  });

  it('L6 fails when a landmark node is far from its flight master, L5 when a node is outside every zone', () => {
    writeGeometry(localGeometryJson());
    const moved = TAXI_CSV.replace('-8832.76953125', '-8782.76953125');
    expect(failing(validate(moved))).toEqual(['L6']);
    // The Redridge and Eastern Plaguelands landmarks (changed frames) are checked too.
    const lakeshire = validate(TAXI_CSV.replace('-9429.099609375', '-9389.099609375'));
    expect(lakeshire.checks.find((c) => c.id === 'L6')?.problems).toEqual([expect.stringMatching(/^TaxiNode 5 is \d+\.\d yd from NPC 931$/) as unknown]);
    const noLightsHope = validate(TAXI_CSV.replace('68,0,2327.4099121094,-5286.8901367188\n', ''));
    expect(noLightsHope.checks.find((c) => c.id === 'L6')?.problems).toEqual(['TaxiNode 68 / NPC 12636: not comparable (missing node or frame)']);
    const stray = `${TAXI_CSV}99,1,20000,20000\n`;
    const result = validate(stray);
    expect(failing(result)).toEqual(['L5']);
    expect(result.checks.find((c) => c.id === 'L5')?.problems).toEqual(['outside every zone frame: TaxiNode 99 (map 1)']);
  });

  it('L4 rejects the whole set when a committed db2-csv UiMap differs, or a frame moved', () => {
    const differing = localGeometryJson();
    rowOf(differing, '1414')['xMax'] = 12800.9;
    writeGeometry(differing);
    const result = validate();
    expect(result.passed).toBe(false);
    expect(failing(result)).toEqual(['L4']);
    expect(result.checks.find((c) => c.id === 'L4')?.problems).toEqual(['rows differ from the committed rows at UiMaps 1414 (local sets may only add UiMaps)']);

    const moved = localGeometryJson();
    rowOf(moved, '1412')['yMax'] = 2047.9166259766;
    writeGeometry(moved);
    const frame = validate();
    expect(failing(frame)).toContain('L4');
    expect(frame.checks.find((c) => c.id === 'L4')?.problems[0]).toMatch(/^frame hash [0-9a-f]{64} differs from the committed 2cb10551/);
    expect(frame.checks.find((c) => c.id === 'L7')?.skipped).toBe('needs a frame-compatible set (L4)');
  });

  it('L3 refuses art that is not a PNG or WebP of the right size and placement, L1 a zone map without a single full-rectangle primary row', () => {
    writeGeometry(localGeometryJson());
    writeFile(dir, 'art/2999.webp', 'not really an image');
    expect(failing(validate())).toEqual(['L3']);
    expect(validate().checks.find((c) => c.id === 'L3')?.problems).toEqual(['art/2999.webp: not a PNG or WebP file']);
    expect(validate().art).toBeNull();
    writeFile(dir, 'art/2999.webp', webpImage(1000, 668));
    expect(validate().checks.find((c) => c.id === 'L3')?.problems).toEqual(["art/2999.webp: 1000 × 668 pixels, UiMap 2999's art is 1002 × 668 (LayerWidth × LayerHeight)"]);
    writeFile(dir, 'art/2999.webp', webpImage(1002, 668));
    expect(validate().passed).toBe(true);

    const partial = localGeometryJson();
    rowOf(partial, '2999')['uiMax'] = [0.5, 1];
    writeGeometry(partial);
    expect(failing(validate())).toEqual(expect.arrayContaining(['L1']));
  });

  it('L0 fails without a geometry file, or for a file that is not a local, local-only geometry with a build', () => {
    expect(failing(validate())).toEqual(['L0']);
    const notLocal = localGeometryJson();
    delete notLocal['redistribution'];
    delete notLocal['build'];
    writeGeometry(notLocal);
    expect(validate().checks.find((c) => c.id === 'L0')?.problems).toEqual([
      'top-level "build" (the set\'s client build) is missing or malformed',
      'redistribution: a local geometry must be "local-only"',
    ]);
  });
});

describe('activation', () => {
  it('writes maps.manifest.json for a passing set: local-only, hashes, checks run and not run, no timestamps', () => {
    writeGeometry(localGeometryJson());
    writeFile(dir, 'taxi.local.json', '{ "redistribution": "local-only" }\n');
    const result = validate();
    const path = activate(dir, result, facts);
    const text = readFileSync(path, 'utf8');
    const manifest = JSON.parse(text) as Json;
    expect(manifest).toEqual({
      schema: 1,
      redistribution: 'local-only',
      set: `wow_classic_beta-${BUILD}`,
      product: 'wow_classic_beta',
      build: BUILD,
      buildKey: SOURCE.buildKey,
      source: { method: 'tacttool-local', tools: SOURCE.tools, wowdbdefs: SOURCE.wowdbdefs },
      generator: { repoCommit: 'c'.repeat(40), node: '22.x' },
      tables: { UiMapAssignment: { rows: 62, sha256: 'a'.repeat(64) } },
      frameHash: REFERENCE_FRAME_HASH,
      geometry: { file: LOCAL_GEOMETRY_FILE, sha256: sha256Hex(lfBytes(readFileSync(join(dir, LOCAL_GEOMETRY_FILE)))) },
      art: {},
      taxi: { file: 'taxi.local.json', sha256: sha256Hex('{ "redistribution": "local-only" }\n') },
      validation: { passed: true, checks: ['L0', 'L1', 'L2', 'L3', 'L4', 'L7'], notRun: { L5: 'no local TaxiNodes CSV given (--taxi-nodes <csv>)', L6: 'no local TaxiNodes CSV given (--taxi-nodes <csv>)' } },
    });
    // audit-dist refuses any file with this marker, so a copied manifest can never deploy.
    expect(LOCAL_ONLY_MARKER.test(text)).toBe(true);
    expect(activate(dir, result, facts)).toBe(path);
    expect(readFileSync(path, 'utf8')).toBe(text);
  });

  it('refuses to activate a failing set, and deactivation removes an existing manifest', () => {
    writeGeometry(localGeometryJson());
    activate(dir, validate(), facts);
    const broken = localGeometryJson();
    rowOf(broken, '1414')['xMax'] = 1;
    writeGeometry(broken);
    const result = validate();
    expect(() => activationManifest(dir, result, facts)).toThrow(/did not pass/);
    expect(deactivate(dir)).toBe(true);
    expect(existsSync(join(dir, LOCAL_MANIFEST_FILE))).toBe(false);
    expect(deactivate(dir)).toBe(false);
  });

  it('refuses a source.json for another build, with local paths, or with unpinned tools', () => {
    writeGeometry(localGeometryJson());
    const result = validate();
    expect(() => activationManifest(dir, result, { ...facts, source: parseSetSource(JSON.stringify({ ...SOURCE, build: '1.60.1.70009' })) })).toThrow(/describes wow_classic_beta 1.60.1.70009/);
    // Built at run time so this file itself contains no profile path (tests/architecture.test.ts).
    const profile = ['C:', 'Users', 'alice', 'wow'].join('/');
    expect(() => parseSetSource(JSON.stringify({ ...SOURCE, note: profile }))).toThrow(/must not contain local paths/);
    expect(() => parseSetSource(JSON.stringify({ ...SOURCE, method: 'scraped' }))).toThrow(/method must be one of/);
    expect(() => parseSetSource(JSON.stringify({ ...SOURCE, wowdbdefs: 'master' }))).toThrow(/wowdbdefs must be a full commit SHA/);
    expect(() => parseSetSource(JSON.stringify({ ...SOURCE, buildKey: 'x' }))).toThrow(/buildKey/);
  });
});

describe('art in the manifest', () => {
  // Generated images (src/infra/maps/test-images.ts): a decodable 1002 × 668 greyscale PNG, and a
  // WebP container with valid headers and a placeholder bitstream. No real map art (D-018).
  const zonePng = pngImage(1002, 668);
  const isleWebp = webpImage(1002, 668);

  it('lists every art file with its type, size, SHA-256 and the row it covers', () => {
    writeGeometry(localGeometryJson());
    writeFile(dir, 'art/1411.png', zonePng);
    writeFile(dir, 'art/2999.webp', isleWebp);
    const result = validate();
    expect(result.passed).toBe(true);
    const manifest = JSON.parse(readFileSync(activate(dir, result, facts), 'utf8')) as Json;
    const durotar = rowOf(localGeometryJson(), '1411');
    expect(manifest['art']).toEqual({
      '1411': {
        file: 'art/1411.png',
        contentType: 'image/png',
        width: 1002,
        height: 668,
        sha256: sha256Hex(zonePng),
        bounds: { assignment: durotar['id'], mapId: 1, xMin: durotar['xMin'], xMax: durotar['xMax'], yMin: durotar['yMin'], yMax: durotar['yMax'] },
      },
      '2999': {
        file: 'art/2999.webp',
        contentType: 'image/webp',
        width: 1002,
        height: 668,
        sha256: sha256Hex(isleWebp),
        bounds: { assignment: 99999, mapId: 2991, xMin: 2000, xMax: 3000, yMin: 0, yMax: 1500 },
      },
    });
    expect(Object.keys(manifest)).toEqual(['schema', 'redistribution', 'set', 'product', 'build', 'buildKey', 'source', 'generator', 'tables', 'frameHash', 'geometry', 'art', 'validation']);
  });

  it('refuses to activate a set whose art fails L3', () => {
    writeGeometry(localGeometryJson());
    writeFile(dir, 'art/947.png', zonePng);
    const result = validate();
    expect(failing(result)).toEqual(['L3']);
    expect(() => activationManifest(dir, result, facts)).toThrow(/did not pass/);
  });

  it('L8: a report compares an existing manifest with the files, and names what changed', () => {
    writeGeometry(localGeometryJson());
    writeFile(dir, 'art/1411.png', zonePng);
    expect(report().checks.find((c) => c.id === 'L8')?.skipped).toBe('no maps.manifest.json (the set is not active)');
    expect(report().passed).toBe(true);
    activate(dir, validate(), facts);
    expect(report().checks.find((c) => c.id === 'L8')).toMatchObject({ problems: [], skipped: null });

    writeFile(dir, 'art/1411.png', pngImage(1002, 668, 7));
    writeFile(dir, 'art/2999.webp', isleWebp);
    writeFile(dir, 'taxi.local.json', '{ "redistribution": "local-only" }\n');
    const stale = report();
    expect(failing(stale)).toEqual(['L8']);
    expect(stale.checks.find((c) => c.id === 'L8')?.problems).toEqual([
      expect.stringMatching(/^art\/1411\.png changed after activation \(SHA-256 [0-9a-f]{12}…, the manifest records [0-9a-f]{12}…\)$/) as unknown,
      'art/2999.webp is not listed',
      'taxi.local.json is not listed',
      'run tools/maps validate --activate again',
    ]);
    // Activation ignores the stale manifest it replaces, and the new one matches again.
    activate(dir, validate(), facts);
    expect(failing(report())).toEqual([]);

    const moved = localGeometryJson();
    rowOf(moved, '2999')['yMax'] = 1501;
    writeGeometry(moved);
    // Within L3's aspect tolerance, so the art still passes; its bounds moved with the row.
    expect(report().checks.find((c) => c.id === 'L8')?.problems).toEqual([
      'geometry.local.json changed after activation',
      'art/2999.webp: bounds is {"assignment":99999,"mapId":2991,"xMin":2000,"xMax":3000,"yMin":0,"yMax":1501}, the manifest records {"assignment":99999,"mapId":2991,"xMin":2000,"xMax":3000,"yMin":0,"yMax":1500}',
      'run tools/maps validate --activate again',
    ]);
    writeFile(dir, 'art/2999.webp', 'not really an image');
    expect(report().checks.find((c) => c.id === 'L8')?.problems).toContain('the art fails L3, so it cannot be compared');
  });
});
