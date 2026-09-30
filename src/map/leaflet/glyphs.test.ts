import { describe, expect, it } from 'vitest';
import type { MarkerBadge } from '../adapter';
import { CHIP, CHIP_PIPS_LIT, chipWidth, drawDifficultyChip, drawGlyph, type ChipInk, type GlyphCanvas } from './glyphs';
import { DEFAULT_MAP_PALETTE, glyphExtent, type GlyphShape, type GlyphSpec } from './style';

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A recording stand-in for a 2D context: every call is kept, with the state at the time of fill/stroke/fillText. */
function recorder(): { readonly ctx: GlyphCanvas; readonly calls: Call[]; depth: () => number } {
  const calls: Call[] = [];
  let depth = 0;
  const state = {
    globalAlpha: 1,
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const record =
    (name: string) =>
    (...args: readonly unknown[]): void => {
      calls.push({ name, args: name === 'fill' || name === 'stroke' || name === 'fillText' ? [...args, { ...state }] : args });
    };
  const ctx: GlyphCanvas = {
    ...state,
    save: () => {
      depth += 1;
      calls.push({ name: 'save', args: [] });
    },
    restore: () => {
      depth -= 1;
      calls.push({ name: 'restore', args: [] });
    },
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    rect: record('rect'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    setLineDash: record('setLineDash'),
  };
  // Mirror property writes into `state` so fills and strokes record the colours in force.
  const proxy = new Proxy(ctx, {
    set(target, key, value) {
      if (typeof key === 'string' && key in state) (state as Record<string, unknown>)[key] = value;
      return Reflect.set(target, key, value);
    },
  });
  return { ctx: proxy, calls, depth: () => depth };
}

const spec = (shape: GlyphShape, badges: readonly MarkerBadge[] = [], text: string | null = null): GlyphSpec => ({
  shape,
  size: 6,
  fill: shape === 'halo' ? null : '#123456',
  stroke: '#abcdef',
  strokeWidth: 1.5,
  alpha: 0.5,
  badges,
  badgeColor: '#000000',
  edge: '#ffffff',
  text,
  stack: null,
  textColor: '#222222',
  font: DEFAULT_MAP_PALETTE.font,
});

const SHAPES: readonly GlyphShape[] = ['step', 'quest-start', 'quest-end', 'objective', 'flight-master', 'transition', 'halo', 'aggregate'];

/** Every coordinate a glyph passes to the context, relative to its centre. */
function extent(calls: readonly Call[], cx: number, cy: number): number {
  let max = 0;
  for (const call of calls) {
    if (call.name === 'moveTo' || call.name === 'lineTo' || call.name === 'rect' || call.name === 'fillText') {
      const [x, y] = (call.name === 'fillText' ? call.args.slice(1) : call.args) as number[];
      if (x !== undefined && y !== undefined) max = Math.max(max, Math.abs(x - cx), Math.abs(y - cy));
    }
    if (call.name === 'arc') {
      const [x, y, r] = call.args as number[];
      if (x !== undefined && y !== undefined && r !== undefined) max = Math.max(max, Math.abs(x - cx) + r, Math.abs(y - cy) + r);
    }
  }
  return max;
}

describe('drawGlyph', () => {
  it('draws every shape around its centre, inside its extent, without saving or restoring the context', () => {
    for (const shape of SHAPES) {
      const { ctx, calls, depth } = recorder();
      drawGlyph(ctx, 100, 50, spec(shape, [], shape === 'aggregate' ? '12' : null));
      expect(depth(), shape).toBe(0);
      // Thousands of glyphs per frame: no per-glyph save/restore (M3 review PERF-3).
      expect(calls.some((call) => call.name === 'save' || call.name === 'restore'), shape).toBe(false);
      expect(extent(calls, 100, 50), shape).toBeLessThanOrEqual(glyphExtent(spec(shape)));
      expect(calls.some((call) => call.name === 'fill' || call.name === 'stroke'), shape).toBe(true);
      // Within about twice the radius (the triangle's apex is 1.15 r away; the transition ring's stroke is extra).
      expect(extent(calls, 100, 50), shape).toBeLessThanOrEqual(6 * 1.2 + 0.001);
    }
  });

  it('gives each kind a different path, so shape carries the meaning', () => {
    const signatures = SHAPES.map((shape) => {
      const { ctx, calls } = recorder();
      drawGlyph(ctx, 0, 0, spec(shape));
      // Paths with their arguments, and whether each is filled or stroked (a ring and a dot share a path).
      return JSON.stringify(calls.map((call) => (call.name === 'fill' || call.name === 'stroke' ? call.name : [call.name, call.args])));
    });
    expect(new Set(signatures).size).toBe(SHAPES.length);
  });

  it('clears a dash pattern only when one may be set, and always leaves none', () => {
    const plain = recorder();
    drawGlyph(plain.ctx, 0, 0, spec('step'), false);
    expect(plain.calls.filter((call) => call.name === 'setLineDash')).toEqual([]);
    const after = recorder();
    drawGlyph(after.ctx, 0, 0, spec('step'), true);
    expect(after.calls.filter((call) => call.name === 'setLineDash').map((call) => JSON.stringify(call.args))).toEqual(['[[]]']);
    // The default is the safe one.
    const unknown = recorder();
    drawGlyph(unknown.ctx, 0, 0, spec('step'));
    expect(unknown.calls[0]).toEqual({ name: 'setLineDash', args: [[]] });
  });

  it('sets every property it relies on, so the state a path before it left does not leak in', () => {
    const { ctx, calls } = recorder();
    ctx.lineJoin = 'miter';
    ctx.globalAlpha = 0.1;
    drawGlyph(ctx, 0, 0, spec('quest-start'), false);
    expect(calls.find((call) => call.name === 'stroke')?.args.at(-1)).toMatchObject({ lineJoin: 'round', globalAlpha: 0.5 });
  });

  it('draws a stack count badge at the bottom right, within its extent', () => {
    const { ctx, calls } = recorder();
    const stacked: GlyphSpec = { ...spec('step'), stack: '4' };
    drawGlyph(ctx, 0, 0, stacked, false);
    const text = calls.find((call) => call.name === 'fillText');
    expect(text?.args[0]).toBe('4');
    const [, x, y] = (text?.args ?? []) as [string, number, number];
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(extent(calls, 0, 0)).toBeLessThanOrEqual(glyphExtent(stacked));
  });

  it('paints with the spec’s colours at its alpha; a halo has no fill', () => {
    const { ctx, calls } = recorder();
    drawGlyph(ctx, 0, 0, spec('step'));
    const fill = calls.find((call) => call.name === 'fill');
    const stroke = calls.find((call) => call.name === 'stroke');
    expect(fill?.args.at(-1)).toMatchObject({ fillStyle: '#123456', globalAlpha: 0.5 });
    expect(stroke?.args.at(-1)).toMatchObject({ strokeStyle: '#abcdef', lineWidth: 1.5 });
    const halo = recorder();
    drawGlyph(halo.ctx, 0, 0, spec('halo'));
    expect(halo.calls.some((call) => call.name === 'fill')).toBe(false);
  });

  it('writes the aggregate count in the box', () => {
    const { ctx, calls } = recorder();
    drawGlyph(ctx, 10, 20, spec('aggregate', [], '4.3k'));
    const text = calls.find((call) => call.name === 'fillText');
    expect(text?.args.slice(0, 3)).toEqual(['4.3k', 10, 20.5]);
    expect(text?.args.at(-1)).toMatchObject({ fillStyle: '#222222', textAlign: 'center', textBaseline: 'middle' });
  });

  it('adds badges: a square for instances, a dashed ring off the frame, a question mark for an unknown leg', () => {
    const { ctx, calls } = recorder();
    drawGlyph(ctx, 0, 0, spec('step', ['instance', 'off-frame', 'leg-unknown']), false);
    expect(calls.filter((call) => call.name === 'rect')).toHaveLength(1);
    expect(calls.some((call) => call.name === 'setLineDash' && JSON.stringify(call.args) === '[[2,2]]')).toBe(true);
    expect(calls.find((call) => call.name === 'fillText')?.args[0]).toBe('?');
    // The dash is reset after the ring, so later paths are solid.
    const dashes = calls.filter((call) => call.name === 'setLineDash').map((call) => JSON.stringify(call.args));
    expect(dashes.at(-1)).toBe('[[]]');
  });
});

describe('the difficulty chip twin (map-presentation.md §12.5, §13.4; step MP.7)', () => {
  const ink: ChipInk = {
    well: 'well',
    pipOff: 'off',
    difficulty: { trivial: 'grey', standard: 'green', difficult: 'yellow', verydifficult: 'orange', impossible: 'red' },
    keyline: 'keyline',
    font: 'sans-serif',
  };
  const measure = (text: string): number => text.length * 5;
  const colours = (calls: readonly Call[]): readonly unknown[] =>
    calls.flatMap((call) => {
      const state = call.args[call.args.length - 1] as { fillStyle?: unknown; strokeStyle?: unknown } | undefined;
      if (call.name === 'fill' || call.name === 'fillText') return [state?.fillStyle];
      if (call.name === 'stroke') return [state?.strokeStyle];
      return [];
    });

  it('draws the well, five pips (the rating’s lit in its colour, as DifficultyLabel’s rank) and the level in the same colour', () => {
    for (const key of ['trivial', 'standard', 'difficult', 'verydifficult', 'impossible'] as const) {
      const { ctx, calls } = recorder();
      const width = drawDifficultyChip(ctx, 10, 20, { key, levelText: '18', lowerBound: false }, ink, measure);
      expect(width).toBe(chipWidth('18', measure, 'sans-serif'));
      const fills = calls.filter((call) => call.name === 'fill').map((call) => (call.args[0] as { fillStyle: unknown }).fillStyle);
      // The well, then five pips.
      expect(fills[0]).toBe('well');
      expect(fills.slice(1).filter((fill) => fill === ink.difficulty[key])).toHaveLength(CHIP_PIPS_LIT[key]);
      expect(fills.slice(1).filter((fill) => fill === 'off')).toHaveLength(5 - CHIP_PIPS_LIT[key]);
      const text = calls.find((call) => call.name === 'fillText');
      expect(text?.args[0]).toBe('18');
      expect((text?.args[3] as { fillStyle: unknown }).fillStyle).toBe(ink.difficulty[key]);
    }
    expect(CHIP_PIPS_LIT).toEqual({ trivial: 1, standard: 2, difficult: 3, verydifficult: 4, impossible: 5 });
  });

  it('reads nothing but its ink (the difficulty tokens and the keyline), and dashes its edge for a lower-bound level', () => {
    const { ctx, calls } = recorder();
    drawDifficultyChip(ctx, 0, 0, { key: 'standard', levelText: '7', lowerBound: true }, ink, measure);
    const allowed = new Set<unknown>([ink.well, ink.pipOff, ink.keyline, ...Object.values(ink.difficulty)]);
    expect(colours(calls).every((colour) => allowed.has(colour))).toBe(true);
    const dashes = calls.filter((call) => call.name === 'setLineDash').map((call) => call.args[0] as number[]);
    expect(dashes[0]).toEqual([...CHIP.dash]);
    expect(dashes.at(-1)).toEqual([]);
    const { ctx: solid, calls: solidCalls } = recorder();
    drawDifficultyChip(solid, 0, 0, { key: 'standard', levelText: '7', lowerBound: false }, ink, measure);
    expect(solidCalls.filter((call) => call.name === 'setLineDash').every((call) => (call.args[0] as number[]).length === 0)).toBe(true);
  });
});
