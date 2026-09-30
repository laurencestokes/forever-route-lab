import { describe, expect, it } from 'vitest';
import type { NpcId, QuestId, WorldMapId } from '../../domain/ids';
import type { ClusterMember, LayerId, MarkerDescriptor, MarkerMark, MapRef } from '../adapter';
import { MARK_DIFFICULTIES, type MarkDifficulty, type MarkState } from '../marks';
import { badgeCentre, BADGE_SIZE, PIN_BADGES_FROM_D, pinGeometry, PIP_TAG } from '../marks-pins';
import {
  countText,
  DEFAULT_PIN_PALETTE,
  drawPin,
  forcedPinPalette,
  pinDiameterFor,
  pinPaletteFrom,
  PinBitmaps,
  pinScaleOf,
  pinSpecKey,
  pinSpecOf,
  specExtent,
  type BitmapCanvas,
  type PinCanvas,
  type PinSpec,
} from './pins';

// map/leaflet may import only map/adapter and map/marks values (ARCHITECTURE §4), so the tests brand ids themselves.
const npcId = (value: number): NpcId => value as NpcId;
const questId = (value: number): QuestId => value as QuestId;
const KALIMDOR = 1 as WorldMapId;

/** The reserved colours (UI.md §3.1, §3.2): the pins' own roles never take them, the difficulty twin aside. */
const RESERVED = ['#808080', '#40bf40', '#ffff00', '#ff8040', '#ff1a1a', '#006d7d', '#3ccfe0'];

interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly fill: unknown;
  readonly stroke: unknown;
  readonly dash: readonly number[];
  readonly lineWidth: number;
}

/** A recording 2D context with a translate/scale transform, so recorded points are in the caller's pixels. */
function recorder(): { readonly ctx: PinCanvas; readonly ops: Op[]; readonly points: { x: number; y: number }[] } {
  const ops: Op[] = [];
  const points: { x: number; y: number }[] = [];
  const stack: { tx: number; ty: number; sx: number; sy: number }[] = [];
  let t = { tx: 0, ty: 0, sx: 1, sy: 1 };
  let dash: number[] = [];
  const map = (x: number, y: number): { x: number; y: number } => ({ x: t.tx + x * t.sx, y: t.ty + y * t.sy });
  const state = { globalAlpha: 1, fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '' };
  const record = (name: string, ...args: unknown[]): void => {
    ops.push({ name, args, fill: state.fillStyle, stroke: state.strokeStyle, dash: [...dash], lineWidth: state.lineWidth });
  };
  const ctx: PinCanvas = Object.assign(state, {
    save: () => {
      stack.push({ ...t });
    },
    restore: () => {
      t = stack.pop() ?? { tx: 0, ty: 0, sx: 1, sy: 1 };
    },
    translate: (x: number, y: number) => {
      t = { ...t, tx: t.tx + x * t.sx, ty: t.ty + y * t.sy };
    },
    scale: (x: number, y: number) => {
      t = { ...t, sx: t.sx * x, sy: t.sy * y };
    },
    beginPath: () => {
      record('beginPath');
    },
    closePath: () => {
      record('closePath');
    },
    moveTo: (x: number, y: number) => {
      points.push(map(x, y));
      record('moveTo', map(x, y).x, map(x, y).y);
    },
    lineTo: (x: number, y: number) => {
      points.push(map(x, y));
      record('lineTo', map(x, y).x, map(x, y).y);
    },
    arc: (x: number, y: number, r: number, a0: number, a1: number) => {
      const c = map(x, y);
      const rr = r * t.sx;
      points.push({ x: c.x - rr, y: c.y - rr }, { x: c.x + rr, y: c.y + rr });
      record('arc', c.x, c.y, rr, a0, a1);
    },
    rect: (x: number, y: number, w: number, h: number) => {
      record('rect', x, y, w, h);
    },
    fill: (path?: unknown) => {
      record('fill', path);
    },
    stroke: (path?: unknown) => {
      record('stroke', path);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      const a = map(x, y);
      const b = map(x + w, y + h);
      points.push(a, b);
      record('fillRect', a.x, a.y, b.x - a.x, b.y - a.y);
    },
    fillText: (text: string, x: number, y: number) => {
      const p = map(x, y);
      points.push(p);
      record('fillText', text, p.x, p.y);
    },
    measureText: (text: string) => ({ width: text.length * 5 }),
    setLineDash: (segments: number[]) => {
      dash = [...segments];
    },
  });
  return { ctx, ops, points };
}

/** Paths are recorded as their `d` strings, so the glyph's parts are visible in the ops. */
const PATH = (d: string): unknown => ({ d });

const mark = (state: MarkState, difficulty: MarkDifficulty | null = 'standard', extra: Partial<MarkerMark> = {}): MarkerMark => ({ state, difficulty, dungeonQuest: false, progress: null, ...extra });

const ref = (id: number): MapRef => ({ kind: 'spawn', subject: { kind: 'npc', id: npcId(id) }, spawnIndex: 0, questIds: [questId(id)] });

function pin(fields: Partial<MarkerDescriptor> = {}): MarkerDescriptor {
  const r = fields.ref ?? ref(1);
  return {
    type: 'marker',
    id: 'spawn:npc:1:0',
    point: { mapId: KALIMDOR, x: 0, y: 0 },
    kind: 'quest-start',
    style: 'neutral',
    emphasis: 'normal',
    label: 'Giver',
    badges: [],
    ref: r,
    count: 1,
    refs: [r],
    labels: ['Giver'],
    ...fields,
  };
}

const member = (questIdValue: number, state: MarkState, difficulty: MarkDifficulty | null): ClusterMember => ({
  questId: questId(questIdValue),
  mark: mark(state, difficulty),
  category: 'available',
  subjects: [`npc:${String(questIdValue)}`],
});

const cluster = (members: readonly ClusterMember[]): MarkerDescriptor => {
  const bounds = { mapId: KALIMDOR, xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
  const r: MapRef = { kind: 'cluster', layer: 'available-quests', bounds, quests: members.length, places: members.length };
  return pin({ id: 'cluster:available-quests:1024:0:0', ref: r, refs: [r], cluster: { members, places: members.length, points: members.length, bounds, cellYards: 1024 }, ...(members[0]?.mark === null || members[0] === undefined ? {} : { mark: members[0].mark }) });
};

const spec = (layer: LayerId, descriptor: MarkerDescriptor, diameter = 26, options: Parameters<typeof pinSpecOf>[2] extends infer O ? Partial<O> : never = {}): PinSpec =>
  pinSpecOf(layer, descriptor, { diameter, ...options });

describe('pin geometry and extents (map-presentation.md §25.2.1)', () => {
  it('draws a 26 × 35 px teardrop at D 26 with its point on the item and a half-angle near 36°', () => {
    const g = pinGeometry(26);
    expect(g.height).toBeCloseTo(35.36, 2);
    // "About 36°" (§25.2.1).
    expect((g.halfAngle * 180) / Math.PI).toBeGreaterThan(35);
    expect((g.halfAngle * 180) / Math.PI).toBeLessThan(37);
    const { ctx, ops } = recorder();
    drawPin(ctx, 100, 200, spec('available-quests', pin({ mark: mark('available') })), DEFAULT_PIN_PALETTE, PATH);
    // The silhouette starts at the point (after the pip tag, drawn under the head).
    expect(ops.some((op) => op.name === 'moveTo' && op.args[0] === 100 && op.args[1] === 200)).toBe(true);
    // Its head is centred 22.36 px above the point.
    const head = ops.find((op) => op.name === 'arc' && Math.abs((op.args[2] as number) - 13) < 1e-9);
    expect(head?.args[1]).toBeCloseTo(200 - g.centreToPoint, 9);
  });

  it('keeps every drawn part inside the extent, a pin with every badge, the tag and a selection ring included', () => {
    const everything: MarkerDescriptor = pin({ mark: mark('in-progress', 'difficult', { dungeonQuest: true, progress: { done: 1, total: 3 } }), count: 12 });
    for (const diameter of [12, 16, 20, 26]) {
      for (const state of ['normal', 'hover', 'selected'] as const) {
        for (const descriptor of [everything, pin({ mark: mark('available', 'impossible', { dungeonQuest: true }), count: 3 }), pin({ mark: mark('unlocks-soon', null, { unlockLevel: 16 }) })]) {
          const s = { ...spec('turn-ins', descriptor, diameter), state };
          const e = specExtent(s);
          const { ctx, points } = recorder();
          drawPin(ctx, 0, 0, s, DEFAULT_PIN_PALETTE, PATH);
          for (const p of points) {
            expect(p.x, `${String(diameter)} ${state} x`).toBeGreaterThanOrEqual(-e.left);
            expect(p.x).toBeLessThanOrEqual(e.right);
            expect(p.y, `${String(diameter)} ${state} y`).toBeGreaterThanOrEqual(-e.up);
            expect(p.y).toBeLessThanOrEqual(e.down);
          }
        }
      }
    }
  });

  it('puts each badge in its fixed slot on the rim, and below D 20 only the count pill', () => {
    const s = spec('turn-ins', pin({ mark: mark('in-progress', null, { dungeonQuest: true, progress: { done: 1, total: 2 } }), count: 2 }));
    expect(s.badges).toEqual(['dungeon-quest', 'progress', 'count']);
    const { ctx, ops } = recorder();
    drawPin(ctx, 0, 0, s, DEFAULT_PIN_PALETTE, PATH);
    const cy = -pinGeometry(26).centreToPoint;
    const tl = badgeCentre('tl', 13);
    const tr = badgeCentre('tr', 13);
    // The badges' discs: whole circles of the badge's radius (the count pill's corners are arcs too).
    const discs = ops.filter((op) => op.name === 'arc' && Math.abs((op.args[2] as number) - BADGE_SIZE.diameter / 2) < 1e-9 && Math.abs((op.args[4] as number) - (op.args[3] as number) - 2 * Math.PI) < 1e-9);
    expect(discs.map((op) => [op.args[0], op.args[1]])).toEqual([
      [tl.x, cy + tl.y],
      [tr.x, cy + tr.y],
    ]);
    // Smaller: the count alone.
    expect(spec('turn-ins', pin({ mark: mark('in-progress', null, { dungeonQuest: true }), count: 2 }), PIN_BADGES_FROM_D - 2).badges).toEqual(['count']);
    expect(countText(12)).toBe('×12');
    expect(countText(250)).toBe('×99+');
  });

  it('never draws a 45° diamond: ◆ and ◇ mean provenance (§25.2.8)', () => {
    for (const state of ['available', 'locked', 'ready', 'in-progress', 'record-unknown', 'objective', 'dungeon', 'raid', 'flight-known', 'flight-other-faction', 'portal', 'innkeeper', 'vendor'] as const) {
      const { ctx, ops } = recorder();
      drawPin(ctx, 0, 0, spec('available-quests', pin({ mark: mark(state), count: 3 })), DEFAULT_PIN_PALETTE, PATH);
      // Subpaths of straight segments only: none is a four-sided figure with every side at 45°.
      let run: { x: number; y: number }[] = [];
      let straight = true;
      const check = (): void => {
        if (straight && run.length === 4) {
          const sides = run.map((p, i) => {
            const q = run[(i + 1) % 4] ?? p;
            return Math.abs(Math.abs(Math.atan2(q.y - p.y, q.x - p.x)) - Math.PI / 4) < 0.05 || Math.abs(Math.abs(Math.atan2(q.y - p.y, q.x - p.x)) - (3 * Math.PI) / 4) < 0.05;
          });
          expect(sides.every(Boolean), state).toBe(false);
        }
      };
      for (const op of ops) {
        if (op.name === 'beginPath') {
          check();
          run = [];
          straight = true;
        } else if (op.name === 'moveTo' || op.name === 'lineTo') run.push({ x: op.args[0] as number, y: op.args[1] as number });
        else if (op.name === 'arc') straight = false;
      }
      check();
    }
  });
});

describe('colour, the pip tag and the group rule (§25.2.3, D-041 G, D-047)', () => {
  it('colours a quest pin from D 16 only, and always with the pip tag', () => {
    const available = pin({ mark: mark('available', 'difficult') });
    expect(spec('available-quests', available, 14).colour).toBeNull();
    expect(spec('available-quests', available, 16).colour).toBe('difficult');
    for (const diameter of [14, 16, 26]) {
      const s = spec('available-quests', available, diameter);
      const { ctx, ops } = recorder();
      drawPin(ctx, 0, 0, s, DEFAULT_PIN_PALETTE, PATH);
      const bars = ops.filter((op) => op.name === 'fillRect');
      // The tag's five bars, at the head's left, come with the colour and never without it.
      expect(bars.length, String(diameter)).toBe(s.colour === null ? 0 : 5);
      if (s.colour !== null) {
        expect(bars.filter((op) => op.fill === DEFAULT_PIN_PALETTE.difficulty.difficult)).toHaveLength(3);
        expect(bars.every((op) => (op.args[0] as number) < -pinGeometry(diameter).radius + PIP_TAG.overlap)).toBe(true);
        // The glyph takes the colour.
        expect(ops.some((op) => op.name === 'stroke' && op.stroke === DEFAULT_PIN_PALETTE.difficulty.difficult)).toBe(true);
      }
    }
  });

  it('keeps colour off the states that take none, off the light family, and off an unknown difficulty', () => {
    expect(spec('available-quests', pin({ mark: mark('locked', 'standard') })).colour).toBeNull();
    expect(spec('turn-ins', pin({ mark: mark('in-progress', 'standard') })).colour).toBeNull();
    expect(spec('available-quests', pin({ mark: mark('available', null) })).colour).toBeNull();
    expect(spec('services', pin({ mark: mark('innkeeper', 'standard') })).colour).toBeNull();
    expect(spec('available-quests', pin({ mark: mark('low-level', 'standard') })).colour).toBe('trivial');
    // Without route state: the "!" uncoloured, solid, no state badge.
    const plain = spec('available-quests', pin());
    expect(plain).toMatchObject({ glyph: 'quest', colour: null, edge: 'solid', fill: 'solid', badges: [] });
    // A flight master whose state is not known yet is drawn "not sure", never "known".
    expect(spec('flight-masters', pin({ kind: 'flight-master' }))).toMatchObject({ glyph: 'flight', fill: 'hollow', edge: 'dashed' });
  });

  it('colours a cluster or a stack only when every member shares one difficulty', () => {
    expect(spec('available-quests', cluster([member(1, 'available', 'standard'), member(2, 'uncertain', 'standard')]), 16)).toMatchObject({ colour: 'standard', count: '×2' });
    expect(spec('available-quests', cluster([member(1, 'available', 'standard'), member(2, 'available', 'difficult')]), 16).colour).toBeNull();
    // A member that takes no colour (locked) leaves the cluster uncoloured.
    expect(spec('available-quests', cluster([member(1, 'available', 'standard'), member(2, 'locked', 'standard')]), 16).colour).toBeNull();
    // Dashed only when every member is.
    expect(spec('available-quests', cluster([member(1, 'uncertain', 'standard'), member(2, 'uncertain', 'standard')])).edge).toBe('dashed');
    expect(spec('available-quests', cluster([member(1, 'available', 'standard'), member(2, 'uncertain', 'standard')])).edge).toBe('solid');
    // A stack leader's members, given by the adapter.
    const leader = pin({ mark: mark('available', 'standard') });
    expect(spec('available-quests', leader, 26, { members: [mark('available', 'standard'), mark('available', 'standard')], count: 2 })).toMatchObject({ colour: 'standard', count: '×2' });
    expect(spec('available-quests', leader, 26, { members: [mark('available', 'standard'), mark('available', 'impossible')], count: 2 }).colour).toBeNull();
    // Clusters below D 16 stay ink.
    expect(spec('available-quests', cluster([member(1, 'available', 'standard'), member(2, 'available', 'standard')]), 14).colour).toBeNull();
  });

  it('draws services light at 0.8 of the band, and counted objectives at 0.8', () => {
    expect(pinScaleOf('services', pin())).toBe(0.8);
    expect(pinScaleOf('objectives', pin({ mark: mark('objective', null) }))).toBe(0.8);
    expect(pinScaleOf('available-quests', pin())).toBe(1);
    const service = spec('services', pin({ mark: mark('innkeeper', null) }));
    expect(service).toMatchObject({ family: 'light', diameter: 26 * 0.8, glyph: 'innkeeper' });
    const { ctx, ops } = recorder();
    drawPin(ctx, 0, 0, service, DEFAULT_PIN_PALETTE, PATH);
    // The light family swaps the two tones: a light body, a dark keyline and glyph.
    const body = ops.find((op) => op.name === 'fill');
    expect(body?.fill).toBe(DEFAULT_PIN_PALETTE.glyph);
  });

  it('draws the edges with fixed meanings: dashed "not sure", double "both factions", and a hollow glyph "not known yet"', () => {
    const dashed = recorder();
    drawPin(dashed.ctx, 0, 0, spec('available-quests', pin({ mark: mark('uncertain') })), DEFAULT_PIN_PALETTE, PATH);
    expect(dashed.ops.some((op) => op.name === 'stroke' && op.dash.length === 2 && op.dash[0] === 3.2 && op.dash[1] === 2.4)).toBe(true);
    const doubled = recorder();
    drawPin(doubled.ctx, 0, 0, { ...spec('flight-masters', pin({ mark: mark('flight-known', null) })), edge: 'double' }, DEFAULT_PIN_PALETTE, PATH);
    expect(doubled.ops.some((op) => op.name === 'arc' && Math.abs((op.args[2] as number) - (13 - 2.6)) < 1e-9)).toBe(true);
    const hollow = recorder();
    drawPin(hollow.ctx, 0, 0, spec('flight-masters', pin({ mark: mark('flight-not-known', null) })), DEFAULT_PIN_PALETTE, PATH);
    // The plane's fill part is outlined, not filled.
    expect(hollow.ops.some((op) => op.name === 'fill' && (op.args[0] as { d?: string } | undefined)?.d?.startsWith('M3.2 12.3') === true)).toBe(false);
    expect(hollow.ops.some((op) => op.name === 'stroke' && (op.args[0] as { d?: string } | undefined)?.d?.startsWith('M3.2 12.3') === true)).toBe(true);
    // Selected: the ring on its halo, laid on both sides.
    const selected = recorder();
    drawPin(selected.ctx, 0, 0, { ...spec('available-quests', pin()), state: 'selected' }, DEFAULT_PIN_PALETTE, PATH);
    const strokes = selected.ops.filter((op) => op.name === 'stroke').slice(0, 2);
    expect(strokes.map((op) => op.stroke)).toEqual([DEFAULT_PIN_PALETTE.ringHalo, DEFAULT_PIN_PALETTE.ring]);
    expect((strokes[0]?.lineWidth ?? 0) - (strokes[1]?.lineWidth ?? 0)).toBe(3);
  });
});

describe('the size curve (§25.2.4)', () => {
  it('grows from 12 to 26 across the continent band in even steps, at most 1.75 px per 0.25 zoom, then stays 26', () => {
    const at = (zoom: number): number => pinDiameterFor(2 ** zoom);
    expect(at(Math.log2(0.01))).toBe(12);
    expect(at(Math.log2(0.022))).toBe(12);
    // D 16 from about 0.0325 px/yd (§25.2.4): the curve reaches 16 at 0.0327, and sizes are bucketed down to even pixels.
    expect(at(Math.log2(0.0325))).toBe(14);
    expect(at(Math.log2(0.0328))).toBe(16);
    expect(at(Math.log2(0.088))).toBe(26);
    expect(at(0)).toBe(26);
    let previous = at(-6);
    for (let zoom = -6; zoom <= -3; zoom += 0.25) {
      const d = at(zoom);
      expect(d % 2 === 0 || d === 26).toBe(true);
      expect(d).toBeGreaterThanOrEqual(previous);
      // Bucketing to even pixels can move by one bucket (2 px) where the curve crosses one.
      expect(d - previous).toBeLessThanOrEqual(2);
      previous = d;
    }
  });
});

describe('palette and bitmaps (§25.2.9, §25.7)', () => {
  it('reads the pin tokens and the difficulty twin, and no pin role but the twin takes a reserved colour', () => {
    const palette = pinPaletteFrom((property) => (property === '--frl-map-pin' ? ' #101216 ' : ''), '#8ea2ff', 'rgb(13 13 13 / 0.85)', 'system-ui');
    expect(palette).toMatchObject({ body: '#101216', glyph: '#f2f2f2', keyline: '#f2f2f2', ring: '#8ea2ff', forced: false });
    expect(MARK_DIFFICULTIES.map((d) => palette.difficulty[d])).toEqual(['#808080', '#40bf40', '#ffff00', '#ff8040', '#ff1a1a']);
    for (const role of [palette.body, palette.glyph, palette.keyline, palette.pipOff, palette.ring, palette.ringHalo]) expect(RESERVED).not.toContain(role.toLowerCase());
  });

  it('switches to the system colours under forced colours, the coloured quest pins keeping their well, colours and tag', () => {
    const forced = forcedPinPalette(DEFAULT_PIN_PALETTE, { canvas: 'rgb(0, 0, 0)', canvasText: 'rgb(255, 255, 255)', highlight: 'rgb(0, 255, 255)' });
    expect(forced).toMatchObject({ body: 'rgb(0, 0, 0)', glyph: 'rgb(255, 255, 255)', keyline: 'rgb(255, 255, 255)', ring: 'rgb(0, 255, 255)', forced: true });
    expect(forced.key).not.toBe(DEFAULT_PIN_PALETTE.key);
    const coloured = recorder();
    drawPin(coloured.ctx, 0, 0, spec('available-quests', pin({ mark: mark('available', 'standard') })), forced, PATH);
    expect(coloured.ops.filter((op) => op.name === 'fill' && op.fill === '#101216').length).toBeGreaterThan(0);
    expect(coloured.ops.filter((op) => op.name === 'fillRect' && op.fill === forced.difficulty.standard)).toHaveLength(2);
    const plain = recorder();
    drawPin(plain.ctx, 0, 0, spec('available-quests', pin({ mark: mark('locked', 'standard') })), forced, PATH);
    expect(plain.ops.find((op) => op.name === 'fill')?.fill).toBe('rgb(0, 0, 0)');
  });

  it('keeps one bitmap per look, palette and ratio, sized to the pin’s extent, at most 256', () => {
    const made: { width: number; height: number }[] = [];
    const create = (width: number, height: number): BitmapCanvas => {
      made.push({ width, height });
      return { width, height, getContext: () => recorder().ctx };
    };
    const bitmaps = new PinBitmaps(create, PATH, 3);
    const a = spec('available-quests', pin({ mark: mark('available', 'standard') }));
    const first = bitmaps.get(a, DEFAULT_PIN_PALETTE, 2);
    expect(bitmaps.get(a, DEFAULT_PIN_PALETTE, 2)).toBe(first);
    const e = specExtent(a);
    expect(first).toMatchObject({ left: e.left, up: e.up, width: e.left + e.right, height: e.up + e.down });
    expect(made[0]).toEqual({ width: Math.ceil((e.left + e.right) * 2), height: Math.ceil((e.up + e.down) * 2) });
    // Another palette or ratio is another bitmap; the LRU keeps the most recent `max`.
    bitmaps.get(a, forcedPinPalette(DEFAULT_PIN_PALETTE, { canvas: '#000', canvasText: '#fff', highlight: '#0ff' }), 2);
    bitmaps.get(a, DEFAULT_PIN_PALETTE, 1);
    bitmaps.get({ ...a, state: 'hover' }, DEFAULT_PIN_PALETTE, 2);
    expect(bitmaps.size).toBe(3);
    expect(bitmaps.drawn).toBe(4);
    // The first was the least recently used and went.
    bitmaps.get(a, DEFAULT_PIN_PALETTE, 2);
    expect(bitmaps.drawn).toBe(5);
    expect(pinSpecKey(a)).not.toBe(pinSpecKey({ ...a, state: 'hover' }));
    // No canvas: no bitmap (the pin draws as vectors).
    expect(new PinBitmaps(() => null, PATH).get(a, DEFAULT_PIN_PALETTE, 1)).toBeNull();
  });
});
