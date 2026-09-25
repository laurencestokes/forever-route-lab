import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId } from '../../src/domain/ids';
import { zoneSourcedPoint } from '../../src/domain/points';
import { canonicalGeometryContent } from '../../src/geo/content';
import { distanceYards } from '../../src/geo/distance';
import { canonicalFrameTuples, frameSetOf } from '../../src/geo/frame';
import { allAssignments, parseGeometryFile } from '../../src/geo/geometry';
import { resolve } from '../../src/geo/resolve';
import { assignmentPercentToWorld, assignmentWorldToPercent, worldToMap } from '../../src/geo/transforms';
import { worldMapIdOf, worldMapIds } from '../../src/geo/zones';
import { CACHE_DIRECTORY_REFERENCE, findPrivacyLeaks, LOCAL_ONLY_MARKER } from '../build/lib/patterns';
import { REFERENCE_FRAME_HASH } from './lib/constants';
import { sha256Hex } from './lib/hash';
import { TAXI_LANDMARKS } from './lib/local-set';
import { CARVE_OUT } from './lib/notice';
import { readRepoText } from './lib/test-support';

/**
 * The committed placeholder itself (public/maps/placeholder/), read as the app will read it:
 * its shape, its frame hash, and the coordinates.md §7-§9 worked examples on the real 61 rows.
 */
const text = readRepoText('public/maps/placeholder/geometry.placeholder.json');
const notice = readRepoText('public/maps/placeholder/NOTICE.md');
const parsed = parseGeometryFile(JSON.parse(text) as unknown);
if (!parsed.ok) throw new Error(`committed geometry does not parse: ${parsed.errors.join('; ')}`);
const geometry = parsed.geometry;

describe('committed geometry.placeholder.json', () => {
  it('is a marked, deterministic file: _generated first, LF, final newline, nothing local', () => {
    expect(Object.keys(JSON.parse(text) as object)[0]).toBe('_generated');
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    for (const file of [text, notice]) {
      expect(findPrivacyLeaks(file)).toEqual([]);
      expect(CACHE_DIRECTORY_REFERENCE.test(file)).toBe(false);
      expect(LOCAL_ONLY_MARKER.test(file)).toBe(false);
    }
  });

  it('holds 60 UiMaps and 61 rows: 49 questiedb-conversion @ 1.60.1.69893 and 12 db2-csv @ 1.60.1.70009', () => {
    const rows = allAssignments(geometry);
    expect(geometry.maps.size).toBe(60);
    expect(rows).toHaveLength(61);
    const by = (source: string) => rows.filter(({ row }) => row.source === source);
    expect(by('questiedb-conversion')).toHaveLength(49);
    expect(by('db2-csv')).toHaveLength(12);
    expect(new Set(by('questiedb-conversion').map(({ row }) => row.build))).toEqual(new Set(['1.60.1.69893']));
    expect(new Set(by('db2-csv').map(({ row }) => row.build))).toEqual(new Set(['1.60.1.70009']));
    expect(worldMapIds(geometry)).toEqual([0, 1, 30, 489, 529, 2991, 2997]);
  });

  it('has the MAPS.md §5.6 reference frame hash, recomputed with node:crypto', () => {
    const frame = canonicalFrameTuples(geometry);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    expect(frame.tuples).toHaveLength(49);
    expect(frame.canonical).toHaveLength(4030);
    expect(sha256Hex(frame.canonical)).toBe(REFERENCE_FRAME_HASH);
    expect(geometry.recordedFrameHash).toBe(REFERENCE_FRAME_HASH);
    expect(frameSetOf(geometry)).toEqual([1411, 1412, 1413, ...Array.from({ length: 46 }, (_, i) => 1416 + i)]);
  });

  it('records the content hash of every row, name, parent and coefficient, recomputed with node:crypto (MAPS.md §5.3)', () => {
    expect(geometry.recordedContentHash).toBe(sha256Hex(canonicalGeometryContent(geometry)));
    expect(geometry.recordedContentHash).toBe('c05a47a276295348a5b40a98dbe13c39ddc6fb4a899c21c821714ebf51c4e6ca');
    // Covers all 61 rows: the 12 db2-csv rows and the Era block as well as the 49 frames.
    const content = JSON.parse(canonicalGeometryContent(geometry)) as [string, number, string, string, [number, ...unknown[]][], unknown[]];
    expect(content[4]).toHaveLength(60);
    expect(content[5]).toHaveLength(4);
  });

  it('carries exactly the four Era → Forever coefficient sets', () => {
    expect([...geometry.eraToForever.keys()]).toEqual([1412, 1423, 1433, 1453]);
  });

  it('gives every UiMap one world map except Azeroth 947, which shows two', () => {
    for (const id of geometry.maps.keys()) expect(worldMapIdOf(id, geometry) === null).toBe(id === 947);
  });

  it('round-trips percent → world → percent below 1e-9 on all 61 rows, inside and outside 0..100', () => {
    let worst = 0;
    for (const { row } of allAssignments(geometry)) {
      for (const x of [-20, 0, 42.06, 100, 120]) {
        for (const y of [-20, 0, 68.33, 100, 120]) {
          const world = assignmentPercentToWorld(row, x, y);
          const back = assignmentWorldToPercent(row, world.x, world.y);
          worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('worked examples on the committed geometry (coordinates.md §7-§9)', () => {
  it('Gornek, Durotar 42.06, 68.33: world (-600.30, -4186.42) on map 1, Kalimdor 57.7531, 54.6207, Azeroth 28.7673, 51.5603', () => {
    const world = resolve(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33), geometry);
    expect(world?.mapId).toBe(1);
    expect(world?.x.toFixed(4)).toBe('-600.2992');
    expect(world?.y.toFixed(4)).toBe('-4186.4222');
    if (world === null) return;
    const kalimdor = worldToMap(world, uiMapId(1414), geometry);
    const azeroth = worldToMap(world, uiMapId(947), geometry);
    expect([kalimdor?.x.toFixed(4), kalimdor?.y.toFixed(4)]).toEqual(['57.7531', '54.6207']);
    expect([azeroth?.x.toFixed(4), azeroth?.y.toFixed(4)]).toEqual(['28.7673', '51.5603']);
  });

  it('Chief Hawkwind, Era 44.18, 76.06 on Mulgore: Forever 43.888926, 76.659548, world (-2877.9715, -221.8308)', () => {
    const world = resolve(zoneSourcedPoint(uiMapId(1412), 44.18, 76.06, 'era'), geometry);
    expect([world?.x.toFixed(4), world?.y.toFixed(4)]).toEqual(['-2877.9715', '-221.8308']);
    if (world === null) return;
    const forever = worldToMap(world, uiMapId(1412), geometry);
    expect([forever?.x.toFixed(6), forever?.y.toFixed(6)]).toEqual(['43.888926', '76.659548']);
  });

  it.each([
    { taxiNode: 2, x: -8832.76953125, y: 478.62298583984, mapId: 0, yards: '11.9' },
    { taxiNode: 23, x: 1677.5899658203, y: -4315.7099609375, mapId: 1, yards: '2.6' },
    { taxiNode: 22, x: -1197.2099609375, y: 29.70999908447, mapId: 1, yards: '3.6' },
    { taxiNode: 5, x: -9429.099609375, y: -2231.3999023438, mapId: 0, yards: '7.0' },
    { taxiNode: 67, x: 2271.0900878906, y: -5340.7998046875, mapId: 0, yards: '4.9' },
    { taxiNode: 68, x: 2327.4099121094, y: -5286.8901367188, mapId: 0, yards: '3.8' },
  ])('TaxiNode $taxiNode (cited 1.60.1.70009 Pos_0/Pos_1) is $yards yd from its QuestieDB flight master', (node) => {
    const landmark = TAXI_LANDMARKS.find((l) => l.taxiNode === node.taxiNode);
    if (landmark === undefined) throw new Error('landmark');
    const master = resolve(zoneSourcedPoint(uiMapId(landmark.uiMapId), landmark.x, landmark.y), geometry);
    if (master === null) throw new Error('unresolved');
    expect(distanceYards(master, { mapId: worldMapId(node.mapId), x: node.x, y: node.y })?.toFixed(1)).toBe(node.yards);
  });

  it('new Forever maps resolve on their own world maps; distances across world maps are null', () => {
    const zephras = resolve(zoneSourcedPoint(uiMapId(2521), 50, 50), geometry);
    const darkspear = resolve(zoneSourcedPoint(uiMapId(2524), 50, 50), geometry);
    expect(zephras?.mapId).toBe(2991);
    expect(darkspear?.mapId).toBe(2997);
    if (zephras === null || darkspear === null) return;
    expect(distanceYards(zephras, darkspear)).toBeNull();
  });
});

describe('committed NOTICE.md', () => {
  it('states both origins, the decisions and the DATA_PROVENANCE §3.2 carve-out verbatim', () => {
    for (const needle of [
      'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
      'f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b',
      '79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a',
      '1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b',
      'tools/maps/inputs/db2-rows-1.60.1.70009.json',
      'not by scripted crawling',
      '"all rights reserved"',
      CARVE_OUT,
      'D-016',
      'D-018',
      'D-022',
      'This is not a legal conclusion.',
      'not affiliated with or endorsed by Blizzard Entertainment or the Questie',
      'pnpm maps:placeholder',
    ]) {
      expect(notice).toContain(needle);
    }
  });

  it('uses the carve-out exactly as DATA_PROVENANCE.md §3.2 words it', () => {
    const provenance = readRepoText('docs/DATA_PROVENANCE.md');
    const start = provenance.indexOf('**Carve-out (LIC-10).**');
    const quote = provenance
      .slice(start)
      .split('\n')
      .filter((line) => line.trimStart().startsWith('>'))
      .slice(0, 3)
      .map((line) => line.trim().replace(/^>\s?/, ''))
      .join(' ');
    expect(quote).toBe(CARVE_OUT);
  });
});
