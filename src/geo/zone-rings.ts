/**
 * Terrain zone rings (docs/research/map-presentation.md §5.3, §12.4, §12.6, §13.2; steps MP.7 and
 * MP.10): each AreaTable area's closed rings on one world map, chained from the D-032 zone arcs
 * (`public/maps/terrain/<map>/zones.json`, whose arcs name the area on either side). They anchor the
 * zone labels (`pole.ts`) and outline the zone fill (the fallback tint and the faction hatching).
 *
 * Pure and deterministic: no DOM, clock, randomness or bitwise operator; the same arcs always give
 * the same rings in the same order. Points are world yards on one world map (D-017): the rings are
 * drawn and used to place labels, never measured as a distance.
 *
 * The arcs follow the terrain's chunk grid, so a ring is the union of an area's terrain chunks: it
 * can take in coastal water the area's chunks cover, and islands and enclaves give an area several
 * rings (an enclave, such as a city inside its zone, is a ring the zone's even-odd fill leaves out).
 */

export interface RingPoint {
  readonly x: number;
  readonly y: number;
}

/** One area's rings on a world map: each closed (the first point repeated last), in chaining order. */
export interface ZoneRings<P extends RingPoint = RingPoint> {
  readonly areaId: number;
  readonly rings: readonly (readonly P[])[];
}

const keyOf = (p: RingPoint): string => `${String(p.x)},${String(p.y)}`;

/**
 * Every area's rings (areas above 0, ascending): the arcs that have the area on one side, chained
 * end to end whichever way each runs. An arc that is already closed is a ring of its own. Arcs that
 * cannot be closed (a broken file) are dropped, never guessed across.
 */
export function zoneRingsOf<P extends RingPoint>(lines: readonly (readonly P[])[], sides: readonly (readonly [number, number])[]): readonly ZoneRings<P>[] {
  const byArea = new Map<number, (readonly P[])[]>();
  lines.forEach((line, index) => {
    const side = sides[index];
    if (side === undefined || line.length < 2) return;
    for (const area of new Set(side)) {
      if (area <= 0) continue;
      const list = byArea.get(area) ?? [];
      list.push(line);
      byArea.set(area, list);
    }
  });
  return [...byArea.keys()]
    .sort((a, b) => a - b)
    .map((areaId) => ({ areaId, rings: chain(byArea.get(areaId) ?? []) }))
    .filter((entry) => entry.rings.length > 0);
}

/** Chains arcs into closed rings, greedily, in input order; arcs left open are dropped. */
function chain<P extends RingPoint>(arcs: readonly (readonly P[])[]): readonly (readonly P[])[] {
  const used = arcs.map(() => false);
  // Arcs by their end points, so each join is a lookup.
  const ends = new Map<string, number[]>();
  arcs.forEach((arc, index) => {
    const first = arc[0];
    const last = arc[arc.length - 1];
    if (first === undefined || last === undefined) return;
    for (const key of new Set([keyOf(first), keyOf(last)])) {
      const list = ends.get(key) ?? [];
      list.push(index);
      ends.set(key, list);
    }
  });
  const rings: (readonly P[])[] = [];
  arcs.forEach((arc, start) => {
    if (used[start]) return;
    used[start] = true;
    const ring: P[] = [...arc];
    const head = ring[0];
    if (head === undefined) return;
    const headKey = keyOf(head);
    for (;;) {
      const tail = ring[ring.length - 1];
      if (tail === undefined) break;
      const tailKey = keyOf(tail);
      if (ring.length > 2 && tailKey === headKey) break;
      const next = (ends.get(tailKey) ?? []).find((index) => !used[index]);
      if (next === undefined) break;
      used[next] = true;
      const other = arcs[next] ?? [];
      const forward = other[0] !== undefined && keyOf(other[0]) === tailKey;
      const points = forward ? other : [...other].reverse();
      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        if (point !== undefined) ring.push(point);
      }
    }
    const tail = ring[ring.length - 1];
    if (ring.length >= 4 && tail !== undefined && keyOf(tail) === headKey) rings.push(ring);
  });
  return rings;
}

/** A ring's area in square yards (unsigned; the shoelace formula over its closed points). */
export function ringArea(ring: readonly RingPoint[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a !== undefined && b !== undefined) sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

/** Whether a point lies inside the rings by the even-odd rule (an enclave's ring cuts a hole). */
export function insideRings(rings: readonly (readonly RingPoint[])[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if (a === undefined || b === undefined) continue;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}
