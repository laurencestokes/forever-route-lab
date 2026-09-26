/**
 * Synthetic WDT, ADT, obj0, WMO and M2 files for tests, built from the documented layouts (no
 * client bytes). Positions are in each file's own space: ADT placement space for obj0, model space
 * for WMO and M2 vertices.
 */
import { MAP_ORIGIN_YD, TILE_YD, CHUNK_YD } from './grid';

export function chunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write([...id].reverse().join(''), 0, 'latin1');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

const u32 = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
};
const f32s = (values: readonly number[]): Buffer => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
};

const MVER = chunk('MVER', u32(18));

// ---------------------------------------------------------------------------------------------
// WDT

export interface SynthWdtTile {
  readonly row: number;
  readonly col: number;
  readonly root: number;
  readonly obj0: number;
}

export function wdtFile(tiles: readonly SynthWdtTile[]): Buffer {
  const main = Buffer.alloc(4096 * 8);
  const maid = Buffer.alloc(4096 * 32);
  for (const t of tiles) {
    const i = t.row * 64 + t.col;
    main.writeUInt32LE(1, i * 8);
    maid.writeUInt32LE(t.root, i * 32);
    maid.writeUInt32LE(t.obj0, i * 32 + 4);
    maid.writeUInt32LE(t.obj0 + 1, i * 32 + 8);
    maid.writeUInt32LE(t.obj0 + 2, i * 32 + 12);
    maid.writeUInt32LE(9999, i * 32 + 28);
  }
  return Buffer.concat([MVER, chunk('MPHD', Buffer.concat([u32(0x80), Buffer.alloc(28)])), chunk('MAIN', main), chunk('MAID', maid)]);
}

// ---------------------------------------------------------------------------------------------
// Root ADT

export interface SynthMcnk {
  readonly ix: number;
  readonly iy: number;
  readonly areaId: number;
  /** 145 heights (default flat 0). */
  readonly heights?: readonly number[];
  /** Quads (row · 8 + col) that are holes, as high-resolution holes. */
  readonly holes?: readonly number[];
  /** Low-resolution hole bits (flag 0x10000 clear). */
  readonly lowResHoles?: number;
  readonly baseZ?: number;
}

/** The world position MCNK (ix, iy) of tile (row, col) stores. */
export function chunkCorner(row: number, col: number, iy: number, ix: number): readonly [number, number] {
  return [MAP_ORIGIN_YD - row * TILE_YD - iy * CHUNK_YD, MAP_ORIGIN_YD - col * TILE_YD - ix * CHUNK_YD];
}

export function mcnk(row: number, col: number, c: SynthMcnk): Buffer {
  const header = Buffer.alloc(0x80);
  const highRes = c.lowResHoles === undefined;
  header.writeUInt32LE(highRes ? 0x10000 : 0, 0);
  header.writeUInt32LE(c.ix, 4);
  header.writeUInt32LE(c.iy, 8);
  if (highRes) {
    for (const q of c.holes ?? []) {
      const at = 0x14 + Math.floor(q / 8);
      header.writeUInt8(header.readUInt8(at) + 2 ** (q % 8), at);
    }
  } else {
    header.writeUInt16LE(c.lowResHoles ?? 0, 0x3c);
  }
  header.writeUInt32LE(c.areaId, 0x34);
  const [x, y] = chunkCorner(row, col, c.iy, c.ix);
  header.writeFloatLE(x, 0x68);
  header.writeFloatLE(y, 0x6c);
  header.writeFloatLE(c.baseZ ?? 0, 0x70);
  const heights = c.heights ?? new Array<number>(145).fill(0);
  return chunk('MCNK', Buffer.concat([header, chunk('MCVT', f32s(heights)), chunk('MCNR', Buffer.alloc(448))]));
}

export interface SynthLiquidInstance {
  readonly type: number;
  readonly objectOrFormat: number;
  readonly min: number;
  readonly max: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Row-major existence flags (omitted: all present). */
  readonly exists?: readonly boolean[];
  /** (width + 1) × (height + 1) heights, written for formats 0, 1 and 3. */
  readonly heights?: readonly number[];
}

export interface SynthChunkLiquid {
  readonly index: number;
  readonly instances: readonly SynthLiquidInstance[];
  /** Quads (row · 8 + col) with the deep bit. */
  readonly deep?: readonly number[];
}

export function mh2o(chunks: readonly SynthChunkLiquid[]): Buffer {
  const headers = Buffer.alloc(256 * 12);
  const data: Buffer[] = [];
  let offset = headers.length;
  const append = (b: Buffer): number => {
    const at = offset;
    data.push(b);
    offset += b.length;
    return at;
  };
  for (const c of chunks) {
    const instanceBlock = Buffer.alloc(24 * c.instances.length);
    const instancesAt = append(instanceBlock);
    c.instances.forEach((l, k) => {
      const p = k * 24;
      instanceBlock.writeUInt16LE(l.type, p);
      instanceBlock.writeUInt16LE(l.objectOrFormat, p + 2);
      instanceBlock.writeFloatLE(l.min, p + 4);
      instanceBlock.writeFloatLE(l.max, p + 8);
      instanceBlock.writeUInt8(l.x, p + 12);
      instanceBlock.writeUInt8(l.y, p + 13);
      instanceBlock.writeUInt8(l.width, p + 14);
      instanceBlock.writeUInt8(l.height, p + 15);
      if (l.exists !== undefined) {
        const bitmap = Buffer.alloc(Math.ceil((l.width * l.height) / 8));
        l.exists.forEach((e, i) => {
          if (e) bitmap.writeUInt8(bitmap.readUInt8(Math.floor(i / 8)) + 2 ** (i % 8), Math.floor(i / 8));
        });
        instanceBlock.writeUInt32LE(append(bitmap), p + 16);
      }
      if (l.heights !== undefined) instanceBlock.writeUInt32LE(append(f32s(l.heights)), p + 20);
    });
    let attributesAt = 0;
    if (c.deep !== undefined) {
      const attributes = Buffer.alloc(16);
      for (const q of c.deep) attributes.writeUInt8(attributes.readUInt8(8 + Math.floor(q / 8)) + 2 ** (q % 8), 8 + Math.floor(q / 8));
      attributesAt = append(attributes);
    }
    headers.writeUInt32LE(c.instances.length > 0 ? instancesAt : 0, c.index * 12);
    headers.writeUInt32LE(c.instances.length, c.index * 12 + 4);
    headers.writeUInt32LE(attributesAt, c.index * 12 + 8);
  }
  return chunk('MH2O', Buffer.concat([headers, ...data]));
}

/** A root ADT of tile (row, col): 256 chunks (flat at z 0 unless given), optional MH2O. */
export function adtRoot(row: number, col: number, overrides: readonly SynthMcnk[] = [], liquids: readonly SynthChunkLiquid[] | null = null, areaId = 14): Buffer {
  const parts: Buffer[] = [MVER, chunk('MHDR', Buffer.alloc(64))];
  if (liquids !== null) parts.push(mh2o(liquids));
  for (let iy = 0; iy < 16; iy += 1) {
    for (let ix = 0; ix < 16; ix += 1) parts.push(mcnk(row, col, overrides.find((o) => o.ix === ix && o.iy === iy) ?? { ix, iy, areaId }));
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------
// obj0

export interface SynthPlacement {
  readonly fileDataId: number;
  readonly uniqueId: number;
  /** ADT placement space (p0, p1 = height, p2). */
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale?: number;
  readonly legacyName?: boolean;
  /** WMO only. */
  readonly doodadSet?: number;
  readonly nameSet?: number;
  readonly extentsMin?: readonly [number, number, number];
  readonly extentsMax?: readonly [number, number, number];
}

/** World (X, Y, Z) → ADT placement space (p0, p1, p2). */
export function worldToPlacement(x: number, y: number, z: number): [number, number, number] {
  return [MAP_ORIGIN_YD - y, z, MAP_ORIGIN_YD - x];
}

export function obj0File(m2s: readonly SynthPlacement[], wmos: readonly SynthPlacement[]): Buffer {
  const mddf = Buffer.alloc(36 * m2s.length);
  m2s.forEach((p, i) => {
    const o = i * 36;
    mddf.writeUInt32LE(p.fileDataId, o);
    mddf.writeUInt32LE(p.uniqueId, o + 4);
    f32s([...p.position, ...(p.rotation ?? [0, 0, 0])]).copy(mddf, o + 8);
    mddf.writeUInt16LE(Math.round((p.scale ?? 1) * 1024), o + 32);
    mddf.writeUInt16LE(p.legacyName === true ? 0 : 0x40, o + 34);
  });
  const modf = Buffer.alloc(64 * wmos.length);
  wmos.forEach((p, i) => {
    const o = i * 64;
    modf.writeUInt32LE(p.fileDataId, o);
    modf.writeUInt32LE(p.uniqueId, o + 4);
    f32s([...p.position, ...(p.rotation ?? [0, 0, 0]), ...(p.extentsMin ?? p.position), ...(p.extentsMax ?? p.position)]).copy(modf, o + 8);
    modf.writeUInt16LE(p.legacyName === true ? 0 : 0x8, o + 56);
    modf.writeUInt16LE(p.doodadSet ?? 0, o + 58);
    modf.writeUInt16LE(p.nameSet ?? 0, o + 60);
    modf.writeUInt16LE(p.scale === undefined ? 0 : Math.round(p.scale * 1024), o + 62);
  });
  return Buffer.concat([MVER, chunk('MDDF', mddf), chunk('MODF', modf)]);
}

// ---------------------------------------------------------------------------------------------
// WMO

export interface SynthDoodad {
  readonly nameIndex: number;
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
  readonly scale?: number;
}

export interface SynthWmoRoot {
  readonly wmoId: number;
  readonly groups: readonly number[];
  readonly flags?: number;
  /** Extra LOD entries appended to GFID (must be ignored). */
  readonly lodExtra?: readonly number[];
  readonly groupNames?: string;
  readonly doodadSets?: readonly { readonly name: string; readonly start: number; readonly count: number }[];
  readonly doodadIds?: readonly number[];
  readonly doodads?: readonly SynthDoodad[];
  readonly boundsMin?: readonly [number, number, number];
  readonly boundsMax?: readonly [number, number, number];
}

export function wmoRootFile(w: SynthWmoRoot): Buffer {
  const mohd = Buffer.alloc(0x40);
  mohd.writeUInt32LE(w.groups.length, 4);
  mohd.writeUInt32LE(w.wmoId, 0x20);
  f32s([...(w.boundsMin ?? [-1, -1, -1]), ...(w.boundsMax ?? [1, 1, 1])]).copy(mohd, 0x24);
  mohd.writeUInt16LE(w.flags ?? 0, 0x3c);
  const mods = Buffer.alloc(32 * (w.doodadSets ?? []).length);
  (w.doodadSets ?? []).forEach((s, i) => {
    mods.write(s.name, i * 32, 'latin1');
    mods.writeUInt32LE(s.start, i * 32 + 20);
    mods.writeUInt32LE(s.count, i * 32 + 24);
  });
  const modd = Buffer.alloc(40 * (w.doodads ?? []).length);
  (w.doodads ?? []).forEach((d, i) => {
    modd.writeUIntLE(d.nameIndex, i * 40, 3);
    f32s([...d.position, ...(d.rotation ?? [0, 0, 0, 1]), d.scale ?? 1]).copy(modd, i * 40 + 4);
  });
  const names = Buffer.from(w.groupNames ?? '\0', 'latin1');
  return Buffer.concat([
    MVER,
    chunk('MOHD', mohd),
    chunk('MOGN', names),
    chunk('MODS', mods),
    chunk('MODI', Buffer.concat((w.doodadIds ?? []).map(u32))),
    chunk('MODD', modd),
    chunk('GFID', Buffer.concat([...w.groups, ...(w.lodExtra ?? [])].map(u32))),
  ]);
}

export interface SynthWmoGroup {
  readonly flags?: number;
  readonly nameOffset?: number;
  readonly groupLiquid?: number;
  readonly wmoGroupId: number;
  readonly vertices: readonly number[];
  /** (a, b, c, material flags) per triangle. */
  readonly triangles: readonly (readonly [number, number, number, number])[];
  readonly wide?: boolean;
  readonly liquid?: {
    readonly xTiles: number;
    readonly yTiles: number;
    readonly corner: readonly [number, number, number];
    readonly height: number;
    /** One byte per tile (default 0: legacy water). */
    readonly tiles?: readonly number[];
  };
}

export function wmoGroupFile(g: SynthWmoGroup): Buffer {
  const header = Buffer.alloc(0x44);
  header.writeUInt32LE(g.nameOffset ?? 0, 0);
  header.writeUInt32LE(g.flags ?? 0, 8);
  header.writeUInt32LE(g.groupLiquid ?? 0, 0x34);
  header.writeInt32LE(g.wmoGroupId, 0x38);
  const wide = g.wide === true;
  const materials = Buffer.alloc(g.triangles.length * (wide ? 4 : 2));
  const indices = Buffer.alloc(g.triangles.length * 3 * (wide ? 4 : 2));
  g.triangles.forEach(([a, b, c, f], i) => {
    if (wide) {
      materials.writeUInt16LE(f, i * 4);
      [a, b, c].forEach((v, k) => indices.writeUInt32LE(v, (i * 3 + k) * 4));
    } else {
      materials.writeUInt8(f, i * 2);
      [a, b, c].forEach((v, k) => indices.writeUInt16LE(v, (i * 3 + k) * 2));
    }
  });
  const sub: Buffer[] = [chunk(wide ? 'MPY2' : 'MOPY', materials), chunk(wide ? 'MOVX' : 'MOVI', indices), chunk('MOVT', f32s(g.vertices))];
  if (g.liquid !== undefined) {
    const l = g.liquid;
    const xVerts = l.xTiles + 1;
    const yVerts = l.yTiles + 1;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(xVerts, 0);
    head.writeUInt32LE(yVerts, 4);
    head.writeUInt32LE(l.xTiles, 8);
    head.writeUInt32LE(l.yTiles, 12);
    f32s(l.corner).copy(head, 16);
    const verts = Buffer.alloc(xVerts * yVerts * 8);
    for (let i = 0; i < xVerts * yVerts; i += 1) verts.writeFloatLE(l.height, i * 8 + 4);
    const tiles = Buffer.from(l.tiles ?? new Array<number>(l.xTiles * l.yTiles).fill(0));
    sub.push(chunk('MLIQ', Buffer.concat([head, verts, tiles])));
  }
  return Buffer.concat([MVER, chunk('MOGP', Buffer.concat([header, ...sub]))]);
}

// ---------------------------------------------------------------------------------------------
// M2

/** An M2 with a collision mesh: chunked (MD21, the default) or legacy (MD20 at 0). */
export function m2File(vertices: readonly number[], triangles: readonly number[], options: { readonly chunked?: boolean } = {}): Buffer {
  const header = Buffer.alloc(0x130);
  header.write('MD20', 0, 'latin1');
  header.writeUInt32LE(274, 4);
  header.writeFloatLE(3, 0xd4);
  const indices = Buffer.alloc(triangles.length * 2);
  triangles.forEach((v, i) => indices.writeUInt16LE(v, i * 2));
  header.writeUInt32LE(triangles.length, 0xd8);
  header.writeUInt32LE(header.length, 0xdc);
  header.writeUInt32LE(vertices.length / 3, 0xe0);
  header.writeUInt32LE(header.length + indices.length, 0xe4);
  const md20 = Buffer.concat([header, indices, f32s(vertices)]);
  if (options.chunked === false) return md20;
  const size = Buffer.alloc(4);
  size.writeUInt32LE(md20.length, 0);
  // Chunked M2 ids are stored in reading order, followed here by an unrelated chunk.
  return Buffer.concat([Buffer.from('MD21', 'latin1'), size, md20, Buffer.from('SFID', 'latin1'), u32(0)]);
}
