import { performance } from 'node:perf_hooks';
import { compose, type Composition, counts as countRows, loadMetas } from './compose';
import { buildDataset, type Dataset } from './dataset';
import { pretty } from './json';
import { buildManifest, type OutputEntry, ORIGINS, outputEntry } from './manifest';
import { readAuthorship, renderNotice } from './notice';
import { CLASS_TOKENS, FACTIONS } from './overlays';
import { describeStep } from './plan';
import { readCoefficients } from './provenance';
import { QUEST_XP_FILE, readQuestXp } from './questxp';
import { generatedMarker, renderDataset } from './render';
import { HINT_SETS } from './sandbox';
import { assertTranscriptionsCurrent } from './semantics';
import { FIXTURE_REGION, sliceDataset } from './slice';
import type { UpstreamPin, UpstreamSource } from './upstream';
import { AREA_TO_UIMAP_FILE, buildZoneTables, DUNGEONS_FILE, type FrameIdentity, readDeferredTables, readDungeons, UIMAP_TO_AREA_FILE } from './zones';

/**
 * The whole extraction in memory (DATA_PROVENANCE §5 step 2): compose Forever and the fork base,
 * build the dataset, render public/data and the fixture slice, and assemble both manifests and
 * the (non-shipped) report. Nothing here writes files or reads a clock except for timings and
 * `extractedAt`, which only the report carries.
 */

export interface ToolIdentity {
  readonly toolTreeHash: { readonly tree: string; readonly lockfile: string };
  readonly runtime: { readonly luaparse: string };
  /** How `toolTreeHash.tree` was computed: by git in a checkout, or in-process (lib/git-tree.ts) without one. Report only. */
  readonly treeMethod: 'git' | 'in-process';
}

export interface RenderedDirectory {
  /** path relative to the directory → file content (manifest.json included). */
  readonly files: ReadonlyMap<string, string>;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface Extraction {
  readonly full: RenderedDirectory;
  readonly slice: RenderedDirectory;
  readonly dataset: Dataset;
  readonly report: Readonly<Record<string, unknown>>;
}

export class GoldenCountError extends Error {}

const FORK_BASE_FLAVOUR = 'Vanilla';

interface ConversionJson {
  readonly geometry?: { readonly source_build?: unknown; readonly target_build?: unknown; readonly transforms?: unknown };
  readonly files?: Readonly<Record<string, { readonly source?: unknown; readonly source_sha256?: unknown; readonly output_sha256?: unknown }>>;
  readonly zone_symbols_sha256?: unknown;
}

function upstreamChecks(source: UpstreamSource, conversion: ConversionJson): { readonly check: Record<string, unknown>; readonly ok: boolean } {
  const hashOf = new Map(source.inputs.map((input) => [input.path, input.sha256]));
  const files = Object.entries(conversion.files ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([output, entry]) => {
      const sourcePath = typeof entry.source === 'string' ? entry.source : null;
      return {
        output,
        outputSha256Matches: hashOf.get(output) === entry.output_sha256,
        source: sourcePath,
        sourceSha256Matches: sourcePath !== null && hashOf.get(sourcePath) === entry.source_sha256,
      };
    });
  const zoneSymbols = hashOf.get('support/Forever/Zones/zoneIds.lua') === conversion.zone_symbols_sha256;
  const provenance = JSON.parse(source.read('support/Forever/provenance.json').toString('utf8')) as { readonly dbc_report?: { readonly build?: unknown }; readonly upstream_seed_commit?: unknown; readonly coordinate_source_checkout_commit?: unknown };
  const dbcBuild = provenance.dbc_report?.build;
  const provenanceMatches = dbcBuild === conversion.geometry?.target_build;
  const ok = files.length === 10 && files.every((f) => f.outputSha256Matches && f.sourceSha256Matches) && zoneSymbols && provenanceMatches;
  return {
    ok,
    check: {
      conversionFiles: files,
      zoneSymbolsSha256Matches: zoneSymbols,
      provenanceJson: {
        dbcReportBuild: typeof dbcBuild === 'string' ? dbcBuild : null,
        matchesDbcTarget: provenanceMatches,
        upstreamSeedCommit: typeof provenance.upstream_seed_commit === 'string' ? provenance.upstream_seed_commit : null,
        coordinateToolBase: typeof provenance.coordinate_source_checkout_commit === 'string' ? provenance.coordinate_source_checkout_commit : null,
      },
      allMatch: ok,
    },
  };
}

/** conversion.json `geometry.transforms[]`: the UiMapAssignment frames (UiMap and its AreaID) at the DBC target build. */
function conversionFrames(conversion: ConversionJson): readonly FrameIdentity[] {
  const transforms = conversion.geometry?.transforms;
  if (!Array.isArray(transforms)) throw new Error('conversion.json: geometry.transforms is not a list');
  return transforms.map((entry: unknown, index): FrameIdentity => {
    const t = entry as { readonly ui_map_id?: unknown; readonly area_id?: unknown } | null;
    if (typeof t?.ui_map_id !== 'number' || typeof t.area_id !== 'number') throw new Error(`conversion.json: geometry.transforms[${String(index)}] lacks ui_map_id/area_id`);
    return { uiMapId: t.ui_map_id, areaId: t.area_id };
  });
}

function sourceGameBuilds(source: UpstreamSource, conversion: ConversionJson, forever: Composition): { dbcTarget: string; conversionSource: string; uiSourceResearched: string; tocInterface: number } {
  const target = conversion.geometry?.target_build;
  const from = conversion.geometry?.source_build;
  if (typeof target !== 'string' || typeof from !== 'string') throw new Error('conversion.json: geometry.source_build/target_build missing');
  const foreverMd = source.read('docs/forever.md').toString('utf8');
  const ui = /researched Forever UI source is\s+\*\*(\d+\.\d+\.\d+\.\d+)\*\*/.exec(foreverMd)?.[1];
  if (ui === undefined) throw new Error('docs/forever.md: the researched Forever UI source build was not found');
  const toc = Number(forever.flavour.interface);
  if (!Number.isInteger(toc)) throw new Error(`config.lua: Forever interface ${forever.flavour.interface} is not one integer`);
  return { dbcTarget: target, conversionSource: from, uiSourceResearched: ui, tocInterface: toc };
}

export function runExtraction(pin: UpstreamPin, source: UpstreamSource, tool: ToolIdentity): Extraction {
  const started = performance.now();
  // A transcribed upstream file that changed since its transcription fails closed (data-F2).
  assertTranscriptionsCurrent(pin.inputs);
  const timings: Record<string, number> = {};
  const time = <T>(label: string, fn: () => T): T => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      timings[label] = Math.round(performance.now() - start);
    }
  };
  const read = (path: string): Buffer => source.read(path);
  const metas = time('schema meta', () => loadMetas(read));
  const forever = time(`compose ${pin.flavour}`, () => compose(read, pin.flavour, metas));
  const era = time(`compose fork base (${FORK_BASE_FLAVOUR})`, () => compose(read, FORK_BASE_FLAVOUR, metas));
  const composedCounts = countRows(forever.composed);
  const rawCounts = countRows(forever.raw);
  for (const key of ['quests', 'npcs', 'objects', 'items'] as const) {
    if (composedCounts[key] !== pin.golden.composed[key] || rawCounts[key] !== pin.golden.raw[key]) {
      throw new GoldenCountError(`golden counts: ${key} raw ${String(rawCounts[key])} / composed ${String(composedCounts[key])}, upstream.json expects ${String(pin.golden.raw[key])} / ${String(pin.golden.composed[key])}`);
    }
  }
  const rules = forever.flavour.rules;
  const conversion = JSON.parse(read('data/Forever/conversion.json').toString('utf8')) as ConversionJson;
  const zones = time('zones', () =>
    buildZoneTables(
      readDeferredTables(AREA_TO_UIMAP_FILE, read(AREA_TO_UIMAP_FILE), ['areaIdToUiMapIdOverride', 'areaIdToUiMapId'], rules),
      readDeferredTables(UIMAP_TO_AREA_FILE, read(UIMAP_TO_AREA_FILE), ['uiMapIdToAreaIdOverride', 'uiMapIdToAreaId'], rules),
      { Alliance: readDungeons(read(DUNGEONS_FILE), 'Alliance', rules), Horde: readDungeons(read(DUNGEONS_FILE), 'Horde', rules) },
      conversionFrames(conversion),
    ),
  );
  const xp = time('quest xp', () => readQuestXp(read(QUEST_XP_FILE), rules));
  const checks = upstreamChecks(source, conversion);
  if (!checks.ok) throw new Error(`upstream manifest check failed: ${JSON.stringify(checks.check)}`);
  const dataset = time('dataset', () => buildDataset({ forever, era, zones, xp, coefficients: readCoefficients(conversion) }));
  const builds = sourceGameBuilds(source, conversion, forever);
  const sliced = time('slice', () => sliceDataset(dataset, FIXTURE_REGION, dataset.detail.flagValues));
  const marker = generatedMarker(pin.repositoryName, pin.commit);
  const authorship = readAuthorship(read('generate.lua').toString('utf8'));
  // Every layer, in the order it is applied (per datatype), then the derived pass and the hints.
  const layers = [
    ...[...forever.plan.staticSteps.values()].flat().map(describeStep),
    'derived:requiredRaces:questieCompatibility',
    ...HINT_SETS.map((name) => `hints:${name}=[${(forever.corrections.hints.get(name) ?? []).join(',')}]`),
  ];
  const dynamicProviders = [...forever.plan.dynamicSteps.values()].flat().map(describeStep);
  const dynamicLayers = [
    ...FACTIONS.map((faction) => ({ key: `faction:${faction}`, file: 'overlays.json', providers: dynamicProviders, dungeons: `${DUNGEONS_FILE} (UnitFactionGroup)` })),
    { key: 'class', file: 'overlays.json', providers: dynamicProviders, classes: [...CLASS_TOKENS], appliedAfter: 'faction' },
  ];
  const inputs = source.inputs.map((input) => ({ path: input.path, sha256: input.sha256, gitBlob: input.gitBlob, bytes: input.bytes.length, role: input.role }));
  const upstream = { repository: pin.repository, branchObserved: pin.branchObserved, commit: pin.commit, commitDate: source.commitDate };

  const directory = (ds: Dataset, slice: { readonly region: unknown; readonly description: string } | null): RenderedDirectory => {
    const rendered = renderDataset(ds, marker);
    const notice = renderNotice({
      repository: pin.repository,
      commit: pin.commit,
      commitDate: source.commitDate,
      authorship,
      dbcTarget: builds.dbcTarget,
      conversionSource: builds.conversionSource,
      slice: slice === null ? null : slice.description,
      licenceCheck: pin.licenceCheck,
    });
    const outputs: OutputEntry[] = [
      ...rendered.map((file) => outputEntry(file.path, file.content, file.records, ORIGINS[file.path] ?? [])),
      outputEntry('NOTICE.md', notice, null, ORIGINS['NOTICE.md'] ?? []),
    ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const shipped = { quests: ds.quests.length, npcs: ds.npcs.length, objects: ds.objects.length, items: ds.items.length };
    const count = (predicate: (row: { readonly provenance: { readonly created: boolean; readonly corrected: boolean } }) => boolean, rows: readonly { readonly provenance: { readonly created: boolean; readonly corrected: boolean } }[]): number => rows.filter(predicate).length;
    const tally = <T extends { readonly provenance: { readonly upstreamDiff: string } }>(rows: readonly T[]): Record<string, number> => {
      const out: Record<string, number> = { era: 0, 'era-coords': 0, 'forever-new': 0, 'forever-changed': 0 };
      for (const row of rows) out[row.provenance.upstreamDiff] = (out[row.provenance.upstreamDiff] ?? 0) + 1;
      return out;
    };
    let spawnPoints = 0;
    let presencePoints = 0;
    for (const map of [...ds.spawns.npc.values(), ...ds.spawns.object.values()]) {
      for (const rows of Object.values(map)) {
        for (const row of rows) {
          if (row[0] === -1 && row[1] === -1) presencePoints += 1;
          else spawnPoints += 1;
        }
      }
    }
    // Counts of the whole extraction that a slice cannot state for itself are null in the slice
    // manifest (review finding data-F16); raw and composed describe the upstream composition the
    // slice was cut from, and golden-check it.
    const whole = <T>(value: T): T | null => (slice === null ? value : null);
    const counts = {
      raw: rawCounts,
      composed: composedCounts,
      shipped,
      spawnEntities: { npc: ds.spawns.npc.size, object: ds.spawns.object.size },
      spawnPoints: { drawable: spawnPoints, instancePresence: presencePoints },
      createdByCorrection: whole({ quests: forever.created.quest.size, npcs: forever.created.npc.size, objects: forever.created.object.size, items: forever.created.item.size }),
      npcSelection: whole(dataset.detail.selection.npcCounts),
      questsWithNullLevel: ds.quests.filter((q) => q.level === null).length,
      questsWithNullXp: ds.quests.filter((q) => q.xp === null).length,
      dungeonQuests: ds.quests.filter((q) => q.dungeonQuest).length,
      dungeonQuestAreas: whole(dataset.detail.dungeonQuestAreas.length),
      itemStartFixesOnly: ds.items.filter((item) => dataset.detail.itemStartFixesOnly.includes(item.id)).length,
      derivedRequiredRaces: whole(forever.derivedRaces.size),
      uiMaps: { named: [...ds.zones.uiMaps.values()].filter((u) => u.name !== null).length, unnamed: [...ds.zones.uiMaps.values()].filter((u) => u.name === null).length },
      areas: ds.zones.areas.size,
      unresolvedReferences: whole(dataset.detail.selection.unresolved.length),
    };
    const provenance = {
      comparisonBasis:
        'each composed static row (raw + static corrections + requiredRaces), and each faction x class persona row of it, compared with the fork base (Era) composed the same way; the worst tag wins',
      taggedByPersonaLayers: {
        quests: ds.quests.filter((r) => dataset.detail.upstreamDiffFromDynamic.quest.has(r.id)).length,
        npcs: ds.npcs.filter((r) => dataset.detail.upstreamDiffFromDynamic.npc.has(r.id)).length,
        objects: ds.objects.filter((r) => dataset.detail.upstreamDiffFromDynamic.object.has(r.id)).length,
        items: ds.items.filter((r) => dataset.detail.upstreamDiffFromDynamic.item.has(r.id)).length,
      },
      upstreamDiff: { quests: tally(ds.quests), npcs: tally(ds.npcs), objects: tally(ds.objects), items: tally(ds.items) },
      corrected: { quests: count((r) => r.provenance.corrected, ds.quests), npcs: count((r) => r.provenance.corrected, ds.npcs), objects: count((r) => r.provenance.corrected, ds.objects), items: count((r) => r.provenance.corrected, ds.items) },
      created: { quests: count((r) => r.provenance.created, ds.quests), npcs: count((r) => r.provenance.created, ds.npcs), objects: count((r) => r.provenance.created, ds.objects), items: count((r) => r.provenance.created, ds.items) },
      forkBase: {
        flavour: era.flavour.name,
        data: ['quest', 'npc', 'object', 'item'].map((kind) => `data/${era.flavour.expansion}/${era.flavour.dataPrefix}${{ quest: 'QuestDB', npc: 'NpcDB', object: 'ObjectDB', item: 'ItemDB' }[kind] ?? ''}.lua`),
        layers: [...era.plan.staticSteps.values()].flat().map(describeStep),
      },
      // The shipped items whose startsQuest was last written by itemStartFixes (declared Wowhead-generated; OD-7).
      itemStartFixesOnly: ds.items.filter((item) => dataset.detail.itemStartFixesOnly.includes(item.id)).map((item) => item.id),
      threeWayClassifier: 'stub',
    };
    const manifest = buildManifest({
      generated: marker,
      slice: slice === null ? null : slice.region,
      upstream,
      flavour: pin.flavour,
      sourceGameBuilds: builds,
      licenceCheck: pin.licenceCheck,
      toolTreeHash: tool.toolTreeHash,
      runtime: tool.runtime,
      inputs,
      upstreamManifestCheck: checks.check,
      layers,
      dynamicLayers,
      outputs,
      counts,
      provenance,
    });
    const files = new Map<string, string>(rendered.map((file) => [file.path, file.content]));
    files.set('NOTICE.md', notice);
    files.set('manifest.json', pretty(manifest));
    return { files, manifest };
  };

  const full = time('render', () => directory(dataset, null));
  const slice = time('render slice', () =>
    directory(sliced.dataset, {
      region: { uiMapId: FIXTURE_REGION.uiMapId, label: FIXTURE_REGION.label, areaIds: sliced.regionAreas, rule: 'quests whose starters or finishers spawn in the region, and their closure (tools/questiedb/lib/slice.ts)' },
      description: sliced.description,
    }),
  );
  timings.total = Math.round(performance.now() - started);
  const report = {
    dataRevision: full.manifest.dataRevision,
    sliceDataRevision: slice.manifest.dataRevision,
    extractedAt: new Date().toISOString(),
    node: process.version,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    toolTreeMethod: tool.treeMethod,
    platform: `${process.platform} ${process.arch}`,
    timingsMs: { ...timings, compose: forever.timingsMs, composeForkBase: era.timingsMs, dataset: dataset.detail.timingsMs },
    lints: [...forever.lints, ...era.lints],
    coverage: dataset.detail.coverage,
    providerWrites: forever.mergeStats.map((stats) => ({
      provider: stats.provider,
      kind: stats.kind,
      applied: stats.applied,
      created: stats.created,
      skippedAbsent: stats.skippedAbsent,
      fieldWrites: Object.fromEntries([...stats.fieldWrites].sort((a, b) => a[0] - b[0])),
      ignoredKeys: stats.ignoredKeys,
    })),
    derivedRequiredRaces: [...forever.derivedRaces.keys()],
    dungeonQuestAreas: dataset.detail.dungeonQuestAreas,
    itemStartFixesOnly: dataset.detail.itemStartFixesOnly,
    zoneNames: zones.report,
    npcSelection: dataset.detail.selection.npcCounts,
    unresolvedReferences: dataset.detail.selection.unresolved,
    overlays: { dynamicEntries: dataset.detail.overlayEntries, droppedForUnshippedEntities: dataset.detail.droppedOverlayIds },
    provenance: {
      upstreamDiffAllComposed: dataset.detail.upstreamDiff,
      taggedByPersonaLayersAllComposed: {
        quest: [...dataset.detail.upstreamDiffFromDynamic.quest],
        npc: [...dataset.detail.upstreamDiffFromDynamic.npc],
        object: [...dataset.detail.upstreamDiffFromDynamic.object],
        item: [...dataset.detail.upstreamDiffFromDynamic.item],
      },
      convertedPairsStatic: dataset.detail.convertedPairs,
      correctedAllComposed: dataset.detail.corrected,
      createdShipped: dataset.detail.createdShipped,
    },
    slice: { region: FIXTURE_REGION, areaIds: sliced.regionAreas },
    warnings: [
      ...zones.report.reverseLinkMismatches.map((m) => `zones: reverse link ${m}`),
      ...dataset.detail.selection.unresolved.map((u) => `unresolved ${u.kind} ${String(u.id)} (${u.referencedBy})`),
    ],
  };
  return { full, slice, dataset, report };
}
