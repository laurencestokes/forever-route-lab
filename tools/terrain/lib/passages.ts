import { z } from 'zod';
import type { MapMesh } from './link';
import type { PassageTag } from './mapfile';

/**
 * Unverified passages (terrain-navigation.md §11.3; RC-09, D-034 item 5):
 * `tools/terrain/inputs/passages.json`. Walks the mesh finds that may be false passes are tagged
 * at build time: the polygons whose centroid lies in the row's box (and whose zone is `zone`, when
 * given). `map.bin` lists them; a leg whose corridor crosses one carries `unverified-passage`.
 *
 * - `unverified`: tagged; a null box is an error.
 * - `verified-pass`: the owner walked it; not tagged.
 * - `verified-block`: the owner found it blocked. That needs a must-not-connect fixture and a mesh
 *   cut, which this build does not implement yet, so such a row is refused.
 */

const box = z.strictObject({ xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number(), zMin: z.number(), zMax: z.number() });

const passageRow = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  map: z.number().int().min(0),
  status: z.enum(['unverified', 'verified-pass', 'verified-block']),
  zone: z.number().int().positive().nullable(),
  box: box.nullable(),
  check: z.string().min(1),
  note: z.string().optional(),
  verified: z.strictObject({ date: z.string(), build: z.string(), by: z.string() }).optional(),
});

const passageFile = z.strictObject({
  $comment: z.array(z.string()).optional(),
  schema: z.literal(1),
  kind: z.literal('nav-passages'),
  passages: z.array(passageRow),
});

export type PassageRow = z.infer<typeof passageRow>;
export type PassageFile = z.infer<typeof passageFile>;

export function parsePassages(value: unknown): PassageFile {
  const parsed = passageFile.safeParse(value);
  if (!parsed.success) throw new Error(`passages.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of parsed.data.passages) {
    if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`);
    ids.add(p.id);
    if (p.status === 'unverified' && p.box === null) problems.push(`${p.id}: an unverified passage needs a box`);
    if (p.status === 'verified-block') problems.push(`${p.id}: verified-block needs a mesh cut, which is not implemented yet`);
    if (p.box !== null && (p.box.xMin >= p.box.xMax || p.box.yMin >= p.box.yMax || p.box.zMin >= p.box.zMax)) problems.push(`${p.id}: empty box`);
  }
  if (problems.length > 0) throw new Error(`passages.json: ${problems.join('; ')}`);
  return parsed.data;
}

/** The tagged polygons of every `unverified` row of `mapId`; `passage` is the row's index in the file. */
export function tagPassages(file: PassageFile, mapId: number, g: MapMesh): PassageTag[] {
  const out: PassageTag[] = [];
  file.passages.forEach((row, index) => {
    if (row.map !== mapId || row.status !== 'unverified' || row.box === null) return;
    const b = row.box;
    const polygons: number[] = [];
    for (let p = 0; p < g.n; p += 1) {
      const x = g.cx[p] ?? 0;
      const y = g.cy[p] ?? 0;
      const z = g.cz[p] ?? 0;
      if (x < b.xMin || x > b.xMax || y < b.yMin || y > b.yMax || z < b.zMin || z > b.zMax) continue;
      if (row.zone !== null && g.zone[p] !== row.zone) continue;
      polygons.push(p);
    }
    out.push({ passage: index, polygons });
  });
  return out;
}
