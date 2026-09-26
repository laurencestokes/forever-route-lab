import type { Vec3 } from './chunked';
import { MAP_ORIGIN_YD } from './grid';

/**
 * Placement transforms (terrain-navigation.md §3.4; wowdev.wiki ADT/v18 MDDF/MODF, WMO MODD):
 *
 * - ADT placement space → world: (X, Y, Z) = (ORIGIN − p[2], ORIGIN − p[0], p[1]);
 * - rotation R = Rz(b) · Ry(a) · Rx(c) of the stored degrees (a, b, c);
 * - world(v) = position + diag(−1, −1, 1) · R · (scale · v) for a model vertex v (x, y, z up).
 *
 * The determinant of diag(−1, −1, 1) · R is +1, so triangle winding is kept. A WMO doodad
 * composes the WMO's transform with its MODD quaternion (x, y, z, w), position and scale.
 * Trigonometry is fine in tools; the geometry builder quantises every vertex to 1/256 yd before
 * Recast, so last-bit differences cannot change the voxels (§3.3).
 */

/** Row-major 3 × 3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface Transform {
  readonly rotation: Mat3;
  readonly scale: number;
  /** World position of the model origin. */
  readonly position: Vec3;
}

export function placementToWorld(p0: number, p1: number, p2: number): Vec3 {
  return [MAP_ORIGIN_YD - p2, MAP_ORIGIN_YD - p0, p1];
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Rz(z) · Ry(y) · Rx(x), angles in radians. */
export function eulerZYX(z: number, y: number, x: number): Mat3 {
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const at = (i: number, j: number): number => (a[i * 3] ?? 0) * (b[j] ?? 0) + (a[i * 3 + 1] ?? 0) * (b[3 + j] ?? 0) + (a[i * 3 + 2] ?? 0) * (b[6 + j] ?? 0);
  return [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
}

/** Rotation matrix of a unit quaternion (x, y, z, w). */
export function quaternionMatrix(q: readonly [number, number, number, number]): Mat3 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

export function determinant(m: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** The transform of an MDDF or MODF placement: rotation (a, b, c) in degrees → Rz(b) · Ry(a) · Rx(c). */
export function placementTransform(position: Vec3, rotation: Vec3, scale: number): Transform {
  return { rotation: eulerZYX(radians(rotation[1]), radians(rotation[0]), radians(rotation[2])), scale, position };
}

/** A model vertex in world space. */
export function apply(t: Transform, x: number, y: number, z: number): Vec3 {
  const r = t.rotation;
  const ix = (r[0] * x + r[1] * y + r[2] * z) * t.scale;
  const iy = (r[3] * x + r[4] * y + r[5] * z) * t.scale;
  const iz = (r[6] * x + r[7] * y + r[8] * z) * t.scale;
  return [t.position[0] - ix, t.position[1] - iy, t.position[2] + iz];
}

/** A doodad (MODD entry) of a placed WMO. */
export function doodadTransform(wmo: Transform, doodad: { readonly position: Vec3; readonly rotation: readonly [number, number, number, number]; readonly scale: number }): Transform {
  return { rotation: multiply(wmo.rotation, quaternionMatrix(doodad.rotation)), scale: wmo.scale * doodad.scale, position: apply(wmo, doodad.position[0], doodad.position[1], doodad.position[2]) };
}
