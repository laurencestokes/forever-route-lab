import { insideRings, ringArea, type RingPoint } from './zone-rings';

/**
 * The pole of inaccessibility of a zone's rings (docs/research/map-presentation.md §13.2; step MP.7):
 * the point inside them farthest from every edge, where a zone label reads as belonging to the zone
 * (a frame's centre can lie in the sea or in a neighbour). Our own search over square cells, each
 * split in four while it could still hold a better point than the best found, until no cell can
 * beat it by more than `precision` yards. Pure and deterministic: no clock or randomness, and the
 * same rings always give the same point.
 *
 * The rings are even-odd (an enclave's ring is a hole), in world yards on one world map (D-017): the
 * pole places a label; it is never used as a distance.
 */

export interface Pole {
  readonly x: number;
  readonly y: number;
  /** Yards from the pole to the nearest edge (0 when the rings enclose nothing). */
  readonly distance: number;
}

/** The search stops refining at this many yards, or at 1 % of the rings' smaller side if that is larger. */
export const POLE_PRECISION_YARDS = 50;
/** At most this many cells are examined per zone (a bound on the work; far more than a zone needs). */
const MAX_CELLS = 4000;

/** Distance from (x, y) to the segment a-b, squared. */
function segmentDistanceSq(x: number, y: number, a: RingPoint, b: RingPoint): number {
  let px = a.x;
  let py = a.y;
  let dx = b.x - px;
  let dy = b.y - py;
  if (dx !== 0 || dy !== 0) {
    const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      px = b.x;
      py = b.y;
    } else if (t > 0) {
      px += dx * t;
      py += dy * t;
    }
  }
  dx = x - px;
  dy = y - py;
  return dx * dx + dy * dy;
}

/** Signed distance from (x, y) to the rings' edges: positive inside (even-odd), negative outside. */
export function signedDistanceToRings(rings: readonly (readonly RingPoint[])[], x: number, y: number): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (a !== undefined && b !== undefined) best = Math.min(best, segmentDistanceSq(x, y, a, b));
    }
  }
  const distance = Number.isFinite(best) ? Math.sqrt(best) : 0;
  return insideRings(rings, x, y) ? distance : -distance;
}

interface Cell {
  readonly x: number;
  readonly y: number;
  /** Half the cell's side. */
  readonly half: number;
  /** The signed distance at its centre. */
  readonly d: number;
  /** The best distance any point of the cell could have. */
  readonly max: number;
  /** Insertion order, the tie-break (deterministic). */
  readonly seq: number;
}

/** Cell `a` comes out of the queue before `b`: the larger `max`, then the earlier. */
const before = (a: Cell, b: Cell): boolean => a.max > b.max || (a.max === b.max && a.seq < b.seq);

/** A binary max-heap of cells. */
class CellQueue {
  private readonly items: Cell[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cell: Cell): void {
    const items = this.items;
    items.push(cell);
    let i = items.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      const up = items[parent];
      if (up === undefined || !before(cell, up)) break;
      items[i] = up;
      i = parent;
    }
    items[i] = cell;
  }

  pop(): Cell | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let pick = i;
      let pickCell = last;
      const l = items[left];
      if (l !== undefined && before(l, pickCell)) {
        pick = left;
        pickCell = l;
      }
      const r = items[right];
      if (r !== undefined && before(r, pickCell)) pick = right;
      if (pick === i) break;
      const moved = items[pick];
      if (moved === undefined) break;
      items[i] = moved;
      i = pick;
    }
    items[i] = last;
    return top;
  }
}

function cellAt(rings: readonly (readonly RingPoint[])[], x: number, y: number, half: number, seq: number): Cell {
  const d = signedDistanceToRings(rings, x, y);
  return { x, y, half, d, max: d + half * Math.SQRT2, seq };
}

/** The area-weighted centre of the largest ring (a first guess the search then improves on). */
function largestRingCentre(rings: readonly (readonly RingPoint[])[]): RingPoint | null {
  let best: readonly RingPoint[] | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  if (best === null || best.length === 0) return null;
  let cx = 0;
  let cy = 0;
  let sum = 0;
  for (let i = 0; i + 1 < best.length; i += 1) {
    const a = best[i];
    const b = best[i + 1];
    if (a === undefined || b === undefined) continue;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
    sum += cross;
  }
  if (sum === 0) return best[0] ?? null;
  return { x: cx / (3 * sum), y: cy / (3 * sum) };
}

/** The pole of inaccessibility of `rings` (even-odd), or null when they have no points. */
export function poleOf(rings: readonly (readonly RingPoint[])[], precision = POLE_PRECISION_YARDS): Pole | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null;
  const width = xMax - xMin;
  const height = yMax - yMin;
  const side = Math.min(width, height);
  if (side <= 0) return { x: xMin, y: yMin, distance: 0 };
  const stop = Math.max(precision, side / 100);
  // Cells over the bounding box, a quarter of the smaller side each.
  const size = side / 4;
  const queue = new CellQueue();
  let seq = 0;
  for (let x = xMin; x < xMax; x += size) for (let y = yMin; y < yMax; y += size) queue.push(cellAt(rings, x + size / 2, y + size / 2, size / 2, (seq += 1)));
  let best = cellAt(rings, xMin + width / 2, yMin + height / 2, 0, 0);
  const centre = largestRingCentre(rings);
  if (centre !== null) {
    const guess = cellAt(rings, centre.x, centre.y, 0, 0);
    if (guess.d > best.d) best = guess;
  }
  while (queue.size > 0 && seq < MAX_CELLS) {
    const cell = queue.pop();
    if (cell === undefined) break;
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= stop) continue;
    const half = cell.half / 2;
    for (const [dx, dy] of [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ] as const) queue.push(cellAt(rings, cell.x + dx, cell.y + dy, half, (seq += 1)));
  }
  return { x: best.x, y: best.y, distance: Math.max(0, best.d) };
}
