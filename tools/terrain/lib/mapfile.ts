import type { OffMeshLink } from './link';
import { ByteReader, ByteWriter } from './varint';

/**
 * The per-map file `public/nav/<mapId>/map.bin` (terrain-navigation.md §5, RC-03): the stage-2
 * facts that change with connectors, pruning or the dataset, kept out of the blocks so such a
 * change rewrites this file and only the blocks whose pruning changes.
 *
 * ```
 * 'FRNM'  u8 version = 1
 * varint mapId, varint blockCount, varint polygonCount   (must equal the manifest's block list)
 * components:
 *   varint componentCount
 *   componentCount × varint size                         (polygons; index order = size desc, then lowest polygon id)
 *   varint runCount
 *   runCount × (varint component index, varint run length) over global polygon ids 0..polygonCount−1
 * connector links (directed):
 *   varint linkCount
 *   linkCount × (varint connector index, varint from polygon, varint to polygon, varint cost tenth-seconds)
 * unverified passages:
 *   varint passageCount
 *   passageCount × (varint passage index, varint runCount, runCount × (zig start − previous run end, varint run length))
 * ```
 */

export const MAP_MAGIC = 'FRNM';
export const MAP_VERSION = 1;

export interface PassageTag {
  /** Index into the manifest's `passages` list. */
  readonly passage: number;
  /** Tagged global polygon ids, ascending. */
  readonly polygons: readonly number[];
}

export interface MapFile {
  readonly mapId: number;
  readonly blockCount: number;
  readonly polygonCount: number;
  readonly sizes: readonly number[];
  /** Component index per global polygon id. */
  readonly comp: Int32Array;
  readonly links: readonly OffMeshLink[];
  readonly passages: readonly PassageTag[];
}

/** Runs of equal values: [value, length] pairs. */
export function runs(values: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? 0;
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === v) last[1] += 1;
    else out.push([v, 1]);
  }
  return out;
}

/** Runs of consecutive ids in an ascending list: [start, length] pairs. */
export function idRuns(ids: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const id of ids) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0] + last[1] === id) last[1] += 1;
    else out.push([id, 1]);
  }
  return out;
}

export function encodeMapFile(m: MapFile): Buffer {
  if (m.comp.length !== m.polygonCount) throw new RangeError('encodeMapFile: one component per polygon');
  const w = new ByteWriter();
  w.ascii(MAP_MAGIC);
  w.byte(MAP_VERSION);
  w.u(m.mapId);
  w.u(m.blockCount);
  w.u(m.polygonCount);
  w.u(m.sizes.length);
  for (const s of m.sizes) w.u(s);
  const r = runs(m.comp);
  w.u(r.length);
  for (const [c, n] of r) {
    if (c < 0 || c >= m.sizes.length) throw new RangeError(`encodeMapFile: component ${String(c)} of ${String(m.sizes.length)}`);
    w.u(c);
    w.u(n);
  }
  w.u(m.links.length);
  for (const l of m.links) {
    w.u(l.connector);
    w.u(l.from);
    w.u(l.to);
    w.u(l.costTenths);
  }
  w.u(m.passages.length);
  for (const p of m.passages) {
    w.u(p.passage);
    const pr = idRuns(p.polygons);
    w.u(pr.length);
    let end = 0;
    for (const [start, n] of pr) {
      w.z(start - end);
      w.u(n);
      end = start + n;
    }
  }
  return w.bytes();
}

export function decodeMapFile(bytes: Uint8Array, what = 'map.bin'): MapFile {
  const r = new ByteReader(bytes, what);
  if (r.ascii(4) !== MAP_MAGIC) r.fail('not a FRNM file');
  const version = r.byte();
  if (version !== MAP_VERSION) r.fail(`version ${String(version)}, expected ${String(MAP_VERSION)}`);
  const mapId = r.u();
  const blockCount = r.u();
  const polygonCount = r.u();
  const componentCount = r.bounded(polygonCount, 'component count');
  const sizes: number[] = [];
  let total = 0;
  for (let i = 0; i < componentCount; i += 1) {
    const s = r.bounded(polygonCount, 'component size');
    if (s === 0) r.fail('empty component');
    if (i > 0 && s > (sizes[i - 1] ?? 0)) r.fail('components not ordered by size');
    sizes.push(s);
    total += s;
  }
  if (total !== polygonCount) r.fail(`component sizes sum to ${String(total)}, not ${String(polygonCount)}`);
  const comp = new Int32Array(polygonCount);
  const counted = new Array<number>(componentCount).fill(0);
  const runCount = r.bounded(polygonCount, 'run count');
  let at = 0;
  for (let i = 0; i < runCount; i += 1) {
    const c = r.bounded(componentCount - 1, 'component index');
    const n = r.bounded(polygonCount - at, 'run length');
    if (n === 0) r.fail('empty run');
    comp.fill(c, at, at + n);
    counted[c] = (counted[c] ?? 0) + n;
    at += n;
  }
  if (at !== polygonCount) r.fail(`runs cover ${String(at)} of ${String(polygonCount)} polygons`);
  counted.forEach((n, c) => {
    if (n !== sizes[c]) r.fail(`component ${String(c)} has ${String(n)} polygons, its size says ${String(sizes[c])}`);
  });
  const linkCount = r.u();
  const links: OffMeshLink[] = [];
  for (let i = 0; i < linkCount; i += 1) {
    const connector = r.u();
    const from = r.bounded(polygonCount - 1, 'link source');
    const to = r.bounded(polygonCount - 1, 'link target');
    links.push({ connector, from, to, costTenths: r.u() });
  }
  const passageCount = r.u();
  const passages: PassageTag[] = [];
  for (let i = 0; i < passageCount; i += 1) {
    const passage = r.u();
    const n = r.bounded(polygonCount, 'passage run count');
    const polygons: number[] = [];
    let end = 0;
    for (let j = 0; j < n; j += 1) {
      const start = end + r.z();
      const len = r.u();
      if (start < end || (j > 0 && start === end) || len === 0 || start + len > polygonCount) r.fail('bad passage run');
      for (let p = start; p < start + len; p += 1) polygons.push(p);
      end = start + len;
    }
    passages.push({ passage, polygons });
  }
  r.end();
  return { mapId, blockCount, polygonCount, sizes, comp, links, passages };
}
