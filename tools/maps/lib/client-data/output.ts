import { gzipSync } from 'node:zlib';
import { inputHash } from '../../../casc/input-hash';
import { WOWDBDEFS_COMMIT, WOWDBDEFS_REPOSITORY } from '../../../casc/layout-source';
import { sha256Hex } from '../hash';
import { formatJson } from '../json';
import { wrap } from '../notice';
import {
  buildDungeons,
  buildTaxi,
  buildZones,
  DUNGEON_COLUMNS,
  DUNGEON_SELECTION,
  TAXI_COLUMNS,
  TAXI_SELECTION,
  ZONE_COLUMNS,
  ZONE_SELECTION,
  type DungeonsBuild,
  type TaxiBuild,
  type ZonesBuild,
} from './build';
import {
  CLIENT_TABLE_FILES,
  CLIENT_TABLES_BUDGET_GZIP_BYTES,
  CLIENT_TABLES_ENTRY,
  CLIENT_TABLES_MANIFEST,
  CLIENT_TABLES_NOTICE,
  REPOSITORY_URL,
  TAXI_FLIGHT_MAPS,
  TAXI_SHAPE_TOLERANCE_YD,
  type ClientTableKind,
} from './constants';
import { CLIENT_LAYOUT_BUILD } from './layouts';
import type { ClientTablesRead, TableInput } from './read';

/**
 * Assembles `public/maps/client/`: the three table files, `manifest.json` and `NOTICE.md`
 * (map-presentation.md §16; D-039). Deterministic: the same rows, client and tool tree give the
 * same bytes (fixed key order, LF, no timestamps), which is what `--check` compares.
 */

export interface ClientTablesFacts {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  /** The module-closure hash of the tool (tools/terrain/lib/tool-tree.ts) and its file count. */
  readonly tool: { readonly hash: string; readonly files: number };
}

export interface ClientTablesOutput {
  readonly name: string;
  readonly bytes: Buffer;
}

export interface ClientTablesBuild {
  readonly taxi: TaxiBuild;
  readonly zones: ZonesBuild;
  readonly dungeons: DungeonsBuild;
  /** Every file of the folder, the manifest and the NOTICE last. */
  readonly outputs: readonly ClientTablesOutput[];
  readonly manifestText: string;
  readonly noticeText: string;
  /** gzip-6 bytes of every output, and their sum (the folder's budget measure). */
  readonly gzipBytes: Readonly<Record<string, number>>;
  readonly totalGzipBytes: number;
}

/** The columns each table contributes (read and used), per table. Only these are shipped (review MP-R19). */
export const TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  TaxiNodes: ['ID', 'Name_lang', 'ContinentID', 'Pos[0]', 'Pos[1]', 'Flags'],
  TaxiPath: ['ID', 'FromTaxiNode', 'ToTaxiNode', 'Cost'],
  TaxiPathNode: ['PathID', 'NodeIndex', 'ContinentID', 'Loc[0]', 'Loc[1]', 'Loc[2]', 'Delay'],
  AreaTable: ['ID', 'AreaName_lang', 'ContinentID', 'ParentAreaID', 'FactionGroupMask', 'Flags[0]'],
  UiMapAssignment: ['AreaID'],
  LFGDungeons: ['ID', 'Name_lang', 'TypeID', 'ContentTuningID'],
  ContentTuning: ['ID', 'MinLevelSquish', 'MaxLevelSquish', 'LfgMinLevel', 'LfgMaxLevel'],
  Map: ['ID', 'MapName_lang', 'InstanceType'],
};

/** The tables each file is built from. */
export const FILE_TABLES: Readonly<Record<ClientTableKind, readonly string[]>> = {
  taxi: ['TaxiNodes', 'TaxiPath', 'TaxiPathNode'],
  zones: ['AreaTable', 'UiMapAssignment'],
  dungeons: ['LFGDungeons', 'ContentTuning', 'Map', 'AreaTable'],
};

const gzipSize = (bytes: Uint8Array): number => gzipSync(bytes, { level: 6 }).length;

function inputsOf(read: ClientTablesRead, tables: readonly string[]): readonly TableInput[] {
  return tables.map((name) => {
    const input = read.inputs.find((i) => i.table === name);
    if (input === undefined) throw new Error(`no input read for ${name}`);
    return input;
  });
}

function undecoded(inputs: readonly TableInput[]): Record<string, { readonly rows: number; readonly tactKeys: readonly string[] }> {
  const out: Record<string, { readonly rows: number; readonly tactKeys: readonly string[] }> = {};
  for (const input of [...inputs].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0))) {
    if (input.skippedRows > 0) out[input.table] = { rows: input.skippedRows, tactKeys: input.skippedKeys };
  }
  return out;
}

function header(kind: string, decision: string, build: string, positions: boolean): Record<string, unknown> {
  return {
    _generated: { by: 'tools/maps client-tables', notice: CLIENT_TABLES_NOTICE, edit: 'do not edit; regenerate with pnpm tsx tools/maps/client-tables.ts (needs the pinned client at WOW_INSTALL)' },
    schema: 1,
    kind,
    build,
    decision,
    ...(positions ? { units: 'yd' } : {}),
  };
}

export function buildClientTables(read: ClientTablesRead, facts: ClientTablesFacts): ClientTablesBuild {
  const build = facts.client.version;
  const taxi = buildTaxi(read.rows);
  const zones = buildZones(read.rows);
  const dungeons = buildDungeons(read.rows);
  const dungeonInputs = inputsOf(read, FILE_TABLES.dungeons);

  const files: Record<ClientTableKind, unknown> = {
    taxi: {
      ...header('client-taxi', 'D-039 B', build, true),
      selection: TAXI_SELECTION,
      columns: TAXI_COLUMNS,
      nodes: taxi.nodes,
      flights: taxi.flights,
      transports: taxi.transports,
    },
    zones: {
      ...header('client-zones', 'D-039 C', build, false),
      selection: ZONE_SELECTION,
      columns: ZONE_COLUMNS,
      zones: zones.zones,
    },
    dungeons: {
      ...header('client-dungeons', 'D-039 E', build, false),
      selection: DUNGEON_SELECTION,
      columns: DUNGEON_COLUMNS,
      undecoded: {
        note: 'rows in encrypted sections of these tables could not be read and are unknown: the lists below may be incomplete',
        tables: undecoded(dungeonInputs),
      },
      lfg: dungeons.lfg,
      instanceMaps: dungeons.instanceMaps,
    },
  };

  const counts: Record<ClientTableKind, unknown> = { taxi: taxi.counts, zones: zones.counts, dungeons: dungeons.counts };
  // The taxi file is written compact (one line, as the terrain arc files are), which keeps it within
  // the budget; the two small tables are formatted for review.
  const text = (kind: ClientTableKind): string => (kind === 'taxi' ? `${JSON.stringify(files[kind])}\n` : formatJson(files[kind]));
  const dataOutputs = (Object.keys(CLIENT_TABLE_FILES) as ClientTableKind[]).map((kind) => ({ kind, name: CLIENT_TABLE_FILES[kind], bytes: Buffer.from(text(kind)) }));
  const manifest = {
    _generated: { by: 'tools/maps client-tables', notice: CLIENT_TABLES_NOTICE, edit: 'do not edit; regenerate with pnpm tsx tools/maps/client-tables.ts (needs the pinned client at WOW_INSTALL)' },
    schema: 1,
    kind: 'client-tables',
    decision: 'D-039 (B, C and E)',
    derivedFrom: 'selected columns of World of Warcraft: Forever client DB2 tables, read-only through tools/casc; not game files',
    client: facts.client,
    layouts: { wowdbdefs: { repository: WOWDBDEFS_REPOSITORY, commit: WOWDBDEFS_COMMIT }, build: CLIENT_LAYOUT_BUILD },
    tool: { toolTreeHash: { [CLIENT_TABLES_ENTRY]: facts.tool.hash }, treeMethod: `module closure of ${CLIENT_TABLES_ENTRY} (${String(facts.tool.files)} files, tools/terrain/lib/tool-tree.ts)` },
    parameters: {
      positionQuantumYd: 1,
      flightMaps: TAXI_FLIGHT_MAPS,
      shapeToleranceYd: TAXI_SHAPE_TOLERANCE_YD,
      shapeMethod: 'Douglas-Peucker on TaxiPathNode Loc[0] and Loc[1] (distance to the segment), then rounded to 1 yd',
      l3d: 'sum of 3D segment lengths along TaxiPathNode Loc in NodeIndex order (SIMULATION TIME-6), rounded to 1 yd',
      inputHash: 'SHA-256 over "<FileDataID> <CKey>\\n" lines, ascending by FileDataID, of the DB2 files the file is built from',
      budgetGzipBytes: CLIENT_TABLES_BUDGET_GZIP_BYTES,
    },
    tables: read.inputs.map((input) => ({
      table: input.table,
      fileDataId: input.fileDataId,
      ckey: input.ckey,
      layoutHash: input.layoutHash,
      rows: input.rows,
      skippedRows: input.skippedRows,
      columns: TABLE_COLUMNS[input.table] ?? [],
    })),
    files: dataOutputs.map((o) => ({
      path: o.name,
      kind: o.kind,
      bytes: o.bytes.length,
      sha256: sha256Hex(o.bytes),
      tables: FILE_TABLES[o.kind],
      inputHash: inputHash(inputsOf(read, FILE_TABLES[o.kind])),
      counts: counts[o.kind],
    })),
  };
  const manifestText = formatJson(manifest);
  const noticeText = clientTablesNoticeText({ client: facts.client, tables: read.inputs, taxi: taxi.counts, zones: zones.counts.zones, lfgRows: dungeons.counts.lfgRows, instanceMaps: dungeons.counts.instanceMaps });
  const outputs: ClientTablesOutput[] = [
    ...dataOutputs.map((o) => ({ name: o.name, bytes: o.bytes })),
    { name: CLIENT_TABLES_MANIFEST, bytes: Buffer.from(manifestText) },
    { name: CLIENT_TABLES_NOTICE, bytes: Buffer.from(noticeText) },
  ];
  const gzipBytes = Object.fromEntries(outputs.map((o) => [o.name, gzipSize(o.bytes)]));
  return {
    taxi,
    zones,
    dungeons,
    outputs,
    manifestText,
    noticeText,
    gzipBytes,
    totalGzipBytes: Object.values(gzipBytes).reduce((a, b) => a + b, 0),
  };
}

const bullet = (text: string): string => wrap(text, '- ', '  ');

interface NoticeFacts {
  readonly client: ClientTablesFacts['client'];
  readonly tables: readonly TableInput[];
  readonly taxi: TaxiBuild['counts'];
  readonly zones: number;
  readonly lfgRows: number;
  readonly instanceMaps: number;
}

/** `NOTICE.md`: names Blizzard Entertainment, the decision, the provenance; no timestamp and no legal conclusion. */
export function clientTablesNoticeText(facts: NoticeFacts): string {
  const { client } = facts;
  const tables = facts.tables.map((t) => `\`${t.table}\` (${String(t.fileDataId)})`).join(', ');
  const blocks: readonly string[] = [
    '# Client-derived tables: notice',
    wrap(
      'Generated by `tools/maps/client-tables.ts`. Do not edit these files by hand; regenerate them with ' +
        '`pnpm tsx tools/maps/client-tables.ts` (it needs the pinned client at `WOW_INSTALL`) and check them with ' +
        "`pnpm tsx tools/maps/client-tables.ts --check`; `manifest.json` records every file's SHA-256.",
    ),
    '## What these files are',
    [
      bullet(
        `\`${CLIENT_TABLE_FILES.taxi}\`: the flight network of Eastern Kingdoms and Kalimdor (${String(facts.taxi.nodes)} flight nodes, ` +
          `${String(facts.taxi.flights)} flights between ${String(facts.taxi.pairs)} node pairs, each with its 3D path length and its shape ` +
          `simplified to ${String(TAXI_SHAPE_TOLERANCE_YD)} yd) and the stops of ${String(facts.taxi.transports)} transport paths.`,
      ),
      bullet(`\`${CLIENT_TABLE_FILES.zones}\`: the faction group and the sanctuary flag of ${String(facts.zones)} zones.`),
      bullet(
        `\`${CLIENT_TABLE_FILES.dungeons}\`: ${String(facts.lfgRows)} dungeon-finder rows with their tuning levels, and ` +
          `${String(facts.instanceMaps)} dungeon and raid maps with their type.`,
      ),
    ].join('\n'),
    wrap(
      'They hold selected columns of tables of the World of Warcraft: Forever client, and a few values this project computes ' +
        'from them (path lengths and simplified shapes). `manifest.json` and each file name the table and column of every value. ' +
        'The meanings of some values (the faction and sanctuary bits, the tuning level) are inferred and labelled as such.',
    ),
    '## Owner',
    [
      bullet(
        "World of Warcraft and its game data are Blizzard Entertainment's, © Blizzard Entertainment, Inc. These values come from " +
          "the game client's tables; they are not this project's work. World of Warcraft, Warcraft and Blizzard Entertainment are " +
          'trademarks or registered trademarks of Blizzard Entertainment, Inc.',
      ),
      bullet("This repository's GPL-3.0-or-later licence covers the project's own code and grants no rights over Blizzard content or client-derived values."),
    ].join('\n'),
    '## Why they are here (D-039)',
    wrap(
      'The project owner decided to commit and deploy these tables with a manifest, this notice and a reproducible extraction ' +
        '(docs/DECISIONS.md D-039, decisions B, C and E). This records a decision; it is not a legal conclusion.',
    ),
    '## How they were made',
    [
      bullet(
        `Read-only from the local client's \`Data/\` folder through this project's CASC reader (\`tools/casc\`), pinned to ` +
          `\`${client.product}\` ${client.version}, build key \`${client.buildKey}\`. Nothing is fetched from the network.`,
      ),
      bullet(`Tables: ${tables}; layouts from WoWDBDefs (THIRD_PARTY_NOTICES "Format definitions").`),
      bullet('Rows in encrypted sections of a table cannot be read; `manifest.json` counts them, and they stay unknown.'),
      bullet('No DB2 or other client file is committed or deployed; only these derived JSON files are.'),
    ].join('\n'),
    '## Non-affiliation',
    wrap('forever-route-lab is not affiliated with or endorsed by Blizzard Entertainment.'),
    `More: [docs/research/map-presentation.md](${REPOSITORY_URL}/blob/main/docs/research/map-presentation.md) §16, ` +
      `[docs/DECISIONS.md](${REPOSITORY_URL}/blob/main/docs/DECISIONS.md) D-039 and ` +
      `[THIRD_PARTY_NOTICES.md](${REPOSITORY_URL}/blob/main/THIRD_PARTY_NOTICES.md) ("Client-derived tables").`,
  ];
  return `${blocks.join('\n\n')}\n`;
}
