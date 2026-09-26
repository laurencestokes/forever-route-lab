import { describe, expect, it } from 'vitest';
import { stepId, uiMapId, worldMapId } from '../domain/ids';
import {
  boundsCenter,
  boundsContain,
  boundsOfPoints,
  combineLabels,
  descriptorMapId,
  emptyLayerContent,
  isLayerId,
  LAYER_IDS,
  LAYER_LABELS,
  labelOf,
  mapViewOf,
  MAX_POLYLINE_VERTICES,
  parseSurfaceId,
  refsOf,
  SPAWN_LAYER_IDS,
  surfaceIdOf,
  surfaceMapId,
  type MapDescriptor,
  type MapRef,
  type MarkerDescriptor,
  type WorldBounds,
} from './adapter';

const ONE = worldMapId(1);

describe('surface ids', () => {
  it('formats and parses world:<mapId>', () => {
    expect(surfaceIdOf(worldMapId(0))).toBe('world:0');
    expect(surfaceIdOf(worldMapId(2991))).toBe('world:2991');
    expect(parseSurfaceId('world:1')).toBe(1);
    expect(parseSurfaceId('world:2997')).toBe(2997);
    expect(surfaceMapId('world:0')).toBe(0);
  });

  it('refuses anything but a canonical non-negative integer', () => {
    for (const text of ['world:', 'world:-1', 'world:1.5', 'world:01', 'world:1e3', 'ui:947', ' world:1', 'world:1 ']) {
      expect(parseSurfaceId(text), text).toBeNull();
    }
    expect(() => surfaceMapId('world:1.5')).toThrow(RangeError);
  });
});

describe('world bounds', () => {
  const b: WorldBounds = { mapId: ONE, xMin: -10, xMax: 10, yMin: -20, yMax: 20 };

  it('contains points on its map, edges included', () => {
    expect(boundsContain(b, { mapId: ONE, x: 10, y: -20 })).toBe(true);
    expect(boundsContain(b, { mapId: ONE, x: 10.001, y: 0 })).toBe(false);
    expect(boundsContain(b, { mapId: worldMapId(0), x: 0, y: 0 })).toBe(false);
  });

  it('has a centre', () => {
    expect(boundsCenter(b)).toEqual({ mapId: ONE, x: 0, y: 0 });
  });

  it('bounds points on one map and ignores the others', () => {
    const points = [
      { mapId: ONE, x: 1, y: 5 },
      { mapId: worldMapId(0), x: 1000, y: 1000 },
      { mapId: ONE, x: -3, y: 2 },
    ];
    expect(boundsOfPoints(ONE, points)).toEqual({ mapId: ONE, xMin: -3, xMax: 1, yMin: 2, yMax: 5 });
    expect(boundsOfPoints(worldMapId(2991), points)).toBeNull();
  });
});

describe('layers', () => {
  it('lists every layer once, art at the bottom and selection on top', () => {
    expect(new Set(LAYER_IDS).size).toBe(LAYER_IDS.length);
    expect(LAYER_IDS[0]).toBe('art');
    expect(LAYER_IDS[LAYER_IDS.length - 1]).toBe('selection');
    // Spawn layers sit below the route, so route markers win hit-testing.
    for (const spawn of SPAWN_LAYER_IDS) expect(LAYER_IDS.indexOf(spawn)).toBeLessThan(LAYER_IDS.indexOf('route-line'));
    expect(Object.keys(LAYER_LABELS).sort()).toEqual([...LAYER_IDS].sort());
    expect(isLayerId('route-steps')).toBe(true);
    expect(isLayerId('route')).toBe(false);
  });

  it('shares one items array between empty contents, so repeated clears are skipped by reference', () => {
    const a = emptyLayerContent('route-line');
    const b = emptyLayerContent('objectives');
    expect(a.items).toBe(b.items);
    expect(a.items).toEqual([]);
    expect(a.stats.drawn).toBe(0);
    expect(b.layer).toBe('objectives');
  });
});

describe('descriptorMapId', () => {
  const ref = { kind: 'step', stepId: stepId('s1') } as const;
  it('reads the world map of every descriptor type', () => {
    const bounds: WorldBounds = { mapId: worldMapId(2991), xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const descriptors: readonly MapDescriptor[] = [
      {
        type: 'marker',
        id: 'm',
        point: { mapId: ONE, x: 0, y: 0 },
        kind: 'step',
        style: 'accent',
        emphasis: 'normal',
        label: null,
        badges: [],
        ref,
        count: 1,
        refs: [ref],
        labels: [null],
      },
      { type: 'polyline', id: 'p', mapId: worldMapId(0), points: [], style: 'route', emphasis: 'normal', label: null, ref },
      { type: 'frame', id: 'f', bounds, kind: 'zone', label: null, emphasis: 'normal', ref },
      { type: 'art', id: 'a', bounds, url: 'x.webp', opacity: 1, label: null, ref },
      {
        type: 'aggregate',
        id: 'g',
        point: { mapId: worldMapId(30), x: 0, y: 0 },
        layer: 'objectives',
        count: 1,
        subjects: 1,
        emphasis: 'normal',
        label: null,
        ref,
      },
    ];
    expect(descriptors.map(descriptorMapId)).toEqual([1, 0, 2991, 2991, 30]);
  });
});

describe('mapViewOf', () => {
  it('keeps the world map, zoom and centre of a view state', () => {
    const view = mapViewOf({
      surface: 'world:1',
      mapId: ONE,
      center: { mapId: ONE, x: 5, y: -7 },
      zoom: -2.5,
      bounds: { mapId: ONE, xMin: 0, xMax: 10, yMin: -10, yMax: 0 },
      widthPx: 800,
      heightPx: 600,
    });
    expect(view).toEqual({ mapId: 1, zoom: -2.5, center: { x: 5, y: -7 }, bounds: { mapId: 1, xMin: 0, xMax: 10, yMin: -10, yMax: 0 } });
  });
});

describe('labels without step numbers (M3 review PERF-2, MAP-UX-3)', () => {
  const step = (id: string): MapRef => ({ kind: 'step', stepId: stepId(id) });
  const marker = (ids: readonly string[], labels: readonly (string | null)[]): MarkerDescriptor => ({
    type: 'marker',
    id: `step:${ids[0] ?? ''}`,
    point: { mapId: ONE, x: 0, y: 0 },
    kind: 'step',
    style: 'accent',
    emphasis: 'normal',
    label: labels[0] ?? null,
    badges: [],
    ref: step(ids[0] ?? ''),
    count: ids.length,
    refs: ids.map(step),
    labels,
  });

  it('combines the labels of a stack, naming how many it holds', () => {
    expect(combineLabels([])).toBeNull();
    expect(combineLabels([], 3)).toBe('3 here');
    expect(combineLabels(['a'])).toBe('a');
    expect(combineLabels(['a', 'b'])).toBe('2 here: a; b');
    expect(combineLabels(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('6 here: a; b; c and 3 more');
    expect(combineLabels(['a'], 4)).toBe('4 here: a and 3 more');
  });

  it('resolves label keys with the provider when a label is shown, else keeps the descriptor’s own', () => {
    const numbers: Readonly<Record<string, number>> = { x: 12, y: 13 };
    const provider = (ref: MapRef): string | null => (ref.kind === 'step' ? `${String(numbers[ref.stepId] ?? 0)} · Note` : null);
    const one = marker(['x'], ['x']);
    expect(labelOf(one)).toBe('x');
    expect(labelOf(one, provider)).toBe('12 · Note');
    expect(labelOf(marker(['x', 'y'], ['x', 'y']), provider)).toBe('2 here: 12 · Note; 13 · Note');
    expect(labelOf(marker(['x'], [null]))).toBeNull();
    expect(refsOf(marker(['x', 'y'], ['x', 'y']))).toEqual([step('x'), step('y')]);
    const frame: MapDescriptor = {
      type: 'frame',
      id: 'f',
      bounds: { mapId: ONE, xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
      kind: 'zone',
      label: 'Durotar',
      emphasis: 'normal',
      ref: { kind: 'zone', uiMapId: uiMapId(1411) },
    };
    // A provider that knows nothing about a ref leaves the descriptor's label.
    expect(labelOf(frame, provider)).toBe('Durotar');
    expect(refsOf(frame)).toEqual([frame.ref]);
  });

  it('caps route polylines at 256 vertices', () => {
    // map/layers ties ROUTE_PIECE_MAX_VERTICES to this constant's type, so the two cannot drift.
    expect(MAX_POLYLINE_VERTICES).toBe(256);
  });
});
