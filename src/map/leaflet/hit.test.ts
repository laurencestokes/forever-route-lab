import { describe, expect, it } from 'vitest';
import { pinGeometry } from '../marks-pins';
import { HIT_TIE_PX, MIN_TARGET_SQUARE, PinHitIndex, stackPins, targetContains, type PinTarget } from './pins';

/*
 * The pins' hit targets and stacks (docs/research/map-presentation.md §25.2.5, §25.2.7; step MP.4a):
 * the head plus 2 px and the triangle to the point, at least a 24 px square below D 20; the head
 * centre nearest the pointer wins, and a tie within 3 px, or a stack, opens a list.
 */

const target = (id: string, x: number, y: number, diameter = 26, list = false): PinTarget => ({ id, x, y, diameter, list });

/** The head centre of a pin whose point is (x, y). */
const head = (x: number, y: number, diameter = 26): { readonly x: number; readonly y: number } => ({ x, y: y - pinGeometry(diameter).centreToPoint });

describe('a pin’s target (§25.2.7)', () => {
  it('is its head circle plus 2 px, and the triangle down to its point', () => {
    const t = target('a', 100, 100);
    const h = head(100, 100);
    const r = pinGeometry(26).radius;
    expect(targetContains(t, h.x, h.y)).toBe(true);
    expect(targetContains(t, h.x + r + 1.9, h.y)).toBe(true);
    expect(targetContains(t, h.x + r + 2.1, h.y)).toBe(false);
    // The point itself, and just beside the triangle's sides.
    expect(targetContains(t, 100, 100)).toBe(true);
    expect(targetContains(t, 100, 99)).toBe(true);
    expect(targetContains(t, 108, 99)).toBe(false);
    // Below the point: nothing.
    expect(targetContains(t, 100, 103)).toBe(false);
  });

  it('is at least a 24 × 24 px square centred on the head below D 20 (WCAG 2.2 SC 2.5.8)', () => {
    const small = target('a', 100, 100, 12);
    const h = head(100, 100, 12);
    // The head alone is 6 + 2 px round; the square reaches 12 px each way.
    expect(targetContains(small, h.x + MIN_TARGET_SQUARE / 2 - 0.5, h.y + MIN_TARGET_SQUARE / 2 - 0.5)).toBe(true);
    expect(targetContains(small, h.x + MIN_TARGET_SQUARE / 2 + 0.5, h.y)).toBe(false);
    // From D 20 the square no longer applies: the corner of a 24 px square is outside a D 20 head.
    const big = target('b', 100, 100, 20);
    const hb = head(100, 100, 20);
    expect(targetContains(big, hb.x + 11.5, hb.y - 11.5)).toBe(false);
  });
});

describe('the hit index (§25.2.7)', () => {
  it('gives the pin whose head centre is nearest the pointer, not the one drawn on top', () => {
    // Two pins 12 px apart: both targets hold a point between them; the nearer head wins.
    const index = new PinHitIndex([target('north', 100, 100), target('south', 112, 100)]);
    const a = head(100, 100);
    expect(index.hit(a.x + 2, a.y)).toMatchObject({ nearest: 'north', ties: ['north'], list: false });
    expect(index.hit(a.x + 10, a.y)).toMatchObject({ nearest: 'south', list: false });
    expect(index.size).toBe(2);
  });

  it('opens a list for two heads within 3 px of the same distance, or for a stack', () => {
    const index = new PinHitIndex([target('a', 100, 100), target('b', 110, 100), target('stack', 400, 100, 26, true)]);
    const mid = head(105, 100);
    const hit = index.hit(mid.x, mid.y);
    expect(hit?.list).toBe(true);
    expect([...(hit?.ties ?? [])].sort()).toEqual(['a', 'b']);
    expect(HIT_TIE_PX).toBe(3);
    const s = head(400, 100);
    expect(index.hit(s.x, s.y)).toMatchObject({ nearest: 'stack', list: true });
    // Nothing under the pointer.
    expect(index.hit(250, 100)).toBeNull();
  });

  it('finds a pin across its grid cells (32 px)', () => {
    const index = new PinHitIndex([target('edge', 31, 63)]);
    const h = head(31, 63);
    for (const [dx, dy] of [
      [-10, -10],
      [10, -10],
      [-10, 10],
      [0, 20],
    ] as const) {
      const x = h.x + dx;
      const y = h.y + dy;
      if (targetContains(target('edge', 31, 63), x, y)) expect(index.hit(x, y)?.nearest).toBe('edge');
    }
  });
});

describe('stacks by spatial hash (§25.2.5)', () => {
  it('merges pins of one kind whose head centres lie within 0.4 D into the first, never pins of another kind', () => {
    const pins = [
      { id: 'a', kind: 'quest', x: 0, y: 0, diameter: 26 },
      { id: 'b', kind: 'quest', x: 10, y: 0, diameter: 26 },
      { id: 'c', kind: 'quest', x: 0, y: 10.5, diameter: 26 },
      { id: 'd', kind: 'turn-in', x: 1, y: 1, diameter: 26 },
      { id: 'e', kind: 'quest', x: 200, y: 0, diameter: 26 },
    ];
    const stacks = stackPins(pins);
    // 0.4 × 26 = 10.4: b joins a; c (10.5 away) leads its own; d is another kind; e is alone.
    expect([...stacks.entries()]).toEqual([['a', ['a', 'b']]]);
    // The same pins in the same order always give the same stacks, and a pan (a translation) too.
    expect([...stackPins(pins.map((pin) => ({ ...pin, x: pin.x + 1000.5, y: pin.y - 777 }))).entries()]).toEqual([['a', ['a', 'b']]]);
  });

  it('checks the eight cells around a pin’s own, so a neighbour across a cell edge still merges', () => {
    const stacks = stackPins([
      { id: 'a', kind: 'quest', x: 10.3, y: 10.3, diameter: 26 },
      { id: 'b', kind: 'quest', x: 10.5, y: 10.5, diameter: 26 },
      { id: 'c', kind: 'quest', x: 20.7, y: 10.3, diameter: 26 },
    ]);
    expect(stacks.get('a')).toEqual(['a', 'b', 'c']);
  });
});
