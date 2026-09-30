// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsonOf, readDirectory } from './support/fake-fetch';
import type { StepId, WorldMapId } from '../src/domain/ids';
import type { WorldPoint } from '../src/domain/points';
import { parseGeometryFile } from '../src/geo/geometry';
import type { MapGeometry } from '../src/geo/types';
import { parseTerrainArcs, type TerrainArcFile } from '../src/infra/maps/terrain';

import type { LayerContent, MapBand, MapView, MarkerDescriptor, OutlineDescriptor, OutlineInput, PolylineDescriptor, ZoneFillDescriptor } from '../src/map/adapter';
import { landRingsNear, landRingsOf, windingAt } from '../src/map/leaflet/leaflet-layers';
import { atlasSurfaceOf, createMapLayers, outlinesDrawn, splitContent, type ActiveSplit } from '../src/map/layers';

/*
 * The presentation fixes in map/layers (the joint review's presentation findings): no terrain
 * outline in the minimap style nor zone outlines at the world band (PR-01, D-047), no outline wholly
 * outside its map's placed extent (QA-10: GM Island), the route split at the active step (PR-02),
 * and the faction patterns on land only (PR-15, QA-15), on the committed geometry and terrain arcs.
 */

const KALIMDOR = 1 as WorldMapId;
const EK = 0 as WorldMapId;

function committedGeometry(): MapGeometry {
  const site = readDirectory('public/maps/placeholder', 'maps/placeholder/');
  const parsed = parseGeometryFile(jsonOf(site, 'maps/placeholder/geometry.placeholder.json'));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
}

function committedArcs(mapId: WorldMapId, kind: 'zones' | 'coast'): OutlineInput & { readonly sides: readonly (readonly [number, number])[] } {
  const json: unknown = JSON.parse(readFileSync(`public/maps/terrain/${String(mapId)}/${kind}.json`, 'utf8'));
  const arcs = (json as { readonly arcs: readonly unknown[] }).arcs.length;
  const parsed = parseTerrainArcs(json, { kind, mapId, arcs } as unknown as TerrainArcFile);
  if (typeof parsed === 'string') throw new Error(parsed);
  return { mapId, lines: parsed.lines, sides: parsed.sides };
}

const GEOMETRY = committedGeometry();

function atlasView(mapId: WorldMapId, zoom: number, band: MapBand): MapView {
  const atlas = atlasSurfaceOf(GEOMETRY);
  if (atlas === null) throw new Error('no atlas');
  return { surface: atlas.id, mapId, zoom, band, bounds: null, visible: [] } as unknown as MapView;
}

describe('terrain outlines (D-047; review PR-01, QA-10)', () => {
  it('draws no terrain outline in the minimap style, and no zone outline at the world band', () => {
    for (const band of ['world', 'continent', 'zone', 'close'] as const) {
      expect(outlinesDrawn('zone-outlines', band, true)).toBe(false);
      expect(outlinesDrawn('coastline', band, true)).toBe(false);
      expect(outlinesDrawn('zone-outlines', band, false)).toBe(band !== 'world');
      expect(outlinesDrawn('coastline', band, false)).toBe(true);
    }
  });

  it('so no outline segment is drawn over a sea key in the minimap style: the layer is empty at every band', () => {
    const layers = createMapLayers({ geometry: GEOMETRY });
    const zones = committedArcs(KALIMDOR, 'zones');
    for (const [zoom, band] of [
      [-6, 'world'],
      [-4, 'continent'],
      [-2, 'zone'],
      [0, 'close'],
    ] as const) {
      const view = atlasView(KALIMDOR, zoom, band);
      expect(layers.part({ layer: 'zone-outlines', outlines: [zones], minimap: true }, view).finish().items).toEqual([]);
      expect(layers.part({ layer: 'coastline', outlines: [committedArcs(KALIMDOR, 'coast')], minimap: true }, view).finish().items).toEqual([]);
    }
    // The painted style keeps them from the continent band.
    expect(layers.part({ layer: 'zone-outlines', outlines: [zones] }, atlasView(KALIMDOR, -4, 'continent')).finish().items).toHaveLength(1);
    expect(layers.part({ layer: 'zone-outlines', outlines: [zones] }, atlasView(KALIMDOR, -6, 'world')).finish().items).toEqual([]);
  });

  it('leaves out every line with no point in its map’s placed extent: GM Island (AreaTable 876) is not drawn', () => {
    const atlas = atlasSurfaceOf(GEOMETRY);
    if (atlas === null) throw new Error('no atlas');
    for (const mapId of [KALIMDOR, EK]) {
      const layers = createMapLayers({ geometry: GEOMETRY });
      const input = committedArcs(mapId, 'zones');
      const rect = atlas.placements.find((placement) => placement.mapId === mapId)?.rect;
      if (rect === undefined) throw new Error('not placed');
      const [outline] = layers.part({ layer: 'zone-outlines', outlines: [input] }, atlasView(mapId, -4, 'continent')).finish().items as OutlineDescriptor[];
      const inside = (p: WorldPoint): boolean => p.x >= rect.xMin && p.x <= rect.xMax && p.y >= rect.yMin && p.y <= rect.yMax;
      // Every drawn ring meets the extent (Teldrassil's and the Eastern Kingdoms' edge rings reach its edge).
      expect(outline?.lines.every((line) => line.some(inside))).toBe(true);
      const gm = input.lines.filter((_, i) => input.sides[i]?.includes(876) === true);
      if (mapId === KALIMDOR) {
        expect(gm.length).toBeGreaterThan(0);
        expect(outline?.lines.length).toBe(input.lines.length - gm.length);
        for (const line of gm) expect(outline?.lines.includes(line)).toBe(false);
      } else expect(outline?.lines.length).toBe(input.lines.length);
    }
  });
});

describe('the route after the active step (§13.6; review PR-02)', () => {
  const at = (x: number): WorldPoint => ({ mapId: KALIMDOR, x, y: -4000 });
  const ids = ['a', 'b', 'c', 'd', 'e'] as StepId[];
  const piece: PolylineDescriptor = {
    type: 'polyline',
    id: 'run:1:route:a',
    mapId: KALIMDOR,
    // Vertex 2 is a path point of the leg into d.
    points: [at(0), at(10), at(15), at(20), at(30)],
    style: 'route',
    emphasis: 'normal',
    label: 'Route',
    ref: { kind: 'run', style: 'route', stepIds: [ids[0], ids[1], ids[3], ids[3], ids[4]] as StepId[] },
  };
  const bead = (id: StepId): MarkerDescriptor => ({
    type: 'marker',
    id: `step:${id}`,
    point: at(0),
    kind: 'step',
    style: 'accent',
    emphasis: 'normal',
    label: id,
    badges: [],
    ref: { kind: 'step', stepId: id },
    count: 1,
    refs: [{ kind: 'step', stepId: id }],
    labels: [id],
  });
  const content: LayerContent = { layer: 'route-line', items: [piece, bead(ids[1] as StepId), bead(ids[3] as StepId)], stats: { drawn: 3, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 } };
  const split = (active: number): ActiveSplit => ({ at: active, positions: new Map(ids.map((id, i) => [id, i])) });

  it('splits a piece at the active step’s vertex: the leg into it stays solid, the part after is its own item', () => {
    // Active c (position 2, not drawn): the split is at b's vertex, before the leg into d.
    const out = splitContent(content, split(2));
    const [before, after] = out.items as PolylineDescriptor[];
    expect(before).toMatchObject({ id: 'run:1:route:a', points: [at(0), at(10)], ref: { stepIds: ['a', 'b'] } });
    expect(before?.after).toBeUndefined();
    expect(after).toMatchObject({ id: 'run:1:route:a>after', points: [at(10), at(15), at(20), at(30)], ref: { stepIds: ['b', 'd', 'd', 'e'] }, after: true });
    // The beads: b is before, d after.
    expect((out.items[2] as MarkerDescriptor).after).toBeUndefined();
    expect((out.items[3] as MarkerDescriptor).after).toBe(true);
  });

  it('keeps the objects: the same split gives the same pieces, no split the content itself, and a piece wholly after keeps its id', () => {
    const first = splitContent(content, split(2));
    expect(splitContent(content, split(2)).items).toEqual(first.items);
    expect(splitContent(content, split(2)).items[0]).toBe(first.items[0]);
    expect(splitContent(content, null)).toBe(content);
    expect(splitContent(content, split(4))).toBe(content);
    const whole = splitContent(content, split(0));
    expect(whole.items[0]).toMatchObject({ id: 'run:1:route:a', after: true, points: piece.points });
  });
});

describe('the faction patterns on land only (§12.6; review PR-15, QA-15)', () => {
  it('builds the coastline into rings whose winding is not zero on land and zero on the sea', () => {
    const kalimdor = landRingsOf(committedArcs(KALIMDOR, 'coast').lines).map((entry) => entry.ring);
    const ek = landRingsOf(committedArcs(EK, 'coast').lines).map((entry) => entry.ring);
    const land = (rings: typeof kalimdor, x: number, y: number): boolean => windingAt(rings, x, y) !== 0;
    // Orgrimmar, the Crossroads, Darkshore; the sea east of Durotar and west of Darkshore.
    expect(land(kalimdor, 1600, -4400)).toBe(true);
    expect(land(kalimdor, -450, -2650)).toBe(true);
    expect(land(kalimdor, 6500, 400)).toBe(true);
    expect(land(kalimdor, 0, -6500)).toBe(false);
    expect(land(kalimdor, 6500, 1500)).toBe(false);
    // Stormwind, Ironforge; the sea west of Westfall.
    expect(land(ek, -8900, 600)).toBe(true);
    expect(land(ek, -4900, -900)).toBe(true);
    expect(land(ek, -10500, 3500)).toBe(false);
    expect(kalimdor.every((ring) => ring.length >= 3)).toBe(true);
  });

  it('gives a faction fill its map’s coastline, and a tint none; the rings that meet the fill clip it to land', () => {
    const coast = committedArcs(KALIMDOR, 'coast');
    const ring: readonly WorldPoint[] = [
      { mapId: KALIMDOR, x: 6000, y: 0 },
      { mapId: KALIMDOR, x: 7000, y: 0 },
      { mapId: KALIMDOR, x: 7000, y: 2000 },
      { mapId: KALIMDOR, x: 6000, y: 2000 },
    ];
    const faction: ZoneFillDescriptor = { type: 'zone-fill', id: 'faction:1:148', mapId: KALIMDOR, areaId: 148, rings: [ring], fill: { pattern: 'alliance' }, label: 'Darkshore: Alliance territory', ref: { kind: 'zone', uiMapId: 1439 as never }, words: 'Alliance territory' };
    const tint: ZoneFillDescriptor = { ...faction, id: 'tint:1:148', fill: { tint: '#123456' }, label: null };
    const layers = createMapLayers({ geometry: GEOMETRY });
    const items = layers.part({ layer: 'zone-fill', fills: [tint, faction], land: [coast] }, atlasView(KALIMDOR, -4, 'continent')).finish().items as ZoneFillDescriptor[];
    const clipped = items.find((item) => item.id === faction.id);
    expect(clipped?.land).toBe(coast.lines);
    expect(items.find((item) => item.id === tint.id)?.land).toBeUndefined();
    // The rings that meet the fill: the sea west of Darkshore inside the fill's ring is not land; the shore is.
    const near = landRingsNear(clipped?.land ?? [], ring);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(landRingsOf(coast.lines).length);
    expect(windingAt(near, 6500, 1500)).toBe(0);
    expect(windingAt(near, 6500, 400)).not.toBe(0);
  });
});
