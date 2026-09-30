import { describe, expect, it } from 'vitest';
import { jsonOf, readDirectory } from '../../tests/support/fake-fetch';
import { worldMapId, type WorldMapId } from '../domain/ids';
import {
  ATLAS_CANONICAL_FORMAT,
  atlasHash,
  atlasLayoutProblems,
  atlasPlacements,
  atlasRectOf,
  atlasToWorld,
  canonicalAtlasString,
  partition,
  placementOf,
  resolveAtlasPoint,
  worldToAtlas,
  type AtlasPlacement,
} from './atlas';
import { ATLAS_LAYOUT, ATLAS_LAYOUT_947, ATLAS_LAYOUT_COMPACT, type AtlasLayout, type AtlasRect } from './atlas-layout';
import { createMapGeometry, parseGeometryFile } from './geometry';
import { AZEROTH, EASTERN_KINGDOMS, FIXTURE_MAPS, fixtureGeometry, KALIMDOR, ZEPHRAS_ISLE } from './test-fixtures';
import type { MapGeometry, UiMapGeometry } from './types';

/*
 * The atlas layout and placements (docs/research/map-atlas.md §5, §8.1, §11 ATL.2; D-042).
 * The 947 rows and the Zephras Isle row are the committed DB2 rows at 1.60.1.70009 (the geo
 * fixtures cite them one by one, and the committed placeholder geometry is read too); the land
 * clearance and seam checks read the committed terrain coastline (public/maps/terrain, D-032).
 */

const MAP_KALIMDOR = worldMapId(1);
const MAP_EK = worldMapId(0);
const MAP_ZEPHRAS = worldMapId(2991);
const LAYOUTS: readonly AtlasLayout[] = [ATLAS_LAYOUT_COMPACT, ATLAS_LAYOUT_947];

function placementsOf(layout: AtlasLayout, geometry: MapGeometry = fixtureGeometry()): readonly AtlasPlacement[] {
  const placements = atlasPlacements(geometry, layout);
  if (placements === null) throw new Error(`no placements: ${atlasLayoutProblems(geometry, layout).join('; ')}`);
  return placements;
}

function placed(placements: readonly AtlasPlacement[], mapId: WorldMapId): AtlasPlacement {
  const placement = placementOf(placements, mapId);
  if (placement === null) throw new Error(`map ${String(mapId)} is not placed`);
  return placement;
}

const offsets = (placements: readonly AtlasPlacement[]) => placements.map((p) => ({ mapId: p.mapId, kind: p.kind, eOff: p.eOff, sOff: p.sOff }));

function committedGeometry(): MapGeometry {
  const site = readDirectory('public/maps/placeholder', 'maps/placeholder/');
  const parsed = parseGeometryFile(jsonOf(site, 'maps/placeholder/geometry.placeholder.json'));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
}

/** The app's pick rounding (src/app/map-controller.ts `pickedPoint`): 0.1 yd, with −0 folded to 0. */
const roundPick = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
};

/** Park–Miller minimal standard generator: pure arithmetic, exact in doubles, repeatable. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

/** Uniform points in a world rectangle, generated from `seed`. */
function pointsIn(rect: AtlasPlacement['rect'], count: number, seed: number): readonly (readonly [number, number])[] {
  const next = seeded(seed);
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < count; i += 1) out.push([rect.xMin + next() * (rect.xMax - rect.xMin), rect.yMin + next() * (rect.yMax - rect.yMin)]);
  return out;
}

describe('ATLAS_LAYOUT (D-042 O9, A1)', () => {
  it('is the compact layout', () => {
    expect(ATLAS_LAYOUT).toBe(ATLAS_LAYOUT_COMPACT);
    expect(ATLAS_LAYOUT.name).toBe('compact');
  });

  it('moves maps only by whole 1,024-yd tiles and puts one map on each side of the seam', () => {
    for (const layout of LAYOUTS) {
      for (const spec of layout.placed) {
        expect(Number.isInteger(spec.shift.e / 1024) && Number.isInteger(spec.shift.s / 1024), `${layout.name} map ${String(spec.mapId)}`).toBe(true);
      }
      expect(layout.placed.map((spec) => spec.side).sort()).toEqual(['east', 'west']);
      expect(layout.worldMap.scaleMapId).toBe(MAP_KALIMDOR);
      expect([layout.extent.eMin, layout.extent.sMin]).toEqual([0, 0]);
    }
    // The compact layout moves the Eastern Kingdoms a further 7,168 yd west (7 level −2 tiles).
    const [kalimdor, ek] = ATLAS_LAYOUT_COMPACT.placed;
    expect([kalimdor?.shift, ek?.shift]).toEqual([
      { e: -3072, s: -2048 },
      { e: -3072 - 7168, s: -2048 },
    ]);
  });
});

describe('atlasPlacements (map-atlas.md §5.2, §5.5)', () => {
  it('places the compact layout: Kalimdor, the Eastern Kingdoms and the Zephras Isle card', () => {
    const placements = placementsOf(ATLAS_LAYOUT_COMPACT);
    expect(offsets(placements)).toEqual([
      { mapId: MAP_KALIMDOR, kind: 'placed', eOff: 5652, sOff: 12778 },
      { mapId: MAP_EK, kind: 'placed', eOff: 22499, sOff: 7907 },
      { mapId: MAP_ZEPHRAS, kind: 'inset', eOff: 17671.25, sOff: 5468.25 },
    ]);
    for (const placement of placements) expect(placement.scale).toBe(1);
    expect(placements.map((p) => [p.source.kind, p.source.uiMapId, p.source.row, p.source.build])).toEqual([
      ['placed', 947, 46785, '1.60.1.70009'],
      ['placed', 947, 46784, '1.60.1.70009'],
      ['inset', 2521, 69208, '1.60.1.70009'],
    ]);
    const kalimdor = placed(placements, MAP_KALIMDOR);
    expect(kalimdor.source.kind === 'placed' && kalimdor.source.layoutShift).toEqual({ e: -3072, s: -2048 });
    // The rectangles are the rows' own.
    expect(kalimdor.rect).toEqual({ mapId: MAP_KALIMDOR, xMin: -12800, xMax: 12266.700195312, yMin: -9600, yMax: 6933.2998046875 });
    expect(placed(placements, MAP_ZEPHRAS).rect).toEqual({ mapId: MAP_ZEPHRAS, xMin: 1247.9169921875, xMax: 4956.25, yMin: -1331.25, yMax: 4231.25 });
    const zephras = placed(placements, MAP_ZEPHRAS);
    expect(zephras.source.kind === 'inset' && zephras.source.reason).toMatch(/no UiMapAssignment row for MapID 2991.*UiMapLink has 0 records \(build 1\.60\.1\.70009\)/);
  });

  it("places the 947 layout at the rows' own translation", () => {
    expect(offsets(placementsOf(ATLAS_LAYOUT_947))).toEqual([
      { mapId: MAP_KALIMDOR, kind: 'placed', eOff: 8724, sOff: 14826 },
      { mapId: MAP_EK, kind: 'placed', eOff: 32739, sOff: 9955 },
      { mapId: MAP_ZEPHRAS, kind: 'inset', eOff: 5255.25, sOff: 35676.25 },
    ]);
  });

  it('differs between the layouts by the shifts alone, so every level holds the same pixels (§5.2)', () => {
    const compact = placementsOf(ATLAS_LAYOUT_COMPACT);
    const game = placementsOf(ATLAS_LAYOUT_947);
    for (const spec of ATLAS_LAYOUT_COMPACT.placed) {
      const a = placed(compact, spec.mapId);
      const b = placed(game, spec.mapId);
      expect([a.eOff - b.eOff, a.sOff - b.sOff]).toEqual([spec.shift.e, spec.shift.s]);
    }
  });

  it("puts the card's north-west corner at the layout's corner, inside the extent", () => {
    const card = atlasRectOf(placed(placementsOf(ATLAS_LAYOUT_COMPACT), MAP_ZEPHRAS));
    expect([card.eMin, card.eMax, card.sMin]).toEqual([13440, 19002.5, 512]);
    expect(card.sMax).toBeCloseTo(4220.333, 3);
    const gameCard = atlasRectOf(placed(placementsOf(ATLAS_LAYOUT_947), MAP_ZEPHRAS));
    expect([gameCard.eMin, gameCard.eMax, gameCard.sMin]).toEqual([1024, 6586.5, 30720]);
    expect(gameCard.sMax).toBeCloseTo(34428.333, 3);
    for (const [layout, rect] of [
      [ATLAS_LAYOUT_COMPACT, card],
      [ATLAS_LAYOUT_947, gameCard],
    ] as const) {
      expect(rect.eMin >= layout.extent.eMin && rect.eMax <= layout.extent.eMax && rect.sMin >= layout.extent.sMin && rect.sMax <= layout.extent.sMax).toBe(true);
    }
  });

  it('reads the committed placeholder geometry exactly as the cited fixture rows', () => {
    const committed = committedGeometry();
    for (const layout of LAYOUTS) {
      expect(atlasPlacements(committed, layout)).toEqual(atlasPlacements(fixtureGeometry(), layout));
      expect(atlasHash(placementsOf(layout, committed), layout)).toBe(atlasHash(placementsOf(layout), layout));
    }
  });

  it('is null without both 947 rows, without the inset row, or when 947 comes to place the inset map', () => {
    const without = (id: number): readonly UiMapGeometry[] => FIXTURE_MAPS.filter((map) => map.uiMapId !== id);
    const withAzeroth = (rows: UiMapGeometry['assignments']): readonly UiMapGeometry[] => [...without(947), { ...AZEROTH, assignments: rows }];
    const [kalimdorRow, ekRow] = AZEROTH.assignments;
    if (kalimdorRow === undefined || ekRow === undefined) throw new Error('fixture');
    const cases: readonly (readonly [string, readonly UiMapGeometry[], RegExp])[] = [
      ['no UiMap 947', without(947), /UiMap 947 has 0 rows for world map 1.*UiMap 947 has 0 rows for world map 0/],
      ['only the Kalimdor row', withAzeroth([kalimdorRow]), /UiMap 947 has 0 rows for world map 0/],
      ['only the Eastern Kingdoms row', withAzeroth([ekRow]), /UiMap 947 has 0 rows for world map 1/],
      ['two Kalimdor rows', withAzeroth([kalimdorRow, ekRow, { ...kalimdorRow, id: 99999, orderIndex: 2 }]), /UiMap 947 has 2 rows for world map 1/],
      ['no Zephras Isle row', without(2521), /UiMap 2521 has no row 69208/],
      ['947 places Zephras Isle', withAzeroth([kalimdorRow, ekRow, { ...kalimdorRow, id: 99999, orderIndex: 2, mapId: MAP_ZEPHRAS }]), /now places world map 2991.*stale/],
    ];
    for (const [name, maps, problem] of cases) {
      const geometry = createMapGeometry({ kind: 'placeholder', product: 'wow_classic_beta', recordedFrameHash: null, maps, eraToForever: [] });
      expect(atlasPlacements(geometry, ATLAS_LAYOUT), name).toBeNull();
      expect(atlasLayoutProblems(geometry, ATLAS_LAYOUT).join('; '), name).toMatch(problem);
    }
    // The continent and zone rows alone never stand in for 947.
    const continentsOnly = createMapGeometry({ kind: 'placeholder', product: 'wow_classic_beta', recordedFrameHash: null, maps: [KALIMDOR, EASTERN_KINGDOMS, ZEPHRAS_ISLE], eraToForever: [] });
    expect(atlasPlacements(continentsOnly, ATLAS_LAYOUT)).toBeNull();
    expect(atlasLayoutProblems(fixtureGeometry(), ATLAS_LAYOUT)).toEqual([]);
  });
});

describe('atlas transforms (map-atlas.md §5.4, MA-08)', () => {
  const COUNT = 10_000;

  it('round-trips 10,000 seeded points per placement within 10⁻⁹ yd, and exactly after the 0.1-yd pick rounding', () => {
    for (const layout of LAYOUTS) {
      for (const [index, placement] of placementsOf(layout).entries()) {
        let worst = 0;
        let otherMap = 0;
        let notBitExact = 0;
        let roundedMismatches = 0;
        for (const [x, y] of pointsIn(placement.rect, COUNT, 20260927 + index)) {
          const atlas = worldToAtlas(placement, x, y);
          const back = atlasToWorld(placement, atlas.e, atlas.s);
          if (back.mapId !== placement.mapId) otherMap += 1;
          worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
          const px = roundPick(x);
          const py = roundPick(y);
          const picked = worldToAtlas(placement, px, py);
          const again = atlasToWorld(placement, picked.e, picked.s);
          if (again.x !== px || again.y !== py) notBitExact += 1;
          if (roundPick(again.x) !== px || roundPick(again.y) !== py) roundedMismatches += 1;
        }
        const where = `${layout.name} map ${String(placement.mapId)}`;
        expect(otherMap, where).toBe(0);
        expect(worst, where).toBeLessThanOrEqual(1e-9);
        expect(roundedMismatches, where).toBe(0);
        // 0.1-yd inputs are not bit-exact on their own (MEASURED: 54-81 % differ, .cache/map-atlas/revise/inverse.mjs);
        // the pick rounding is what makes them exact.
        expect(notBitExact, where).toBeGreaterThan(0);
      }
    }
  });

  it('round-trips whole yards bit for bit', () => {
    for (const layout of LAYOUTS) {
      for (const [index, placement] of placementsOf(layout).entries()) {
        for (const [x, y] of pointsIn(placement.rect, COUNT, 7 + index)) {
          const wx = Math.round(x);
          const wy = Math.round(y);
          const atlas = worldToAtlas(placement, wx, wy);
          const back = atlasToWorld(placement, atlas.e, atlas.s);
          if (back.x !== wx || back.y !== wy) expect.fail(`${layout.name} map ${String(placement.mapId)}: (${String(wx)}, ${String(wy)}) came back as (${String(back.x)}, ${String(back.y)})`);
        }
      }
    }
  });

  it('maps a world rectangle to its atlas rectangle, east and south growing', () => {
    const kalimdor = placed(placementsOf(ATLAS_LAYOUT_COMPACT), MAP_KALIMDOR);
    // North-west corner (xMax, yMax) is the rectangle's least E and least S.
    expect(worldToAtlas(kalimdor, kalimdor.rect.xMax, kalimdor.rect.yMax)).toEqual({ e: atlasRectOf(kalimdor).eMin, s: atlasRectOf(kalimdor).sMin });
    expect(atlasRectOf(kalimdor)).toEqual({ eMin: 5652 - 6933.2998046875, eMax: 5652 + 9600, sMin: 12778 - 12266.700195312, sMax: 12778 + 12800 });
  });
});

describe('partition (map-atlas.md §5.4; D-042 A5)', () => {
  it('gives the card to Zephras Isle, the west of the seam to Kalimdor and the east to the Eastern Kingdoms', () => {
    const placements = placementsOf(ATLAS_LAYOUT_COMPACT);
    const at = (e: number, s: number): number => partition(placements, ATLAS_LAYOUT_COMPACT, e, s);
    expect(ATLAS_LAYOUT_COMPACT.seamE).toBe(16617);
    expect(at(16221, 2366)).toBe(2991); // the card's centre
    expect([at(13440, 512), at(19002.5, 4220), at(13439.9, 512), at(19002.6, 512)]).toEqual([2991, 2991, 1, 0]); // edges belong to the card
    expect([at(16617, 10000), at(16617.1, 10000)]).toEqual([1, 0]);
    expect([at(-5000, -5000), at(50000, 50000), at(16000, 4221), at(17000, 4221)]).toEqual([1, 0, 1, 0]);
    expect(partition(placementsOf(ATLAS_LAYOUT_947), ATLAS_LAYOUT_947, 21532, 0)).toBe(1);
    expect(partition(placementsOf(ATLAS_LAYOUT_947), ATLAS_LAYOUT_947, 21533, 0)).toBe(0);
  });

  it('resolves an atlas point to a world point of the map it belongs to', () => {
    const placements = placementsOf(ATLAS_LAYOUT_COMPACT);
    // Razor Hill's flight master area, Durotar (world x 300, y -4700 on map 1).
    const durotar = worldToAtlas(placed(placements, MAP_KALIMDOR), 300, -4700);
    expect(resolveAtlasPoint(placements, ATLAS_LAYOUT_COMPACT, durotar.e, durotar.s)).toEqual({ mapId: MAP_KALIMDOR, x: 300, y: -4700 });
    const card = resolveAtlasPoint(placements, ATLAS_LAYOUT_COMPACT, 16221.25, 2366.25);
    expect(card).toEqual({ mapId: MAP_ZEPHRAS, x: 5468.25 - 2366.25, y: 17671.25 - 16221.25 });
    expect(resolveAtlasPoint([], ATLAS_LAYOUT_COMPACT, 0, 0)).toBeNull();
    expect(() => partition(placements, { ...ATLAS_LAYOUT_COMPACT, placed: [] }, 0, 0)).toThrow(/no west map/);
  });
});

// =============================================================================================
// Against the committed terrain coastline (D-032)

type Segment = readonly [e1: number, s1: number, e2: number, s2: number];

interface Coast {
  /** Every coast segment inside the map's placement rectangle, in atlas units. */
  readonly segments: readonly Segment[];
  /** Segments with one end inside the placement rectangle and one outside. */
  readonly crossings: number;
  /** The bounding box of the coast vertices inside the rectangle: the land's, since the coast bounds it there. */
  readonly box: AtlasRect;
}

function decodeCoast(mapId: 0 | 1): readonly (readonly (readonly [number, number])[])[] {
  const site = readDirectory(`public/maps/terrain/${String(mapId)}`, 'coast/');
  const json = jsonOf(site, 'coast/coast.json') as { readonly kind: string; readonly mapId: number; readonly arcs: readonly (readonly number[])[] };
  if (json.kind !== 'terrain-coast' || json.mapId !== mapId) throw new Error('not the coast file');
  // Delta-coded 1-yd integers: [x0, y0, dx1, dy1, …] (src/infra/maps/terrain.ts).
  return json.arcs.map((arc) => {
    const points: (readonly [number, number])[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < arc.length; i += 2) {
      x += arc[i] ?? 0;
      y += arc[i + 1] ?? 0;
      points.push([x, y]);
    }
    return points;
  });
}

const COAST_ARCS = new Map<number, ReturnType<typeof decodeCoast>>();
const coastArcs = (mapId: 0 | 1): ReturnType<typeof decodeCoast> => {
  const cached = COAST_ARCS.get(mapId);
  if (cached !== undefined) return cached;
  const arcs = decodeCoast(mapId);
  COAST_ARCS.set(mapId, arcs);
  return arcs;
};

function coastOf(placement: AtlasPlacement, mapId: 0 | 1): Coast {
  const { rect } = placement;
  const inside = ([x, y]: readonly [number, number]): boolean => x >= rect.xMin && x <= rect.xMax && y >= rect.yMin && y <= rect.yMax;
  const segments: Segment[] = [];
  let crossings = 0;
  let box = { eMin: Infinity, eMax: -Infinity, sMin: Infinity, sMax: -Infinity };
  for (const arc of coastArcs(mapId)) {
    for (const [i, point] of arc.entries()) {
      if (inside(point)) {
        const { e, s } = worldToAtlas(placement, point[0], point[1]);
        box = { eMin: Math.min(box.eMin, e), eMax: Math.max(box.eMax, e), sMin: Math.min(box.sMin, s), sMax: Math.max(box.sMax, s) };
      }
      const previous = i > 0 ? arc[i - 1] : undefined;
      if (previous === undefined) continue;
      if (inside(previous) !== inside(point)) crossings += 1;
      else if (inside(point)) {
        const a = worldToAtlas(placement, previous[0], previous[1]);
        const b = worldToAtlas(placement, point[0], point[1]);
        segments.push([a.e, a.s, b.e, b.s]);
      }
    }
  }
  return { segments, crossings, box };
}

/** The distance from a segment to a rectangle (0 when they meet). */
function segmentToRect([e1, s1, e2, s2]: Segment, r: AtlasRect): number {
  const inRect = (e: number, s: number): boolean => e >= r.eMin && e <= r.eMax && s >= r.sMin && s <= r.sMax;
  if (inRect(e1, s1) || inRect(e2, s2)) return 0;
  const pointToRect = (e: number, s: number): number => Math.hypot(Math.max(r.eMin - e, 0, e - r.eMax), Math.max(r.sMin - s, 0, s - r.sMax));
  const pointToSegment = (e: number, s: number): number => {
    const de = e2 - e1;
    const ds = s2 - s1;
    const length = de * de + ds * ds;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((e - e1) * de + (s - s1) * ds) / length));
    return Math.hypot(e1 + t * de - e, s1 + t * ds - s);
  };
  // A segment with both ends outside meets the rectangle only by crossing an edge (a collinear
  // overlap passes through a corner, which the corner distances below find). Otherwise the two are
  // disjoint convex sets, and the nearest pair has a segment end or a rectangle corner in it.
  const edges: readonly Segment[] = [
    [r.eMin, r.sMin, r.eMax, r.sMin],
    [r.eMax, r.sMin, r.eMax, r.sMax],
    [r.eMax, r.sMax, r.eMin, r.sMax],
    [r.eMin, r.sMax, r.eMin, r.sMin],
  ];
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (const [f1, g1, f2, g2] of edges) {
    const d1 = cross(f1, g1, f2, g2, e1, s1);
    const d2 = cross(f1, g1, f2, g2, e2, s2);
    const d3 = cross(e1, s1, e2, s2, f1, g1);
    const d4 = cross(e1, s1, e2, s2, f2, g2);
    if (d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0)) return 0;
  }
  return Math.min(pointToRect(e1, s1), pointToRect(e2, s2), pointToSegment(r.eMin, r.sMin), pointToSegment(r.eMax, r.sMin), pointToSegment(r.eMin, r.sMax), pointToSegment(r.eMax, r.sMax));
}

const containsRect = (outer: AtlasRect, inner: AtlasRect): boolean =>
  inner.eMin >= outer.eMin && inner.eMax <= outer.eMax && inner.sMin >= outer.sMin && inner.sMax <= outer.sMax;

describe('the layouts against the terrain coastline (map-atlas.md §5.2, §5.4, §5.5)', () => {
  it('keeps the Zephras Isle card at least 1,000 yd from every map’s land (MEASURED 1,529 yd on the relief)', () => {
    for (const layout of LAYOUTS) {
      const placements = placementsOf(layout);
      const card = atlasRectOf(placed(placements, MAP_ZEPHRAS));
      const centre = { e: (card.eMin + card.eMax) / 2, s: (card.sMin + card.sMax) / 2 };
      const clearance: number[] = [];
      for (const mapId of [1, 0] as const) {
        const coast = coastOf(placed(placements, worldMapId(mapId)), mapId);
        const where = `${layout.name} map ${String(mapId)}`;
        // The coast bounds all the land inside the placement's rectangle: no arc leaves it.
        expect(coast.crossings, where).toBe(0);
        // The card's centre is outside the land's bounding box, so it is sea; no coast within the
        // clearance means the whole card is.
        expect(!(centre.e >= coast.box.eMin && centre.e <= coast.box.eMax && centre.s >= coast.box.sMin && centre.s <= coast.box.sMax), where).toBe(true);
        let nearest = Infinity;
        for (const segment of coast.segments) nearest = Math.min(nearest, segmentToRect(segment, card));
        expect(nearest, where).toBeGreaterThanOrEqual(1000);
        clearance.push(Math.round(nearest));
      }
      if (layout === ATLAS_LAYOUT_COMPACT) {
        // The 4.2-yd coast agrees with the 16.7-yd relief measurement (1,897 and 1,529 yd) within a relief cell.
        expect(Math.abs((clearance[0] ?? 0) - 1897)).toBeLessThanOrEqual(17);
        expect(Math.abs((clearance[1] ?? 0) - 1529)).toBeLessThanOrEqual(17);
      }
    }
  });

  it('puts every coast point of each continent on its own side of the seam, inside the extent', () => {
    for (const layout of LAYOUTS) {
      const placements = placementsOf(layout);
      const boxes = new Map<number, AtlasRect>();
      for (const mapId of [1, 0] as const) {
        const placement = placed(placements, worldMapId(mapId));
        const coast = coastOf(placement, mapId);
        boxes.set(mapId, coast.box);
        expect(containsRect(layout.extent, coast.box), `${layout.name} map ${String(mapId)} land inside the extent`).toBe(true);
        let wrong = 0;
        for (const [e1, s1] of coast.segments) if (partition(placements, layout, e1, s1) !== placement.mapId) wrong += 1;
        expect(wrong, `${layout.name} map ${String(mapId)}`).toBe(0);
      }
      const west = boxes.get(1);
      const east = boxes.get(0);
      if (west === undefined || east === undefined) throw new Error('boxes');
      expect(west.eMax).toBeLessThan(layout.seamE);
      expect(east.eMin).toBeGreaterThan(layout.seamE);
      if (layout === ATLAS_LAYOUT_COMPACT) {
        // 0.39 Kalimdor widths of sea between the continents (§5.2: 4,880 yd on the relief).
        expect((east.eMin - west.eMax) / (west.eMax - west.eMin)).toBeCloseTo(0.39, 2);
        // The seam is midway, within the coast's 4.2-yd cells of the relief-measured land edges.
        expect(Math.abs((west.eMax + east.eMin) / 2 - layout.seamE)).toBeLessThanOrEqual(17);
      }
    }
  });
});

// =============================================================================================
// Identity

describe('atlasHash (map-atlas.md §7.2, §7.5 T4)', () => {
  it('is pinned for the committed geometry and ATLAS_LAYOUT', () => {
    const placements = placementsOf(ATLAS_LAYOUT, committedGeometry());
    expect(atlasHash(placements, ATLAS_LAYOUT)).toBe('748eef8d5584ac4e092fd5f625cdff76');
    expect(canonicalAtlasString(placements, ATLAS_LAYOUT)).toBe(
      JSON.stringify([
        ATLAS_CANONICAL_FORMAT,
        1,
        'compact',
        [0, 30720, 0, 26112],
        16617,
        [947, 1002, 668, 1],
        [
          [0, 'placed', 1, 22499, 7907, -16000, 6933.2998046875, -7466.7001953125, 8000, 947, 46784, '1.60.1.70009', -10240, -2048, 'east', null, null],
          [1, 'placed', 1, 5652, 12778, -12800, 12266.700195312, -9600, 6933.2998046875, 947, 46785, '1.60.1.70009', -3072, -2048, 'west', null, null],
          [2991, 'inset', 1, 17671.25, 5468.25, 1247.9169921875, 4956.25, -1331.25, 4231.25, 2521, 69208, '1.60.1.70009', null, null, null, 13440, 512],
        ],
      ]),
    );
  });

  it('is 32 hex digits, independent of placement order and free text, and changes with anything that places a pixel', () => {
    const placements = placementsOf(ATLAS_LAYOUT);
    const base = atlasHash(placements, ATLAS_LAYOUT);
    expect(base).toMatch(/^[0-9a-f]{32}$/);
    expect(atlasHash([...placements].reverse(), ATLAS_LAYOUT)).toBe(base);
    expect(atlasHash(placements, { ...ATLAS_LAYOUT, basis: 'other words' })).toBe(base);
    const [first, second, third] = placements;
    if (first === undefined || second === undefined || third === undefined) throw new Error('placements');
    const variants: readonly (readonly [string, string])[] = [
      ['the 947 layout', atlasHash(placementsOf(ATLAS_LAYOUT_947), ATLAS_LAYOUT_947)],
      ['eOff + 1', atlasHash([{ ...first, eOff: first.eOff + 1 }, second, third], ATLAS_LAYOUT)],
      ['sOff + 0.25', atlasHash([first, { ...second, sOff: second.sOff + 0.25 }, third], ATLAS_LAYOUT)],
      ['a row rectangle', atlasHash([first, second, { ...third, rect: { ...third.rect, xMin: third.rect.xMin + 0.001 } }], ATLAS_LAYOUT)],
      ['a row id', atlasHash([{ ...first, source: { ...first.source, row: 1 } }, second, third], ATLAS_LAYOUT)],
      ['a build', atlasHash([{ ...first, source: { ...first.source, build: '1.60.1.70010' } }, second, third], ATLAS_LAYOUT)],
      ['seamE', atlasHash(placements, { ...ATLAS_LAYOUT, seamE: 16618 })],
      ['the extent', atlasHash(placements, { ...ATLAS_LAYOUT, extent: { ...ATLAS_LAYOUT.extent, sMax: 26113 } })],
      ['the art size', atlasHash(placements, { ...ATLAS_LAYOUT, worldMap: { ...ATLAS_LAYOUT.worldMap, artWidth: 1001 } })],
      ['a dropped placement', atlasHash([first, second], ATLAS_LAYOUT)],
    ];
    const seen = new Set([base]);
    for (const [name, hash] of variants) {
      expect(hash, name).not.toBe(base);
      seen.add(hash);
    }
    expect(seen.size).toBe(variants.length + 1);
  });
});
