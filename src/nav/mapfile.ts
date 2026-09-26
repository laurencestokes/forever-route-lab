import { ByteReader } from './bytes';

/**
 * Decoder of the per-map file `public/nav/<mapId>/map.bin` (terrain-navigation.md §5, RC-03):
 * the stage-2 facts of a map (components, connector links, unverified-passage tags), loaded before
 * the first query of the map (§7.1, §9.6).
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
 *
 * Strict in the same ways as `tools/terrain/lib/mapfile.ts`; throws `NavFormatError`.
 */

export const MAP_MAGIC = 'FRNM';
export const MAP_VERSION = 1;

/** A directed off-mesh link: a connector (§11.2). Polygon ids are global ids of the map. */
export interface ConnectorLink {
  /** Index into the manifest's `connectors` list. */
  readonly connector: number;
  readonly from: number;
  readonly to: number;
  /** Wait plus ride (or cast) time, in tenth-seconds. */
  readonly costTenths: number;
}

export interface PassageTag {
  /** Index into the manifest's `passages` list. */
  readonly passage: number;
  /** Tagged global polygon ids, ascending. */
  readonly polygons: readonly number[];
}

export interface MapFacts {
  readonly mapId: number;
  readonly blockCount: number;
  readonly polygonCount: number;
  /** Polygons per component, by component index (0 = main). */
  readonly sizes: Int32Array;
  /** Component index per global polygon id. */
  readonly comp: Int32Array;
  readonly links: readonly ConnectorLink[];
  readonly passages: readonly PassageTag[];
}

export function decodeMapFile(bytes: Uint8Array, what = 'map.bin'): MapFacts {
  const r = new ByteReader(bytes, what);
  if (r.ascii(4) !== MAP_MAGIC) r.fail('not a FRNM file');
  const version = r.byte();
  if (version !== MAP_VERSION) r.fail(`version ${String(version)}, expected ${String(MAP_VERSION)}`);
  const mapId = r.u();
  const blockCount = r.u();
  const polygonCount = r.u();
  const componentCount = r.bounded(polygonCount, 'component count');
  const sizes = new Int32Array(componentCount);
  let total = 0;
  for (let i = 0; i < componentCount; i += 1) {
    const s = r.bounded(polygonCount, 'component size');
    if (s === 0) r.fail('empty component');
    if (i > 0 && s > (sizes[i - 1] ?? 0)) r.fail('components not ordered by size');
    sizes[i] = s;
    total += s;
  }
  if (total !== polygonCount) r.fail(`component sizes sum to ${String(total)}, not ${String(polygonCount)}`);
  const comp = new Int32Array(polygonCount);
  const counted = new Int32Array(componentCount);
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
  for (let c = 0; c < componentCount; c += 1) {
    if (counted[c] !== sizes[c]) r.fail(`component ${String(c)} has ${String(counted[c] ?? 0)} polygons, its size says ${String(sizes[c] ?? 0)}`);
  }
  const linkCount = r.u();
  const links: ConnectorLink[] = [];
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
