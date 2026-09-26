/**
 * The pure end-to-end test (docs/ARCHITECTURE.md §15): a self-authored RXP fixture
 * (tests/fixtures/rxp) is imported and lowered against the fixture slice (tests/fixtures/data,
 * Durotar) and the committed placeholder geometry, then walked, simulated and validated
 * (`validateRoute`), and exported again. The issues are snapshotted below, one line per issue:
 * `#step code quest | message | data`. Validation never changes the route, so the export stays
 * byte-identical to the fixture.
 *
 * Notes on the snapshots: the slice has no flight master in Durotar, so `.fp Orgrimmar` and
 * `.fly Crossroads` resolve no node (SIM-8) and the nearest node is a cited Forever one (SIM-7).
 * Fixture 06's points in other zones move between world maps without a transport (SIM-4).
 *
 * Also here: the availability rules on real records of the committed dataset (SIMULATION §9: one
 * case per VAL rule the data can express, and the Skyborne masks 77, 178 and 1), each run on the
 * dataset view of the character's faction and class, and the check that the RXP registry (src/rxp)
 * follows the same code grammar as src/validate/codes.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flightMasterIdsOf } from '../src/app/dataset-source';
import type { DatasetView } from '../src/domain/dataset';
import { questId, sequentialIdSource } from '../src/domain/ids';
import type { ValidationIssue } from '../src/domain/issues';
import type { CharacterProfile, ProjectV1 } from '../src/domain/project';
import type { RouteStep } from '../src/domain/route';
import { makeAcceptStep, makeTurnInStep } from '../src/domain/step-factory';
import { createEmptyProject } from '../src/domain/project-factory';
import type { EngineContext } from '../src/engine';
import { effectiveRules, rulesetById } from '../src/rules';
import { createStraightLineTravelModel } from '../src/rules/straight-line';
import { seedTravelGraph } from '../src/rules/travel-graph';
import { exportRxp, importRxp, type ImportedGuide, RXP_CODES, type RxpLowerContext, zoneKeyLookup } from '../src/rxp';
import { ISSUE_CODE_PATTERN, ISSUE_CODES, issueCodeSpec, isRegisteredCode, parseIssueCode, validateRoute } from '../src/validate';
import { createDatasetView, identityOf, prepareDataset } from '../src/infra/data';
import { publicSite, REPO_ROOT } from './support/fake-fetch';
import { fixturePrepared, fixtureView, placeholderGeometry, siteFiles, siteManifest } from './support/fixture-dataset';

const GEOMETRY = placeholderGeometry();
const VIEW: DatasetView = fixtureView();

const LOWER: RxpLowerContext = {
  zoneKey: zoneKeyLookup(VIEW.zones()),
  quest: (id) => {
    const quest = VIEW.quest(id);
    return quest === undefined ? null : { objectiveCount: quest.objectives.length, custom: quest.provenance.source === 'custom' };
  },
  geometry: GEOMETRY,
};

const bytesOf = (name: string): Buffer => readFileSync(join(REPO_ROOT, 'tests/fixtures/rxp', name));

function importGuide(bytes: Buffer): ImportedGuide {
  const result = importRxp(bytes.toString('utf8'), sequentialIdSource(), LOWER);
  if (result.status !== 'ok') throw new Error('refused');
  const [guide] = result.guides;
  if (guide === undefined) throw new Error('no guide');
  return guide;
}

function projectOf(guide: ImportedGuide, character: Partial<CharacterProfile>): ProjectV1 {
  const empty = createEmptyProject({ ids: sequentialIdSource(9000), nowIso: '2026-09-26T00:00:00.000Z', name: guide.import.name, character });
  return { ...empty, route: { ...empty.route, steps: guide.steps, groups: guide.groups }, imports: [guide.import] };
}

/** The engine context the app builds for a project: its effective rules, the seeded TravelGraph, straight-line legs. */
function contextOf(project: ProjectV1): EngineContext {
  const rules = effectiveRules(rulesetById(project.rulesetId), project.assumptions);
  const graph = seedTravelGraph(
    { npc: (id) => VIEW.npc(id), spawns: (ref) => VIEW.spawns(ref), zone: (id) => VIEW.zone(id), flightMasterIds: flightMasterIdsOf(fixturePrepared()), dungeons: [] },
    rules,
  );
  return { dataset: VIEW, geometry: GEOMETRY, rules, travel: createStraightLineTravelModel(rules.values.groundDetourFactor.value), graph };
}

/** One line per issue: `#step` (1-based) or `route`, code, quest, message and data. */
function lines(project: ProjectV1, issues: readonly ValidationIssue[]): string[] {
  const index = new Map(project.route.steps.map((step, i) => [step.id, i + 1]));
  return issues.map((issue) => {
    const at = issue.stepId === null ? 'route' : `#${String(index.get(issue.stepId))}`;
    const quest = issue.questId === null ? '' : ` q${String(issue.questId)}`;
    const data = issue.data === null ? '' : ` | ${JSON.stringify(issue.data)}`;
    return `${at} ${issue.code}${quest} | ${issue.message}${data}`;
  });
}

/** ARCHITECTURE §9.4: the fixed shape with explicit nulls, a registered code, its severity and data keys. */
function expectWellFormed(issues: readonly ValidationIssue[]): void {
  for (const issue of issues) {
    expect(Object.keys(issue)).toEqual(['code', 'severity', 'stepId', 'questId', 'message', 'data']);
    if (!isRegisteredCode(issue.code)) throw new Error(`unregistered ${issue.code}`);
    const spec = issueCodeSpec(issue.code);
    expect(issue.severity).toBe(spec.severity);
    expect(issue.data === null ? [] : Object.keys(issue.data), issue.code).toEqual(spec.params);
  }
}

interface Case {
  readonly name: string;
  readonly fixture: string;
  readonly character: Partial<CharacterProfile>;
  readonly expected: readonly string[];
}

const CASES: readonly Case[] = [
  // A clean route: the fixture is written for this character.
  { name: 'fixture 01, a fresh Orc warrior', fixture: '01-basic-durotar.txt', character: { race: 'Orc', class: 'WARRIOR' }, expected: [] },
  // The Horde mask 178 admits Windshaper Skyborne (§7.3); Vile Familiars' class mask 1247 excludes warlocks.
  {
    name: 'fixture 01, a Windshaper Skyborne warlock',
    fixture: '01-basic-durotar.txt',
    character: { race: 'WindshaperSkyborne', class: 'WARLOCK' },
    expected: [
      `#11 VAL007-class q792 | Vile Familiars (792) is not offered to the character's class (WARLOCK). | {"class":"WARLOCK","classes":1247}`,
    ],
  },
  // Mask 178 excludes High Order Skyborne; the breadcrumb's target is refused too (the vmangos warning).
  {
    name: 'fixture 01, a High Order Skyborne warrior',
    fixture: '01-basic-durotar.txt',
    character: { race: 'HighOrderSkyborne', class: 'WARRIOR', faction: 'Alliance' },
    expected: [
      `#2 VAL006-race q4641 | Your Place In The World (4641) is not offered to the character's race (HighOrderSkyborne). | {"race":"HighOrderSkyborne","races":178}`,
      `#2 VAL013-breadcrumb-target-unavailable q4641 | Your Place In The World (4641) leads to Cutting Teeth (788), which cannot be accepted yet (VAL006-race). Questie still offers the breadcrumb; the vmangos emulator does not. | {"targetQuestId":788,"reason":"VAL006-race"}`,
      `#5 VAL006-race q788 | Cutting Teeth (788) is not offered to the character's race (HighOrderSkyborne). | {"race":"HighOrderSkyborne","races":178}`,
      `#9 VAL006-race q789 | Sting of the Scorpid (789) is not offered to the character's race (HighOrderSkyborne). | {"race":"HighOrderSkyborne","races":178}`,
      `#10 VAL006-race q4402 | Galgar's Cactus Apple Surprise (4402) is not offered to the character's race (HighOrderSkyborne). | {"race":"HighOrderSkyborne","races":178}`,
      `#11 VAL006-race q792 | Vile Familiars (792) is not offered to the character's race (HighOrderSkyborne). | {"race":"HighOrderSkyborne","races":178}`,
      `#12 VAL006-race q790 | Sarkoth (790) is not offered to the character's race (HighOrderSkyborne). | {"race":"HighOrderSkyborne","races":178}`,
    ],
  },
  { name: 'fixture 01, a Tauren warrior', fixture: '01-basic-durotar.txt', character: { race: 'Tauren', class: 'WARRIOR' }, expected: [] },
  // A mid-level start with an unknown history: quests the route never accepted are assumed in the log (-unverifiable).
  {
    name: 'fixture 06, a level-13 Troll warrior with an unknown history',
    fixture: '06-lowering-and-export.txt',
    character: { race: 'Troll', class: 'WARRIOR', startLevel: 13, priorHistory: 'unknown' },
    expected: [
      `#1 LINT004-xp-reduced q788 | Cutting Teeth (788) is turned in 11 levels above its level 2: it gives 10% of its XP, 155 XP less. | {"level":13,"levelBasis":"source","levelEraFallback":false,"questLevel":2,"percent":10,"xp":15,"fullXp":170,"xpLost":155,"xpBasis":"assumption","eraFallback":true,"assumed":"questXpRounding,questXpMultiplier"}`,
      `#1 VAL030-not-in-log-unverifiable q788 | Cutting Teeth (788) is turned in but never accepted in the route; it is assumed to have been in the quest log before the route.`,
      `#1 VAL030-objectives-incidental q788 | Cutting Teeth (788) is turned in, but no step finishes objective 1; assumed completed along the way. | {"objectives":"0"}`,
      `#2 LINT003-low-value q789 | Sting of the Scorpid (789) is of low value at level 13: it is grey (quest level 3). | {"level":13,"levelBasis":"assumption","levelEraFallback":true,"questLevel":3,"difficulty":"trivial","xp":25,"xpBasis":"assumption","eraFallback":true,"assumed":"greenRange,difficultyYellowLowerBound"}`,
      `#3 SIM004-cross-world-no-transport | This step moves from world map 1 to world map 0 without a transport, hearth or instance entrance; the travel time is unknown. | {"fromMapId":1,"toMapId":0}`,
      `#5 SIM004-cross-world-no-transport | This step moves from world map 0 to world map 1 without a transport, hearth or instance entrance; the travel time is unknown. | {"fromMapId":0,"toMapId":1}`,
      // RXP031 at import; validation now says why the step's work has no time (review ENG-06).
      `#6 DATA003-unknown-objective q788 | Cutting Teeth (788) has no objective 2; its work in this step cannot be priced. | {"objective":1,"objectives":1}`,
      `#6 SIM016-complete-not-in-log q788 | Cutting Teeth (788) is not in the quest log while this step works on it.`,
      `#7 SIM016-complete-not-in-log-unverifiable q792 | Vile Familiars (792) is worked on but never accepted in the route; it is assumed to have been in the quest log before the route.`,
      `#9 DATA002-unknown-quest q900001 | Quest 900001 is not in the dataset or among the project's custom quests.`,
      `#9 SIM016-complete-not-in-log-unverifiable q900001 | Quest 900001 is worked on but never accepted in the route; it is assumed to have been in the quest log before the route.`,
      `#10 LINT003-low-value q790 | Sarkoth (790) is of low value at level 13: it is grey (quest level 5). | {"level":13,"levelBasis":"assumption","levelEraFallback":true,"questLevel":5,"difficulty":"trivial","xp":180,"xpBasis":"assumption","eraFallback":true,"assumed":"greenRange,difficultyYellowLowerBound"}`,
      `#11 LINT004-xp-reduced q789 | Sting of the Scorpid (789) is turned in 10 levels above its level 3: it gives 10% of its XP, 225 XP less. | {"level":13,"levelBasis":"assumption","levelEraFallback":true,"questLevel":3,"percent":10,"xp":25,"fullXp":250,"xpLost":225,"xpBasis":"assumption","eraFallback":true,"assumed":"questXpRounding,questXpMultiplier"}`,
      `#20 SIM008-flight-unresolved | The flight's destination cannot be resolved: no flight node matches. | {"end":"to","reason":"no-node"}`,
      `#21 SIM007-flight-unknown-path | Not a known flight path: the flight's departure node, Tainted Foothills, Mount Hyjal (taxi:3242). | {"end":"from","node":"taxi:3242"}`,
      `#21 SIM008-flight-unresolved | The flight's destination cannot be resolved: no flight node matches. | {"end":"to","reason":"no-node"}`,
      `#26 LINT004-xp-reduced q790 | Sarkoth (790) is turned in 8 levels above its level 5: it gives 40% of its XP, 270 XP less. | {"level":13,"levelBasis":"assumption","levelEraFallback":true,"questLevel":5,"percent":40,"xp":180,"fullXp":450,"xpLost":270,"xpBasis":"assumption","eraFallback":true,"assumed":"questXpRounding,questXpMultiplier"}`,
      `#26 VAL030-objectives-incidental q790 | Sarkoth (790) is turned in, but no step finishes objective 1; assumed completed along the way. | {"objectives":"0"}`,
    ],
  },
  // Skip conditions the walker cannot decide keep their steps (SIM-13); a listed history makes VAL-32 an error.
  {
    name: 'fixture 05, a level-11 Orc warrior with a listed history',
    fixture: '05-travel-and-conditions.txt',
    character: { race: 'Orc', class: 'WARRIOR', startLevel: 11, priorHistory: 'listed' },
    expected: [
      `#4 SIM013-condition-unknown | A condition of this step cannot be decided for this character; the step is kept.`,
      `#5 SIM008-flight-unresolved | The flight's destination cannot be resolved: no flight node matches. | {"end":"to","reason":"no-node"}`,
      `#5 SIM013-condition-unknown | A condition of this step cannot be decided for this character; the step is kept.`,
      `#6 SIM007-flight-unknown-path | Not a known flight path: the flight's departure node, Tainted Foothills, Mount Hyjal (taxi:3242). | {"end":"from","node":"taxi:3242"}`,
      `#6 SIM008-flight-unresolved | The flight's destination cannot be resolved: no flight node matches. | {"end":"to","reason":"no-node"}`,
      `#6 SIM013-condition-unknown | A condition of this step cannot be decided for this character; the step is kept.`,
      `#7 SIM013-condition-unknown | A condition of this step cannot be decided for this character; the step is kept.`,
      `#10 SIM016-complete-not-in-log q789 | Sting of the Scorpid (789) is not in the quest log while this step works on it.`,
      `#11 VAL032-not-in-log q790 | Sarkoth (790) is not in the quest log, so it cannot be abandoned.`,
    ],
  },
];

describe('validate end to end: RXP fixture → import → lower → walk → validate → export', () => {
  it.each(CASES)('$name', ({ fixture, character, expected }) => {
    const bytes = bytesOf(fixture);
    const guide = importGuide(bytes);
    const project = projectOf(guide, character);
    const { walk, issues } = validateRoute(project, contextOf(project), { baseDataset: VIEW });
    expect(walk.records).toHaveLength(project.route.steps.length);
    expectWellFormed(issues);
    expect(lines(project, issues)).toEqual(expected);
    // Deterministic: a second validation of the same project gives the same issues.
    expect(validateRoute(project, contextOf(project), { baseDataset: VIEW }).issues).toEqual(issues);
    const exported = exportRxp(project.route, project.imports, { zoneKey: LOWER.zoneKey, geometry: GEOMETRY });
    if (!exported.ok) throw new Error(exported.errors.map((e) => e.message).join('; '));
    expect(exported.unedited).toBe(true);
    expect(Buffer.from(exported.text, 'utf8').equals(bytes)).toBe(true);
  });
});

describe('real Forever records (the committed dataset, SIMULATION §9)', () => {
  const site = publicSite();
  const geometry = placeholderGeometry(site);
  const prepared = prepareDataset(siteFiles(site), identityOf(siteManifest(site)), geometry);
  const rules = effectiveRules(rulesetById('forever-beta'));
  const contexts = new Map<string, EngineContext>();

  /** The context the app builds for a character: the dataset view of its faction and class (review ENG-13). */
  function contextFor(character: Pick<CharacterProfile, 'faction' | 'class'>): EngineContext {
    const key = `${character.faction}/${character.class}`;
    let context = contexts.get(key);
    if (context === undefined) {
      const view = createDatasetView(prepared, { faction: character.faction, class: character.class, customQuests: [], questOverrides: {} });
      context = {
        dataset: view,
        geometry,
        rules,
        travel: createStraightLineTravelModel(rules.values.groundDetourFactor.value),
        graph: seedTravelGraph({ npc: (id) => view.npc(id), spawns: (ref) => view.spawns(ref), zone: (id) => view.zone(id), flightMasterIds: [], dungeons: [] }, rules),
      };
      contexts.set(key, context);
    }
    return context;
  }

  function run(steps: readonly RouteStep[], character: Partial<CharacterProfile>): string[] {
    const empty = createEmptyProject({ ids: sequentialIdSource(9000), nowIso: '2026-09-26T00:00:00.000Z', name: 'Real records', character: { faction: 'Alliance', class: 'WARRIOR', ...character } });
    const project: ProjectV1 = { ...empty, route: { ...empty.route, steps } };
    const index = new Map(steps.map((step, i) => [step.id, i + 1]));
    return validateRoute(project, contextFor(project.character)).issues.map((issue) => `#${String(issue.stepId === null ? 'route' : index.get(issue.stepId))} ${issue.code} q${String(issue.questId)}`);
  }

  it('the Sweet Amber chain 48 → 49 → 50 → 51 → 53: prerequisites and later chain steps (VAL-2, VAL-8, VAL-11)', () => {
    const ids = sequentialIdSource();
    const accept = (id: number): RouteStep => makeAcceptStep(ids, { questId: questId(id) });
    const turnIn = (id: number): RouteStep => makeTurnInStep(ids, { questId: questId(id) });
    const steps = [accept(49), accept(48), turnIn(49), accept(50), accept(53)];
    expect(run(steps, { race: 'Human', startLevel: 44, priorHistory: 'listed', priorCompletedQuests: [questId(48)] })).toEqual([
      '#2 VAL002-already-completed q48',
      '#2 VAL011-later-chain-step q48',
      '#3 VAL030-objectives-incidental q49',
      '#5 VAL008-prequest-single q53',
    ]);
    // With an unknown history the missing prerequisite of 49 may have been done before the route.
    expect(run([accept(49)], { race: 'Human', startLevel: 44, priorHistory: 'unknown' })).toEqual(['#1 VAL008-prequest-single-unverifiable q49']);
  });

  it('the Alliance mask 77 on real records: High Order Skyborne admitted, Windshaper Skyborne and Orc refused (§7.3)', () => {
    const ids = sequentialIdSource();
    const steps = [makeAcceptStep(ids, { questId: questId(48) })];
    expect(run(steps, { race: 'HighOrderSkyborne', startLevel: 44 })).toEqual([]);
    expect(run(steps, { race: 'Human', startLevel: 44 })).toEqual([]);
    expect(run(steps, { race: 'WindshaperSkyborne', faction: 'Horde', startLevel: 44 })).toEqual(['#1 VAL006-race q48']);
    expect(run(steps, { race: 'Orc', faction: 'Horde', startLevel: 44 })).toEqual(['#1 VAL006-race q48']);
  });

  it('mask 1 (Human only) and a class mask on The Tome of Divinity (1641, classes 2): Skyborne of either faction refused (§7.3)', () => {
    const steps = [makeAcceptStep(sequentialIdSource(), { questId: questId(1641) })];
    const paladin = { race: 'Human', class: 'PALADIN', startLevel: 12 } as const;
    expect(run(steps, paladin)).toEqual([]);
    expect(run(steps, { ...paladin, race: 'HighOrderSkyborne' })).toEqual(['#1 VAL006-race q1641']);
    expect(run(steps, { ...paladin, race: 'WindshaperSkyborne', faction: 'Horde' })).toEqual(['#1 VAL006-race q1641']);
    expect(run(steps, { ...paladin, class: 'WARRIOR' })).toEqual(['#1 VAL007-class q1641']);
  });

  const accept = (ids: ReturnType<typeof sequentialIdSource>, id: number): RouteStep => makeAcceptStep(ids, { questId: questId(id) });
  const human = { race: 'Human', priorHistory: 'listed' } as const;
  /**
   * One case per VAL rule on real records (a listed history unless stated). VAL-17 and VAL-18's
   * starting-with part have no record in the data, so they stay synthetic (availability.test.ts).
   */
  const RULES: readonly (readonly [string, readonly number[], Partial<CharacterProfile>, readonly string[]])[] = [
    ['VAL-4: A Warden of the Alliance (171) needs level 10', [171], { ...human, startLevel: 5, priorCompletedQuests: [questId(558), questId(4822)] }, ['#1 VAL004-min-level q171']],
    ['VAL-5: The Battle for Arathi Basin! (8168) is for levels 20-29', [8168], { ...human, startLevel: 35 }, ['#1 LINT003-low-value q8168', '#1 VAL005-max-level q8168']],
    ['VAL-9: 171 needs the group 558 and 4822', [171], { ...human, startLevel: 60 }, ['#1 LINT003-low-value q171', '#1 VAL009-prequest-group q171']],
    ['VAL-9 with an unknown history', [171], { ...human, startLevel: 60, priorHistory: 'unknown' }, ['#1 LINT003-low-value q171', '#1 VAL009-prequest-group-unverifiable q171']],
    ['VAL-9 met', [171], { ...human, startLevel: 60, priorCompletedQuests: [questId(558), questId(4822)] }, ['#1 LINT003-low-value q171']],
    ['VAL-10: Digging Through the Dirt (254) needs its parent 253 active', [254], { ...human, startLevel: 35 }, ['#1 VAL010-parent-not-active q254']],
    [
      'VAL-12 (and VAL-22): Escape Through Force and Stealth (994, 995) exclude each other',
      [994, 995],
      { ...human, startLevel: 22, priorCompletedQuests: [questId(993)] },
      ['#1 VAL022-needs-event q994', '#2 VAL012-exclusive q995', '#2 VAL022-needs-event q995'],
    ],
    ['VAL-13: Raven Hill (163) after its target 5 is taken', [5, 163], { ...human, startLevel: 20 }, ['#2 VAL011-later-chain-step q163', '#2 VAL013-breadcrumb-target-taken q163']],
    ['VAL-14 (and VAL-21): 5 while its breadcrumb 163 is active', [163, 5], { ...human, startLevel: 20 }, ['#2 VAL014-breadcrumb-active q5', '#2 VAL021-previous-chain-active q5']],
    ['VAL-15: Seasoned Wolf Kabobs (90) needs Cooking 50', [90], { ...human, startLevel: 25, professions: { '185': 10 } }, ['#1 VAL015-skill q90']],
    ['VAL-15 undeclared', [90], { ...human, startLevel: 25 }, ['#1 VAL015-skill-unverifiable q90']],
    ['VAL-16: Young Crocolisk Skins (484) needs neutral with faction 72', [484], { ...human, startLevel: 22, reputation: { '72': -100 } }, ['#1 VAL016-reputation q484']],
    ['VAL-16 undeclared', [484], { ...human, startLevel: 22 }, ['#1 VAL016-reputation-unverifiable q484']],
    ['VAL-18: Onu is meditating (960) ends once 949 is turned in', [960], { ...human, startLevel: 5, priorCompletedQuests: [questId(944), questId(949)] }, ['#1 VAL018-availability-window q960']],
    ['VAL-18: Timberling Seeds (918) is disabled while 997 is in the log', [997, 918], { ...human, startLevel: 7 }, ['#2 VAL018-availability-window q918']],
    [
      'VAL-19: Goblin Engineering (3629) needs a specialisation',
      [3629],
      { ...human, race: 'Gnome', startLevel: 47 },
      ['#1 LINT002-link-mismatch q3629', '#1 VAL015-skill-unverifiable q3629', '#1 VAL019-specialization-unverifiable q3629'],
    ],
    ["VAL-21: Mai'Zoth (205) while its previous chain step 207 is in the log", [205], { ...human, startLevel: 40, priorQuestLog: [questId(207)] }, ['#1 VAL008-prequest-single q205', '#1 VAL021-previous-chain-active q205']],
    ['VAL-22: The Fargodeep Mine (62) needs an event', [62], { ...human, startLevel: 7 }, ['#1 VAL022-needs-event q62']],
  ];

  it.each(RULES)('%s', (_name, quests, character, expected) => {
    const ids = sequentialIdSource();
    expect(run(quests.map((id) => accept(ids, id)), character)).toEqual(expected);
  });

  it('VAL-20: a 41st quest does not fit a full quest log (capacity 40 in forever-beta)', () => {
    const view = contextFor({ faction: 'Alliance', class: 'WARRIOR' }).dataset as DatasetView;
    const log = view
      .quests()
      .filter((quest) => quest.id < 900)
      .slice(0, 40)
      .map((quest) => quest.id);
    expect(log).toHaveLength(40);
    expect(run([accept(sequentialIdSource(), 62)], { ...human, startLevel: 7, priorQuestLog: log })).toContain('#1 VAL020-quest-log-full q62');
  });
});

describe('issue-code registries', () => {
  it('src/validate and src/rxp follow one grammar, with unique codes and one number per RXP code', () => {
    const all = [...ISSUE_CODES.map((spec) => spec.code), ...RXP_CODES.map((spec) => spec.code)];
    for (const code of all) expect(code, code).toMatch(ISSUE_CODE_PATTERN);
    expect(new Set(all).size).toBe(all.length);
    const rxpNumbers = RXP_CODES.map((spec) => parseIssueCode(spec.code)?.number);
    expect(new Set(rxpNumbers).size).toBe(rxpNumbers.length);
    expect(RXP_CODES.every((spec) => parseIssueCode(spec.code)?.family === 'RXP')).toBe(true);
    expect(ISSUE_CODES.every((spec) => parseIssueCode(spec.code)?.family !== 'RXP')).toBe(true);
  });
});
