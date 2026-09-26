import { describe, expect, it } from 'vitest';
import { jsonOf, readDirectory } from '../../../tests/support/fake-fetch';
import { worldMapId } from '../../domain/ids';
import { parseTerrainArcs, parseTerrainManifest, TERRAIN_MANIFEST_PATH, type TerrainArcFile } from './terrain';

/*
 * The committed terrain byproducts (public/maps/terrain/; D-032; terrain-navigation.md §13.1):
 * the manifest parses with every file it lists, the arc files decode to world points, and the
 * guards refuse damaged or mismatched files.
 */

type Json = Record<string, unknown>;
const SITE = new Map([
  ...readDirectory('public/maps/terrain', 'maps/terrain/'),
  ...readDirectory('public/maps/terrain/0', 'maps/terrain/0/'),
  ...readDirectory('public/maps/terrain/1', 'maps/terrain/1/'),
]);
const committed = (): Json => structuredClone(jsonOf(SITE, TERRAIN_MANIFEST_PATH)) as Json;
const manifest = () => {
  const parsed = parseTerrainManifest(committed(), './');
  if (typeof parsed === 'string') throw new Error(parsed);
  return parsed;
};
const fileOf = (mapId: number, kind: 'zones' | 'coast'): TerrainArcFile => {
  const file = manifest().maps.find((map) => map.mapId === mapId)?.[kind];
  if (file === null || file === undefined) throw new Error(`no ${kind} for ${String(mapId)}`);
  return file;
};

describe('parseTerrainManifest', () => {
  it('reads the committed manifest: the relief, zone outlines and coastline of both continents', () => {
    const parsed = manifest();
    expect(parsed.build).toBe('1.60.1.70009');
    expect(parsed.maps.map((map) => [map.mapId, map.name])).toEqual([
      [0, 'Eastern Kingdoms'],
      [1, 'Kalimdor'],
    ]);
    const kalimdor = parsed.maps[1];
    expect(kalimdor?.relief).toEqual({
      mapId: 1,
      url: './maps/terrain/1/relief.png',
      bounds: { mapId: 1, xMin: -12800, xMax: 17066.666666666668, yMin: -9066.666666666668, yMax: 17066.666666666668 },
      width: 1568,
      height: 1792,
      pixelYd: 16.666666666666668,
    });
    expect(kalimdor?.zones).toMatchObject({ kind: 'zones', mapId: 1, path: 'maps/terrain/1/zones.json', url: './maps/terrain/1/zones.json', arcs: 127 });
    expect(kalimdor?.coast).toMatchObject({ kind: 'coast', mapId: 1, path: 'maps/terrain/1/coast.json', arcs: 916 });
    for (const map of parsed.maps) for (const file of [map.relief, map.zones, map.coast]) expect(SITE.has((file?.url ?? '').replace('./', ''))).toBe(true);
  });

  const refusals: readonly (readonly [string, (json: Json) => void, RegExp])[] = [
    ['not version 1', (json) => (json['schema'] = 2), /schema is not 1/],
    ['not terrain', (json) => (json['kind'] = 'map-art'), /kind is not terrain-byproducts/],
    ['a path outside the folder', (json) => (((json['files'] as Json[])[0] as Json)['path'] = '../0/zones.json'), /files\[0\]\.path/],
    ['a file on the wrong map', (json) => (((json['files'] as Json[])[0] as Json)['mapId'] = 1), /files\[0\]\.mapId/],
    ['a map the manifest does not list', (json) => (json['maps'] = [(json['maps'] as Json[])[1]]), /map 0 is not in maps/],
    ['the wrong kind', (json) => (((json['files'] as Json[])[0] as Json)['kind'] = 'coast'), /kind must be zones/],
    ['a repeated file', (json) => (json['files'] as Json[]).push((json['files'] as Json[])[0] as Json), /repeats map 0's zones/],
    ['a malformed hash', (json) => (((json['files'] as Json[])[1] as Json)['sha256'] = 'x'), /sha256/],
    ['an empty rectangle', (json) => ((((json['files'] as Json[])[2] as Json)['rect'] as Json)['xMax'] = -16000.000000000004), /rect is empty/],
    ['a relief without its size', (json) => delete ((json['files'] as Json[])[2] as Json)['pixelYd'], /pixel size and pixelYd/],
  ];

  it.each(refusals)('refuses the whole manifest for %s', (_, damage, message) => {
    const json = committed();
    damage(json);
    expect(parseTerrainManifest(json, './')).toMatch(message);
  });
});

describe('parseTerrainArcs', () => {
  it('decodes the committed zone outlines to world points, with the zones on each side', () => {
    const file = fileOf(1, 'zones');
    const arcs = parseTerrainArcs(jsonOf(SITE, file.path), file);
    if (typeof arcs === 'string') throw new Error(arcs);
    expect(arcs.lines).toHaveLength(127);
    expect(arcs.sides).toHaveLength(127);
    expect(arcs.lines.reduce((sum, line) => sum + line.length, 0)).toBe(1973);
    expect(arcs.lines.every((line) => line.length >= 2 && line.every((p) => p.mapId === 1 && Number.isInteger(p.x) && Number.isInteger(p.y)))).toBe(true);
    // Every point lies in the manifest's rectangle for the map, to the 1-yd quantum the arcs are stored in.
    const rect = manifest().maps[1]?.relief?.bounds;
    if (rect === undefined) throw new Error('no rectangle');
    const inside = (p: { readonly x: number; readonly y: number }): boolean => p.x >= rect.xMin - 1 && p.x <= rect.xMax + 1 && p.y >= rect.yMin - 1 && p.y <= rect.yMax + 1;
    expect(arcs.lines.every((line) => line.every(inside))).toBe(true);
  });

  it('decodes the committed coastline', () => {
    const file = fileOf(0, 'coast');
    const arcs = parseTerrainArcs(jsonOf(SITE, file.path), file);
    if (typeof arcs === 'string') throw new Error(arcs);
    expect(arcs.lines).toHaveLength(876);
    expect(arcs.sides).toEqual([]);
    expect(arcs.lines.reduce((sum, line) => sum + line.length, 0)).toBe(15552);
    expect(arcs.lines[0]?.slice(0, 2)).toEqual([
      { mapId: 0, x: 2650, y: 1725 },
      { mapId: 0, x: 2637, y: 1738 },
    ]);
  });

  const file: TerrainArcFile = { kind: 'zones', mapId: worldMapId(1), path: 'maps/terrain/1/zones.json', url: './maps/terrain/1/zones.json', sha256: '0'.repeat(64), arcs: 1 };
  const small = (arcs: unknown, extra: Json = {}): Json => ({ schema: 1, kind: 'terrain-zones', mapId: 1, units: 'yd', zones: [14, 17], arcs, ...extra });

  it('adds the deltas to the first point: x north, y west, in yards', () => {
    expect(parseTerrainArcs(small([[14, 17, 10, 20, 1, -2, 3, 0]]), file)).toEqual({
      kind: 'zones',
      mapId: 1,
      lines: [
        [
          { mapId: 1, x: 10, y: 20 },
          { mapId: 1, x: 11, y: 18 },
          { mapId: 1, x: 14, y: 18 },
        ],
      ],
      sides: [[14, 17]],
    });
    // Area 0 marks unassigned chunks.
    expect(parseTerrainArcs(small([[0, 17, 10, 20, 1, -2]]), file)).toMatchObject({ sides: [[0, 17]] });
  });

  const bad: readonly (readonly [string, Json, RegExp])[] = [
    ['the wrong kind', small([[14, 17, 0, 0, 1, 1]], { kind: 'terrain-coast' }), /not a schema 1 terrain-zones file/],
    ['another world map', small([[14, 17, 0, 0, 1, 1]], { mapId: 0 }), /mapId is not 1/],
    ['other units', small([[14, 17, 0, 0, 1, 1]], { units: 'm' }), /units are not yd/],
    ['another arc count', small([]), /0 arcs, the manifest records 1/],
    ['one point', small([[14, 17, 0, 0]]), /at least two points/],
    ['an odd length', small([[14, 17, 0, 0, 1, 1, 2]]), /at least two points/],
    ['fractions', small([[14, 17, 0, 0.5, 1, 1]]), /must hold integers/],
    ['a zone the file does not list', small([[14, 99, 0, 0, 1, 1]]), /names a zone the file does not list/],
  ];

  it.each(bad)('refuses a file with %s', (_, json, message) => {
    expect(parseTerrainArcs(json, file)).toMatch(message);
  });
});
