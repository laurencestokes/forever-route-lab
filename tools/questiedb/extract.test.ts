import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitDate } from './lib/git';
import { type Extraction, runExtraction } from './lib/pipeline';
import { assertExpectedPlan, derivePlan, describeStep } from './lib/plan';
import { compareDirectory } from './lib/output-dir';
import type { EntitiesFile, OverlaysFile, QuestsFile, SpawnsFile, ZonesFile } from './lib/shapes';
import { toolIdentity } from './lib/tool-identity';
import { cacheDir, FIXTURE_DATA_DIR, loadUpstream, openPinnedSource, PUBLIC_DATA_DIR } from './lib/upstream';
import { validateDirectory } from './lib/validate-lib';

/**
 * End-to-end extraction on the real pinned QuestieDB inputs: the only test that proves public/data
 * equals a fresh extraction. Without the clone (run `pnpm data:fetch`) it is skipped, loudly; with
 * the environment variable CI set, a missing clone fails instead (DATA_PROVENANCE §5; review
 * findings data-F3, code-F1).
 */

const pin = loadUpstream();
const HAS_CLONE = existsSync(cacheDir(pin));
const IN_CI = (process.env.CI ?? '') !== '' && process.env.CI !== 'false' && process.env.CI !== '0';
const SKIPPED = `tools/questiedb/extract.test.ts: the end-to-end extraction was SKIPPED: no QuestieDB clone at ${pin.cachePath} (run pnpm data:fetch). public/data was not compared with a fresh extraction in this run.`;

describe('the QuestieDB clone for the end-to-end extraction', () => {
  it('is present in CI; elsewhere its absence is reported loudly', () => {
    if (!HAS_CLONE) console.warn(`\n*** ${SKIPPED} ***\n`);
    expect(HAS_CLONE || !IN_CI, `${SKIPPED} CI must run pnpm data:fetch first.`).toBe(true);
  });
});

describe.skipIf(!HAS_CLONE)('extraction from the pinned QuestieDB commit', () => {
  let first: Extraction;
  let second: Extraction;
  let temp: string;

  beforeAll(() => {
    const source = openPinnedSource(pin, cacheDir(pin), commitDate);
    const tool = toolIdentity();
    first = runExtraction(pin, source, tool);
    second = runExtraction(pin, source, tool);
    temp = mkdtempSync(join(tmpdir(), 'questiedb-extract-'));
  }, 120_000);

  afterAll(() => {
    if (temp !== undefined) rmSync(temp, { recursive: true, force: true });
  });

  it('is byte-deterministic: two runs give identical files', () => {
    expect([...first.full.files.keys()]).toEqual([...second.full.files.keys()]);
    for (const [path, content] of first.full.files) expect(second.full.files.get(path), path).toBe(content);
    for (const [path, content] of first.slice.files) expect(second.slice.files.get(path), path).toBe(content);
  });

  it('reproduces the committed public/data and fixture slice byte for byte, with no other file (DATA_PROVENANCE §8.3)', () => {
    for (const [dir, rendered] of [[PUBLIC_DATA_DIR, first.full], [FIXTURE_DATA_DIR, first.slice]] as const) {
      expect(compareDirectory(dir, rendered.files, dir), `${dir} equals a fresh extraction (run pnpm data:extract)`).toEqual([]);
      for (const [path, content] of rendered.files) expect(readFileSync(join(dir, path), 'utf8') === content, path).toBe(true);
    }
  });

  it('matches the golden composed counts and QuestieDB’s recorded composed differences from Era', () => {
    const counts = first.full.manifest.counts as { readonly composed: unknown; readonly raw: unknown };
    expect(counts.composed).toEqual(pin.golden.composed);
    expect(counts.raw).toEqual(pin.golden.raw);
    // QuestieDB docs/forever-validation.md: composed hashes differ for 12 quests, 741 NPCs, 607 objects, 0 items.
    const detail = first.dataset.detail.upstreamDiff;
    expect([detail.quest['era-coords'], detail.npc['era-coords'], detail.object['era-coords'], detail.item['era-coords']]).toEqual([12, 741, 607, 0]);
    expect([detail.quest['forever-changed'], detail.npc['forever-changed'], detail.object['forever-changed'], detail.item['forever-changed']]).toEqual([0, 0, 0, 0]);
  });

  it('passes validate, written to disk, for both the full dataset and the slice', () => {
    const tool = toolIdentity().toolTreeHash;
    for (const [name, rendered, slice] of [['full', first.full, false], ['slice', first.slice, true]] as const) {
      const dir = join(temp, name);
      mkdirSync(dir, { recursive: true });
      for (const [path, content] of rendered.files) writeFileSync(join(dir, path), content, 'utf8');
      const result = validateDirectory({ dir, pin, slice, toolTreeHash: tool });
      expect(result.findings, name).toEqual([]);
    }
  });

  it('keeps the worked examples: Gornek as published, quest 7 corrected, 7162 derived, 503 hinted', () => {
    const spawns = JSON.parse(first.full.files.get('spawns.json') ?? '{}') as SpawnsFile;
    expect(spawns.npc['3143']).toEqual({ 14: [[42.06, 68.33]] });
    const quests = JSON.parse(first.full.files.get('quests.json') ?? '{}') as QuestsFile;
    const byId = new Map(quests.rows.map((row) => [row.id, row]));
    const q7 = byId.get(7);
    expect(q7?.prerequisites.nextQuestInChain).toBe(15);
    expect(q7?.reputationReward).toEqual([{ factionId: 72, value: 100 }]);
    expect(q7?.provenance).toEqual({ upstreamDiff: 'era', foreverStatus: 'unknown', corrected: true, created: false, source: 'questiedb' });
    expect(byId.get(7162)?.races).toBe(77); // set by the requiredRaces pass from its Alliance starter
    const q503 = byId.get(503);
    expect(q503?.objectives[0]?.kind).toBe('item');
    const entities = JSON.parse(first.full.files.get('entities.json') ?? '{}') as EntitiesFile;
    expect(entities.npcs.find((npc) => npc.id === 3143)?.friendlyTo).toBe('H');
  });

  it('keeps dynamic corrections as overlays: faction layers and per-faction class layers', () => {
    const overlays = JSON.parse(first.full.files.get('overlays.json') ?? '{}') as OverlaysFile;
    // The Horde layer writes 0 ("no next quest"), which ships as null over the static 1200.
    expect(overlays.faction.Horde.quests['1198']?.prerequisites?.nextQuestInChain).toBeNull();
    expect(overlays.class.Alliance.PALADIN?.quests['8977']?.prerequisites?.nextQuestInChain).toBe(8933);
    expect(overlays.class.Horde.SHAMAN?.quests['8978']?.prerequisites?.nextQuestInChain).toBe(8942);
    expect(overlays.faction.Alliance.dungeons['2597']?.entrances).toEqual([{ areaId: 36, x: 63.6, y: 58.8, frameVerified: true }]);
  });

  it('ships no single id as 0 (DATA_PROVENANCE §6: 0 → null)', () => {
    const quests = JSON.parse(first.full.files.get('quests.json') ?? '{}') as QuestsFile;
    const entities = JSON.parse(first.full.files.get('entities.json') ?? '{}') as EntitiesFile;
    const zeros = [
      ...quests.rows.flatMap((q) => [q.zoneOrSort, q.prerequisites.nextQuestInChain, q.prerequisites.parentQuest, q.requirements.sourceItemId, q.requirements.spell]),
      ...entities.npcs.map((n) => n.zoneId),
      ...entities.objects.flatMap((o) => [o.zoneId, o.factionId]),
    ].filter((value) => value === 0);
    expect(zeros).toEqual([]);
    expect(entities.npcs.find((n) => n.id === 5676)?.zoneId).toBeNull();
  });

  it('classifies AreaID links as direct frames or routed subzones, and marks the unverified entrances (COORD-3, COORD-4)', () => {
    const zones = JSON.parse(first.full.files.get('zones.json') ?? '{}') as ZonesFile;
    const byLink = new Map<string, number>();
    for (const row of Object.values(zones.areas)) byLink.set(row.link, (byLink.get(row.link) ?? 0) + 1);
    expect(Object.fromEntries(byLink)).toEqual({ direct: 54, routed: 1010, 'legacy-compat': 40, suppressed: 4, 'synthetic-alias': 3 });
    expect(zones.areas['14']).toEqual({ uiMapId: 1411, link: 'direct' });
    expect(zones.areas['363']).toEqual({ uiMapId: 1411, link: 'routed' });
    const unverified = Object.entries(zones.dungeons).flatMap(([key, row]) => row.entrances.filter((e) => !e.frameVerified).map((e) => [Number(key), e.areaId, e.x, e.y]));
    expect(unverified).toEqual([
      [5861, 215, 36.85, 35.86],
      [6618, 1519, 69.49, 31.2],
      [10001, 139, 43.5, 19.4],
    ]);
  });

  it('publishes the itemStartFixes-only item ids and no Node version in the manifest (data-F10, data-F5)', () => {
    const manifest = first.full.manifest as { readonly provenance: { readonly itemStartFixesOnly: readonly number[] }; readonly counts: { readonly itemStartFixesOnly: number }; readonly runtime: unknown };
    expect(manifest.provenance.itemStartFixesOnly).toHaveLength(manifest.counts.itemStartFixesOnly);
    expect(manifest.runtime).toEqual({ luaparse: '0.3.1' });
    expect(first.report.nodeMajor).toBe(Number(process.versions.node.split('.')[0]));
  });

  it('derives the reviewed correction plans from upstream config, and would notice a change', () => {
    const source = openPinnedSource(pin, cacheDir(pin), commitDate);
    const plan = derivePlan((path) => source.read(path), 'Forever');
    expect(() => {
      assertExpectedPlan(plan);
    }).not.toThrow();
    expect((plan.staticSteps.get('Item') ?? []).map((step) => step.loadOrder)).toEqual([2, 11, 1411]);
    expect((plan.dynamicSteps.get('Quest') ?? []).map(describeStep)).toEqual(['legacy/classicQuestFixes.lua:LoadFactionFixes', 'foreverQuestFixes.lua:LoadDynamic']);
    const reordered = { ...plan, staticSteps: new Map([...plan.staticSteps].map(([datatype, steps]) => [datatype, [...steps].reverse()])) };
    expect(() => {
      assertExpectedPlan(reordered);
    }).toThrow(/reviewed for/);
    expect(() => {
      assertExpectedPlan(derivePlan((path) => source.read(path), 'Vanilla'));
    }).not.toThrow();
  });

  it('keeps the fixture slice small', () => {
    const total = [...first.slice.files.values()].reduce((sum, content) => sum + Buffer.byteLength(content, 'utf8'), 0);
    expect(total).toBeLessThan(300_000);
  });
});
