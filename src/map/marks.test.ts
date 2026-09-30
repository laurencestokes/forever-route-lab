import { describe, expect, it } from 'vitest';
import {
  BADGE_SLOT_OF,
  BADGE_SLOTS,
  bucketPinDiameter,
  COLOUR_MIN_SHAPE_PX,
  colourFits,
  GLYPH_BOX_UNITS,
  MARK_DIFFICULTIES,
  MARK_STATE_NAMES,
  MARK_STATES,
  markColour,
  PIN_SIZE,
  pinDiameterAt,
  PIPS_LIT,
  QUEST_GLYPH,
  QUEST_MARK_STATES,
  resolveMarkLook,
  TURN_IN_GLYPH,
  type GlyphPath,
  type MarkState,
} from './marks';
import {
  badgeCentre,
  badgesDrawnAt,
  fillSpoken,
  groupLook,
  MARK_GLYPH_NAMES,
  MARK_GLYPHS,
  PIN_BADGES_FROM_D,
  PIN_COLOUR_FROM_D,
  pinColour,
  pinExtent,
  pinGeometry,
  pinGlyphBoxPx,
  pinTarget,
  pipBars,
} from './marks-pins';

/**
 * The one path set and state table (docs/research/map-presentation.md §25.2.2 to §25.2.4, step
 * MP.2b): the state table's cases, the glyph rules (no 45° diamond, no warning triangle, the "!"
 * as recorded), and the D-041 G colour rule (colour only with the pips, and only from 11 px).
 */

// ---- A small SVG path reader: enough for our own glyphs (absolute and relative M, L, H, V, C, S, A, Z).

interface Subpath {
  readonly vertices: readonly (readonly [number, number])[];
  readonly closed: boolean;
  /** Only straight segments (a polygon or polyline). */
  readonly straight: boolean;
}

function subpathsOf(d: string): readonly Subpath[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Subpath[] = [];
  let x = 0;
  let y = 0;
  let vertices: [number, number][] = [];
  let straight = true;
  let command = '';
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const flush = (closed: boolean): void => {
    if (vertices.length > 0) out.push({ vertices, closed, straight });
    vertices = [];
    straight = true;
  };
  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/[a-zA-Z]/.test(token)) {
      command = token;
      i += 1;
      if (command === 'z' || command === 'Z') {
        flush(true);
        continue;
      }
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case 'M': {
        flush(false);
        const nx = num();
        const ny = num();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        vertices.push([x, y]);
        // Further pairs after a moveto are linetos.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const nx = num();
        const ny = num();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        vertices.push([x, y]);
        break;
      }
      case 'H':
        x = relative ? x + num() : num();
        vertices.push([x, y]);
        break;
      case 'V':
        y = relative ? y + num() : num();
        vertices.push([x, y]);
        break;
      case 'C': {
        const args = [num(), num(), num(), num(), num(), num()];
        x = relative ? x + (args[4] ?? 0) : (args[4] ?? 0);
        y = relative ? y + (args[5] ?? 0) : (args[5] ?? 0);
        straight = false;
        vertices.push([x, y]);
        break;
      }
      case 'S': {
        const args = [num(), num(), num(), num()];
        x = relative ? x + (args[2] ?? 0) : (args[2] ?? 0);
        y = relative ? y + (args[3] ?? 0) : (args[3] ?? 0);
        straight = false;
        vertices.push([x, y]);
        break;
      }
      case 'A': {
        const args = [num(), num(), num(), num(), num(), num(), num()];
        x = relative ? x + (args[5] ?? 0) : (args[5] ?? 0);
        y = relative ? y + (args[6] ?? 0) : (args[6] ?? 0);
        straight = false;
        vertices.push([x, y]);
        break;
      }
      default:
        throw new Error(`path command ${command} is not read by this test`);
    }
  }
  flush(false);
  return out;
}

/** A closed straight subpath's distinct vertices (the closing vertex dropped when it repeats the first). */
function polygonOf(subpath: Subpath): readonly (readonly [number, number])[] | null {
  if (!subpath.closed || !subpath.straight) return null;
  const vs = [...subpath.vertices];
  const first = vs[0];
  const last = vs.at(-1);
  if (first !== undefined && last !== undefined && vs.length > 1 && first[0] === last[0] && first[1] === last[1]) vs.pop();
  return vs;
}

const angleOf = (a: readonly [number, number], b: readonly [number, number]): number => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const near45 = (angle: number): boolean => {
  const folded = ((angle % 90) + 90) % 90;
  return Math.abs(folded - 45) < 10;
};

const partsOf = (path: GlyphPath) => path.flatMap((part) => subpathsOf(part.d));

describe('the glyph paths (§25.2.2, §25.2.8)', () => {
  it('names eleven glyphs, each its own path object in a 24-unit box', () => {
    expect(MARK_GLYPH_NAMES).toHaveLength(11);
    expect(new Set(Object.values(MARK_GLYPHS)).size).toBe(11);
    expect(MARK_GLYPHS.quest).toBe(QUEST_GLYPH);
    expect(MARK_GLYPHS['turn-in']).toBe(TURN_IN_GLYPH);
    for (const name of MARK_GLYPH_NAMES) {
      for (const sub of partsOf(MARK_GLYPHS[name])) {
        for (const [px, py] of sub.vertices) {
          expect(px, name).toBeGreaterThanOrEqual(0);
          expect(py, name).toBeGreaterThanOrEqual(0);
          expect(px, name).toBeLessThanOrEqual(GLYPH_BOX_UNITS);
          expect(py, name).toBeLessThanOrEqual(GLYPH_BOX_UNITS);
        }
      }
      for (const part of MARK_GLYPHS[name]) {
        if (part.mode === 'stroke' || part.mode === 'cut') expect(part.width, name).toBeGreaterThan(0);
        else expect(part.width, name).toBeUndefined();
      }
    }
  });

  it('draws no 45° diamond anywhere (◆ and ◇ mean provenance)', () => {
    const diamonds: string[] = [];
    for (const name of MARK_GLYPH_NAMES) {
      for (const sub of partsOf(MARK_GLYPHS[name])) {
        const polygon = polygonOf(sub);
        if (polygon?.length !== 4) continue;
        const edges = polygon.map((vertex, i) => angleOf(vertex, polygon[(i + 1) % 4] ?? vertex));
        if (edges.every(near45)) diamonds.push(name);
      }
    }
    expect(diamonds).toEqual([]);
    // The reader finds a diamond when there is one.
    const diamond = polygonOf(subpathsOf('M12 2 22 12 12 22 2 12z')[0] ?? { vertices: [], closed: false, straight: false });
    expect(diamond?.length).toBe(4);
    expect(diamond?.map((vertex, i) => angleOf(vertex, diamond[(i + 1) % 4] ?? vertex)).every(near45)).toBe(true);
  });

  it('draws no warning triangle: the "!" and "?" hold no polygon, and no glyph is an upright isosceles triangle', () => {
    for (const path of [QUEST_GLYPH, TURN_IN_GLYPH]) for (const sub of partsOf(path)) expect(polygonOf(sub)).toBeNull();
    const upright: string[] = [];
    for (const name of MARK_GLYPH_NAMES) {
      for (const sub of partsOf(MARK_GLYPHS[name])) {
        const polygon = polygonOf(sub);
        if (polygon?.length !== 3) continue;
        const sorted = [...polygon].sort((a, b) => a[1] - b[1]);
        const [apex, b1, b2] = sorted;
        if (apex === undefined || b1 === undefined || b2 === undefined) continue;
        const flatBase = Math.abs(b1[1] - b2[1]) < 0.5;
        const centred = Math.abs(apex[0] - (b1[0] + b2[0]) / 2) < 1;
        if (flatBase && centred && apex[1] < b1[1]) upright.push(name);
      }
    }
    expect(upright).toEqual([]);
  });

  it('builds the "!" as recorded (review UR-09): a constant-width stroke from y 4.6 to 13 on x 12 and a dot of radius 2.5 at y 18.8', () => {
    const [bar, dot] = QUEST_GLYPH;
    expect(bar).toEqual({ d: 'M12 4.6V13', mode: 'stroke', width: 4.4 });
    expect(dot?.mode).toBe('fill');
    const dotPoints = subpathsOf(dot?.d ?? '')[0]?.vertices ?? [];
    const ys = dotPoints.map((p) => p[1]);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(18.8, 5);
    expect((Math.max(...ys) - Math.min(...ys)) / 2).toBeCloseTo(2.5, 5);
    // Ink from the bar's top cap (4.6 - 2.2) to the dot's bottom (21.3): 18.9 units.
    const inkTop = 4.6 - 4.4 / 2;
    const inkHeight = 21.3 - inkTop;
    expect(inkHeight).toBeCloseTo(18.9, 5);
    expect((13 - 4.6 + 4.4) / inkHeight).toBeCloseTo(0.677, 3);
    expect(4.4 / inkHeight).toBeCloseTo(0.233, 3);
    expect((18.8 - inkTop) / inkHeight).toBeCloseTo(0.868, 3);
    expect(2.5 / inkHeight).toBeCloseTo(0.132, 3);
    const [question, questionDot] = TURN_IN_GLYPH;
    expect(question).toMatchObject({ mode: 'stroke', width: 3.9 });
    expect(questionDot?.mode).toBe('fill');
  });
});

describe('the one state table (§25.2.3)', () => {
  const row = (state: MarkState) => MARK_STATES[state];

  it('gives each quest mark state its glyph, edge, colour rule and badge', () => {
    expect(row('available')).toMatchObject({ glyph: 'quest', fill: 'solid', edge: 'solid', colour: 'difficulty', badge: null });
    expect(row('uncertain')).toMatchObject({ glyph: 'quest', edge: 'dashed', colour: 'difficulty', badge: null });
    expect(row('locked')).toMatchObject({ glyph: 'quest', edge: 'solid', colour: 'none', badge: 'lock' });
    expect(row('unlocks-soon')).toMatchObject({ glyph: 'quest', edge: 'solid', colour: 'none', badge: 'level' });
    expect(row('low-level')).toMatchObject({ glyph: 'quest', edge: 'solid', colour: 'trivial', badge: null });
    expect(row('ready')).toMatchObject({ glyph: 'turn-in', edge: 'solid', colour: 'difficulty', badge: null });
    expect(row('in-progress')).toMatchObject({ glyph: 'turn-in', edge: 'solid', colour: 'none', badge: 'progress' });
    expect(row('record-unknown')).toMatchObject({ glyph: 'turn-in', edge: 'dashed', colour: 'none', badge: 'progress-unknown' });
    expect(QUEST_MARK_STATES).toEqual(['available', 'uncertain', 'locked', 'unlocks-soon', 'low-level', 'ready', 'in-progress', 'record-unknown']);
    // The written-out lists match the table (they are literals, so an unused table costs a bundle nothing).
    expect(MARK_STATE_NAMES).toEqual(Object.keys(MARK_STATES));
    expect(QUEST_MARK_STATES).toEqual(MARK_STATE_NAMES.filter((state) => MARK_STATES[state].glyph === 'quest' || MARK_STATES[state].glyph === 'turn-in'));
  });

  it('gives places and services theirs: entrances, flights by knowledge, transports, portals, the light family', () => {
    expect(row('dungeon')).toMatchObject({ glyph: 'dungeon', family: 'dark', colour: 'none' });
    expect(row('raid')).toMatchObject({ glyph: 'raid', family: 'dark', colour: 'none' });
    expect(row('flight-known')).toMatchObject({ glyph: 'flight', fill: 'solid', edge: 'solid' });
    expect(row('flight-not-known')).toMatchObject({ glyph: 'flight', fill: 'hollow', edge: 'solid' });
    expect(row('flight-may-be-known')).toMatchObject({ glyph: 'flight', fill: 'hollow', edge: 'dashed' });
    expect(row('flight-other-faction')).toMatchObject({ glyph: 'flight', fill: 'hollow', struck: true, badge: 'faction' });
    expect(row('transport-inferred')).toMatchObject({ glyph: 'transport', edge: 'solid' });
    expect(row('transport-unknown')).toMatchObject({ glyph: 'transport', edge: 'dashed' });
    expect(row('portal')).toMatchObject({ glyph: 'portal', edge: 'solid' });
    for (const service of ['innkeeper', 'trainer', 'vendor'] as const) expect(row(service)).toMatchObject({ glyph: service, family: 'light', colour: 'none' });
    expect(row('objective')).toMatchObject({ glyph: 'objective', family: 'dark', colour: 'none' });
    // Only quest marks ever take colour.
    for (const state of MARK_STATE_NAMES) if (!QUEST_MARK_STATES.includes(state)) expect(row(state).colour, state).toBe('none');
  });

  it('keeps each edge to its one meaning: dashed only for "not sure", no double in the table itself', () => {
    const dashed = MARK_STATE_NAMES.filter((state) => row(state).edge === 'dashed');
    expect(dashed).toEqual(['uncertain', 'record-unknown', 'flight-may-be-known', 'transport-unknown']);
    expect(MARK_STATE_NAMES.filter((state) => row(state).edge === 'double')).toEqual([]);
  });

  it('puts every badge in its own slot: TL the arch, TR the state, BL the position, BR the count', () => {
    expect(BADGE_SLOT_OF).toEqual({
      'dungeon-quest': 'tl',
      lock: 'tr',
      level: 'tr',
      progress: 'tr',
      'progress-unknown': 'tr',
      faction: 'tr',
      position: 'bl',
      count: 'br',
    });
    // No state badge sits anywhere but TR, so a dungeon quest's arch never meets it.
    for (const state of MARK_STATE_NAMES) {
      const badge = row(state).badge;
      if (badge !== null) expect(BADGE_SLOT_OF[badge], state).toBe('tr');
    }
    expect(BADGE_SLOTS).toEqual(['tl', 'tr', 'bl', 'br']);
  });

  it('applies the modifiers: the dungeon-quest arch on quest marks only, the flight edges, the position ring on entrances, the count', () => {
    expect(resolveMarkLook('locked', { dungeonQuest: true }).badges).toEqual(['dungeon-quest', 'lock']);
    expect(resolveMarkLook('ready', { dungeonQuest: true }).badges).toEqual(['dungeon-quest']);
    expect(resolveMarkLook('dungeon', { dungeonQuest: true }).badges).toEqual([]);
    expect(resolveMarkLook('flight-known', { sides: 'both' }).edge).toBe('double');
    expect(resolveMarkLook('flight-not-known', { sides: 'both' }).edge).toBe('double');
    expect(resolveMarkLook('flight-may-be-known', { sides: 'both' }).edge).toBe('dashed');
    expect(resolveMarkLook('flight-known', { sides: 'none' }).edge).toBe('dashed');
    expect(resolveMarkLook('flight-known', { sides: 'own' }).edge).toBe('solid');
    expect(resolveMarkLook('flight-other-faction', { sides: 'both' }).edge).toBe('solid');
    expect(resolveMarkLook('dungeon', { positionUnverified: true, count: 4 }).badges).toEqual(['position', 'count']);
    expect(resolveMarkLook('raid', { positionUnverified: true }).badges).toEqual(['position']);
    expect(resolveMarkLook('available', { positionUnverified: true }).badges).toEqual([]);
    expect(resolveMarkLook('available', { count: 1 }).badges).toEqual([]);
    expect(resolveMarkLook('in-progress', { dungeonQuest: true, count: 3 }).badges).toEqual(['dungeon-quest', 'progress', 'count']);
  });

  it('draws only the count pill below D 20', () => {
    expect(badgesDrawnAt(19.9, ['dungeon-quest', 'lock', 'count'])).toEqual(['count']);
    expect(badgesDrawnAt(PIN_BADGES_FROM_D, ['dungeon-quest', 'lock', 'count'])).toEqual(['dungeon-quest', 'lock', 'count']);
  });

  it('fills the spoken templates, leaving a missing part visible', () => {
    expect(fillSpoken(row('available').spoken, { step: 14, title: 'Plainstrider Menace', difficulty: 'difficult', level: 12 })).toBe(
      'Quest available after step 14: Plainstrider Menace (difficult, level 12)',
    );
    expect(fillSpoken(row('in-progress').spoken, { done: 1, total: 3 })).toBe('Turn in: 1 of 3 objectives done after step {step}');
    for (const state of MARK_STATE_NAMES) expect(row(state).spoken.length, state).toBeGreaterThan(10);
  });
});

describe('colour only with the pips, and only from 11 px (D-041 G, D-047)', () => {
  it('colours a shape of 11 px or more, never a smaller one or a non-finite size', () => {
    expect(COLOUR_MIN_SHAPE_PX).toBe(11);
    expect(colourFits(11)).toBe(true);
    expect(colourFits(10.99)).toBe(false);
    expect(colourFits(Number.NaN)).toBe(false);
  });

  it('gives a colour only together with the pips, and only for a known difficulty on a colouring state', () => {
    for (const state of MARK_STATE_NAMES) {
      for (const difficulty of [...MARK_DIFFICULTIES, null]) {
        for (const shape of [9, 11, 18, 22]) {
          const colour = markColour(state, difficulty, shape);
          if (colour === null) continue;
          expect(colour.pips, `${state} ${String(difficulty)} ${String(shape)}`).toBe(true);
          expect(shape).toBeGreaterThanOrEqual(11);
          expect(MARK_STATES[state].colour).not.toBe('none');
        }
      }
    }
    expect(markColour('available', 'difficult', 22)).toEqual({ difficulty: 'difficult', pips: true });
    expect(markColour('uncertain', 'standard', 18)).toEqual({ difficulty: 'standard', pips: true });
    expect(markColour('available', null, 22)).toBeNull();
    expect(markColour('locked', 'difficult', 22)).toBeNull();
    expect(markColour('in-progress', 'difficult', 22)).toBeNull();
    // A low-level quest is always trivial grey with its one pip.
    expect(markColour('low-level', 'standard', 22)).toEqual({ difficulty: 'trivial', pips: true });
    expect(markColour('low-level', null, 22)).toEqual({ difficulty: 'trivial', pips: true });
  });

  it('colours a row disc at both densities (22 and 18 px), and a pin from D 16 (glyph box 11.2 px)', () => {
    expect(markColour('available', 'standard', 22)).not.toBeNull();
    expect(markColour('available', 'standard', 18)).not.toBeNull();
    expect(pinGlyphBoxPx(16, 'quest')).toBeCloseTo(11.2, 10);
    expect(pinGlyphBoxPx(20, 'quest')).toBeCloseTo(14, 10);
    expect(pinGlyphBoxPx(26, 'turn-in')).toBeCloseTo(18.2, 10);
    expect(pinColour('available', 'standard', 14)).toBeNull();
    expect(pinColour('available', 'standard', PIN_COLOUR_FROM_D)).toEqual({ difficulty: 'standard', pips: true });
    expect(pinColour('ready', 'impossible', 26)).toEqual({ difficulty: 'impossible', pips: true });
    // The light family never takes a colour; nor does any place.
    expect(pinColour('innkeeper', 'standard', 26)).toBeNull();
    expect(pinColour('dungeon', 'standard', 26)).toBeNull();
    // Bucketed continent-band sizes: D 14 never colours, D 16 does.
    expect(bucketPinDiameter(15.9)).toBe(14);
    expect(bucketPinDiameter(16.2)).toBe(16);
  });

  it('colours a cluster or stack only when every member shows one colour; dashed only when every member is', () => {
    const at = 11.2;
    expect(groupLook([{ state: 'available', difficulty: 'standard' }, { state: 'uncertain', difficulty: 'standard' }], at)).toMatchObject({
      colour: 'standard',
      look: { edge: 'solid', badges: ['count'] },
    });
    expect(groupLook([{ state: 'available', difficulty: 'standard' }, { state: 'available', difficulty: 'difficult' }], at)?.colour).toBeNull();
    expect(groupLook([{ state: 'available', difficulty: 'standard' }, { state: 'locked', difficulty: 'standard' }], at)?.colour).toBeNull();
    expect(groupLook([{ state: 'uncertain', difficulty: 'standard' }, { state: 'uncertain', difficulty: 'standard' }], at)?.look.edge).toBe('dashed');
    expect(groupLook([{ state: 'uncertain', difficulty: 'standard' }, { state: 'available', difficulty: 'standard' }], at)?.look.edge).toBe('solid');
    expect(groupLook([{ state: 'available', difficulty: 'standard' }], 9)?.colour).toBeNull();
    expect(groupLook([], at)).toBeNull();
  });
});

describe('pin geometry and sizes (§25.2.1, §25.2.4, §25.2.7)', () => {
  it('makes a 26 × 35 px teardrop at D 26, its sides at about 36° from the axis', () => {
    const g = pinGeometry(26);
    expect(g.radius).toBe(13);
    expect(g.centreToPoint).toBeCloseTo(22.36, 10);
    expect(g.height).toBeCloseTo(35.36, 10);
    expect((g.halfAngle * 180) / Math.PI).toBeCloseTo(35.55, 1);
  });

  it('sizes the head 12 px zoomed out, 12 → 26 px across the continent band (1.75 px per 0.25 zoom), 26 px from the zone band', () => {
    expect(pinDiameterAt(0.01)).toBe(12);
    expect(pinDiameterAt(PIN_SIZE.fromPxPerYard)).toBe(12);
    expect(pinDiameterAt(0.0239)).toBeCloseTo(12.8, 1);
    expect(pinDiameterAt(0.0325)).toBeCloseTo(15.94, 1);
    expect(pinDiameterAt(0.049)).toBeCloseTo(20.1, 1);
    expect(pinDiameterAt(PIN_SIZE.toPxPerYard)).toBe(26);
    expect(pinDiameterAt(1)).toBe(26);
    expect(pinDiameterAt(Number.NaN)).toBe(12);
    // One quarter-zoom step changes the head by 1.75 px inside the band.
    const px = 0.03;
    expect(pinDiameterAt(px * 2 ** 0.25) - pinDiameterAt(px)).toBeCloseTo(1.75, 10);
  });

  it('draws the pip staircase: five bars 2 px wide with 1 px gaps, 2 to 6 px tall, lit by difficulty', () => {
    const bars = pipBars('difficult');
    expect(bars.map((bar) => bar.x)).toEqual([0, 3, 6, 9, 12]);
    expect(bars.map((bar) => bar.height)).toEqual([2, 3, 4, 5, 6]);
    expect(bars.map((bar) => bar.lit)).toEqual([true, true, true, false, false]);
    expect(MARK_DIFFICULTIES.map((d) => PIPS_LIT[d])).toEqual([1, 2, 3, 4, 5]);
  });

  it('places badges on the 45° diagonals and keeps them, the tag and a pill inside the extent', () => {
    const r = 13;
    expect(badgeCentre('tl', r)).toEqual({ x: -10.4, y: -10.4 });
    expect(badgeCentre('br', r)).toEqual({ x: 10.4, y: 10.4 });
    const plain = pinExtent(26);
    const tagged = pinExtent(26, { tag: true, pill: true, selected: true });
    expect(tagged.left).toBeGreaterThan(plain.left);
    expect(tagged.right).toBeGreaterThan(plain.right);
    // The tag (18 px from 2.5 px inside the head's left) fits in the left extent.
    expect(tagged.left).toBeGreaterThanOrEqual(r - 2.5 + 18);
    // A badge disc (5 px radius) at a slot fits on every side.
    for (const slot of BADGE_SLOTS) {
      const c = badgeCentre(slot, r);
      const cy = -pinGeometry(26).centreToPoint + c.y;
      expect(Math.abs(c.x) + 5).toBeLessThanOrEqual(plain.left);
      expect(-cy + 5).toBeLessThanOrEqual(plain.up);
    }
    expect(plain.up).toBeGreaterThanOrEqual(Math.ceil(pinGeometry(26).height));
  });

  it('keeps pointer targets at least 24 px below D 20 (WCAG 2.2 SC 2.5.8)', () => {
    expect(pinTarget(12)).toMatchObject({ radius: 8, minSquare: 24 });
    expect(pinTarget(26)).toMatchObject({ radius: 15, minSquare: null });
    expect(pinTarget(26).headOffsetY).toBeCloseTo(-22.36, 10);
  });
});
