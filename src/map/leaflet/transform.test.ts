import { describe, expect, it } from 'vitest';
import type { UiMapId, WorldMapId } from '../../domain/ids';
import type { FrameDescriptor, WorldBounds } from '../adapter';
import {
  boundsToLatLngBounds,
  clipInset,
  connectorArc,
  connectorMidpoint,
  formatYards,
  IDENTITY,
  latLngBoundsMeet,
  latLngBoundsOnMap,
  latLngOnMap,
  latLngToAtlas,
  padLatLngBounds,
  placedLatLng,
  placedLatLngBounds,
  placementLatLngBounds,
  type LatLngBoundsPair,
  gridLabel,
  gridLinesIn,
  gridSpacingAt,
  gridValues,
  intersectBounds,
  latLngBoundsToWorld,
  latLngToWorld,
  minZoomFor,
  nativeZoom,
  nearestSegment,
  niceCeil,
  niceFloor,
  pointToLatLng,
  scaleBarAt,
  worldToLatLng,
  yardsPerPixel,
  zonesAt,
  zoomToFit,
} from './transform';

// map/leaflet may import only map/adapter values (ARCHITECTURE §4), so the tests brand ids themselves.
const uiMapId = (value: number): UiMapId => value as UiMapId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

const ONE = worldMapId(1);

describe('world ⇄ CRS.Simple lat/lng', () => {
  it('maps world (x north, y west) to lat = x, lng = -y', () => {
    expect(worldToLatLng(100, 200)).toEqual([100, -200]);
    // Gornek (coordinates.md §7.1): north is up, and a more westerly point (larger y) is further left.
    const [lat, lng] = worldToLatLng(-600.2991646363, -4186.4222239014);
    expect(lat).toBe(-600.2991646363);
    expect(lng).toBe(4186.4222239014);
    const west = worldToLatLng(0, 1000);
    const east = worldToLatLng(0, -1000);
    expect(west[1]).toBeLessThan(east[1]);
  });

  it('never produces -0', () => {
    expect(Object.is(worldToLatLng(0, 0)[1], 0)).toBe(true);
    expect(Object.is(latLngToWorld(0, 0, ONE).y, 0)).toBe(true);
  });

  it('round-trips exactly', () => {
    for (const [x, y] of [
      [0, 0],
      [-600.2991646363, -4186.4222239014],
      [12799.900390625, -19733.2109375],
      [1e-9, -1e9],
    ] as const) {
      const [lat, lng] = worldToLatLng(x, y);
      expect(latLngToWorld(lat, lng, ONE)).toEqual({ mapId: 1, x, y });
      expect(pointToLatLng({ x, y })).toEqual([lat, lng]);
    }
  });

  it('maps a world rectangle to [[south, west], [north, east]] and back', () => {
    // Durotar 1411 (QuestieDB conversion.json target_bounds at b6f5b07b).
    const durotar: WorldBounds = { mapId: ONE, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
    const [[south, west], [north, east]] = boundsToLatLngBounds(durotar);
    expect([south, west, north, east]).toEqual([-1716.6666259766, 1962.4998779297, 1808.3332519531, 7249.9995117188]);
    expect(south).toBeLessThan(north);
    expect(west).toBeLessThan(east);
    expect(latLngBoundsToWorld(south, west, north, east, ONE)).toEqual(durotar);
  });
});

describe('scale maths', () => {
  it('uses 2^zoom pixels per yard', () => {
    expect(yardsPerPixel(0)).toBe(1);
    expect(yardsPerPixel(-3)).toBe(8);
    expect(yardsPerPixel(1)).toBe(0.5);
  });

  it('computes the native zoom of an art image (MAPS §7.1)', () => {
    // Durotar: 1002 px across 5,287.5 yards of Y → about -2.40.
    expect(nativeZoom(1002, -1962.4998779297 + 7249.9995117188)).toBeCloseTo(-2.4, 2);
    // Kalimdor: 1002 px across 36,799.8 yards → about -5.20.
    expect(nativeZoom(1002, 17066.599609375 + 19733.2109375)).toBeCloseTo(-5.2, 2);
  });

  it('rounds to 1, 2 or 5 × 10^k', () => {
    expect([niceFloor(1), niceFloor(1.9), niceFloor(4.9), niceFloor(7), niceFloor(10), niceFloor(999), niceFloor(0.3)]).toEqual([
      1, 1, 2, 5, 10, 500, 0.2,
    ]);
    expect([niceCeil(1), niceCeil(1.1), niceCeil(3), niceCeil(6), niceCeil(150), niceCeil(100)]).toEqual([1, 2, 5, 10, 200, 100]);
    expect(niceFloor(Number.NaN)).toBeNull();
    expect(niceFloor(0)).toBeNull();
    expect(niceCeil(-1)).toBeNull();
    expect(niceCeil(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('builds a yard scale bar that fits', () => {
    // At zoom -3 a pixel is 8 yards: 120 px is 960 yards, so the bar shows 500 yards over 62.5 px.
    expect(scaleBarAt(-3, 120)).toEqual({ yards: 500, widthPx: 62.5, text: '500 yd' });
    expect(scaleBarAt(-6, 120)).toEqual({ yards: 5000, widthPx: 78.125, text: '5,000 yd' });
    expect(scaleBarAt(2, 120)?.yards).toBe(20);
    expect(scaleBarAt(Number.NaN, 120)).toBeNull();
  });

  it('formats yards with fixed separators', () => {
    expect(formatYards(12500)).toBe('12,500 yd');
    expect(formatYards(999.6)).toBe('1,000 yd');
    expect(formatYards(-50)).toBe('-50 yd');
  });
});

describe('grid', () => {
  it('spaces lines at least the requested pixels apart', () => {
    // zoom -3: 8 yd per px; 96 px → 768 yd → 1,000 yd lines.
    expect(gridSpacingAt(-3, 96)).toBe(1000);
    expect(gridSpacingAt(0, 96)).toBe(100);
  });

  it('lists multiples of the spacing inside a range', () => {
    expect(gridValues(-250, 1000, 500)).toEqual([0, 500, 1000]);
    expect(gridValues(-1000, -1, 500)).toEqual([-1000, -500]);
    expect(Object.is(gridValues(-1, 1, 1)[1], 0)).toBe(true);
    expect(gridValues(0, 1e9, 1)).toEqual([]); // over the limit: refuse rather than hang
    expect(gridValues(5, 1, 1)).toEqual([]);
    expect(gridValues(0, 1, 0)).toEqual([]);
  });

  it('clips to the surface extent', () => {
    const visible: WorldBounds = { mapId: ONE, xMin: -2000, xMax: 2000, yMin: -2000, yMax: 2000 };
    const extent: WorldBounds = { mapId: ONE, xMin: 0, xMax: 5000, yMin: -500, yMax: 500 };
    const lines = gridLinesIn(visible, extent, 1000);
    expect(lines?.area).toEqual({ mapId: ONE, xMin: 0, xMax: 2000, yMin: -500, yMax: 500 });
    expect(lines?.xs).toEqual([0, 1000, 2000]);
    expect(lines?.ys).toEqual([0]);
    expect(gridLinesIn(visible, { ...extent, xMin: 3000 }, 1000)).toBeNull();
    expect(gridLinesIn(visible, null, 1000)?.xs).toEqual([-2000, -1000, 0, 1000, 2000]);
    expect(intersectBounds(visible, { ...extent, mapId: worldMapId(0) })).toBeNull();
  });
});

describe('grid labels (M3 review MAP-COORD-14)', () => {
  it('names the Blizzard axis, the value with a true minus sign, and the direction it grows', () => {
    expect(gridLabel('X', 500)).toBe('X 500 (N)');
    expect(gridLabel('Y', -4100)).toBe('Y \u22124100 (W)');
    expect(gridLabel('X', -0.2)).toBe('X 0 (N)');
    expect(gridLabel('Y', 12000.4)).toBe('Y 12000 (W)');
  });
});

describe('zoom limits (M3 review MAP-UX-7)', () => {
  // Kalimdor 1414 and the Eastern Kingdoms 1415 (UiMapAssignment at 1.60.1.70009).
  const KALIMDOR: WorldBounds = { mapId: ONE, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 };
  const EK: WorldBounds = { mapId: worldMapId(0), xMin: -16000, xMax: 7466.6000976562, yMin: -19199.900390625, yMax: 16000 };
  const limits = { paddingPx: 24, preferred: -6, floor: -7.5, snap: 0.25 };

  it('finds the zoom at which bounds just fit a view', () => {
    // 36,800 yd across 752 px: 2^z = 752 / 36,800.
    expect(zoomToFit(KALIMDOR, 800, 600, 24)).toBeCloseTo(Math.log2(752 / 36799.810546875), 12);
    expect(zoomToFit(KALIMDOR, 40, 600, 24)).toBeNull();
    expect(zoomToFit({ ...KALIMDOR, yMax: KALIMDOR.yMin }, 800, 600, 24)).toBeNull();
  });

  it('keeps the preferred least zoom where the largest surface fits, and lowers it on a small stage down to the floor', () => {
    expect(minZoomFor([KALIMDOR, EK], 800, 600, limits)).toBe(-6);
    // 336 px across: log2(288 / 36,800) = -7.0 (snapped down to a quarter).
    expect(minZoomFor([KALIMDOR, EK], 336, 634, limits)).toBe(-7);
    expect(minZoomFor([KALIMDOR, EK], 424, 634, limits)).toBe(-6.75);
    expect(minZoomFor([KALIMDOR, EK], 120, 200, limits)).toBe(-7.5);
    // No usable size or extent: the preferred value.
    expect(minZoomFor([KALIMDOR], 0, 0, limits)).toBe(-6);
    expect(minZoomFor([], 336, 634, limits)).toBe(-6);
  });
});

describe('hit helpers', () => {
  it('finds the segment of a polyline nearest to a point', () => {
    const points = [
      { mapId: ONE, x: 0, y: 0 },
      { mapId: ONE, x: 100, y: 0 },
      { mapId: ONE, x: 100, y: 100 },
    ];
    expect(nearestSegment(points, { x: 50, y: 5 })).toBe(0);
    expect(nearestSegment(points, { x: 95, y: 60 })).toBe(1);
    expect(nearestSegment(points, { x: 100, y: 0 })).toBe(0); // a tie at the shared vertex goes to the lower index
    expect(nearestSegment(points.slice(0, 1), { x: 0, y: 0 })).toBeNull();
    const origin = { mapId: ONE, x: 0, y: 0 };
    expect(nearestSegment([origin, origin], { x: 3, y: 4 })).toBe(0);
  });

  it('lists the zone frames under a point, smallest first', () => {
    const frame = (id: number, b: Omit<WorldBounds, 'mapId'>, kind: FrameDescriptor['kind'] = 'zone'): FrameDescriptor => ({
      type: 'frame',
      id: `frame:${String(id)}`,
      bounds: { mapId: ONE, ...b },
      filled: true,
      kind,
      label: null,
      emphasis: 'normal',
      ref: kind === 'zone' ? { kind: 'zone', uiMapId: uiMapId(id) } : { kind: 'surface', mapId: ONE },
    });
    const frames = [
      frame(1411, { xMin: 0, xMax: 100, yMin: 0, yMax: 100 }),
      frame(1454, { xMin: 40, xMax: 60, yMin: 40, yMax: 60 }),
      frame(1413, { xMin: -100, xMax: 50, yMin: -100, yMax: 50 }),
      frame(0, { xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000 }, 'extent'),
    ];
    expect(zonesAt(frames, { mapId: ONE, x: 45, y: 45 })).toEqual([1454, 1411, 1413]);
    expect(zonesAt(frames, { mapId: ONE, x: 90, y: 90 })).toEqual([1411]);
    expect(zonesAt(frames, { mapId: worldMapId(0), x: 45, y: 45 })).toEqual([]);
  });
});

// =============================================================================================
// Through placements (docs/research/map-atlas.md §5.1, §5.4, §8.1; step ATL.3)

/**
 * The compact layout's placements (map-atlas.md §5.2; src/geo/atlas.test.ts pins them from the
 * committed rows): map/leaflet may import only map/adapter values, so they are written out here as
 * the plain data the adapter receives. Rectangles: UiMap 947 rows 46785 and 46784, and UiMap 2521
 * row 69208 (1.60.1.70009).
 */
const PLACEMENTS = [
  { mapId: worldMapId(1), eOff: 5652, sOff: 12778, rect: { mapId: worldMapId(1), xMin: -12800, xMax: 12266.700195312, yMin: -9600, yMax: 6933.2998046875 } },
  { mapId: worldMapId(0), eOff: 22499, sOff: 7907, rect: { mapId: worldMapId(0), xMin: -16000, xMax: 6933.2998046875, yMin: -7466.7001953125, yMax: 8000 } },
  { mapId: worldMapId(2991), eOff: 17671.25, sOff: 5468.25, rect: { mapId: worldMapId(2991), xMin: 1247.9169921875, xMax: 4956.25, yMin: -1331.25, yMax: 4231.25 } },
] as const;

/** The app's pick rounding (src/app/map-controller.ts `pickedPoint`): 0.1 yd, −0 folded to 0. */
const roundPick = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
};

/** Park–Miller minimal standard generator (as src/geo/atlas.test.ts): exact in doubles, repeatable. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

describe('the funnel through a placement (map-atlas.md §5.1, ATL.3)', () => {
  it('is exactly the world transform, −0 included, through the identity placement', () => {
    const values = [0, -0, 1, -1, 0.1, -600.2991646363, -4186.4222239014, 12799.900390625, -19733.2109375, Number.MAX_VALUE];
    for (const x of values) {
      for (const y of values) {
        const [lat, lng] = placedLatLng(IDENTITY, x, y);
        const [wLat, wLng] = worldToLatLng(x, y);
        expect(Object.is(lat, wLat) && Object.is(lng, wLng), `${String(x)}, ${String(y)}`).toBe(true);
        const back = latLngOnMap(IDENTITY, x, y, ONE);
        const world = latLngToWorld(x, y, ONE);
        expect(Object.is(back.x, world.x) && Object.is(back.y, world.y), `back ${String(x)}, ${String(y)}`).toBe(true);
      }
    }
    const bounds: WorldBounds = { mapId: ONE, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
    expect(placedLatLngBounds(IDENTITY, bounds)).toEqual(boundsToLatLngBounds(bounds));
    expect(latLngBoundsOnMap(IDENTITY, -3, -4, 5, 6, ONE)).toEqual(latLngBoundsToWorld(-3, -4, 5, 6, ONE));
  });

  it('draws a placed point at latLng = (−S, E), with S = sOff − x and E = eOff − y', () => {
    const [kalimdor] = PLACEMENTS;
    // Gornek in Durotar: E = 5652 + 4186.42…, S = 12778 + 600.29…
    const [lat, lng] = placedLatLng(kalimdor, -600.2991646363, -4186.4222239014);
    expect(lng).toBe(5652 - -4186.4222239014);
    expect(lat).toBe(0 - (12778 - -600.2991646363));
    expect(latLngToAtlas(lat, lng)).toEqual({ e: 5652 - -4186.4222239014, s: 12778 - -600.2991646363 });
  });

  it('round-trips 10,000 seeded points per placement within 10⁻⁹ yd, exactly after the 0.1-yd pick rounding, and whole yards bit for bit', () => {
    for (const [index, placement] of PLACEMENTS.entries()) {
      const next = seeded(20260927 + index);
      let worst = 0;
      let rounded = 0;
      let whole = 0;
      for (let i = 0; i < 10_000; i += 1) {
        const x = placement.rect.xMin + next() * (placement.rect.xMax - placement.rect.xMin);
        const y = placement.rect.yMin + next() * (placement.rect.yMax - placement.rect.yMin);
        const [lat, lng] = placedLatLng(placement, x, y);
        const back = latLngOnMap(placement, lat, lng, placement.mapId);
        worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
        const [pLat, pLng] = placedLatLng(placement, roundPick(x), roundPick(y));
        const picked = latLngOnMap(placement, pLat, pLng, placement.mapId);
        if (roundPick(picked.x) !== roundPick(x) || roundPick(picked.y) !== roundPick(y)) rounded += 1;
        const [wLat, wLng] = placedLatLng(placement, Math.round(x), Math.round(y));
        const again = latLngOnMap(placement, wLat, wLng, placement.mapId);
        if (again.x !== Math.round(x) || again.y !== Math.round(y)) whole += 1;
      }
      const where = `map ${String(placement.mapId)}`;
      expect(worst, where).toBeLessThanOrEqual(1e-9);
      expect(rounded, where).toBe(0);
      expect(whole, where).toBe(0);
    }
  });

  it('computes the inverse as src/geo/atlas.ts does, x = sOff − S and y = eOff − E, bit for bit', () => {
    for (const placement of PLACEMENTS) {
      const next = seeded(99 + placement.mapId);
      for (let i = 0; i < 1000; i += 1) {
        const lat = 0 - next() * 30000;
        const lng = next() * 30000;
        const s = 0 - lat;
        const back = latLngOnMap(placement, lat, lng, placement.mapId);
        expect(back.x).toBe(placement.sOff - s);
        expect(back.y).toBe(placement.eOff - lng);
      }
    }
  });

  it('places each map’s rectangle where the layout puts it, and pads and meets rectangles as Leaflet does', () => {
    const [kalimdor, ek, zephras] = PLACEMENTS;
    // Kalimdor's 947 row: E −1,281.3…15,252, S 511.3…25,578; the card E 13,440–19,002.5, S 512–4,220.3.
    const k = placementLatLngBounds(kalimdor);
    expect(k[0]).toEqual([-25578, 5652 - 6933.2998046875]);
    expect(k[1]).toEqual([12266.700195312 - 12778, 15252]);
    expect(placementLatLngBounds(zephras)).toEqual([
      [1247.9169921875 - 5468.25, 13440],
      [-512, 19002.5],
    ]);
    expect(latLngBoundsMeet(placementLatLngBounds(kalimdor), placementLatLngBounds(ek))).toBe(true);
    const view: LatLngBoundsPair = [
      [-14000, 7000],
      [-12000, 9000],
    ];
    expect(latLngBoundsMeet(view, placementLatLngBounds(zephras))).toBe(false);
    expect(padLatLngBounds(view, 0.5)).toEqual([
      [-15000, 6000],
      [-11000, 10000],
    ]);
  });
});

describe('connector arcs (map-atlas.md §8.5)', () => {
  it('bulges 12 % of the chord to the left of travel at mid-arc, its ends exact', () => {
    const from: readonly [number, number] = [0, 0];
    const to: readonly [number, number] = [0, 1000];
    const arc = connectorArc(from, to);
    expect(arc).toHaveLength(25);
    expect(arc[0]).toBe(from);
    expect(arc[24]).toBe(to);
    // Travelling east (lng growing), left is north (lat growing): the apex is 120 yd north of the chord.
    expect(arc[12]?.[0]).toBeCloseTo(120, 9);
    expect(arc[12]?.[1]).toBeCloseTo(500, 9);
    expect(connectorMidpoint(from, to)).toEqual([120, 500]);
    // Travelling west, the arc bulges south.
    expect(connectorMidpoint(to, from)).toEqual([-120, 500]);
  });
});

describe('clipInset (interim art clipped to its side of the partition)', () => {
  const image: WorldBounds = { mapId: ONE, xMin: -100, xMax: 100, yMin: -200, yMax: 200 };

  it('gives the cut on each side as fractions of the image, east on the right', () => {
    // Keep y ≥ −100 (the west three quarters): a quarter is cut from the east (right).
    expect(clipInset(image, { ...image, yMin: -100 })).toEqual({ top: 0, right: 0.25, bottom: 0, left: 0 });
    expect(clipInset(image, { ...image, yMax: 100, xMax: 50 })).toEqual({ top: 0.25, right: 0, bottom: 0, left: 0.25 });
  });

  it('is null for no cut, another map or an empty image; a clip that misses cuts everything', () => {
    expect(clipInset(image, image)).toBeNull();
    expect(clipInset(image, { ...image, mapId: worldMapId(0), yMin: 0 })).toBeNull();
    expect(clipInset({ ...image, xMax: -100 }, image)).toBeNull();
    expect(clipInset(image, { ...image, yMin: 500, yMax: 600 })).toEqual({ top: 0, right: 1, bottom: 0, left: 0 });
  });
});
