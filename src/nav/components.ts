import { NavMeshError, type NavMesh } from './mesh';

/**
 * Components (terrain-navigation.md §7.1; TN-02). They are computed at build time over the
 * whole map, after connectors, and stored in `map.bin`: at runtime "no walking path" between two
 * polygons of different components is an O(1) test that never depends on which blocks are
 * loaded. Index 0 is the main component; indices are ordered by size (largest first), then by
 * lowest polygon id. Every edge counts in both directions, one-way connectors included: the
 * search, not the component test, finds that a way back is missing.
 *
 * `recomputeComponents` relabels a fully loaded mesh with the same rule, so tests and validation
 * can check the stored components against the runtime mesh (0 mismatches expected).
 */

export const MAIN_COMPONENT = 0;

export const componentOf = (mesh: NavMesh, p: number): number => mesh.comp[p] ?? -1;

export const componentSize = (mesh: NavMesh, c: number): number => mesh.sizes[c] ?? 0;

/** True when polygons a and b are in one component (a walking path may exist). */
export const sameComponent = (mesh: NavMesh, a: number, b: number): boolean => (mesh.comp[a] ?? -1) === (mesh.comp[b] ?? -2);

export interface ComponentLabels {
  readonly comp: Int32Array;
  readonly sizes: Int32Array;
}

/** Components of the loaded mesh; every block must be loaded. */
export function recomputeComponents(mesh: NavMesh): ComponentLabels {
  if (mesh.loaded !== mesh.blockCount) throw new NavMeshError(`recomputeComponents needs every block: ${String(mesh.loaded)} of ${String(mesh.blockCount)} loaded`);
  const n = mesh.n;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while ((parent[r] ?? r) !== r) {
      const up = parent[parent[r] ?? r] ?? r;
      parent[r] = up;
      r = up;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  for (const b of mesh.loadedBlocks()) {
    const m = mesh.block(b);
    if (m === null) continue;
    for (let p = 0; p < m.np; p += 1) {
      const g = m.base + p;
      for (let s = m.polyFirst[p] ?? 0; s < (m.polyFirst[p + 1] ?? 0); s += 1) {
        const q = m.nei[s] ?? -1;
        if (q >= 0) union(g, m.base + q);
      }
      for (let k = m.cross.first[p] ?? 0; k < (m.cross.first[p + 1] ?? 0); k += 1) union(g, m.cross.to[k] ?? 0);
    }
    for (const side of m.sides) {
      if (side === null) continue;
      for (let k = 0; k < side.from.length; k += 1) union(side.from[k] ?? 0, side.to[k] ?? 0);
    }
  }
  for (const l of mesh.facts.links) union(l.from, l.to);
  // roots are the lowest id of each set (union keeps the smaller root)
  const rawSize = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    rawSize.set(r, (rawSize.get(r) ?? 0) + 1);
  }
  const order = [...rawSize.keys()].sort((a, b) => (rawSize.get(b) ?? 0) - (rawSize.get(a) ?? 0) || a - b);
  const rank = new Map<number, number>();
  order.forEach((r, i) => rank.set(r, i));
  const comp = new Int32Array(n);
  for (let i = 0; i < n; i += 1) comp[i] = rank.get(find(i)) ?? -1;
  return { comp, sizes: Int32Array.from(order.map((r) => rawSize.get(r) ?? 0)) };
}
