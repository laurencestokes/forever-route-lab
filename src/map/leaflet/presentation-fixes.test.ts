import { describe, expect, it } from 'vitest';
import { readDirectory } from '../../../tests/support/fake-fetch';
import type { StepId, UiMapId, WorldMapId } from '../../domain/ids';
import type { LabelDescriptor, MarkerDescriptor } from '../adapter';
import { BADGE_SIZE, pinGeometry, PIN_LINES } from '../marks-pins';
import { boxesOverlap, CARD_FACTION_LINE, drawPlacedLabel, labelForms, pinBoxes, placeLabels, placeStepNumbers, STEP_NUMBERS, stepNumberBox, type LabelCanvas } from './labels';
import { BEAD_AFTER_ALPHA, DEFAULT_MAP_PALETTE, frameStyle, lineHalo, markerGlyph, polylineStyle, ROUTE_AFTER } from './style';

/*
 * The presentation fixes on the Leaflet side that are pure (the joint review's presentation
 * findings): the route after the active step and the line halos (PR-02, PR-03), the underground
 * frame's colour (PR-17), the pins' boxes the labels keep clear of and the step numbers that move
 * round them (PR-16), the cards' faction words (PR-15), and the forced-colours probe's stylesheet
 * (PR-04).
 */

const stepId = (value: string): StepId => value as StepId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

describe('the route after the active step and the line halos (§13.6, §25.4; review PR-02, PR-03)', () => {
  const palette = DEFAULT_MAP_PALETTE;

  it('dashes a solid leg 5-6 at 55 % after the active step, and keeps a dashed leg’s own dashes', () => {
    expect(polylineStyle('route', 'normal', palette)).toMatchObject({ weight: 2.6, dashArray: null, opacity: 0.9 });
    expect(polylineStyle('route', 'normal', palette, true)).toMatchObject({ weight: 2.6, dashArray: ROUTE_AFTER.dash, opacity: ROUTE_AFTER.opacity });
    expect(ROUTE_AFTER).toEqual({ opacity: 0.55, dash: '5 6' });
    expect(polylineStyle('transport', 'normal', palette, true)).toMatchObject({ dashArray: '10 6', opacity: 0.55 });
    expect(polylineStyle('flight', 'normal', palette, true)).toMatchObject({ dashArray: '1 6', opacity: 0.55 });
  });

  it('draws the route 2.6 px over a 5.5 px halo and the network 1.1 px over a 3 px one, in the label halo; the highlight and the proposal none', () => {
    expect(lineHalo('route', 'normal', palette)).toEqual({ color: palette.labelHalo, weight: 5.5 });
    expect(lineHalo('route', 'strong', palette)?.weight).toBe(7.5);
    expect(lineHalo('network-flight', 'normal', palette)).toEqual({ color: palette.labelHalo, weight: 3 });
    expect(lineHalo('network-transport', 'normal', palette)).toEqual({ color: palette.labelHalo, weight: 3 });
    for (const style of ['transport', 'flight', 'hearth', 'route-pending', 'route-fallback'] as const) {
      const halo = lineHalo(style, 'normal', palette);
      expect(halo?.weight).toBeGreaterThan(polylineStyle(style, 'normal', palette).weight);
    }
    expect(lineHalo('highlight', 'normal', palette)).toBeNull();
    expect(lineHalo('proposal', 'normal', palette)).toBeNull();
  });

  it('fades a step bead after the active step to 60 %', () => {
    const bead: MarkerDescriptor = {
      type: 'marker',
      id: 'step:a',
      point: { mapId: worldMapId(1), x: 0, y: 0 },
      kind: 'step',
      style: 'accent',
      emphasis: 'normal',
      label: 'a',
      badges: [],
      ref: { kind: 'step', stepId: stepId('a') },
      count: 1,
      refs: [{ kind: 'step', stepId: stepId('a') }],
      labels: ['a'],
    };
    expect(markerGlyph(bead, palette).alpha).toBe(1);
    expect(markerGlyph({ ...bead, after: true }, palette).alpha).toBe(BEAD_AFTER_ALPHA);
    expect(BEAD_AFTER_ALPHA).toBe(0.6);
  });
});

describe('an underground city’s frame in the minimap style (D-049 O19; review PR-17)', () => {
  it('keeps the frame colour when it is the jumped-to zone, where any other zone takes the strong colour', () => {
    const palette = { ...DEFAULT_MAP_PALETTE, frame: '#aabbcc', frameStrong: '#8ea2ff' };
    expect(frameStyle('zone', 'strong', palette, false, { dashed: true })).toMatchObject({ color: '#aabbcc', dashArray: '5 4', weight: 2.5 });
    expect(frameStyle('zone', 'strong', palette, false)).toMatchObject({ color: '#8ea2ff' });
  });
});

describe('labels and step numbers keep clear of the pins (review PR-16)', () => {
  it('boxes a pin’s head, and its count pill at the bottom right growing to the right', () => {
    const d = 26;
    const { radius, centreToPoint } = pinGeometry(d);
    const [head, pill] = pinBoxes(d, { count: '×12', level: null });
    expect(head).toEqual({ x0: -(radius + PIN_LINES.keyline), y0: -centreToPoint - radius - PIN_LINES.keyline, x1: radius + PIN_LINES.keyline, y1: -centreToPoint + radius + PIN_LINES.keyline });
    // The pill starts left of its slot's centre by the badge's radius and reaches right of the head.
    expect(pill?.x1).toBeGreaterThan(radius);
    expect((pill?.y1 ?? 0) - (pill?.y0 ?? 0)).toBeCloseTo(BADGE_SIZE.diameter + 2 * BADGE_SIZE.rim);
    expect(pinBoxes(d, { count: null, level: null })).toHaveLength(1);
    expect(pinBoxes(d, { count: '×2', level: '16' })).toHaveLength(3);
  });

  it('places a label clear of the pins where it has room, and over them rather than not at all where it has none', () => {
    const input = { id: 'z', name: 'Durotar', priority: 1, x: 200, y: 200, forms: [{ kind: 'line' as const, width: 60, height: 14, size: 11 }] };
    const area = { x0: 0, y0: 0, x1: 400, y1: 400 };
    const plain = placeLabels([input], [], area).placed[0];
    if (plain === undefined) throw new Error('not placed');
    // A pill over its first spot: it moves off it.
    const moved = placeLabels([input], [], area, [plain.box]).placed[0];
    expect(moved === undefined ? true : boxesOverlap(moved.box, plain.box)).toBe(false);
    // Pins all round: it is placed where it would be without them, not skipped.
    const covered = placeLabels([input], [], area, [area]);
    expect(covered.skipped).toEqual([]);
    expect(covered.placed[0]?.box).toEqual(plain.box);
    // A hard obstacle all round still skips it.
    expect(placeLabels([input], [area], area).skipped).toEqual(['Durotar']);
  });

  it('moves a number round its bead to the first spot clear of the obstacles, and skips it when none is', () => {
    const bead = { stepId: stepId('a'), x: 100, y: 100, number: 27, rank: 2 as const };
    const free = placeStepNumbers([bead]);
    expect(free.drawn[0]).toMatchObject({ x: 100 + STEP_NUMBERS.dx, y: 100 + STEP_NUMBERS.dy });
    // A pill over the up-right spot: the number goes down and right.
    const upRight = stepNumberBox(100 + STEP_NUMBERS.dx, 100 + STEP_NUMBERS.dy, 27);
    const moved = placeStepNumbers([bead], { obstacles: [upRight] });
    expect(moved.drawn[0]).toMatchObject({ x: 100 + STEP_NUMBERS.dx, y: 100 - STEP_NUMBERS.dy });
    expect(boxesOverlap(upRight, stepNumberBox(moved.drawn[0]?.x ?? 0, moved.drawn[0]?.y ?? 0, 27))).toBe(false);
    // Covered all round: skipped and counted.
    const wall = { x0: 0, y0: 0, x1: 200, y1: 200 };
    expect(placeStepNumbers([bead], { obstacles: [wall] })).toEqual({ drawn: [], skipped: 1 });
  });
});

describe('the zone cards’ faction words (§12.6; review PR-15)', () => {
  const measure = (text: string): number => text.length * 6;
  const label: LabelDescriptor = {
    type: 'label',
    id: 'zone:1411',
    point: { mapId: worldMapId(1), x: 0, y: 0 },
    kind: 'zone',
    text: 'Durotar',
    card: { name: 'Durotar', span: 'quests 1-10 (40)', compact: '1-10', basis: 'derived', difficulty: null, widthPx: 100 },
    priority: 1,
    minPxPerYard: 0,
    maxPxPerYard: null,
    label: null,
    ref: { kind: 'zone', uiMapId: 1411 as UiMapId },
  };

  it('makes the card a line taller and at least as wide as the words while the overlay is shown', () => {
    const [plain] = labelForms(label, 0.06, measure, 'sans-serif');
    const [withWords] = labelForms(label, 0.06, measure, 'sans-serif', 'Horde territory, and a long tail of words');
    expect(plain).toMatchObject({ kind: 'card', height: 30 });
    expect(withWords).toMatchObject({ kind: 'card', height: 30 + CARD_FACTION_LINE.dy });
    expect(withWords?.width).toBeGreaterThanOrEqual(measure('Horde territory, and a long tail of words'));
  });

  it('draws the words as the card’s third line, on the halo', () => {
    const ops: { name: string; args: readonly unknown[] }[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (target, key) => (typeof key === 'string' && key in target ? target[key] : (...args: readonly unknown[]) => ops.push({ name: String(key), args })),
      set: (target, key, value) => {
        target[String(key)] = value;
        return true;
      },
    }) as unknown as LabelCanvas;
    const ink = { ink: '#f2f2f2', halo: 'rgb(13 13 13 / 0.85)', font: 'sans-serif' };
    drawPlacedLabel(ctx, label, { id: 'z', form: { kind: 'card', width: 100, height: 43, size: 12 }, box: { x0: 10, y0: 40, x1: 110, y1: 85 }, leader: false, x: 60, y: 60 }, ink, measure, null, 'Horde territory');
    expect(ops.filter((op) => op.name === 'fillText').map((op) => op.args[0])).toEqual(['Durotar', 'quests 1-10 (40)', 'E', 'Horde territory']);
    expect(ops.filter((op) => op.name === 'strokeText').map((op) => op.args[0])).toContain('Horde territory');
  });
});

describe('the forced-colours probe’s stylesheet (§25.2.9; review PR-04)', () => {
  it('gives the probe an opaque Canvas background, CanvasText and a solid Highlight border', () => {
    const css = new TextDecoder().decode(readDirectory('src/map/leaflet', '').get('map.css')).replace(/\r\n/g, '\n');
    const rule = /\.frl-map__probe \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/\bcolor: CanvasText;/);
    expect(rule).toMatch(/\bbackground-color: Canvas;/);
    expect(rule).toMatch(/\bborder: 1px solid Highlight;/);
  });
});
