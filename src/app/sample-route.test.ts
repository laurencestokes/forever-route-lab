import { describe, expect, it } from 'vitest';
import { jsonOf, publicSite } from '../../tests/support/fake-fetch';
import { fixtureView, SITE } from '../../tests/support/fixture-dataset';
import { raceAllowed, classAllowed, npcId, questId, sequentialIdSource, uiMapId, zoneSourcedPoint } from '../domain';
import { parseProject, serializeProject } from '../project';
import {
  createSampleProject,
  DUROTAR_START_SAMPLE,
  HOLIDAY_QUEST_SORTS,
  HOLIDAY_QUEST_SORTS_SOURCE,
  SAMPLE_ORIGIN_REF,
  SAMPLE_ROUTE_NAME,
  SAMPLE_ROUTE_NOTICE,
  sampleExclusion,
  sampleQuests,
} from './sample-route';
import { effectiveQuestLevel, stepQuestIds } from './shell-support';

const NOW = '2026-09-25T12:00:00.000Z';
const dataset = fixtureView();
const ORC_WARRIOR = { race: 'Orc', class: 'WARRIOR', startLevel: 1 } as const;
const DUROTAR = uiMapId(1411);

describe('sampleQuests over the fixture slice (Durotar)', () => {
  const quests = sampleQuests(dataset, ORC_WARRIOR);

  it('takes only quests whose starter spawns in Durotar, with a known required level of at most 5, open to an Orc Warrior', () => {
    expect(quests.length).toBeGreaterThan(10);
    for (const { quest, accept } of quests) {
      expect(quest.minLevel).not.toBeNull();
      expect(quest.minLevel).toBeLessThanOrEqual(DUROTAR_START_SAMPLE.maxRequiredLevel);
      expect(raceAllowed(quest.races, 'Orc') && classAllowed(quest.classes, 'WARRIOR')).toBe(true);
      expect(quest.starters).toContainEqual(accept.via);
      expect(accept.location?.source.space === 'zone' ? accept.location.source.uiMapId : null).toBe(DUROTAR);
    }
    const ids = quests.map((q) => q.quest.id);
    // Cutting Teeth (Gornek, Valley of Trials) is in; The New Horde starts in Orgrimmar; Simple Tablet is for Trolls.
    expect(ids).toContain(questId(788));
    expect(ids).not.toContain(questId(787));
    expect(ids).not.toContain(questId(3065));
    // Vanquish the Betrayers needs level 3 and starts in Razor Hill, also on the Durotar map.
    expect(ids).toContain(questId(784));
  });

  it('leaves out holiday and event quests and repeatable quests (COORD-8, code-F9)', () => {
    const ids = quests.map((q) => q.quest.id);
    // Winter's Presents and New Year Celebrations! (Seasonal, -22), Runetotem the Elder (Lunar Festival, -366).
    for (const id of [8828, 8861, 8670]) {
      expect(dataset.quest(questId(id))).toBeDefined();
      expect(ids).not.toContain(questId(id));
    }
    for (const { quest } of quests) {
      expect(quest.flags.repeatable).toBe(false);
      expect(quest.zoneOrSort === null || !HOLIDAY_QUEST_SORTS.has(quest.zoneOrSort)).toBe(true);
    }
    // Class quests (negative, but not holiday sorts) stay: Simple Parchment is the Warrior's (-81).
    expect(ids).toContain(questId(2383));
  });

  it('orders by quest level, then id', () => {
    const keys = quests.map((q) => [effectiveQuestLevel(1, q.quest.level, q.quest.minLevel) ?? Number.POSITIVE_INFINITY, q.quest.id] as const);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(keys).toEqual(sorted);
  });

  it('places the steps at the published spawns of the starter and finisher', () => {
    const cutting = quests.find((q) => q.quest.id === questId(788));
    expect(cutting?.accept).toEqual({
      via: { kind: 'npc', id: npcId(3143) },
      location: { source: zoneSourcedPoint(DUROTAR, 42.06, 68.33, 'forever'), label: 'Gornek', radius: null },
    });
    expect(cutting?.turnIn?.via).toEqual({ kind: 'npc', id: npcId(3143) });
  });

  it('gives an Alliance character none of these Horde quests', () => {
    const human = sampleQuests(dataset, { race: 'Human', class: 'WARRIOR', startLevel: 1 });
    for (const { quest } of human) expect(raceAllowed(quest.races, 'Human')).toBe(true);
    expect(human.map((q) => q.quest.id)).not.toContain(questId(788));
  });
});

describe('sampleExclusion and its QuestSort list', () => {
  it('names why a quest is left out: a holiday sort, then repeatable', () => {
    const quest = (zoneOrSort: number | null, repeatable: boolean) => ({ zoneOrSort, flags: { repeatable, needsEvent: false, questFlags: 0, specialFlags: 0 } });
    expect(sampleExclusion(quest(-22, false))).toBe('holiday');
    expect(sampleExclusion(quest(-366, true))).toBe('holiday');
    expect(sampleExclusion(quest(14, true))).toBe('repeatable');
    expect(sampleExclusion(quest(-81, false))).toBeNull();
    expect(sampleExclusion(quest(null, false))).toBeNull();
  });

  it('lists the thirteen sorts of the "Holidays and recurring events" section, from the input both manifests pin', () => {
    expect([...HOLIDAY_QUEST_SORTS].sort((a, b) => a - b)).toEqual([-404, -402, -378, -376, -375, -374, -370, -369, -366, -364, -41, -22, -21]);
    for (const site of [SITE, publicSite()]) {
      const manifest = jsonOf(site, 'data/manifest.json') as { upstream: { commit: string }; inputs: { path: string; sha256: string }[] };
      // A pin bump that changes the enum file fails here, so the list is reviewed with it.
      expect(manifest.upstream.commit).toBe(HOLIDAY_QUEST_SORTS_SOURCE.commit);
      expect(manifest.inputs.find((i) => i.path === HOLIDAY_QUEST_SORTS_SOURCE.path)?.sha256).toBe(HOLIDAY_QUEST_SORTS_SOURCE.sha256);
    }
  });
});

describe('createSampleProject', () => {
  const project = createSampleProject({ dataset, nowIso: NOW });
  const steps = project.route.steps;

  it('is a level-1 Horde Orc Warrior on the loaded dataset revision, labelled as a sample', () => {
    expect(project.character).toMatchObject({ faction: 'Horde', race: 'Orc', class: 'WARRIOR', startLevel: 1, startLocation: null });
    expect(project.dataRevision).toBe(dataset.identity.dataRevision);
    expect(project.gameBuild).toBe('1.60.1.69893');
    expect(project.route.name).toBe(SAMPLE_ROUTE_NAME);
    expect(project.route.description.startsWith(SAMPLE_ROUTE_NOTICE)).toBe(true);
    const [note] = steps;
    expect(note?.kind === 'note' ? note.text : '').toMatch(/^Sample route \(auto-generated, not a recommended route\): \d+ quests whose starter spawns in Durotar/);
    expect(note?.kind === 'note' ? note.text : '').toContain("Repeatable quests and quests of QuestieDB's holiday and event categories are left out.");
    expect(SAMPLE_ROUTE_NAME).toBe('Sample: Durotar start (auto-generated)');
  });

  it('has an accept and then a turn-in step for each sample quest, in route order', () => {
    const quests = sampleQuests(dataset, ORC_WARRIOR);
    expect(steps).toHaveLength(1 + 2 * quests.length);
    quests.forEach(({ quest }, i) => {
      const accept = steps[1 + 2 * i];
      const turnIn = steps[2 + 2 * i];
      expect(accept?.kind === 'accept' ? accept.questId : null).toBe(quest.id);
      expect(turnIn?.kind === 'turnin' ? turnIn.questId : null).toBe(quest.id);
    });
    for (const step of steps) expect(step.origin).toEqual({ source: 'manual', ref: SAMPLE_ORIGIN_REF });
    for (const id of steps.flatMap(stepQuestIds)) expect(dataset.quest(id)).toBeDefined();
  });

  it('is deterministic and passes the project schema', () => {
    const again = createSampleProject({ dataset, nowIso: NOW, ids: sequentialIdSource() });
    expect(serializeProject(again)).toBe(serializeProject(project));
    const parsed = parseProject(JSON.parse(serializeProject(project)) as unknown);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
  });
});
