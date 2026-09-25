import type { Chunk, Expression, StringLiteral } from 'luaparse';
import { Evaluator, type Lint } from './evaluator';
import { bytesToLuaText, lineCommentsByLine, longStringContentLine, parseLua } from './lua-source';
import { describeValue, LuaTable, type LuaValue, sequence, ShapeError } from './lua-value';
import { supportEnvironment } from './sandbox';
import type { Transcription } from './semantics';
import type { AreaLink, DungeonRow, EntranceRow } from './shapes';

/**
 * Zone tables (DATA_PROVENANCE §6.6): AreaID → UiMapID with override precedence, each link
 * classified (direct frame, routed subzone, synthetic alias, legacy compatibility, suppressed),
 * UiMap names from the trailing comments of uiMapIdToAreaId.lua (LIC-13), and dungeons.lua
 * evaluated once per faction, with the entrances QuestieDB's own audit leaves frame-unverified
 * marked. No geometry.
 */

export const AREA_TO_UIMAP_FILE = 'support/Forever/Zones/areaIdToUiMapId.lua';
export const UIMAP_TO_AREA_FILE = 'support/Forever/Zones/uiMapIdToAreaId.lua';
export const DUNGEONS_FILE = 'support/Forever/Zones/dungeons.lua';
export const COORDINATE_AUDIT_FILE = 'docs/forever-coordinate-audit.md';

/** Upstream content transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  {
    path: COORDINATE_AUDIT_FILE,
    sha256: 'ac4b4e56f34911c104ae374d2d936443fbf91a43e0cb76562b964ea95739aab6',
    what: 'FRAME_UNVERIFIED_ENTRANCES (section "Entrances not eligible for the Era transform")',
  },
];

export interface UnverifiedEntrance {
  /** The dungeons.lua key. */
  readonly dungeonAreaId: number;
  readonly areaId: number;
  readonly x: number;
  readonly y: number;
  /** As the audit names it, for messages. */
  readonly label: string;
}

/**
 * Entrance points on a changed Era→Forever frame whose frame QuestieDB's own audit leaves
 * unverified ("These three entries remain unchanged and explicitly annotated pending their own
 * review", docs/forever-coordinate-audit.md at the pin; review finding COORD-4). A self-authored
 * transcription: they ship with `frameVerified: false`, and each must match exactly one entrance
 * of dungeons.lua, or the extraction fails.
 */
export const FRAME_UNVERIFIED_ENTRANCES: readonly UnverifiedEntrance[] = [
  { dungeonAreaId: 5861, areaId: 215, x: 36.85, y: 35.86, label: 'DMF Island 5861: Mulgore 36.85, 35.86' },
  { dungeonAreaId: 6618, areaId: 1519, x: 69.49, y: 31.2, label: "Bizmo's Brawlpub 6618: Stormwind 69.49, 31.2" },
  { dungeonAreaId: 10001, areaId: 139, x: 43.5, y: 19.4, label: 'Stratholme Gauntlet 10001: EPL 43.5, 19.4' },
];

/** The two comments that mark legacy dungeon compatibility rows (never names; rule 3). */
export const LEGACY_COMMENTS = ['Referenced dungeon area', 'Referenced synthetic dungeon alias'] as const;

export interface DeferredRow {
  readonly key: number;
  readonly value: number;
  /** Line in the upstream file. */
  readonly line: number;
  /** The trailing `--` comment on the same line (trimmed), or null. */
  readonly comment: string | null;
}

/**
 * Runs a support file that assigns `ZoneDB.private.<name> = [[return {...}]]` strings, then parses
 * each string with comments and locations (rule 1). Each row must be `[number] = number`, alone on
 * its line (rule 2: a name is the comment on the same line; own-line comments are never names).
 */
export function readDeferredTables(file: string, bytes: Uint8Array, names: readonly string[], rules: string): ReadonlyMap<string, readonly DeferredRow[]> {
  const text = bytesToLuaText(bytes, file);
  const chunk = parseLua(text, file, { locations: true });
  const env = supportEnvironment(rules);
  const lints: Lint[] = [];
  new Evaluator({ file, globals: env.globals, varargs: [], lints }).runChunk(chunk);
  const zoneDb = env.module('ZoneDB');
  const privateTable = zoneDb.get('private');
  if (!(privateTable instanceof LuaTable)) throw new ShapeError(file, 'ZoneDB.private is missing');
  const out = new Map<string, readonly DeferredRow[]>();
  for (const name of names) {
    const literal = findStringAssignment(chunk, `ZoneDB.private.${name}`, file);
    const value = privateTable.get(name);
    if (typeof value !== 'string') throw new ShapeError(file, `ZoneDB.private.${name} is not a string`);
    out.set(name, readDeferredRows(file, literal, value));
  }
  return out;
}

function findStringAssignment(chunk: Chunk, target: string, file: string): StringLiteral {
  const found: StringLiteral[] = [];
  for (const statement of chunk.body) {
    if (statement.type !== 'AssignmentStatement') continue;
    statement.variables.forEach((variable, index) => {
      const init = statement.init[index];
      if (init?.type === 'StringLiteral' && dotted(variable) === target) found.push(init);
    });
  }
  const [literal] = found;
  if (found.length !== 1 || literal === undefined) throw new ShapeError(file, `expected one string assignment to ${target}`);
  return literal;
}

function dotted(node: Expression): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.indexer === '.') {
    const base = dotted(node.base);
    return base === null ? null : `${base}.${node.identifier.name}`;
  }
  return null;
}

function readDeferredRows(file: string, literal: StringLiteral, content: string): readonly DeferredRow[] {
  const offset = longStringContentLine(literal, file) - 1;
  const inner = parseLua(bytesToLuaText(Buffer.from(content, 'utf8'), file), file, { comments: true, locations: true });
  const comments = lineCommentsByLine(inner, file);
  const [statement, ...rest] = inner.body;
  if (statement?.type !== 'ReturnStatement' || rest.length > 0 || statement.arguments.length !== 1) throw new ShapeError(file, 'deferred string must be `return { ... }`');
  const table = statement.arguments[0];
  if (table?.type !== 'TableConstructorExpression') throw new ShapeError(file, 'deferred string must return a table constructor');
  const rows: DeferredRow[] = [];
  const lines = new Set<number>();
  const keys = new Set<number>();
  for (const field of table.fields) {
    const at = `${file}:${String((field.loc?.start.line ?? 0) + offset)}`;
    if (field.type !== 'TableKey' || field.key.type !== 'NumericLiteral' || field.value.type !== 'NumericLiteral') throw new ShapeError(at, 'row must be `[number] = number`');
    const innerLine = field.loc?.start.line;
    if (innerLine === undefined || field.loc?.end.line !== innerLine) throw new ShapeError(at, 'row must be on one line');
    if (lines.has(innerLine)) throw new ShapeError(at, 'two rows on one line');
    lines.add(innerLine);
    if (keys.has(field.key.value)) throw new ShapeError(at, `key ${String(field.key.value)} repeated`);
    keys.add(field.key.value);
    const comment = comments.get(innerLine);
    if (comment !== undefined && comment.column < (field.loc?.end.column ?? 0)) throw new ShapeError(at, 'comment before the row');
    rows.push({ key: field.key.value, value: field.value.value, line: innerLine + offset, comment: comment === undefined || comment.text === '' ? null : comment.text });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Dungeons

export interface DungeonEntry extends DungeonRow {
  readonly areaId: number;
}

function entrance(value: LuaValue, where: string, unverified: (areaId: number, x: number, y: number) => boolean): EntranceRow {
  if (!(value instanceof LuaTable)) throw new ShapeError(where, `entrance is ${describeValue(value)}`);
  const [areaId, x, y] = sequence(value, where);
  if (value.size !== 3 || typeof areaId !== 'number' || !Number.isInteger(areaId) || typeof x !== 'number' || typeof y !== 'number') {
    throw new ShapeError(where, 'entrance must be {areaId, x, y}');
  }
  return { areaId, x, y, frameVerified: !unverified(areaId, x, y) };
}

/**
 * dungeons.lua for one faction (it reads `UnitFactionGroup` at load). Entrances listed in
 * `frameUnverified` get `frameVerified: false`; each listed entrance must match exactly one.
 */
export function readDungeons(
  bytes: Uint8Array,
  faction: 'Alliance' | 'Horde',
  rules: string,
  frameUnverified: readonly UnverifiedEntrance[] = FRAME_UNVERIFIED_ENTRANCES,
): ReadonlyMap<number, DungeonEntry> {
  const file = DUNGEONS_FILE;
  const env = supportEnvironment(rules);
  env.persona.faction = faction;
  const chunk = parseLua(bytesToLuaText(bytes, file), file, { locations: true });
  const lints: Lint[] = [];
  new Evaluator({ file, globals: env.globals, varargs: [], lints }).runChunk(chunk);
  if (lints.length > 0) throw new ShapeError(file, lints.map((lint) => lint.detail).join('; '));
  const privateTable = env.module('ZoneDB').get('private');
  const dungeons = privateTable instanceof LuaTable ? privateTable.get('dungeons') : null;
  if (!(dungeons instanceof LuaTable)) throw new ShapeError(file, 'ZoneDB.private.dungeons is not a table');
  const out = new Map<number, DungeonEntry>();
  const matched = new Map<UnverifiedEntrance, number>(frameUnverified.map((entry) => [entry, 0]));
  const unverifiedIn =
    (dungeonAreaId: number) =>
    (areaId: number, x: number, y: number): boolean => {
      const entry = frameUnverified.find((e) => e.dungeonAreaId === dungeonAreaId && e.areaId === areaId && e.x === x && e.y === y);
      if (entry !== undefined) matched.set(entry, (matched.get(entry) ?? 0) + 1);
      return entry !== undefined;
    };
  for (const [key, value] of dungeons.entries()) {
    const where = `${file} [${String(key)}]`;
    if (typeof key !== 'number' || !Number.isInteger(key)) throw new ShapeError(where, 'dungeon key is not an AreaId');
    if (!(value instanceof LuaTable)) throw new ShapeError(where, 'entry is not a table');
    for (const k of value.keys()) if (k !== 1 && k !== 2 && k !== 3 && k !== 4) throw new ShapeError(where, `unexpected slot ${String(k)}`);
    const name = value.get(1);
    const alternatives = value.get(2);
    const parent = value.get(3);
    const entrances = value.get(4);
    if (typeof name !== 'string' || typeof parent !== 'number' || !(entrances instanceof LuaTable)) throw new ShapeError(where, 'entry must be {name, alternativeAreaIds?, parentZone, entrances}');
    const alternativeAreaIds =
      alternatives === null
        ? []
        : sequence(alternatives instanceof LuaTable ? alternatives : new LuaTable(), `${where} alternatives`).map((id) => {
            if (typeof id !== 'number' || !Number.isInteger(id)) throw new ShapeError(where, 'alternative AreaId is not an integer');
            return id;
          });
    if (alternatives !== null && !(alternatives instanceof LuaTable)) throw new ShapeError(where, 'alternativeAreaIds is not a list');
    out.set(key, {
      areaId: key,
      name,
      alternativeAreaIds,
      parentZoneAreaId: parent,
      entrances: sequence(entrances, `${where} entrances`).map((row, index) => entrance(row, `${where} entrance ${String(index + 1)}`, unverifiedIn(key))),
    });
  }
  for (const [entry, count] of matched) {
    if (count !== 1) {
      throw new ShapeError(file, `the audit's frame-unverified entrance ${entry.label} matches ${String(count)} entrances (${faction}); review FRAME_UNVERIFIED_ENTRANCES against ${COORDINATE_AUDIT_FILE}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Assembly

/** Links whose points are zone points in the mapped UiMap's frame (Questie's reading). */
export const isZoneLink = (link: AreaLink): boolean => link === 'direct' || link === 'routed' || link === 'synthetic-alias';

export interface AreaEntry {
  readonly uiMapId: number;
  readonly link: AreaLink;
}

export interface UiMapEntry {
  readonly name: string | null;
  readonly nameSource: string | null;
  readonly areaId: number | null;
}

export interface ZoneTables {
  readonly areas: ReadonlyMap<number, AreaEntry>;
  readonly uiMaps: ReadonlyMap<number, UiMapEntry>;
  /** Every dungeons.lua key and alternative AreaId (the instance-type areas). */
  readonly instanceTypeAreas: ReadonlySet<number>;
  readonly dungeonsByFaction: { readonly Alliance: ReadonlyMap<number, DungeonEntry>; readonly Horde: ReadonlyMap<number, DungeonEntry> };
  readonly report: {
    readonly baseRows: number;
    readonly overrideRows: number;
    readonly overriddenBaseRows: readonly number[];
    readonly legacyPairs: { readonly 'Referenced dungeon area': number; readonly 'Referenced synthetic dungeon alias': number };
    readonly suppressedAreas: readonly number[];
    readonly syntheticAliases: readonly number[];
    /** AreaIds linked as direct frames and as routed subzones (after the overrides). */
    readonly directAreas: number;
    readonly routedAreas: number;
    readonly namedUiMaps: number;
    readonly unnamedUiMaps: readonly number[];
    readonly reverseLinkMismatches: readonly string[];
  };
}

/** A UiMapAssignment frame as conversion.json records it (`geometry.transforms[]`). */
export interface FrameIdentity {
  readonly uiMapId: number;
  readonly areaId: number;
}

/**
 * `frames`: UiMapAssignment rows known from the client (conversion.json `geometry.transforms`,
 * DBC target build). Each must come out as a `direct` link to its own UiMap, or the extraction
 * fails, which cross-checks the direct/routed split against a client-derived source.
 */
export function buildZoneTables(
  areaFile: ReadonlyMap<string, readonly DeferredRow[]>,
  uiMapFile: ReadonlyMap<string, readonly DeferredRow[]>,
  dungeonsByFaction: ZoneTables['dungeonsByFaction'],
  frames: readonly FrameIdentity[] = [],
): ZoneTables {
  const baseRows = areaFile.get('areaIdToUiMapId') ?? [];
  const areaOverride = areaFile.get('areaIdToUiMapIdOverride') ?? [];
  const uiMain = uiMapFile.get('uiMapIdToAreaId') ?? [];
  const uiOverride = uiMapFile.get('uiMapIdToAreaIdOverride') ?? [];
  const instanceTypeAreas = new Set<number>();
  for (const dungeons of [dungeonsByFaction.Alliance, dungeonsByFaction.Horde]) {
    for (const entry of dungeons.values()) {
      instanceTypeAreas.add(entry.areaId);
      for (const id of entry.alternativeAreaIds) instanceTypeAreas.add(id);
    }
  }

  // uiMapIdToAreaId: names (rules 2-4, 6) and the legacy rows (rule 3).
  const uiMaps = new Map<number, UiMapEntry>();
  const legacyPairs = new Map<number, number>(); // areaId → uiMapId
  const namedOverridePairs = new Map<number, number>(); // areaId → uiMapId
  const legacyCounts = { 'Referenced dungeon area': 0, 'Referenced synthetic dungeon alias': 0 };
  const nameOf = (row: DeferredRow, where: string): UiMapEntry => {
    if (row.comment === null) throw new ShapeError(where, `UiMap ${String(row.key)} has no name comment (rule 4)`);
    if ((LEGACY_COMMENTS as readonly string[]).includes(row.comment)) throw new ShapeError(where, `UiMap ${String(row.key)} carries a legacy comment where a name is required (rule 3)`);
    return { name: row.comment, nameSource: `questiedb:${UIMAP_TO_AREA_FILE}:${String(row.line)}`, areaId: row.value };
  };
  for (const row of uiMain) {
    const where = `${UIMAP_TO_AREA_FILE}:${String(row.line)}`;
    if (uiMaps.has(row.key)) throw new ShapeError(where, `UiMap ${String(row.key)} listed twice`);
    uiMaps.set(row.key, nameOf(row, where));
  }
  for (const row of uiOverride) {
    const where = `${UIMAP_TO_AREA_FILE}:${String(row.line)}`;
    if (instanceTypeAreas.has(row.value)) {
      // A legacy compatibility row: its comment must be exactly one of the two markers (rule 3).
      if (row.comment === null || !(LEGACY_COMMENTS as readonly string[]).includes(row.comment)) {
        throw new ShapeError(where, `legacy row [${String(row.key)}] = ${String(row.value)} has comment ${JSON.stringify(row.comment)} (rule 3)`);
      }
      legacyCounts[row.comment as (typeof LEGACY_COMMENTS)[number]] += 1;
      legacyPairs.set(row.value, row.key);
    } else {
      if (uiMaps.has(row.key)) throw new ShapeError(where, `UiMap ${String(row.key)} listed twice`);
      uiMaps.set(row.key, nameOf(row, where));
      namedOverridePairs.set(row.value, row.key);
    }
  }

  // areaIdToUiMapId: override wins over base; every override row must be classified. A base row
  // is `direct` when its AreaId is the UiMap's own AreaId in uiMapIdToAreaId (the UiMapAssignment
  // AreaID that defines the frame, research/coordinates.md §13.2), else `routed` (a subzone
  // routed to its parent zone's UiMap).
  const ownArea = new Map(uiMain.map((row) => [row.key, row.value]));
  const areas = new Map<number, AreaEntry>();
  for (const row of baseRows) {
    if (row.value === 0) throw new ShapeError(`${AREA_TO_UIMAP_FILE}:${String(row.line)}`, 'a base row maps to UiMap 0');
    areas.set(row.key, { uiMapId: row.value, link: ownArea.get(row.value) === row.key ? 'direct' : 'routed' });
  }
  const overriddenBaseRows: number[] = [];
  const suppressedAreas: number[] = [];
  const syntheticAliases: number[] = [];
  const seenLegacy = new Set<number>();
  for (const row of areaOverride) {
    const where = `${AREA_TO_UIMAP_FILE}:${String(row.line)}`;
    if (areas.has(row.key)) overriddenBaseRows.push(row.key);
    let link: AreaLink;
    if (row.value === 0) {
      link = 'suppressed';
      suppressedAreas.push(row.key);
    } else if (legacyPairs.get(row.key) === row.value) {
      if (row.comment === null || !(LEGACY_COMMENTS as readonly string[]).includes(row.comment)) throw new ShapeError(where, `legacy pair comment ${JSON.stringify(row.comment)}`);
      link = 'legacy-compat';
      seenLegacy.add(row.key);
    } else if (namedOverridePairs.get(row.key) === row.value) {
      link = 'synthetic-alias';
      syntheticAliases.push(row.key);
    } else {
      throw new ShapeError(where, `override [${String(row.key)}] = ${String(row.value)} is neither suppression, a legacy pair nor a named alias; review it`);
    }
    areas.set(row.key, { uiMapId: row.value, link });
  }
  for (const areaId of legacyPairs.keys()) {
    if (!seenLegacy.has(areaId)) throw new ShapeError(UIMAP_TO_AREA_FILE, `legacy pair for AreaId ${String(areaId)} has no forward override`);
  }
  for (const frame of frames) {
    const entry = areas.get(frame.areaId);
    if (entry?.uiMapId !== frame.uiMapId || entry.link !== 'direct') {
      const got = entry === undefined ? 'not linked' : `linked as ${entry.link} to UiMap ${String(entry.uiMapId)}`;
      throw new ShapeError(AREA_TO_UIMAP_FILE, `conversion.json frame UiMap ${String(frame.uiMapId)} (AreaID ${String(frame.areaId)}) is ${got}, not as a direct link`);
    }
  }

  // Every UiMap a direct, routed or alias link reaches is a zone; unlisted ones have no name (rule 4).
  const unnamed: number[] = [];
  for (const entry of areas.values()) {
    if (isZoneLink(entry.link) && !uiMaps.has(entry.uiMapId)) {
      uiMaps.set(entry.uiMapId, { name: null, nameSource: null, areaId: null });
      unnamed.push(entry.uiMapId);
    }
  }
  const reverseLinkMismatches: string[] = [];
  for (const [uiMapId, entry] of uiMaps) {
    if (entry.areaId === null) continue;
    const forward = areas.get(entry.areaId);
    if (forward?.uiMapId !== uiMapId) reverseLinkMismatches.push(`UiMap ${String(uiMapId)} → AreaId ${String(entry.areaId)} → ${forward === undefined ? 'no UiMap' : `UiMap ${String(forward.uiMapId)}`}`);
  }
  const sorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);
  return {
    areas: new Map([...areas].sort((a, b) => a[0] - b[0])),
    uiMaps: new Map([...uiMaps].sort((a, b) => a[0] - b[0])),
    instanceTypeAreas,
    dungeonsByFaction,
    report: {
      baseRows: baseRows.length,
      overrideRows: areaOverride.length,
      overriddenBaseRows: sorted(overriddenBaseRows),
      legacyPairs: legacyCounts,
      suppressedAreas: sorted(suppressedAreas),
      syntheticAliases: sorted(syntheticAliases),
      directAreas: [...areas.values()].filter((entry) => entry.link === 'direct').length,
      routedAreas: [...areas.values()].filter((entry) => entry.link === 'routed').length,
      namedUiMaps: [...uiMaps.values()].filter((entry) => entry.name !== null).length,
      unnamedUiMaps: sorted(unnamed),
      reverseLinkMismatches,
    },
  };
}
