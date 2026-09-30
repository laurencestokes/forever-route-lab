import { describe, expect, it } from 'vitest';
import type { StepId, UiMapId, WorldMapId } from '../../domain/ids';
import type { LabelDescriptor, ZoneCard } from '../adapter';
import {
  boxesOverlap,
  candidateOffsets,
  CARD_FROM_PX_PER_YARD,
  drawPlacedLabel,
  drawStepNumbers,
  labelForms,
  labelInRange,
  LABEL_TEXT,
  leaderOffsets,
  lineParts,
  placeLabels,
  placeStepNumbers,
  STEP_NUMBERS,
  type BeadInput,
  type Box,
  type LabelCanvas,
  type LabelForm,
  type Measure,
  type PlacementInput,
} from './labels';
import { chipWidth } from './glyphs';

/**
 * The labels canvas's pure parts (docs/research/map-presentation.md §13.2 to §13.6; step MP.1):
 * deterministic placement by static priority, the eleven and sixteen candidate positions and the
 * leaders, the skip counts, the forms by scale, the range hysteresis and the step numbers.
 */

// map/leaflet may import only map/adapter values (ARCHITECTURE §4), so the tests brand ids themselves.
const stepId = (value: string): StepId => value as StepId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;
const uiMapId = (value: number): UiMapId => value as UiMapId;

/** Text measured at 6 px per character at 11 px, scaled by the font size (fonts are `<weight> <size>px <family>`). */
const measure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? '11');
  return (text.length * 6 * size) / 11;
};

const line = (width: number, height = 14): LabelForm => ({ kind: 'line', width, height, size: 11 });
const input = (id: string, priority: number, x: number, y: number, width = 60): PlacementInput => ({ id, name: id, priority, x, y, forms: [line(width)] });
const AREA: Box = { x0: 0, y0: 0, x1: 800, y1: 600 };

describe('placement (§13.2)', () => {
  it('tries eleven positions round the anchor, centre first, then sixteen with a leader up to 3.5 lines away', () => {
    const near = candidateOffsets(60, 14);
    expect(near).toHaveLength(11);
    expect(near[0]).toEqual([0, 0]);
    const far = leaderOffsets(60, 14);
    expect(far).toHaveLength(16);
    expect(Math.max(...far.map(([, dy]) => Math.abs(dy)))).toBeCloseTo(3.5 * 14, 10);
    expect(far.every(([dx, dy]) => dx !== 0 || dy !== 0)).toBe(true);
  });

  it('places by static priority, higher first, whatever the input order, and the same inputs always give the same result', () => {
    const inputs = [input('low', 1, 400, 300), input('high', 9, 400, 300), input('mid', 5, 400, 300)];
    const a = placeLabels(inputs, [], AREA);
    const b = placeLabels([...inputs].reverse(), [], AREA);
    expect(a).toEqual(b);
    // The highest priority takes the anchor itself; the others move away from it.
    const [first] = a.placed;
    expect(first?.id).toBe('high');
    expect(first?.box).toEqual({ x0: 369, y0: 293, x1: 431, y1: 307 });
    for (let i = 0; i < a.placed.length; i += 1) for (let j = i + 1; j < a.placed.length; j += 1) expect(boxesOverlap(a.placed[i]?.box ?? AREA, a.placed[j]?.box ?? AREA)).toBe(false);
    // Ties in priority go by id.
    expect(placeLabels([input('b', 1, 100, 100), input('a', 1, 100, 100)], [], AREA).placed[0]?.id).toBe('a');
  });

  it('keeps clear of obstacles and inside the area, and draws a leader when only a far position is free', () => {
    // Block the eleven near positions of a 60 × 14 label at (400, 300) with one wide obstacle.
    const block: Box = { x0: 330, y0: 270, x1: 470, y1: 330 };
    const result = placeLabels([input('zone', 5, 400, 300)], [block], AREA);
    expect(result.leaders).toBe(1);
    const [placed] = result.placed;
    expect(placed?.leader).toBe(true);
    expect(boxesOverlap(placed?.box ?? block, block)).toBe(false);
    // Near an edge a box never leaves the area.
    const edge = placeLabels([input('edge', 5, 5, 5)], [], AREA).placed[0];
    expect(edge?.box.x0).toBeGreaterThanOrEqual(0);
    expect(edge?.box.y0).toBeGreaterThanOrEqual(0);
  });

  it('skips a label that finds no room and names it, keeping the priority order of the skipped', () => {
    const everything: Box = { x0: 0, y0: 0, x1: 800, y1: 600 };
    const result = placeLabels([input('Redridge Mountains', 1, 400, 300), input('Deadwind Pass', 2, 400, 300)], [everything], AREA);
    expect(result.placed).toEqual([]);
    expect(result.skipped).toEqual(['Deadwind Pass', 'Redridge Mountains']);
  });

  it('falls back to the next form (a card to its compact line, 11 px to 10 px) when the first has no room', () => {
    const wide: LabelForm = { kind: 'card', width: 300, height: 30, size: 12 };
    const narrow = line(40);
    // A card that cannot fit in a 200 px area, beside an anchor at its centre.
    const result = placeLabels([{ id: 'barrens', name: 'The Barrens', priority: 1, x: 100, y: 100, forms: [wide, narrow] }], [], { x0: 0, y0: 0, x1: 200, y1: 200 });
    expect(result.placed[0]?.form).toBe(narrow);
    expect(result.skipped).toEqual([]);
  });
});

describe('forms and ranges (§13.3 to §13.5)', () => {
  const card: ZoneCard = { name: 'The Barrens', span: 'quests 13-25 (93)', compact: '13-25', basis: 'derived', difficulty: null, widthPx: 120 };
  const zone = (overrides: Partial<LabelDescriptor> = {}): LabelDescriptor => ({
    type: 'label',
    id: 'label:zone:1413',
    point: { mapId: worldMapId(1), x: 0, y: 0 },
    kind: 'zone',
    text: 'The Barrens',
    card,
    priority: 10,
    minPxPerYard: 0,
    maxPxPerYard: 0.3,
    label: null,
    ref: { kind: 'zone', uiMapId: uiMapId(1413) },
    ...overrides,
  });

  it('draws compact lines (11 px, then 10 px) below 0.05 px per yard, a card with its compact fallback to the zone band, and 13 px zone labels from it', () => {
    const compact = labelForms(zone(), 0.03, measure, 'sans-serif');
    expect(compact.map((form) => [form.kind, form.size])).toEqual([
      ['line', 11],
      ['line', 10],
    ]);
    // The name, then the compact span ("13-25") in the regular weight and the boxed E (§13.3).
    expect(compact[0]?.width).toBeCloseTo(measure('The Barrens', '600 11px x') + 4 + measure('13-25', '400 10px x') + 13, 10);
    const cards = labelForms(zone(), CARD_FROM_PX_PER_YARD, measure, 'sans-serif');
    expect(cards.map((form) => form.kind)).toEqual(['card', 'line', 'line']);
    // Line 2 keeps room for the difficulty twin, rated or not, so the card's width never changes with the step.
    const second = chipWidth('88', measure, 'sans-serif') + 3 + measure('quests 13-25 (93)', '400 10px x') + 11 + 3;
    expect(cards[0]?.width).toBeCloseTo(Math.max(120, second) + 4, 10);
    expect(labelForms(zone({ card: { ...card, difficulty: { key: 'standard', levelText: '18', lowerBound: false } } }), CARD_FROM_PX_PER_YARD, measure, 'sans-serif')[0]?.width).toBe(cards[0]?.width);
    // A zone with cited text: its compact label is the name alone (§13.3).
    const cited = zone({ card: { ...card, span: 'mid-30s to mid-40s (official)', compact: null, basis: 'official' } });
    expect(labelForms(cited, 0.03, measure, 'sans-serif')[0]?.width).toBeCloseTo(measure('The Barrens', '600 11px x'), 10);
    const zoneBand = labelForms(zone(), 0.1, measure, 'sans-serif');
    expect(zoneBand.map((form) => form.size)).toEqual([LABEL_TEXT.zone, LABEL_TEXT.compact]);
    // Without a card, no card form.
    expect(labelForms(zone({ card: null }), 0.06, measure, 'sans-serif').map((form) => form.kind)).toEqual(['line', 'line']);
    expect(labelForms(zone({ kind: 'continent', card: null }), 0.01, measure, 'sans-serif').map((form) => form.size)).toEqual([18]);
    expect(labelForms(zone({ kind: 'place', card: null }), 0.2, measure, 'sans-serif').map((form) => form.size)).toEqual([10]);
    expect(lineParts(zone())).toEqual({ name: 'The Barrens', span: '13-25', derived: true });
  });

  it('shows a label in its range with the bands’ hysteresis on both edges', () => {
    const label = zone({ minPxPerYard: 0.05, maxPxPerYard: 0.3 });
    expect(labelInRange(label, 0.05, null)).toBe(true);
    expect(labelInRange(label, 0.0499, null)).toBe(false);
    expect(labelInRange(label, 0.3, null)).toBe(false);
    // Drawn: stays until the scale leaves the range by 0.125 zoom.
    expect(labelInRange(label, 0.05 * 2 ** -0.1, true)).toBe(true);
    expect(labelInRange(label, 0.05 * 2 ** -0.2, true)).toBe(false);
    expect(labelInRange(label, 0.3 * 2 ** 0.1, true)).toBe(true);
    // Not drawn: shows only once inside the range by as much.
    expect(labelInRange(label, 0.05 * 2 ** 0.1, false)).toBe(false);
    expect(labelInRange(label, 0.05 * 2 ** 0.2, false)).toBe(true);
    expect(labelInRange(label, 0.3 * 2 ** -0.1, false)).toBe(false);
    expect(labelInRange(zone({ minPxPerYard: 0, maxPxPerYard: null }), 100, false)).toBe(true);
  });
});

describe('step numbers (§13.6)', () => {
  const bead = (id: string, x: number, y: number, number: number, rank: BeadInput['rank'] = 2): BeadInput => ({ stepId: stepId(id), x, y, number, rank });

  it('numbers the active step first, then the selected steps, then route order, skipping one within 16 px of another', () => {
    const beads = [bead('a', 100, 100, 1), bead('b', 110, 100, 2), bead('c', 200, 100, 3, 1), bead('d', 205, 100, 4, 0), bead('e', 300, 100, 5)];
    const { drawn, skipped } = placeStepNumbers(beads);
    expect(drawn.map((n) => n.number)).toEqual([4, 1, 5]);
    expect(skipped).toBe(2);
    // Offset up and right of the bead.
    expect(drawn[0]).toMatchObject({ x: 205 + STEP_NUMBERS.dx, y: 100 + STEP_NUMBERS.dy });
    // Deterministic whatever the input order.
    expect(placeStepNumbers([...beads].reverse())).toEqual({ drawn, skipped });
  });

  it('draws at most 150 in view', () => {
    const beads = Array.from({ length: 400 }, (_, i) => bead(`s${String(i)}`, (i % 20) * 40, Math.floor(i / 20) * 40, i + 1));
    const { drawn, skipped } = placeStepNumbers(beads);
    expect(drawn).toHaveLength(150);
    expect(skipped).toBe(250);
    expect(STEP_NUMBERS.maxInView).toBe(150);
    expect(STEP_NUMBERS.minDistance).toBe(16);
  });
});

describe('drawing', () => {
  interface Op {
    readonly name: string;
    readonly args: readonly unknown[];
  }
  const recorder = (): { readonly ctx: LabelCanvas; readonly ops: Op[] } => {
    const ops: Op[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (target, key) => (typeof key === 'string' && key in target ? target[key] : (...args: readonly unknown[]) => ops.push({ name: String(key), args })),
      set: (target, key, value) => {
        target[String(key)] = value;
        ops.push({ name: `set:${String(key)}`, args: [value] });
        return true;
      },
    }) as unknown as LabelCanvas;
    return { ctx, ops };
  };
  const ink = { ink: '#f2f2f2', halo: 'rgb(13 13 13 / 0.85)', font: 'sans-serif' };

  it('draws text over a 3 px halo, a leader to a dot at its anchor, and a card with its span and the boxed E', () => {
    const { ctx, ops } = recorder();
    const label: LabelDescriptor = {
      type: 'label',
      id: 'z',
      point: { mapId: worldMapId(1), x: 0, y: 0 },
      kind: 'zone',
      text: 'Durotar',
      card: { name: 'Durotar', span: 'quests 1-10 (40)', compact: '1-10', basis: 'derived', difficulty: null, widthPx: 100 },
      priority: 1,
      minPxPerYard: 0,
      maxPxPerYard: null,
      label: null,
      ref: { kind: 'zone', uiMapId: uiMapId(1411) },
    };
    drawPlacedLabel(ctx, label, { id: 'z', form: { kind: 'card', width: 100, height: 30, size: 12 }, box: { x0: 10, y0: 40, x1: 110, y1: 70 }, leader: true, x: 60, y: 10 }, ink, measure);
    const strokes = ops.filter((op) => op.name === 'strokeText').map((op) => op.args[0]);
    const fills = ops.filter((op) => op.name === 'fillText').map((op) => op.args[0]);
    expect(strokes).toEqual(fills);
    expect(fills).toEqual(['Durotar', 'quests 1-10 (40)', 'E']);
    expect(ops.find((op) => op.name === 'arc')?.args.slice(0, 3)).toEqual([60, 10, 1.8]);
    expect(ops.filter((op) => op.name === 'set:lineWidth').map((op) => op.args[0])).toContain(LABEL_TEXT.halo);
    const numbers = recorder();
    drawStepNumbers(numbers.ctx, [{ stepId: stepId('a'), number: 12, x: 7, y: -7 }], ink);
    expect(numbers.ops.filter((op) => op.name === 'fillText').map((op) => op.args)).toEqual([['12', 7, -7]]);
  });
});
