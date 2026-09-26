/**
 * The simple stupid funnel (the algorithm of Detour's `findStraightPath`, reimplemented, not
 * copied; terrain-navigation.md §9.1) through one walking piece of a corridor, then the
 * ground/swim split: the path crosses portal i at one point, and between consecutive crossings it
 * is straight inside corridor polygon i, so each piece is ground or swim by that polygon.
 *
 * The same expressions as the build's G10-checked reference (`tools/terrain/lib/legs.ts`), so the
 * shipped runtime and the implementation check measure the same thing. Lengths are horizontal
 * (2D), a labelled assumption (RC-13); with `heights`, `length3d` lifts every crossing to its
 * portal's interpolated height (the mesh has no detail heights) to report the size of that
 * assumption, and the corners carry heights for drawing.
 */

/**
 * One piece: `m` corridor polygons, portals 1 … m − 1 between them. Index 0 of the portal arrays
 * is the start point, index m the end point, index i the portal into polygon i, as seen walking
 * forward (left and right endpoints, with heights). Arrays may be longer than m + 1 (reused
 * buffers).
 */
export interface FunnelInput {
  readonly m: number;
  readonly lx: Float64Array;
  readonly ly: Float64Array;
  readonly lz: Float64Array;
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  readonly rz: Float64Array;
  /** 1 when corridor polygon i (0 … m − 1) is a swim polygon. */
  readonly swim: Uint8Array;
  /** Interpolate heights (corners and `length3d`); off, heights are 0 and `length3d` is 0. */
  readonly heights?: boolean;
}

export interface FunnelResult {
  readonly ground: number;
  readonly swim: number;
  readonly longestSwim: number;
  /** Straight-path corners as x, y, z triples, start and end included. */
  readonly corners: readonly number[];
  /** The 3D length through the portal crossings, each at its portal's interpolated height (with `heights`). */
  readonly length3d: number;
}

/** Reusable crossing buffers. */
export class FunnelWork {
  cx = new Float64Array(256);
  cy = new Float64Array(256);
  cz = new Float64Array(256);

  ensure(n: number): void {
    if (n <= this.cx.length) return;
    let size = this.cx.length;
    while (size < n) size *= 2;
    this.cx = new Float64Array(size);
    this.cy = new Float64Array(size);
    this.cz = new Float64Array(size);
  }
}

const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);

const len = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
};

export function funnel(f: FunnelInput, work: FunnelWork = new FunnelWork()): FunnelResult {
  const { m, lx: Lx, ly: Ly, lz: Lz, rx: Rx, ry: Ry, rz: Rz } = f;
  const heights = f.heights === true;
  const sx = Lx[0] ?? 0;
  const sy = Ly[0] ?? 0;
  const ex = Lx[m] ?? 0;
  const ey = Ly[m] ?? 0;
  const pts: number[] = [sx, sy, Lz[0] ?? 0];
  const ptPortal: number[] = [0];
  let ax = sx;
  let ay = sy;
  let lx = sx;
  let ly = sy;
  let lz = Lz[0] ?? 0;
  let rx = sx;
  let ry = sy;
  let rz = Lz[0] ?? 0;
  let li = 0;
  let ri = 0;
  for (let i = 1; i <= m; i += 1) {
    const plx = Lx[i] ?? 0;
    const ply = Ly[i] ?? 0;
    const prx = Rx[i] ?? 0;
    const pry = Ry[i] ?? 0;
    if (tri(ax, ay, rx, ry, prx, pry) <= 0) {
      if ((ax === rx && ay === ry) || tri(ax, ay, lx, ly, prx, pry) > 0) {
        rx = prx;
        ry = pry;
        rz = Rz[i] ?? 0;
        ri = i;
      } else {
        pts.push(lx, ly, lz);
        ptPortal.push(li);
        ax = lx;
        ay = ly;
        const ai = li;
        rx = ax;
        ry = ay;
        rz = lz;
        ri = ai;
        i = ai;
        li = ai;
        continue;
      }
    }
    if (tri(ax, ay, lx, ly, plx, ply) >= 0) {
      if ((ax === lx && ay === ly) || tri(ax, ay, rx, ry, plx, ply) < 0) {
        lx = plx;
        ly = ply;
        lz = Lz[i] ?? 0;
        li = i;
      } else {
        pts.push(rx, ry, rz);
        ptPortal.push(ri);
        ax = rx;
        ay = ry;
        const ai = ri;
        lx = ax;
        ly = ay;
        lz = rz;
        li = ai;
        i = ai;
        ri = ai;
        continue;
      }
    }
  }
  const np = ptPortal.length;
  if (pts[(np - 1) * 3] !== ex || pts[(np - 1) * 3 + 1] !== ey || ptPortal[np - 1] !== m) {
    pts.push(ex, ey, Lz[m] ?? 0);
    ptPortal.push(m);
  }
  // crossing point of each portal
  work.ensure(m + 1);
  const cxs = work.cx;
  const cys = work.cy;
  const czs = work.cz;
  cxs[0] = sx;
  cys[0] = sy;
  czs[0] = Lz[0] ?? 0;
  cxs[m] = ex;
  cys[m] = ey;
  czs[m] = Lz[m] ?? 0;
  let seg = 0;
  for (let i = 1; i < m; i += 1) {
    while (seg + 1 < ptPortal.length && (ptPortal[seg + 1] ?? 0) < i) seg += 1;
    const x0 = pts[seg * 3] ?? 0;
    const y0 = pts[seg * 3 + 1] ?? 0;
    let cx: number;
    let cy: number;
    if (ptPortal[seg] === i) {
      cx = x0;
      cy = y0;
    } else {
      const x1 = pts[seg * 3 + 3] ?? 0;
      const y1 = pts[seg * 3 + 4] ?? 0;
      if (ptPortal[seg + 1] === i) {
        cx = x1;
        cy = y1;
      } else {
        const qx = Lx[i] ?? 0;
        const qy = Ly[i] ?? 0;
        const ux = (Rx[i] ?? 0) - qx;
        const uy = (Ry[i] ?? 0) - qy;
        const vx = x1 - x0;
        const vy = y1 - y0;
        const den = vx * uy - vy * ux;
        let s = den !== 0 ? ((qx - x0) * uy - (qy - y0) * ux) / den : 0;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        cx = x0 + s * vx;
        cy = y0 + s * vy;
      }
    }
    cxs[i] = cx;
    cys[i] = cy;
    if (heights) {
      // the crossing's position along the portal, clamped, between the portal's end heights
      const qx = Lx[i] ?? 0;
      const qy = Ly[i] ?? 0;
      const ux = (Rx[i] ?? 0) - qx;
      const uy = (Ry[i] ?? 0) - qy;
      const u2 = ux * ux + uy * uy;
      let t = u2 > 0 ? ((cx - qx) * ux + (cy - qy) * uy) / u2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qz = Lz[i] ?? 0;
      czs[i] = qz + ((Rz[i] ?? 0) - qz) * t;
    }
  }
  let ground = 0;
  let swim = 0;
  let runLen = 0;
  let longest = 0;
  let length3d = 0;
  for (let i = 0; i < m; i += 1) {
    const d = len(cxs[i] ?? 0, cys[i] ?? 0, cxs[i + 1] ?? 0, cys[i + 1] ?? 0);
    if (heights) {
      const dz = (czs[i + 1] ?? 0) - (czs[i] ?? 0);
      length3d += Math.sqrt(d * d + dz * dz);
    }
    if (f.swim[i] === 1) {
      swim += d;
      runLen += d;
      if (runLen > longest) longest = runLen;
    } else {
      ground += d;
      runLen = 0;
    }
  }
  return { ground, swim, longestSwim: longest, corners: pts, length3d };
}
