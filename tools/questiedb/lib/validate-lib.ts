import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { DUNGEON_KEYS, dungeonClassificationProblems } from './dungeon-areas';
import { EXPECTED_UIMAP_NAMES } from './expected-zone-names';
import { sha256Hex } from './git';
import { computeDataRevision } from './manifest';
import { CARVE_OUT } from './notice';
import { isInstanceSentinel, pointsOf } from './points';
import { generatedMarker, JSON_OUTPUTS } from './render';
import { entitiesFileSchema, itemsFileSchema, manifestSchema, overlaysFileSchema, questsFileSchema, spawnsFileSchema, zonesFileSchema } from './schema';
import { questEntityRefs } from './select';
import { transcriptionProblems } from './semantics';
import type { DungeonRow, EntitiesFile, EntityRefRow, ItemsFile, OverlaysFile, PointMap, QuestPatch, QuestsFile, SpawnsFile, ZonesFile } from './shapes';
import type { UpstreamPin } from './upstream';
import { FRAME_UNVERIFIED_ENTRANCES, isZoneLink } from './zones';

/**
 * `pnpm data:validate` checks (DATA_PROVENANCE §5 step 3), as pure functions of a data directory,
 * the pin and the tool identity. Field-level parity with QuestieDB's own Lua generation is not
 * one of them (an optional manual check, tools/questiedb/README.md).
 */

export interface ValidateOptions {
  readonly dir: string;
  readonly pin: UpstreamPin;
  /** The fixture slice: quest ids named by entities may be outside it; golden shipped counts do not apply. */
  readonly slice: boolean;
  /** The checkout's toolTreeHash, or null to skip that check (never in CI). */
  readonly toolTreeHash: { readonly tree: string; readonly lockfile: string } | null;
}

export interface Finding {
  readonly check: string;
  readonly message: string;
}

export interface ValidateResult {
  readonly findings: readonly Finding[];
  readonly summary: Readonly<Record<string, unknown>>;
}

const EXPECTED_FILES = [...JSON_OUTPUTS, 'NOTICE.md', 'manifest.json'].sort();

/** Local paths or references to tool caches (the dist audit enforces the same on dist/). */
const ABSOLUTE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|(?<![\w.-])\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
const CACHE_REFERENCE = /(?:^|[\s"'`(=:,;\\/])\.cache[\\/]/m;

export function validateDirectory(options: ValidateOptions): ValidateResult {
  const findings: Finding[] = [];
  const fail = (check: string, message: string): void => {
    findings.push({ check, message });
  };
  const { dir, pin } = options;
  if (!existsSync(dir)) return { findings: [{ check: 'files', message: `${dir} does not exist` }], summary: {} };
  const present = readdirSync(dir).sort();
  for (const name of EXPECTED_FILES) if (!present.includes(name)) fail('files', `${name} is missing`);
  for (const name of present) if (!EXPECTED_FILES.includes(name)) fail('files', `${name} is not a file the extractor writes`);
  if (findings.length > 0) return { findings, summary: {} };

  const bytes = new Map(present.map((name) => [name, readFileSync(join(dir, name))]));
  const text = (name: string): string => (bytes.get(name) ?? Buffer.alloc(0)).toString('utf8');

  // Encoding, marking and hygiene of every file.
  const marker = generatedMarker(pin.repositoryName, pin.commit);
  const parsed = new Map<string, unknown>();
  for (const name of present) {
    const content = bytes.get(name) ?? Buffer.alloc(0);
    if (content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) fail('encoding', `${name} starts with a BOM`);
    if (content.includes(0x0d)) fail('encoding', `${name} contains CR characters (LF only)`);
    if (content.at(-1) !== 0x0a) fail('encoding', `${name} does not end with a newline`);
    const body = content.toString('utf8');
    if (ABSOLUTE_PATH.test(body)) fail('hygiene', `${name} contains an absolute path`);
    if (CACHE_REFERENCE.test(body)) fail('hygiene', `${name} references a .cache directory`);
    if (!name.endsWith('.json')) continue;
    let value: unknown;
    try {
      value = JSON.parse(body) as unknown;
    } catch (error) {
      fail('json', `${name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail('marking', `${name} is not a JSON object at the top level`);
      continue;
    }
    if (Object.keys(value)[0] !== '_generated') fail('marking', `${name}: the first key is not "_generated"`);
    if (JSON.stringify((value as { readonly _generated?: unknown })._generated) !== JSON.stringify(marker)) fail('marking', `${name}: "_generated" does not name ${marker.upstream}`);
    parsed.set(name, value);
  }

  const check = <T>(name: string, schema: z.ZodType<T>): T | null => {
    const result = schema.safeParse(parsed.get(name));
    if (!result.success) {
      const issues = result.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      fail('schema', `${name}: ${issues.join('; ')}${result.error.issues.length > 5 ? ` (+${String(result.error.issues.length - 5)} more)` : ''}`);
      return null;
    }
    return result.data;
  };
  const quests = check('quests.json', questsFileSchema) as QuestsFile | null;
  const entities = check('entities.json', entitiesFileSchema) as EntitiesFile | null;
  const items = check('items.json', itemsFileSchema) as ItemsFile | null;
  const spawns = check('spawns.json', spawnsFileSchema) as SpawnsFile | null;
  const zones = check('zones.json', zonesFileSchema) as ZonesFile | null;
  const overlays = check('overlays.json', overlaysFileSchema) as OverlaysFile | null;
  const manifest = check('manifest.json', manifestSchema);
  if (quests === null || entities === null || items === null || spawns === null || zones === null || overlays === null || manifest === null) return { findings, summary: {} };

  // Manifest: outputs, hashes, dataRevision, pin, inputs, tool identity.
  const listed = manifest.outputs.map((output) => output.path).sort();
  const expectedOutputs = EXPECTED_FILES.filter((name) => name !== 'manifest.json');
  if (JSON.stringify(listed) !== JSON.stringify(expectedOutputs)) fail('manifest', `outputs list ${listed.join(', ')}, expected ${expectedOutputs.join(', ')}`);
  for (const output of manifest.outputs) {
    const content = bytes.get(output.path);
    if (content === undefined) continue;
    if (sha256Hex(content) !== output.sha256) fail('hashes', `${output.path}: sha256 differs from the manifest`);
    if (content.length !== output.bytes) fail('hashes', `${output.path}: ${String(content.length)} bytes, manifest says ${String(output.bytes)}`);
  }
  if (computeDataRevision(manifest.outputs) !== manifest.dataRevision) fail('dataRevision', 'dataRevision does not recompute from the outputs');
  if (manifest.upstream.commit !== pin.commit || manifest.upstream.repository !== pin.repository) fail('pin', 'manifest upstream differs from tools/questiedb/upstream.json');
  const pinned = new Map(pin.inputs.map((input) => [input.path, input]));
  if (manifest.inputs.length !== pin.inputs.length) fail('inputs', `manifest lists ${String(manifest.inputs.length)} inputs, upstream.json ${String(pin.inputs.length)}`);
  for (const input of manifest.inputs) {
    const want = pinned.get(input.path);
    if (want === undefined || want.sha256 !== input.sha256 || want.role !== input.role) fail('inputs', `${input.path}: differs from upstream.json`);
  }
  if (options.toolTreeHash !== null) {
    if (manifest.toolTreeHash.tree !== options.toolTreeHash.tree) {
      fail('toolTreeHash', `manifest tree ${manifest.toolTreeHash.tree}, checkout ${options.toolTreeHash.tree}: tools/questiedb changed without regenerating (pnpm data:extract)`);
    }
    if (manifest.toolTreeHash.lockfile !== options.toolTreeHash.lockfile) fail('toolTreeHash', 'pnpm-lock.yaml changed without regenerating (pnpm data:extract)');
  }
  for (const problem of transcriptionProblems(pin.inputs)) fail('semantics', problem);
  const notice = text('NOTICE.md');
  if (!notice.includes(CARVE_OUT)) fail('notice', 'NOTICE.md lacks the verbatim carve-out');
  if (!notice.includes(pin.commit)) fail('notice', 'NOTICE.md does not name the pinned commit');
  if (!notice.includes('not affiliated with or endorsed by Blizzard Entertainment')) fail('notice', 'NOTICE.md lacks the non-affiliation statement');
  if (notice.includes(manifest.dataRevision)) fail('notice', 'NOTICE.md must not contain the dataRevision');

  // Golden counts.
  const counts = manifest.counts;
  for (const key of ['quests', 'npcs', 'objects', 'items'] as const) {
    if (counts.composed[key] !== pin.golden.composed[key]) fail('golden', `composed ${key} ${String(counts.composed[key])}, golden ${String(pin.golden.composed[key])}`);
    if (counts.raw[key] !== pin.golden.raw[key]) fail('golden', `raw ${key} ${String(counts.raw[key])}, golden ${String(pin.golden.raw[key])}`);
  }
  const actual = { quests: quests.rows.length, npcs: entities.npcs.length, objects: entities.objects.length, items: items.rows.length };
  for (const key of ['quests', 'npcs', 'objects', 'items'] as const) {
    if (counts.shipped[key] !== actual[key]) fail('counts', `manifest says ${String(counts.shipped[key])} ${key}, the files hold ${String(actual[key])}`);
  }
  if (counts.spawnEntities.npc !== Object.keys(spawns.npc).length || counts.spawnEntities.object !== Object.keys(spawns.object).length) fail('counts', 'spawnEntities differ from spawns.json');
  if (!options.slice) {
    if (pin.golden.shipped === null) fail('golden', 'upstream.json golden.shipped is null: record the shipped counts');
    else {
      for (const key of ['quests', 'npcs', 'objects', 'items'] as const) {
        if (actual[key] !== pin.golden.shipped[key]) fail('golden', `shipped ${key} ${String(actual[key])}, golden ${String(pin.golden.shipped[key])}`);
      }
      if (counts.spawnEntities.npc !== pin.golden.shipped.spawnEntities.npc || counts.spawnEntities.object !== pin.golden.shipped.spawnEntities.object) fail('golden', 'spawn entity counts differ from golden.shipped');
    }
  }

  // Ordering and uniqueness.
  const ascending = (label: string, ids: readonly number[]): void => {
    for (let i = 1; i < ids.length; i += 1) if ((ids[i] ?? 0) <= (ids[i - 1] ?? 0)) fail('order', `${label} is not in ascending unique id order at index ${String(i)}`);
  };
  ascending('quests.json rows', quests.rows.map((row) => row.id));
  ascending('entities.json npcs', entities.npcs.map((row) => row.id));
  ascending('entities.json objects', entities.objects.map((row) => row.id));
  ascending('items.json rows', items.rows.map((row) => row.id));

  // Referential integrity.
  const shipped = {
    quest: new Set(quests.rows.map((row) => row.id)),
    npc: new Set(entities.npcs.map((row) => row.id)),
    object: new Set(entities.objects.map((row) => row.id)),
    item: new Set(items.rows.map((row) => row.id)),
  };
  let dangling = 0;
  const ref = (r: EntityRefRow, by: string): void => {
    if (!shipped[r.kind].has(r.id)) {
      dangling += 1;
      if (dangling <= 20) fail('references', `${by} references ${r.kind} ${String(r.id)}, which does not ship`);
    }
  };
  const questRef = (idValue: number, by: string): void => {
    if (!options.slice && idValue > 0 && !shipped.quest.has(idValue)) {
      dangling += 1;
      if (dangling <= 20) fail('references', `${by} names quest ${String(idValue)}, which does not ship`);
    }
  };
  const patchRefs = (patch: QuestPatch, by: string): void => {
    for (const r of questEntityRefs({
      starters: patch.starters ?? [],
      finishers: patch.finishers ?? [],
      objectives: patch.objectives ?? [],
      objectiveHints: patch.objectiveHints ?? [],
      requirements: patch.requirements ?? { skill: null, minReputation: null, maxReputation: null, spell: null, specialization: null, sourceItemId: null, requiredSourceItems: [] },
    })) {
      ref(r, by);
    }
  };
  for (const quest of quests.rows) for (const r of questEntityRefs(quest)) ref(r, `quest ${String(quest.id)}`);
  for (const item of items.rows) {
    for (const idValue of item.dropNpcs) ref({ kind: 'npc', id: idValue }, `item ${String(item.id)} dropNpcs`);
    for (const idValue of item.dropObjects) ref({ kind: 'object', id: idValue }, `item ${String(item.id)} dropObjects`);
    for (const idValue of item.dropItems) ref({ kind: 'item', id: idValue }, `item ${String(item.id)} dropItems`);
    if (item.startsQuest !== null) questRef(item.startsQuest, `item ${String(item.id)} startsQuest`);
  }
  for (const npc of entities.npcs) for (const q of [...npc.questStarts, ...npc.questEnds]) questRef(q, `npc ${String(npc.id)}`);
  for (const object of entities.objects) for (const q of [...object.questStarts, ...object.questEnds]) questRef(q, `object ${String(object.id)}`);
  for (const key of Object.keys(spawns.npc)) if (!shipped.npc.has(Number(key))) fail('references', `spawns.json npc ${key} does not ship`);
  for (const key of Object.keys(spawns.object)) if (!shipped.object.has(Number(key))) fail('references', `spawns.json object ${key} does not ship`);
  for (const faction of ['Alliance', 'Horde'] as const) {
    const layer = overlays.faction[faction];
    for (const [idKey, patch] of Object.entries(layer.quests)) {
      if (!shipped.quest.has(Number(idKey))) fail('references', `overlay ${faction} quest ${idKey} does not ship`);
      patchRefs(patch, `overlay ${faction} quest ${idKey}`);
    }
    for (const idKey of Object.keys(layer.npcs)) if (!shipped.npc.has(Number(idKey))) fail('references', `overlay ${faction} npc ${idKey} does not ship`);
    for (const idKey of Object.keys(layer.objects)) if (!shipped.object.has(Number(idKey))) fail('references', `overlay ${faction} object ${idKey} does not ship`);
    for (const [idKey, patch] of Object.entries(layer.items)) {
      if (!shipped.item.has(Number(idKey))) fail('references', `overlay ${faction} item ${idKey} does not ship`);
      for (const idValue of patch.dropNpcs ?? []) ref({ kind: 'npc', id: idValue }, `overlay ${faction} item ${idKey}`);
      for (const idValue of patch.dropObjects ?? []) ref({ kind: 'object', id: idValue }, `overlay ${faction} item ${idKey}`);
      for (const idValue of patch.dropItems ?? []) ref({ kind: 'item', id: idValue }, `overlay ${faction} item ${idKey}`);
    }
    for (const [token, classLayer] of Object.entries(overlays.class[faction])) {
      for (const [idKey, patch] of Object.entries(classLayer.quests)) {
        if (!shipped.quest.has(Number(idKey))) fail('references', `overlay ${faction}/${token} quest ${idKey} does not ship`);
        patchRefs(patch, `overlay ${faction}/${token} quest ${idKey}`);
      }
    }
  }
  if (dangling > 20) fail('references', `${String(dangling - 20)} more dangling references`);

  // Coordinates and sentinels; presence keys resolve through instanceAreas. A drawable point
  // keyed by a routed subzone would be read in its parent's frame, which it does not define: none
  // ships at the pin, so one appearing at a pin bump fails for review (COORD-3).
  const presence = new Set<number>();
  let points = 0;
  const routedKeys = new Set<number>();
  const scan = (map: PointMap, where: string): void => {
    for (const [area, row] of pointsOf(map)) {
      points += 1;
      if (row[0] === -1 || row[1] === -1) {
        if (!isInstanceSentinel(row) || row.length !== 2) fail('coordinates', `${where} area ${String(area)}: malformed instance sentinel ${JSON.stringify(row)}`);
        presence.add(area);
        continue;
      }
      if (row[0] < 0 || row[0] > 100 || row[1] < 0 || row[1] > 100) fail('coordinates', `${where} area ${String(area)}: ${JSON.stringify(row)} is outside 0-100`);
      if (row.length === 3 && row[2] === 0) fail('coordinates', `${where}: a zero phase must be dropped`);
      const link = zones.areas[String(area)];
      if (link?.link === 'routed' && !routedKeys.has(area)) {
        routedKeys.add(area);
        fail('coordinates', `${where}: a drawable point is keyed by AreaId ${String(area)}, a subzone routed to UiMap ${String(link.uiMapId)} that defines no frame of its own; review it before shipping`);
      }
    }
  };
  const scanQuestPatch = (patch: QuestPatch, where: string): void => {
    for (const objective of patch.objectives ?? []) if (objective.kind === 'event') scan(objective.points, `${where} event`);
    for (const hint of patch.objectiveHints ?? []) scan(hint.points, `${where} hint`);
  };
  for (const [idKey, map] of Object.entries(spawns.npc)) scan(map, `npc ${idKey}`);
  for (const [idKey, map] of Object.entries(spawns.object)) scan(map, `object ${idKey}`);
  for (const quest of quests.rows) {
    for (const objective of quest.objectives) if (objective.kind === 'event') scan(objective.points, `quest ${String(quest.id)} event`);
    for (const hint of quest.objectiveHints) scan(hint.points, `quest ${String(quest.id)} hint`);
  }
  for (const faction of ['Alliance', 'Horde'] as const) {
    for (const [idKey, patch] of [...Object.entries(overlays.faction[faction].npcs), ...Object.entries(overlays.faction[faction].objects)]) {
      if (patch.spawns !== undefined) scan(patch.spawns, `overlay ${faction} ${idKey}`);
    }
    for (const [idKey, patch] of Object.entries(overlays.faction[faction].quests)) scanQuestPatch(patch, `overlay ${faction} quest ${idKey}`);
    for (const [token, classLayer] of Object.entries(overlays.class[faction])) {
      for (const [idKey, patch] of Object.entries(classLayer.quests)) scanQuestPatch(patch, `overlay ${faction}/${token} quest ${idKey}`);
    }
  }
  const dungeons = new Map<number, DungeonRow>(Object.entries(zones.dungeons).map(([k, v]) => [Number(k), v]));
  const factionDungeons = new Set([...Object.keys(overlays.faction.Alliance.dungeons), ...Object.keys(overlays.faction.Horde.dungeons)].map(Number));
  for (const area of presence) if (!(String(area) in zones.instanceAreas)) fail('zones', `presence key ${String(area)} has no instanceAreas entry`);
  for (const [area, row] of Object.entries(zones.instanceAreas)) {
    if (!presence.has(Number(area))) fail('zones', `instanceAreas ${area} is not used by any shipped point`);
    if (row.dungeonAreaId !== null && !dungeons.has(row.dungeonAreaId) && !factionDungeons.has(row.dungeonAreaId)) fail('zones', `instanceAreas ${area} resolves to missing dungeon ${String(row.dungeonAreaId)}`);
  }

  // Zone tables and names (DATA_PROVENANCE §6.6).
  for (const [area, row] of Object.entries(zones.areas)) {
    if ((row.link === 'suppressed') !== (row.uiMapId === 0)) fail('zones', `area ${area}: link ${row.link} with UiMap ${String(row.uiMapId)}`);
    if (isZoneLink(row.link) && !(String(row.uiMapId) in zones.uiMaps)) fail('zones', `area ${area} links to UiMap ${String(row.uiMapId)}, which zones.json does not list`);
    // A direct link is the UiMap's own AreaId (uiMapIdToAreaId round-trips); a routed one is not.
    const own = zones.uiMaps[String(row.uiMapId)]?.areaId ?? null;
    if (row.link === 'direct' && own !== Number(area)) fail('zones', `area ${area} is linked as direct, but the own AreaId of UiMap ${String(row.uiMapId)} is ${String(own)}`);
    if (row.link === 'routed' && own === Number(area)) fail('zones', `area ${area} is linked as routed, but it is the own AreaId of UiMap ${String(row.uiMapId)}`);
  }
  // Entrances: frameVerified is false exactly for the audit's frame-unverified entrances (COORD-4).
  const entranceRows: [string, DungeonRow][] = [
    ...Object.entries(zones.dungeons),
    ...Object.entries(overlays.faction.Alliance.dungeons),
    ...Object.entries(overlays.faction.Horde.dungeons),
  ];
  for (const [key, row] of entranceRows) {
    for (const entrance of row.entrances) {
      const listed = FRAME_UNVERIFIED_ENTRANCES.some((e) => e.dungeonAreaId === Number(key) && e.areaId === entrance.areaId && e.x === entrance.x && e.y === entrance.y);
      if (entrance.frameVerified === listed) fail('zones', `dungeon ${key} entrance ${JSON.stringify([entrance.areaId, entrance.x, entrance.y])}: frameVerified ${String(entrance.frameVerified)}, expected ${String(!listed)}`);
    }
  }
  for (const [uiMap, row] of Object.entries(zones.uiMaps)) {
    if ((row.name === null) !== (row.nameSource === null)) fail('zone-names', `UiMap ${uiMap}: name and nameSource must both be set or both be null`);
    if (row.name !== null && row.name !== row.name.trim()) fail('zone-names', `UiMap ${uiMap}: name is not trimmed`);
    const expected = EXPECTED_UIMAP_NAMES[Number(uiMap)];
    if (!options.slice || expected !== undefined) {
      if ((expected ?? null) !== row.name) fail('zone-names', `UiMap ${uiMap}: name ${JSON.stringify(row.name)}, expected ${JSON.stringify(expected ?? null)} (tools/questiedb/lib/expected-zone-names.ts)`);
    }
  }
  if (!options.slice) {
    for (const uiMap of Object.keys(EXPECTED_UIMAP_NAMES)) if (!(uiMap in zones.uiMaps)) fail('zone-names', `expected UiMap ${uiMap} (${EXPECTED_UIMAP_NAMES[Number(uiMap)] ?? ''}) is missing`);
  }

  // Derived values and provenance invariants. dungeonQuest is recomputed from both factions'
  // dungeon entries with the classification the extractor uses (lib/dungeon-areas.ts).
  const dungeonAreas = new Set<number>();
  for (const [key, row] of entranceRows) {
    if (!DUNGEON_KEYS.has(Number(key))) continue;
    dungeonAreas.add(Number(key));
    for (const alt of row.alternativeAreaIds) dungeonAreas.add(alt);
  }
  if (!options.slice) for (const problem of dungeonClassificationProblems(new Set(entranceRows.map(([key]) => Number(key))))) fail('derived', problem);
  for (const quest of quests.rows) {
    if (!options.slice) {
      const expected = quest.zoneOrSort !== null && quest.zoneOrSort > 0 && dungeonAreas.has(quest.zoneOrSort);
      if (expected !== quest.dungeonQuest) fail('derived', `quest ${String(quest.id)}: dungeonQuest ${String(quest.dungeonQuest)}, expected ${String(expected)}`);
    }
    if (quest.provenance.created && !quest.provenance.corrected) fail('provenance', `quest ${String(quest.id)} is created but not corrected`);
  }
  for (const record of [...entities.npcs, ...entities.objects, ...items.rows]) {
    if (record.provenance.created && !record.provenance.corrected) fail('provenance', `record ${String(record.id)} is created but not corrected`);
  }
  return {
    findings,
    summary: {
      dataRevision: manifest.dataRevision,
      records: actual,
      points,
      presenceAreas: presence.size,
      uiMaps: Object.keys(zones.uiMaps).length,
      areas: Object.keys(zones.areas).length,
    },
  };
}
