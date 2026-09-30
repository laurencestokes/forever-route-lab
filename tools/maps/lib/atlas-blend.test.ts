import { describe, expect, it } from 'vitest';
import { atlasPlacements, placementOf } from '../../../src/geo/atlas';
import { worldMapId } from '../../../src/domain/ids';
import { composeWindow, emptyCounts, seaColour, type CoverageCensus, type Scene } from './atlas-blend';
import { reliefGrid } from './atlas-mask';
import { ATLAS_PARAMS, RELIEF_WATER, SEA_COAST, SEA_DEEP } from './atlas-params';
import { planAtlas } from './atlas-plan';
import { tintOf, type Rgba8 } from './atlas-raster';
import { buildScene, type LabelRuleInput } from './atlas-scene';
import {
  CARD_COLOUR,
  continentRaster,
  flatRaster,
  islandGrid,
  islandRelief,
  ISLAND_ARCS,
  RELIEF_CELL,
  RELIEF_RECT,
  LABEL_COLOUR,
  overlayUnion,
  SYNTH_ASSIGNMENTS,
  SYNTH_LAYOUT,
  SYNTH_UIMAPS,
  synthGeometry,
  ZONE_COLOUR,
} from './atlas-test-support';
import type { Rgba } from './raster';

/**
 * The composition rules of docs/research/map-atlas.md §6.2, §6.4 and §6.5 on a synthetic world
 * (atlas-test-support.ts): one zone painting over its own polygon (area 10), a neighbouring area
 * (20) it paints only where its explored overlays do, a continent painting read for the land test
 * and the tint, the sea, a card, and label rules.
 */

const toR = (r: Rgba): Rgba8 => ({ w: r.width, h: r.height, d: r.data });
const greyGrid = (grey: (X: number, Y: number) => number): ReturnType<typeof islandGrid> => {
  const r = islandRelief(grey);
  return reliefGrid(1, r.d, r.w, r.h, RELIEF_CELL, RELIEF_RECT, ISLAND_ARCS);
};
const placements = atlasPlacements(synthGeometry(), SYNTH_LAYOUT) ?? [];
const plan = planAtlas({
  uiMaps: SYNTH_UIMAPS,
  assignments: SYNTH_ASSIGNMENTS,
  artSize: new Map([5000, 5001, 5002].map((id) => [id, { width: 1002, height: 668 }])),
  terrainZones: new Map([
    [1, [10, 20]],
    [0, []],
  ]),
  placements,
  roundUp: ATLAS_PARAMS.roundUp,
});

interface Options {
  readonly zone?: Rgba;
  readonly labels?: readonly LabelRuleInput[];
  readonly grey?: (X: number, Y: number) => number;
}

function built(options: Options = {}): ReturnType<typeof buildScene> {
  const zone = options.zone ?? flatRaster(ZONE_COLOUR);
  const map1 = placementOf(placements, worldMapId(1));
  const map0 = placementOf(placements, worldMapId(0));
  if (map1 === null || map0 === null) throw new Error('synthetic placements');
  const sea = new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (RELIEF_WATER[i % 4] ?? 0)));
  return buildScene({
    seamE: SYNTH_LAYOUT.seamE,
    westMapId: 1,
    eastMapId: 0,
    extentW: 10240,
    extentH: 4096,
    maps: [
      { mapId: 1, eOff: map1.eOff, sOff: map1.sOff, rect: map1.rect, grid: options.grey === undefined ? islandGrid() : greyGrid(options.grey), arcs: ISLAND_ARCS, zoneIds: [10, 20] },
      { mapId: 0, eOff: map0.eOff, sOff: map0.sOff, rect: map0.rect, grid: reliefGrid(0, sea, 16, 16, 256, { xMin: -2048, xMax: 2048, yMin: -2048, yMax: 2048 }, []), arcs: [], zoneIds: [] },
    ],
    sources: plan.sources.map((spec) => {
      if (spec.uiMapId === 5000) return { spec, full: toR(continentRaster()), lowPass: null, overlays: null };
      return { spec, full: toR(zone), lowPass: toR(zone), overlays: toR(overlayUnion()) };
    }),
    insets: plan.insets.map((spec) => ({ spec, full: toR(flatRaster(CARD_COLOUR)) })),
    labels: options.labels ?? [],
    seaCoast: SEA_COAST,
    seaDeep: SEA_DEEP,
  });
}
const scene = (options: Options = {}): Scene => built(options).scene;

/** The composed pixel over world point (X, Y) of map 1 at level z. */
function at(sc: Scene, z: number, X: number, Y: number, census: CoverageCensus | null = null): number[] {
  const p = 2 ** -z;
  const m = sc.maps.find((x) => x.mapId === 1);
  if (m === undefined) throw new Error('map 1');
  const { out } = composeWindow(sc, z, Math.floor((m.eOff - Y) / p), Math.floor((m.sOff - X) / p), 1, 1, census, null);
  return [...out];
}

const neutral = tintOf(ATLAS_PARAMS.neutralTintSource, ATLAS_PARAMS.tintMaxSaturation, ATLAS_PARAMS.tintLightness).map(Math.round);

describe('the level −2 composite (§6.2)', () => {
  const sc = scene();

  it('plans the zone at its nearest level, the continent as read-only, and the card as an inset', () => {
    expect(plan.sources.map((s) => [s.uiMapId, s.cls, s.t, s.areas])).toEqual([
      [5000, 'continent', -2, null],
      [5001, 'zone', -2, [10]],
    ]);
    // the card's art is 1 yd/px, but a card is composed at level −2 and coarser only
    expect(plan.insets.map((i) => [i.uiMapId, i.e0, i.s0, i.w, i.h, i.top])).toEqual([[5002, 4096, 3072, 1002, 668, -2]]);
  });

  it('draws a painting over its own polygon', () => {
    expect(at(sc, -2, 400, 600)).toEqual([...ZONE_COLOUR]);
    expect(at(sc, -2, -400, 600)).toEqual([...ZONE_COLOUR]);
  });

  it('outside its polygon, draws only its painted ground (never its parchment margins, MA-02)', () => {
    // area 20: X > 0 is under the explored overlays, X < 0 is parchment
    expect(at(sc, -2, 400, -600)).toEqual([...ZONE_COLOUR]);
    expect(at(sc, -2, -400, -600)).not.toEqual([...ZONE_COLOUR]);
  });

  it('fills kept land no painting shows with the area tint (relief grey at the median: unshaded)', () => {
    // area 20 has no zone painting: its tint comes from the continent painting's mean colour there
    const tint = built().facts.areaTints.get(1)?.get(20);
    expect(tint?.from).toBe(5000);
    const expected = (tint?.rgb ?? [0, 0, 0]).map(Math.round);
    expect(at(sc, -2, -400, -500)).toEqual(expected);
    expect(expected).not.toEqual(neutral);
    // the zone's own area takes the zone painting's mean colour
    expect(built().facts.areaTints.get(1)?.get(10)?.from).toBe(5001);
  });

  it('shades the tint by the relief: brighter relief, brighter tint, within the clamp', () => {
    // relief grey 100 west of X = −400, 200 east of it (the median lies between)
    const sh = scene({ grey: (X) => (X < -400 ? 100 : 200) });
    const dark = at(sh, -2, -600, -500);
    const light = at(sh, -2, -200, -500);
    for (let c = 0; c < 3; c += 1) expect(light[c]).toBeGreaterThan(dark[c] ?? 0);
    const flat = at(sc, -2, -400, -500);
    for (let c = 0; c < 3; c += 1) {
      expect(dark[c]).toBeGreaterThanOrEqual(Math.round((flat[c] ?? 0) * ATLAS_PARAMS.reliefClamp[0]) - 1);
      expect(light[c]).toBeLessThanOrEqual(Math.round((flat[c] ?? 0) * ATLAS_PARAMS.reliefClamp[1]) + 1);
    }
  });

  it('drops land the continent painting shows as sea and no own painting frames (the land test)', () => {
    const px = at(sc, -2, -400, -1100);
    expect(px).not.toEqual(at(sc, -2, -400, -500));
    expect(built().facts.dropped.get(1)?.get(20)).toBeGreaterThan(0);
    expect(built().facts.dropped.get(1)?.get(10)).toBeUndefined();
    // drawn as sea: between the coastal and the deep colour, as the sea is near kept land
    for (let c = 0; c < 3; c += 1) {
      expect(px[c]).toBeLessThanOrEqual(Math.max(SEA_COAST[c] ?? 0, SEA_DEEP[c] ?? 0));
      expect(px[c]).toBeGreaterThanOrEqual(Math.min(SEA_COAST[c] ?? 0, SEA_DEEP[c] ?? 0));
    }
  });

  it('paints the sea from coastal water to the deep colour by distance from kept land', () => {
    expect(seaColour(sc, 0)).toEqual([...SEA_COAST]);
    expect(seaColour(sc, 5000)).toEqual([...SEA_DEEP]);
    const mid = seaColour(sc, 600);
    for (let c = 0; c < 3; c += 1) expect(mid[c]).toBeCloseTo(((SEA_COAST[c] ?? 0) + (SEA_DEEP[c] ?? 0)) / 2, 6);
    // map 0 is all sea, far from any land: the deep colour exactly
    const { out } = composeWindow(sc, -2, 1750, 250, 1, 1, null, null);
    expect([...out]).toEqual([...SEA_DEEP]);
  });

  it('fades a painting out over the sea within its coastal band', () => {
    // 100 yd off the island's north coast, under painted ground: mostly the painting
    const near = at(sc, -2, 900, 0);
    // 400 yd off: past the band, sea
    const far = at(sc, -2, 1200, 0);
    expect(Math.abs((near[0] ?? 0) - ZONE_COLOUR[0])).toBeLessThan(Math.abs((far[0] ?? 0) - ZONE_COLOUR[0]));
    expect(far).not.toEqual([...ZONE_COLOUR]);
  });

  it('draws the inset card as the whole painting', () => {
    const { out } = composeWindow(sc, -2, (4096 + 500) / 4, (3072 + 300) / 4, 1, 1, null, null);
    expect([...out]).toEqual([...CARD_COLOUR]);
  });

  it('counts the coverage census on the 16-yd lattice', () => {
    const census: CoverageCensus = { byMap: new Map(), byArea: new Map() };
    const m = sc.maps.find((x) => x.mapId === 1);
    if (m === undefined) throw new Error('map 1');
    composeWindow(sc, -2, 0, 0, 1024, 700, census, null);
    const c = census.byMap.get(1) ?? emptyCounts();
    expect(c.land).toBeGreaterThan(0);
    expect(c.own + c.neighbour + c.tint + c.dropped).toBe(c.land);
    expect(c.own).toBeGreaterThan(0);
    expect(c.neighbour).toBeGreaterThan(0);
    expect(c.tint).toBeGreaterThan(0);
    expect(c.dropped).toBeGreaterThan(0);
    expect(census.byArea.get('1:20')?.dropped).toBe(c.dropped);
  });

  it('gives the same bytes whatever the window partition', () => {
    const whole = composeWindow(sc, -2, 480, 300, 64, 32, null, null).out;
    const parts = [composeWindow(sc, -2, 480, 300, 32, 32, null, null).out, composeWindow(sc, -2, 512, 300, 32, 32, null, null).out];
    for (let j = 0; j < 32; j += 1) {
      expect([...whole.subarray(j * 64 * 3, j * 64 * 3 + 96)]).toEqual([...(parts[0] ?? new Uint8Array()).subarray(j * 96, (j + 1) * 96)]);
      expect([...whole.subarray(j * 64 * 3 + 96, (j + 1) * 64 * 3)]).toEqual([...(parts[1] ?? new Uint8Array()).subarray(j * 96, (j + 1) * 96)]);
    }
  });
});

describe('the label rules (§6.5)', () => {
  // A white label straddling the border of areas 10 and 20 over parchment: source u 480-520
  // (world Y 84 … −76), v 400-420 (world X −264 … −344).
  const straddling = flatRaster(ZONE_COLOUR, [{ box: [480, 400, 520, 420], colour: LABEL_COLOUR }]);
  // A white label inside the zone's own polygon: u 300-340, v 250-260 (X 336 … 296, Y 804 … 644).
  const inside = flatRaster(ZONE_COLOUR, [{ box: [300, 250, 340, 260], colour: LABEL_COLOUR }]);

  it('draws a label listed whole across its painting\'s polygon edge, and cuts it without the rule', () => {
    const X = -304;
    const Y = -38;
    expect(at(scene({ zone: straddling }), -2, X, Y)).not.toEqual([...LABEL_COLOUR]);
    expect(at(scene({ zone: straddling, labels: [{ uiMapId: 5001, box: [480, 400, 520, 420], rule: 'whole', levels: 'all' }] }), -2, X, Y)).toEqual([...LABEL_COLOUR]);
  });

  it('hides a listed label by a mirror fill from the painting\'s own rows, at every level', () => {
    const rule: LabelRuleInput = { uiMapId: 5001, box: [300, 250, 340, 260], rule: 'hide', levels: 'all' };
    expect(at(scene({ zone: inside }), -2, 316, 724)).toEqual([...LABEL_COLOUR]);
    expect(at(scene({ zone: inside, labels: [rule] }), -2, 316, 724)).toEqual([...ZONE_COLOUR]);
  });

  it('hides a capital banner at levels −1 and 0 only', () => {
    const sc = scene({ zone: inside, labels: [{ uiMapId: 5001, box: [300, 250, 340, 260], rule: 'hide', levels: 'fine' }] });
    expect(at(sc, -2, 316, 724)).toEqual([...LABEL_COLOUR]);
    expect(at(sc, -1, 316, 724)).toEqual([...ZONE_COLOUR]);
  });
});

describe('the fine levels (§6.4)', () => {
  it('outside the fine sources a recomposed tile equals its nearest stored ancestor', () => {
    const sc = scene();
    const ancestor = [11, 22, 33];
    const { out } = composeWindow(sc, -1, 900, 700, 4, 4, null, (_i, _j, col) => {
      col[0] = ancestor[0] ?? 0;
      col[1] = ancestor[1] ?? 0;
      col[2] = ancestor[2] ?? 0;
    });
    for (let q = 0; q < 16; q += 1) expect([...out.subarray(q * 3, q * 3 + 3)]).toEqual(ancestor);
  });
});
