import { sha256Hex } from './git';
import { CARVE_OUT } from './notice';
import type { LicenceCheck } from './upstream';

/**
 * public/data/manifest.json (DATA_PROVENANCE §8, the single authoritative manifest; D-026) and
 * the content-addressed dataRevision (§8.3).
 */

export const MANIFEST_SCHEMA_VERSION = 1;
export const DATASET_ID = 'questiedb-forever';

export interface Origin {
  readonly fields: readonly string[];
  readonly origin: string;
  readonly evidence: string;
}

export interface OutputEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Records in the file (rows, map entries or patches), or null for NOTICE.md. */
  readonly records: number | null;
  readonly origins: readonly Origin[];
}

/**
 * lines = path + "\t" + sha256 + "\n" for each output sorted by path (UTF-8 byte order);
 * dataRevision = SHA-256 of their concatenation.
 */
export function computeDataRevision(outputs: readonly { readonly path: string; readonly sha256: string }[]): string {
  for (const output of outputs) {
    if (/[\t\n\r]/.test(output.path)) throw new Error(`output path ${JSON.stringify(output.path)} contains a tab or newline`);
    if (!/^[0-9a-f]{64}$/.test(output.sha256)) throw new Error(`output ${output.path} has a malformed sha256`);
  }
  const sorted = [...outputs].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  return sha256Hex(sorted.map((output) => `${output.path}\t${output.sha256}\n`).join(''));
}

export function outputEntry(path: string, content: string, records: number | null, origins: readonly Origin[]): OutputEntry {
  const bytes = Buffer.from(content, 'utf8');
  return { path, sha256: sha256Hex(bytes), bytes: bytes.length, records, origins };
}

/** A value this tool derives from QuestieDB data with its own, documented rules (DATA_PROVENANCE §8.2). */
const DERIVED = 'derived by forever-route-lab from questiedb';

/** DATA_PROVENANCE §8.2, per output file. */
export const ORIGINS: Readonly<Record<string, readonly Origin[]>> = {
  'quests.json': [
    { fields: ['id', 'level', 'minLevel', 'maxLevel', 'races', 'classes', 'zoneOrSort', 'starters', 'finishers', 'objectives', 'prerequisites', 'requirements', 'reputationReward', 'flags'], origin: 'questiedb', evidence: 'data/Forever/foreverQuestDB.lua; src/corrections/Forever/**' },
    { fields: ['dungeonQuest'], origin: DERIVED, evidence: 'support/Forever/Zones/dungeons.lua; tools/questiedb/lib/dungeon-areas.ts (self-authored classification of its entries)' },
    { fields: ['name', 'objectivesText'], origin: 'blizzard-game-content', evidence: 'data/Forever/foreverQuestDB.lua (quest text via QuestieDB)' },
    {
      fields: ['objectives[].label', 'objectives[kind=event].text'],
      origin: 'blizzard-game-content or questiedb-authored (not distinguished)',
      evidence: 'data/Forever/foreverQuestDB.lua; src/corrections/Forever/legacy/classicQuestFixes.lua (corrections write labels and event text too)',
    },
    { fields: ['objectives[kind=event].points', 'objectiveHints[].points'], origin: 'questiedb; Era→Forever projection blizzard-client-derived (1.15.9.69722 → 1.60.1.69893)', evidence: 'data/Forever/conversion.json' },
    { fields: ['objectiveHints[].text'], origin: 'questiedb', evidence: 'src/corrections/Forever/legacy/classicQuestFixes.lua (extraObjectives are authored in the corrections)' },
    { fields: ['xp'], origin: 'questiedb (Era seed; value origin not declared)', evidence: 'support/Forever/QuestXP/xpDB-classic.lua:1; docs/forever-data.md:70' },
  ],
  'entities.json': [
    { fields: ['name', 'subName'], origin: 'blizzard-game-content', evidence: 'data/Forever/foreverNpcDB.lua; data/Forever/foreverObjectDB.lua' },
    { fields: ['minLevel', 'maxLevel', 'rank', 'zoneId', 'npcFlags', 'friendlyTo', 'factionId', 'questStarts', 'questEnds'], origin: 'questiedb', evidence: 'data/Forever/foreverNpcDB.lua; data/Forever/foreverObjectDB.lua; src/corrections/Forever/**' },
  ],
  'items.json': [
    { fields: ['name'], origin: 'blizzard-game-content', evidence: 'data/Forever/foreverItemDB.lua' },
    { fields: ['startsQuest (the items listed in manifest provenance.itemStartFixesOnly)'], origin: 'declared:wowhead-generated via questiedb:itemStartFixes', evidence: 'src/corrections/Forever/legacy/itemStartFixes.lua:13' },
    { fields: ['dropNpcs', 'dropObjects', 'dropItems', 'startsQuest (every other item)', 'itemClass'], origin: 'questiedb', evidence: 'data/Forever/foreverItemDB.lua (no third-party origin declared; the declared Wowhead/CMaNGOS drop percentages are not shipped: support/Forever/DropTables/classicItemDrops.lua:7,17806)' },
  ],
  'spawns.json': [{ fields: ['npc', 'object'], origin: 'questiedb; Era→Forever projection blizzard-client-derived (1.15.9.69722 → 1.60.1.69893)', evidence: 'data/Forever/conversion.json' }],
  'zones.json': [
    { fields: ['areas[].uiMapId'], origin: 'blizzard-client-derived (1.60.1.69893, hand-completed upstream)', evidence: 'support/Forever/Zones/areaIdToUiMapId.lua:1-4' },
    { fields: ['areas[].link'], origin: DERIVED, evidence: 'support/Forever/Zones/areaIdToUiMapId.lua; support/Forever/Zones/uiMapIdToAreaId.lua; tools/questiedb/lib/zones.ts' },
    { fields: ['uiMaps[].name', 'dungeons[].name'], origin: 'blizzard-game-content (from comments of a hand-completed file; dungeons.lua)', evidence: 'support/Forever/Zones/uiMapIdToAreaId.lua:1-4; support/Forever/Zones/dungeons.lua' },
    { fields: ['dungeons[].entrances', 'dungeons[].alternativeAreaIds', 'instanceAreas'], origin: 'questiedb', evidence: 'support/Forever/Zones/dungeons.lua' },
    { fields: ['dungeons[].entrances[].frameVerified'], origin: DERIVED, evidence: 'docs/forever-coordinate-audit.md (QuestieDB); tools/questiedb/lib/zones.ts FRAME_UNVERIFIED_ENTRANCES' },
  ],
  'overlays.json': [{ fields: ['faction', 'class'], origin: 'questiedb (dynamic corrections; names and text inside are blizzard-game-content)', evidence: 'src/corrections/Forever/legacy/*:LoadFactionFixes; support/Forever/Zones/dungeons.lua' }],
  'NOTICE.md': [],
};

export interface ManifestInput {
  readonly generated: unknown;
  readonly slice: unknown;
  readonly upstream: { readonly repository: string; readonly branchObserved: string; readonly commit: string; readonly commitDate: string };
  readonly flavour: string;
  readonly sourceGameBuilds: { readonly dbcTarget: string; readonly conversionSource: string; readonly uiSourceResearched: string; readonly tocInterface: number };
  readonly licenceCheck: LicenceCheck;
  readonly toolTreeHash: { readonly tree: string; readonly lockfile: string };
  readonly runtime: { readonly luaparse: string };
  readonly inputs: readonly { readonly path: string; readonly sha256: string; readonly gitBlob: string; readonly bytes: number; readonly role: string }[];
  readonly upstreamManifestCheck: unknown;
  readonly layers: readonly string[];
  readonly dynamicLayers: readonly unknown[];
  readonly outputs: readonly OutputEntry[];
  readonly counts: unknown;
  readonly provenance: unknown;
}

/** The manifest object, keys in DATA_PROVENANCE §8.1 order. */
export function buildManifest(input: ManifestInput): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    _generated: input.generated,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    dataRevision: computeDataRevision(input.outputs),
    dataset: DATASET_ID,
    flavour: input.flavour,
  };
  if (input.slice !== null) manifest.slice = input.slice;
  Object.assign(manifest, {
    upstream: input.upstream,
    licence: {
      upstreamLicenceFile: input.licenceCheck.upstreamLicenceFile,
      checked: input.licenceCheck.date,
      finding: `${input.licenceCheck.result}, full-history check (${input.licenceCheck.evidence})`,
      projectLicence: 'GPL-3.0-or-later',
      scope: CARVE_OUT,
      notice: 'NOTICE.md',
    },
    sourceGameBuilds: input.sourceGameBuilds,
    toolTreeHash: input.toolTreeHash,
    runtime: input.runtime,
    inputs: input.inputs,
    upstreamManifestCheck: input.upstreamManifestCheck,
    layers: input.layers,
    dynamicLayers: input.dynamicLayers,
    outputs: input.outputs,
    counts: input.counts,
    provenance: input.provenance,
    foreverContentVerified: false,
  });
  return manifest;
}
