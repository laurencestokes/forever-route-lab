import type { PublishedPoint, SpawnPoint } from '../../domain/dataset';
import { type AreaId, areaId, uiMapId } from '../../domain/ids';
import { type SourcedPoint, zoneSourcedPoint } from '../../domain/points';
import { resolvePoint, type MapGeometry } from '../../geo';
import type { DungeonRow, PointMap, PointRow, ZonesTable } from './rows';

/**
 * Published points → domain points (DATA_PROVENANCE §6.5, ARCHITECTURE §5.2, D-017). The rules,
 * per AreaTable id key of a PointMap, from `zones.json` `areas`:
 *
 * - exactly `[-1, -1]`: instance presence, `InstancePresence { kind: 'instance', areaId }`, never a point;
 * - `link: 'direct'`, `'routed'` or `'synthetic-alias'`: a zone `SourcedPoint` on the mapped UiMap
 *   (frame `forever`, lexemes null), exactly as published. A `routed` subzone has no frame of its
 *   own, so its percentages are read in the mapped UiMap's frame, as Questie reads them; the
 *   extractor's `validate` fails if a drawable published point uses a routed key (none at the pin),
 *   so this reading is reviewed before any such point ships (M2 review COORD-3);
 * - `link: 'suppressed'`: `UnmappedAreaPoint` reason `suppressed`;
 * - `link: 'legacy-compat'`: `UnmappedAreaPoint` reason `instance-area`;
 * - an AreaId missing from `areas`: `UnmappedAreaPoint` reason `no-uimap`.
 *
 * A row's phase (`[x, y, phase]`, one point at the pin) has no place in the domain point types
 * and is dropped here. Nothing is rounded, re-projected or guessed.
 */

/** Own-key lookup: a key like "constructor" never reads Object.prototype. */
function own<T>(table: Readonly<Record<string, T>>, key: string | number): T | undefined {
  const k = String(key);
  return Object.hasOwn(table, k) ? table[k] : undefined;
}

const isPresence = (row: PointRow): boolean => row.length === 2 && row[0] === -1 && row[1] === -1;

/** One published row under AreaTable id `key`. */
export function publishedPoint(key: string, row: PointRow, zones: ZonesTable): PublishedPoint {
  const area = areaId(Number(key));
  if (isPresence(row)) return { kind: 'instance', areaId: area };
  const [x, y] = row;
  const link = own(zones.areas, key);
  if (link === undefined) return { kind: 'unmapped', areaId: area, x, y, reason: 'no-uimap' };
  switch (link.link) {
    case 'direct':
    case 'routed':
    case 'synthetic-alias':
      return zoneSourcedPoint(uiMapId(link.uiMapId), x, y, 'forever');
    case 'suppressed':
      return { kind: 'unmapped', areaId: area, x, y, reason: 'suppressed' };
    case 'legacy-compat':
      return { kind: 'unmapped', areaId: area, x, y, reason: 'instance-area' };
  }
}

/** Every point of a PointMap, AreaIds ascending (integer keys iterate in that order), rows as published. */
export function publishedPoints(points: PointMap, zones: ZonesTable): PublishedPoint[] {
  const out: PublishedPoint[] = [];
  for (const key of Object.keys(points)) {
    for (const row of points[key] ?? []) out.push(publishedPoint(key, row, zones));
  }
  return out;
}

export const isSourcedPoint = (point: PublishedPoint): point is SourcedPoint => 'space' in point;

/** The dungeons one persona sees: `zones.json`'s, with the faction's whole-entry replacements. */
export type DungeonTable = Readonly<Record<string, DungeonRow>>;

/**
 * Why an instance presence has no entrance: no dungeon entry, an entry without entrances, several
 * entrances (which one depends on the approach), an entrance on no map, or an entrance whose frame
 * QuestieDB's audit leaves unverified (`frameVerified: false`, COORD-4).
 */
export type EntranceGap = 'no-dungeon' | 'no-entrance' | 'several-entrances' | 'entrance-unmapped' | 'entrance-frame-unverified';

export type EntranceResult = { readonly kind: 'entrance'; readonly point: SourcedPoint; readonly dungeonAreaId: AreaId } | { readonly kind: 'none'; readonly gap: EntranceGap };

/**
 * The entrance of the dungeon an instance-presence area belongs to (`instanceAreas` → `dungeons`).
 * Only a dungeon with exactly one entrance gives one: with several (13 dungeons at the pin, for
 * example Blackrock Depths from Searing Gorge or Burning Steppes) the entrance depends on where
 * the character comes from, which is the engine's travel graph's job, not a guess made here. An
 * entrance marked `frameVerified: false` (on a changed frame QuestieDB's audit leaves unverified)
 * is never used: its percentages might be in the Era frame, so unknown stays unknown.
 */
export function entranceOf(presenceArea: AreaId, zones: ZonesTable, dungeons: DungeonTable): EntranceResult {
  const dungeonAreaId = own(zones.instanceAreas, presenceArea)?.dungeonAreaId ?? (own(dungeons, presenceArea) === undefined ? null : presenceArea);
  if (dungeonAreaId === null) return { kind: 'none', gap: 'no-dungeon' };
  const dungeon = own(dungeons, dungeonAreaId);
  if (dungeon === undefined) return { kind: 'none', gap: 'no-dungeon' };
  const [entrance, ...others] = dungeon.entrances;
  if (entrance === undefined) return { kind: 'none', gap: 'no-entrance' };
  if (others.length > 0) return { kind: 'none', gap: 'several-entrances' };
  if (!entrance.frameVerified) return { kind: 'none', gap: 'entrance-frame-unverified' };
  const point = publishedPoint(String(entrance.areaId), [entrance.x, entrance.y], zones);
  if (!isSourcedPoint(point)) return { kind: 'none', gap: 'entrance-unmapped' };
  return { kind: 'entrance', point, dungeonAreaId: areaId(dungeonAreaId) };
}

/**
 * Converts published points to spawns once, sharing one `SpawnPoint` per instance-presence area
 * (every presence row of an area is the same fact). Built per dungeon table, because three
 * battleground entrances differ by faction.
 *
 * `SpawnPoint.uiMapId` is the UiMap its `world` point is on (M2 review COORD-2): for a zone point
 * the UiMap it was published on, for instance presence the UiMap of its dungeon's entrance, and
 * null when there is no world point. It is therefore not "the zone the entity is in": a presence
 * spawn is inside the instance, and its `source` (`kind: 'instance'`) says so. Consumers that name
 * a zone check `source` first (src/ui/app-model.ts `spawnZone`, `questZoneName`).
 */
export class SpawnConverter {
  private readonly presence = new Map<number, SpawnPoint>();
  /** Presence areas whose dungeon is not in the faction-invariant table: their result may depend on the faction. */
  readonly factionDependentAreas: ReadonlySet<number>;

  constructor(
    private readonly zones: ZonesTable,
    private readonly dungeons: DungeonTable,
    private readonly geometry: MapGeometry,
    factionDependentDungeons: ReadonlySet<number>,
  ) {
    const areas = new Set<number>();
    for (const [key, row] of Object.entries(zones.instanceAreas)) {
      if (row.dungeonAreaId !== null && factionDependentDungeons.has(row.dungeonAreaId)) areas.add(Number(key));
    }
    for (const id of factionDependentDungeons) areas.add(id);
    this.factionDependentAreas = areas;
  }

  spawn(point: PublishedPoint): SpawnPoint {
    if (isSourcedPoint(point)) return { source: point, world: resolvePoint(point, this.geometry), uiMapId: point.uiMapId };
    if (point.kind === 'unmapped') return { source: point, world: null, uiMapId: null };
    const cached = this.presence.get(point.areaId);
    if (cached !== undefined) return cached;
    // Instance presence resolves to its dungeon's entrance when there is exactly one (entranceOf):
    // `world` and `uiMapId` are then the entrance's (where the world point is, not where the
    // entity is), and the source still says "inside".
    const entrance = entranceOf(point.areaId, this.zones, this.dungeons);
    const spawn: SpawnPoint =
      entrance.kind === 'entrance'
        ? { source: point, world: resolvePoint(entrance.point, this.geometry), uiMapId: entrance.point.uiMapId }
        : { source: point, world: null, uiMapId: null };
    this.presence.set(point.areaId, spawn);
    return spawn;
  }

  spawns(points: PointMap): readonly SpawnPoint[] {
    const out: SpawnPoint[] = [];
    for (const key of Object.keys(points)) {
      const rows = points[key] ?? [];
      for (const row of rows) out.push(this.spawn(publishedPoint(key, row, this.zones)));
    }
    return out;
  }

  /** Whether the spawns of `points` could differ under another faction's dungeon table. */
  dependsOnFaction(points: PointMap): boolean {
    for (const key of Object.keys(points)) {
      if (!this.factionDependentAreas.has(Number(key))) continue;
      if ((points[key] ?? []).some(isPresence)) return true;
    }
    return false;
  }
}
