import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId, type WorldMapId } from '../src/domain/ids';
import { zoneSourcedPoint } from '../src/domain/points';
import { parseGeometryFile, resolvePoint, zoneFramesContaining, type MapGeometry } from '../src/geo';
import { parseTerrainArcs, parseTerrainManifest } from '../src/infra/maps/terrain';
import { zoneShapesOf, type ZoneShapes } from '../src/app/map-labels';
import { zoneOfPoint } from '../src/app/map-viewing';

/*
 * The "Viewing" chip's zone on the committed geometry and terrain zone arcs (review QA-01): the
 * frames overlap, so the frame a point is most central in names the wrong zone at the Valley of
 * Trials and at Kargath; the terrain rings name the right one.
 */

function committed(): { readonly geometry: MapGeometry; readonly shapes: ReadonlyMap<WorldMapId, ZoneShapes> } {
  const parsed = parseGeometryFile(JSON.parse(readFileSync(join('public', 'maps', 'placeholder', 'geometry.placeholder.json'), 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const manifest = parseTerrainManifest(JSON.parse(readFileSync(join('public', 'maps', 'terrain', 'manifest.json'), 'utf8')) as unknown, './');
  if (typeof manifest === 'string') throw new Error(manifest);
  const shapes = new Map<WorldMapId, ZoneShapes>();
  for (const map of manifest.maps) {
    if (map.zones === null) continue;
    const arcs = parseTerrainArcs(JSON.parse(readFileSync(join('public', 'maps', 'terrain', String(map.mapId), 'zones.json'), 'utf8')) as unknown, map.zones);
    if (typeof arcs === 'string') throw new Error(arcs);
    shapes.set(map.mapId, zoneShapesOf(map.mapId, arcs.lines, arcs.sides));
  }
  return { geometry: parsed.geometry, shapes };
}

const { geometry, shapes } = committed();

/** A point published in a zone's own coordinates (percent), in world yards. */
function at(zone: number, x: number, y: number) {
  const point = resolvePoint(zoneSourcedPoint(uiMapId(zone), x, y), geometry);
  if (point === null) throw new Error(`no world point for ${String(zone)} ${String(x)},${String(y)}`);
  return point;
}

const DUROTAR = uiMapId(1411);
const BADLANDS = uiMapId(1418);

describe('the zone the view is on (map-viewing.ts; review QA-01)', () => {
  it('names Durotar at the Valley of Trials and the Badlands at Kargath, where the most central frame is another zone', () => {
    // Gornek and Kaltunk (the dataset's Durotar 42.06, 68.33 and 43.29, 68.53); Gorn at Kargath (Badlands 2.91, 45.6).
    const gornek = at(1411, 42.06, 68.33);
    const kaltunk = at(1411, 43.29, 68.53);
    const gorn = at(1418, 2.91, 45.6);
    // The frames alone got them wrong: The Barrens (1413) and Searing Gorge (1427).
    expect(zoneFramesContaining(gornek, geometry)[0]).toBe(uiMapId(1413));
    expect(zoneFramesContaining(gorn, geometry)[0]).toBe(uiMapId(1427));
    expect(zoneOfPoint(gornek, shapes, geometry)).toBe(DUROTAR);
    expect(zoneOfPoint(kaltunk, shapes, geometry)).toBe(DUROTAR);
    expect(zoneOfPoint(gorn, shapes, geometry)).toBe(BADLANDS);
  });

  it('names a city enclave as the city, and an underground city by its frame', () => {
    // Orgrimmar (1454) has its own terrain ring inside Durotar's; Ironforge (1455) has none (its city is underground).
    expect(zoneOfPoint(at(1454, 50, 50), shapes, geometry)).toBe(uiMapId(1454));
    expect(zoneOfPoint(at(1455, 50, 50), shapes, geometry)).toBe(uiMapId(1455));
  });

  it('falls back to the most central frame while the rings load, off the coast and on a map without terrain arcs', () => {
    const gornek = at(1411, 42.06, 68.33);
    expect(zoneOfPoint(gornek, null, geometry)).toBe(zoneFramesContaining(gornek, geometry)[0]);
    expect(zoneOfPoint(gornek, new Map(), geometry)).toBe(zoneFramesContaining(gornek, geometry)[0]);
    // Zephras Isle (map 2991) has no zone arcs.
    const isle = at(2521, 50, 50);
    expect(isle.mapId).toBe(worldMapId(2991));
    expect(zoneOfPoint(isle, shapes, geometry)).toBe(zoneFramesContaining(isle, geometry)[0] ?? null);
    // Far out at sea, in no frame and no ring: unknown, not guessed.
    expect(zoneOfPoint({ mapId: worldMapId(1), x: -12000, y: 12000 }, shapes, geometry)).toBeNull();
  });
});
