import type { MapMesh } from './link';

/**
 * Connected components over the whole map (terrain-navigation.md §7.1; TN-02). Every edge counts
 * in both directions (a one-way connector still joins its two ends into one component: the
 * search, not the component test, finds that the way back is missing). Component indices are
 * ordered by size (largest first), then by lowest polygon id; the main component is index 0.
 */

export interface Components {
  /** Component index per polygon. */
  readonly comp: Int32Array;
  /** Polygons per component, by index. */
  readonly sizes: readonly number[];
}

/**
 * `passable(edge, from, to)`, when given, can exclude edges (the water rule's cut). Polygons for
 * which `keep` is false are left out entirely: their component is −1.
 */
export function components(g: MapMesh, passable?: (edge: number, from: number, to: number) => boolean, keep?: (p: number) => boolean): Components {
  // undirected adjacency: every CSR edge plus its reverse
  const degree = new Int32Array(g.n + 1);
  const ok = (k: number, p: number, q: number): boolean => (keep === undefined || (keep(p) && keep(q))) && (passable === undefined || passable(k, p, q));
  for (let p = 0; p < g.n; p += 1) {
    for (let k = g.eFirst[p] ?? 0; k < (g.eFirst[p + 1] ?? 0); k += 1) {
      const q = g.eTo[k] ?? 0;
      if (!ok(k, p, q)) continue;
      degree[p] = (degree[p] ?? 0) + 1;
      degree[q] = (degree[q] ?? 0) + 1;
    }
  }
  const start = new Int32Array(g.n + 1);
  for (let p = 0; p < g.n; p += 1) start[p + 1] = (start[p] ?? 0) + (degree[p] ?? 0);
  const fill = Int32Array.from(start);
  const adj = new Int32Array(start[g.n] ?? 0);
  for (let p = 0; p < g.n; p += 1) {
    for (let k = g.eFirst[p] ?? 0; k < (g.eFirst[p + 1] ?? 0); k += 1) {
      const q = g.eTo[k] ?? 0;
      if (!ok(k, p, q)) continue;
      adj[fill[p] ?? 0] = q;
      fill[p] = (fill[p] ?? 0) + 1;
      adj[fill[q] ?? 0] = p;
      fill[q] = (fill[q] ?? 0) + 1;
    }
  }
  const raw = new Int32Array(g.n).fill(-1);
  const size0: number[] = [];
  const minId: number[] = [];
  const stack = new Int32Array(Math.max(1, g.n));
  for (let s = 0; s < g.n; s += 1) {
    if ((raw[s] ?? 0) >= 0) continue;
    if (keep !== undefined && !keep(s)) continue;
    const id = size0.length;
    let count = 0;
    let sp = 0;
    stack[sp] = s;
    sp += 1;
    raw[s] = id;
    while (sp > 0) {
      sp -= 1;
      const p = stack[sp] ?? 0;
      count += 1;
      for (let k = start[p] ?? 0; k < (start[p + 1] ?? 0); k += 1) {
        const q = adj[k] ?? 0;
        if ((raw[q] ?? 0) < 0) {
          raw[q] = id;
          stack[sp] = q;
          sp += 1;
        }
      }
    }
    size0.push(count);
    minId.push(s);
  }
  const order = size0.map((_, i) => i).sort((a, b) => (size0[b] ?? 0) - (size0[a] ?? 0) || (minId[a] ?? 0) - (minId[b] ?? 0));
  const rank = new Int32Array(order.length);
  order.forEach((c, r) => {
    rank[c] = r;
  });
  const comp = new Int32Array(g.n);
  for (let p = 0; p < g.n; p += 1) {
    const r = raw[p] ?? -1;
    comp[p] = r < 0 ? -1 : (rank[r] ?? -1);
  }
  return { comp, sizes: order.map((c) => size0[c] ?? 0) };
}
