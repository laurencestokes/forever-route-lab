import { describe, expect, it } from 'vitest';
import { funnel } from './funnel';
import { CostHeap } from './heap';

describe('CostHeap (terrain-navigation.md §9.1)', () => {
  it('pops in (cost, id) order through ties, duplicates and growth', () => {
    const h = new CostHeap();
    const pushed: [number, number][] = [];
    let s = 12345;
    for (let i = 0; i < 5000; i += 1) {
      s = (s * 48271) % 2147483647;
      const cost = s % 50; // many equal costs
      const id = Math.floor(s / 50) % 400; // and repeated ids
      h.push(cost, id);
      pushed.push([cost, id]);
    }
    expect(h.size).toBe(5000);
    const popped: [number, number][] = [];
    while (h.size > 0) {
      const cost = h.topCost();
      popped.push([cost, h.pop()]);
    }
    expect(popped).toEqual([...pushed].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });
});

describe('funnel (§9.1)', () => {
  const piece = (pts: readonly (readonly [number, number, number, number])[], swim: readonly number[]): ReturnType<typeof funnel> => {
    // pts: per portal index 0..m: left x, left y, right x, right y
    const m = pts.length - 1;
    const arr = (k: number): Float64Array => Float64Array.from(pts.map((p) => p[k] ?? 0));
    return funnel({ m, lx: arr(0), ly: arr(1), lz: new Float64Array(m + 1), rx: arr(2), ry: arr(3), rz: new Float64Array(m + 1), swim: Uint8Array.from(swim) });
  };

  it('goes straight when every portal lets the line through, and splits by corridor polygon', () => {
    // along +x through portals at x = 10 and x = 20, each spanning y −5..5 (left is +y when walking +x)
    const r = piece(
      [
        [0, 0, 0, 0],
        [10, 5, 10, -5],
        [20, 5, 20, -5],
        [30, 0, 30, 0],
      ],
      [0, 1, 0],
    );
    expect(r.ground).toBeCloseTo(20, 12);
    expect(r.swim).toBeCloseTo(10, 12);
    expect(r.longestSwim).toBeCloseTo(10, 12);
    expect(r.corners).toEqual([0, 0, 0, 30, 0, 0]);
  });

  it('bends at a portal end the straight line misses', () => {
    // the portal at x = 10 spans y 2..8 only: the path bends at (10, 2)
    const r = piece(
      [
        [0, 0, 0, 0],
        [10, 8, 10, 2],
        [20, 0, 20, 0],
      ],
      [0, 0],
    );
    expect(r.ground).toBeCloseTo(2 * Math.sqrt(104), 12);
    expect(r.corners).toEqual([0, 0, 0, 10, 2, 0, 20, 0, 0]);
  });
});
