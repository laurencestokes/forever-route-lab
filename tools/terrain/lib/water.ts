import { components, type Components } from './components';
import type { MapMesh } from './link';

/**
 * The open-water rule (terrain-navigation.md §10; TN-10, U2): a swim polygon whose distance from
 * the nearest ground polygon, measured through water, exceeds N/2 is dropped, so open water wider
 * than N is not connected (N = 800 yd). Rivers and coasts of any length stay swimmable.
 *
 * The distance is a Dijkstra over swim polygons from every ground polygon: centroid to portal
 * midpoint to centroid, the swim starting at the shared edge when leaving the ground. The heap is
 * ordered by (distance, polygon id), with `Math.floor((i − 1) / 2)` parents (no bitwise operators).
 */

class MinHeap {
  private cost: number[] = [];
  private id: number[] = [];

  get size(): number {
    return this.cost.length;
  }

  private less(i: number, j: number): boolean {
    const a = this.cost[i] ?? 0;
    const b = this.cost[j] ?? 0;
    return a < b || (a === b && (this.id[i] ?? 0) < (this.id[j] ?? 0));
  }

  private swap(i: number, j: number): void {
    const c = this.cost[i] ?? 0;
    this.cost[i] = this.cost[j] ?? 0;
    this.cost[j] = c;
    const d = this.id[i] ?? 0;
    this.id[i] = this.id[j] ?? 0;
    this.id[j] = d;
  }

  push(cost: number, id: number): void {
    this.cost.push(cost);
    this.id.push(id);
    let i = this.cost.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Removes the smallest entry and returns [cost, id]. */
  pop(): [number, number] {
    const top: [number, number] = [this.cost[0] ?? 0, this.id[0] ?? 0];
    const lastCost = this.cost.pop() ?? 0;
    const lastId = this.id.pop() ?? 0;
    if (this.cost.length > 0) {
      this.cost[0] = lastCost;
      this.id[0] = lastId;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.cost.length && this.less(l, m)) m = l;
        if (r < this.cost.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** Through-water distance from the shore per polygon (0 for ground polygons, Infinity for swim polygons no shore reaches). */
export function shoreDistance(g: MapMesh): Float64Array {
  const d = new Float64Array(g.n).fill(Infinity);
  const heap = new MinHeap();
  for (let p = 0; p < g.n; p += 1) {
    if (g.swim[p] === 0) {
      d[p] = 0;
      heap.push(0, p);
    }
  }
  while (heap.size > 0) {
    const [c, p] = heap.pop();
    if (c > (d[p] ?? Infinity)) continue;
    const px = g.cx[p] ?? 0;
    const py = g.cy[p] ?? 0;
    for (let k = g.eFirst[p] ?? 0; k < (g.eFirst[p + 1] ?? 0); k += 1) {
      const q = g.eTo[k] ?? 0;
      if (g.swim[q] !== 1) continue;
      const mx = ((g.eAx[k] ?? 0) + (g.eBx[k] ?? 0)) / 2;
      const my = ((g.eAy[k] ?? 0) + (g.eBy[k] ?? 0)) / 2;
      const dx1 = mx - px;
      const dy1 = my - py;
      const dx2 = (g.cx[q] ?? 0) - mx;
      const dy2 = (g.cy[q] ?? 0) - my;
      const step = (g.swim[p] === 1 ? Math.sqrt(dx1 * dx1 + dy1 * dy1) : 0) + Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (c + step < (d[q] ?? Infinity)) {
        d[q] = c + step;
        heap.push(c + step, q);
      }
    }
  }
  return d;
}

/** The keep mask of the water rule: false for swim polygons farther than N/2 from the shore. N = 0 keeps everything. */
export function waterKeep(g: MapMesh, distance: Float64Array, openWaterYd: number): Uint8Array {
  const keep = new Uint8Array(g.n).fill(1);
  if (openWaterYd <= 0) return keep;
  for (let p = 0; p < g.n; p += 1) if (g.swim[p] === 1 && (distance[p] ?? Infinity) > openWaterYd / 2) keep[p] = 0;
  return keep;
}

export interface SplitPart {
  readonly polygons: number;
  /** Most common polygon zone of the part. */
  readonly zone: number;
  /** Mean centroid of the part's polygons, rounded to 1 yd. */
  readonly centroid: readonly [number, number];
  readonly zones: readonly (readonly [number, number])[];
}

export interface WaterSplit {
  /** Size of the component at N = ∞. */
  readonly fullPolygons: number;
  /** The parts of at least `minPart` polygons after the cut, largest first. */
  readonly parts: readonly SplitPart[];
}

/**
 * The diagnostic of §10: components that are one at N = ∞ and fall apart at N, with their parts
 * of at least `minPart` polygons. The largest part of each split is the one that keeps the name;
 * every other part needs a reviewed reason (gate G9).
 */
export function waterSplits(g: MapMesh, full: Components, keep: Uint8Array, minPart = 50): WaterSplit[] {
  const cut = components(g, undefined, (p) => keep[p] === 1);
  const parts = new Map<number, Map<number, number[]>>();
  for (let p = 0; p < g.n; p += 1) {
    if (keep[p] !== 1) continue;
    const fc = full.comp[p] ?? 0;
    const cc = cut.comp[p] ?? 0;
    let m = parts.get(fc);
    if (m === undefined) {
      m = new Map();
      parts.set(fc, m);
    }
    const list = m.get(cc);
    if (list === undefined) m.set(cc, [p]);
    else list.push(p);
  }
  const out: WaterSplit[] = [];
  for (const [fc, m] of [...parts].sort((a, b) => a[0] - b[0])) {
    const big = [...m.values()].filter((l) => l.length >= minPart).sort((a, b) => b.length - a.length || (a[0] ?? 0) - (b[0] ?? 0));
    if (big.length < 2) continue;
    out.push({
      fullPolygons: full.sizes[fc] ?? 0,
      parts: big.map((list) => {
        const z = new Map<number, number>();
        let sx = 0;
        let sy = 0;
        for (const p of list) {
          z.set(g.zone[p] ?? 0, (z.get(g.zone[p] ?? 0) ?? 0) + 1);
          sx += g.cx[p] ?? 0;
          sy += g.cy[p] ?? 0;
        }
        const zones = [...z].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        return { polygons: list.length, zone: zones[0]?.[0] ?? 0, centroid: [Math.round(sx / list.length), Math.round(sy / list.length)] as const, zones: zones.slice(0, 3) };
      }),
    });
  }
  return out;
}
