import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZonesTable } from '../../../src/infra/data/rows';
import { isSourcedPoint, publishedPoint } from '../../../src/infra/data/points';
import { parseGeometryFile, resolvePoint, type MapGeometry } from '../../../src/geo';

/**
 * Every dataset spawn as a world point (terrain-navigation.md §12), through the repository's own
 * readers: `src/infra/data/points.ts` (published rows → points, D-017) and `src/geo` with the
 * committed placeholder geometry. Instance-presence rows, unmapped areas and unresolved points
 * have no world point and are counted in `skipped`.
 *
 * A spawn's identity is (kind, id, index): `index` is its position among every published row of
 * that entity, area keys ascending (the order integer keys iterate in), rows in file order, so it
 * does not depend on which rows resolve. Census anchors use the lowest identity (§12).
 */

export type SpawnKind = 'npc' | 'object';

export interface Spawn {
  readonly kind: SpawnKind;
  readonly id: number;
  readonly index: number;
  /** The AreaTable id the dataset keys the row by. */
  readonly areaKey: number;
  readonly mapId: number;
  readonly x: number;
  readonly y: number;
}

export interface DatasetInputs {
  readonly dataRevision: string;
  /** SHA-256 of spawns.json with LF line ends. */
  readonly spawnsSha256: string;
  readonly geometrySha256: string;
}

export interface LoadedSpawns {
  readonly spawns: readonly Spawn[];
  readonly skipped: Readonly<Record<string, number>>;
  readonly inputs: DatasetInputs;
  readonly geometry: MapGeometry;
}

export const lfSha256 = (bytes: Buffer): string => createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');

export function loadGeometry(repoRoot: string): { geometry: MapGeometry; sha256: string } {
  const bytes = readFileSync(join(repoRoot, 'public', 'maps', 'placeholder', 'geometry.placeholder.json'));
  const parsed = parseGeometryFile(JSON.parse(bytes.toString('utf8')) as unknown);
  if (!parsed.ok) throw new Error(`geometry.placeholder.json: ${parsed.errors.join('; ')}`);
  return { geometry: parsed.geometry, sha256: lfSha256(bytes) };
}

export function loadSpawns(repoRoot: string): LoadedSpawns {
  const dataDir = join(repoRoot, 'public', 'data');
  const zones = JSON.parse(readFileSync(join(dataDir, 'zones.json'), 'utf8')) as ZonesTable;
  const spawnBytes = readFileSync(join(dataDir, 'spawns.json'));
  const raw = JSON.parse(spawnBytes.toString('utf8')) as Record<string, unknown>;
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as { dataRevision?: unknown };
  if (typeof manifest.dataRevision !== 'string') throw new Error('public/data/manifest.json has no dataRevision');
  const { geometry, sha256: geometrySha256 } = loadGeometry(repoRoot);
  const out: Spawn[] = [];
  const skipped: Record<string, number> = {};
  for (const kind of ['npc', 'object'] as const) {
    const table = raw[kind] as Record<string, Record<string, (readonly number[])[]>> | undefined;
    if (table === undefined) throw new Error(`spawns.json has no "${kind}" table`);
    for (const [id, byArea] of Object.entries(table)) {
      let index = 0;
      for (const [areaKey, rows] of Object.entries(byArea)) {
        for (const row of rows) {
          const i = index;
          index += 1;
          const p = publishedPoint(areaKey, row as never, zones);
          if (!isSourcedPoint(p)) {
            skipped[p.kind] = (skipped[p.kind] ?? 0) + 1;
            continue;
          }
          const w = resolvePoint(p, geometry);
          if (w === null) {
            skipped['unresolved'] = (skipped['unresolved'] ?? 0) + 1;
            continue;
          }
          out.push({ kind, id: Number(id), index: i, areaKey: Number(areaKey), mapId: Number(w.mapId), x: w.x, y: w.y });
        }
      }
    }
  }
  return { spawns: out, skipped, inputs: { dataRevision: manifest.dataRevision, spawnsSha256: lfSha256(spawnBytes), geometrySha256 }, geometry };
}

/** Total order of spawn identities: kind ('npc' before 'object'), id, index. */
export function compareSpawnKeys(a: { readonly kind: SpawnKind; readonly id: number; readonly index: number }, b: { readonly kind: SpawnKind; readonly id: number; readonly index: number }): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id - b.id || a.index - b.index;
}

export const spawnKey = (s: { readonly kind: SpawnKind; readonly id: number; readonly index: number }): string => `${s.kind}:${String(s.id)}:${String(s.index)}`;
