import { factionId, questId } from '../../domain/ids';
import type { QuestRecord } from '../../domain/dataset';
import { at, killObjective, npcRecord } from '../../engine/test-helpers';
import { hQuest, hScenario, hSteps, type Scenario } from './test-helpers';
import type { OptimizationGoal, SearchOptions } from './types';

/**
 * The §13 fixtures (docs/research/optimizer-m7.md §13.1) as scenarios for the core's unit tests,
 * with the expected figures the plan CHECKED against the engine. Test support only.
 */

export interface CoreFixture {
  readonly id: string;
  readonly scenario: Scenario;
  readonly goal: Partial<OptimizationGoal>;
  readonly options?: Partial<SearchOptions>;
  /** The expected best estimate and incumbent, ms (the plan's seconds × 1000, within §6.3 parity). */
  readonly bestMs: number;
  readonly incumbentMs: number;
  /** The expected best unit sequence, when the plan pins it. */
  readonly units?: readonly number[];
}

const custom = (record: QuestRecord, x: number, y: number): Scenario['project']['customQuests'][number] => ({
  ...record,
  provenance: { ...record.provenance, source: 'custom' as const },
  starterLocation: at(x, y),
  finisherLocation: at(x, y),
});

export function coreFixtures(): CoreFixture[] {
  const out: CoreFixture[] = [];
  {
    const s = hSteps();
    out.push({
      id: '1',
      scenario: hScenario({ quests: [hQuest(101, 3000), hQuest(102, 1600), hQuest(103, 1600)], steps: [...s.quest(101, 3000, 0), ...s.quest(102, 100, 0), ...s.quest(103, 0, 100)], exit: { x: 0, y: 200 } }),
      goal: { targetXp: 3000 },
      bestMs: 46_142,
      incumbentMs: 632_142,
      units: [2, 3, 4, 5],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '2',
      scenario: hScenario({
        quests: [hQuest(201, 1000), hQuest(202, 1000), hQuest(203, 1000), hQuest(204, 1000)],
        steps: [...s.quest(201, -100, 0), ...s.quest(202, 900, 0), ...s.quest(203, 950, 50), ...s.quest(204, 1000, 0)],
        exit: { x: 1000, y: 0 },
      }),
      goal: { targetXp: 3000 },
      bestMs: 122_142,
      incumbentMs: 148_142,
      units: [2, 3, 4, 5, 6, 7],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '3',
      scenario: hScenario({ quests: [hQuest(301, 1000), hQuest(302, 1000), hQuest(303, 1000)], steps: [...s.quest(301, -50, 0), ...s.quest(302, 600, 0), ...s.quest(303, 610, 0)], exit: { x: 620, y: 0 } }),
      goal: { targetXp: 2000 },
      bestMs: 74_000,
      incumbentMs: 90_000,
      units: [2, 3, 4, 5],
    });
  }
  // Fixture 4 is about the beam: at width 1 the beam alone (no seeds, no local pass) keeps the
  // original. The full search at width 1 finds Y then X through the local pass over the
  // nearest-neighbour seed, whose pre-screen now sees the exit leg (review M7Q Q-04: Y then X adds
  // 5 s of travel inside the section and saves 25 s of exit).
  for (const [id, options, best] of [
    ['4-beam1', { beamWidth: 1, seeds: false, localWindow: 0 }, false],
    ['4-beam1-pass', { beamWidth: 1 }, true],
    ['4-beam4', { beamWidth: 4 }, true],
  ] as const) {
    const s = hSteps();
    out.push({
      id,
      scenario: hScenario({ quests: [hQuest(401, 1000), hQuest(402, 1000)], steps: [...s.quest(401, 100, 0), ...s.quest(402, -150, 0)], exit: { x: 400, y: 0 } }),
      goal: {},
      options,
      bestMs: best ? 82_000 : 102_000,
      incumbentMs: 102_000,
      units: best ? [2, 3, 0, 1] : [0, 1, 2, 3],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '5',
      scenario: hScenario({
        quests: [hQuest(501, 4000), hQuest(502, 4000), hQuest(503, 1000, { minLevel: 11 })],
        steps: [...s.quest(501, 400, 300), ...s.quest(502, 800, 0), ...s.quest(503, -100, 0)],
        exit: { x: 800, y: 0 },
      }),
      goal: {},
      bestMs: 296_310,
      incumbentMs: 298_000,
      units: [2, 3, 0, 1, 4, 5],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '6',
      scenario: hScenario({
        quests: [hQuest(601, 2000, { objectives: [killObjective(6100)] }), hQuest(602, 1000)],
        data: { npcs: [npcRecord(6100, { minLevel: 10, maxLevel: 10 })] },
        steps: [s.accept(601, 100, 0), s.accept(602, 0, 150), s.turnin(602, 0, 150), s.complete(601, 1000, 0), s.turnin(601, 100, 0, { locked: true })],
        exit: { x: 0, y: 200 },
      }),
      goal: {},
      bestMs: 465_028,
      incumbentMs: 493_507,
      units: [0, 3, 4, 1, 2],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '7a',
      scenario: hScenario({ quests: [hQuest(701, 1000), hQuest(702, 1000)], steps: [s.accept(701, 500, 0), ...s.quest(702, -100, 0)], suffix: [s.turnin(701, 500, 0)] }),
      goal: {},
      bestMs: 79_000,
      incumbentMs: 179_000,
      units: [1, 2, 0],
    });
  }
  {
    const s = hSteps();
    const f = hQuest(713, 1000);
    out.push({
      id: '7b',
      scenario: hScenario({
        quests: [hQuest(711, 1000), hQuest(712, 1000), { ...f, prerequisites: { ...f.prerequisites, preQuestSingle: [questId(711)] } }],
        steps: [...s.quest(711, -800, 0), ...s.quest(712, 100, 0)],
        suffix: [s.accept(713, 200, 0)],
      }),
      goal: { targetXp: 1000 },
      bestMs: 186_000,
      incumbentMs: 192_000,
      units: [0, 1],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '7c',
      scenario: hScenario({
        quests: [hQuest(721, 1000), hQuest(722, 1000)],
        steps: [s.accept(721, 0, 0, { locked: true }), s.accept(722, 100, 0), s.turnin(722, 100, 0), s.turnin(721, 2000, 0)],
        exit: { x: 100, y: 0 },
      }),
      goal: { targetXp: 1000 },
      bestMs: 396_000,
      incumbentMs: 402_000,
      units: [0, 3],
    });
  }
  {
    const s = hSteps();
    const q = (id: number): QuestRecord => hQuest(id, 1000, { xp: { questLevel: 60, baseXp: 1000, basis: 'era-seed' } });
    out.push({
      id: '7d',
      scenario: hScenario({
        quests: [q(731), q(732)],
        steps: [...s.quest(732, 1000, 0), s.accept(731, 0, 50), s.train(0, 60, { skill: 'riding', rank: 1 }), s.turnin(731, 0, 50)],
        exit: { x: 1000, y: 0 },
        character: { startLevel: 40 },
      }),
      goal: {},
      bestMs: 91_203,
      incumbentMs: 286_328,
      units: [2, 3, 0, 1],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '7e',
      scenario: hScenario({
        quests: [hQuest(741, 1000), hQuest(742, 1000)],
        steps: [
          ...s.quest(741, 200, 100),
          s.note(300, -200, { locked: true }),
          s.note(0, -100, { condition: { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast', level: 60, xp: null, negate: false }] } }),
          ...s.quest(742, -200, 100),
          s.note(-300, -200, { locked: true }),
        ],
        exit: { x: 400, y: 0 },
      }),
      goal: {},
      bestMs: 205_285,
      incumbentMs: 230_314,
      units: [2, 3, 6, 4, 5, 0, 1],
    });
  }
  {
    const k = hQuest(-751, null, { starters: [], finishers: [] });
    for (const variant of ['v1', 'v2'] as const) {
      const s = hSteps();
      const acceptK = { ...s.accept(-751, 0, 0), location: null };
      const turnInK = { ...s.turnin(-751, 0, 0), location: null };
      const a = s.quest(752, 100, 0);
      out.push({
        id: `7f-${variant}`,
        scenario: hScenario({
          quests: [k, hQuest(752, 1000)],
          steps: variant === 'v1' ? [acceptK, turnInK, ...a] : [...a, acceptK, turnInK],
          exit: variant === 'v1' ? { x: -1000, y: 0 } : { x: 100, y: 0 },
          customQuests: [custom(k, -2000, 0)],
        }),
        goal: {},
        bestMs: variant === 'v1' ? 332_000 : 442_000,
        incumbentMs: variant === 'v1' ? 532_000 : 442_000,
        units: variant === 'v1' ? [2, 3, 0, 1] : [0, 1, 2, 3],
      });
    }
  }
  for (const exitX of [1000, -1000]) {
    const s = hSteps();
    out.push({
      id: `7g-${String(exitX)}`,
      scenario: hScenario({ quests: [hQuest(761, 1000), hQuest(762, 1000)], steps: [...s.quest(761, 100, 0), ...s.quest(762, -100, 0)], exit: { x: exitX, y: 0 } }),
      goal: {},
      bestMs: 132_000,
      incumbentMs: exitX > 0 ? 152_000 : 132_000,
      units: exitX > 0 ? [2, 3, 0, 1] : [0, 1, 2, 3],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '8',
      scenario: hScenario({ quests: [hQuest(801, 1000), hQuest(802, 1000)], steps: [...s.quest(802, 200, 0), ...s.quest(801, 100, 0)], exit: { x: 200, y: 0 } }),
      goal: { targetXp: 2500 },
      bestMs: 212_000,
      incumbentMs: 232_000,
      units: [2, 3, 0, 1],
    });
  }
  for (const grindFill of ['shortfall', 'replace-quests'] as const) {
    const s = hSteps();
    out.push({
      id: `8b-${grindFill}`,
      scenario: hScenario({ quests: [hQuest(811, 1000), hQuest(812, 1000)], steps: [...s.quest(811, 100, 0), ...s.quest(812, 2000, 0)], exit: { x: 0, y: 0 } }),
      goal: { grindFill },
      bestMs: grindFill === 'shortfall' ? 412_000 : 356_000,
      incumbentMs: 412_000,
      units: grindFill === 'shortfall' ? [0, 1, 2, 3] : [0, 1],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '10c',
      scenario: hScenario({ quests: [hQuest(101, 3000), hQuest(102, 1600), hQuest(103, 1600)], steps: [...s.quest(101, 3000, 0), ...s.quest(102, 100, 0), ...s.quest(103, 0, 100)], exit: { x: 0, y: 0 } }),
      goal: { targetXp: 3000 },
      bestMs: 46_142,
      incumbentMs: 632_142,
      units: [2, 3, 4, 5],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '12',
      scenario: hScenario({
        quests: [hQuest(1201, 1000), hQuest(1202, 1000), hQuest(1203, 1000)],
        steps: [s.accept(1201, 100, 0), s.turnin(1201, 100, 0), s.travel(null, 0), s.accept(1202, 200, 0), s.turnin(1202, 200, 0), ...s.quest(1203, 3000, 0)],
        exit: { x: 0, y: 0 },
      }),
      goal: {},
      bestMs: 608_000,
      incumbentMs: 608_000,
      units: [0, 1, 2, 3, 4],
    });
  }
  {
    const s = hSteps();
    out.push({
      id: '13a',
      scenario: hScenario({
        quests: [hQuest(1301, 1000), hQuest(1302, 1000, { minLevel: 11 }), hQuest(1303, 1000)],
        steps: [...s.quest(1301, 1000, 0), s.accept(1302, 0, 50, { anyOf: [questId(1302), questId(1303)] })],
        suffix: [s.turnin(1302, 1000, 50)],
        character: { startXp: 7000 },
      }),
      goal: {},
      bestMs: 309_125,
      incumbentMs: 309_125,
      units: [0, 1, 2],
    });
  }
  {
    const s = hSteps();
    const m = hQuest(1312, 1000);
    out.push({
      id: '13b',
      scenario: hScenario({
        quests: [hQuest(1311, 1000, { reputationReward: [{ factionId: factionId(76), value: 250 }] }), { ...m, requirements: { ...m.requirements, minReputation: { factionId: factionId(76), value: 250 } } }],
        steps: [...s.quest(1311, -500, 0), ...s.quest(1312, 100, 0)],
        exit: { x: 0, y: 0 },
        character: { reputation: { '76': 0 } },
      }),
      goal: { targetXp: 1000 },
      bestMs: 106_000,
      incumbentMs: 132_000,
      units: [0, 1],
    });
  }
  {
    const s = hSteps();
    const b = hQuest(1322, 500);
    out.push({
      id: '13c',
      scenario: hScenario({
        quests: [hQuest(1321, 1000), { ...b, prerequisites: { ...b.prerequisites, breadcrumbForQuestId: questId(1323) } }, hQuest(1323, 1000, { minLevel: 11 })],
        steps: [...s.quest(1321, 1000, 0), s.accept(1322, 0, 50)],
        suffix: [s.turnin(1322, 1000, 50)],
        character: { startXp: 7000 },
      }),
      goal: {},
      bestMs: 309_125,
      incumbentMs: 309_125,
      units: [0, 1, 2],
    });
  }
  return out;
}

/** Grid-40 (fixture 10): quests 1000 + k at a grid, turned in at quest (k + 13) mod 40's accept point. */
export function grid40(): Scenario {
  const s = hSteps();
  const quests: QuestRecord[] = [];
  const steps = [];
  const point = (k: number): { readonly x: number; readonly y: number } => ({ x: 150 * (k % 8), y: 150 * Math.floor(k / 8) });
  for (let k = 0; k < 40; k += 1) quests.push(hQuest(1000 + k, 1000));
  for (let k = 0; k < 40; k += 1) {
    const a = point(k);
    const t = point((k + 13) % 40);
    steps.push(s.accept(1000 + k, a.x, a.y), s.turnin(1000 + k, t.x, t.y));
  }
  return hScenario({ quests, steps, exit: { x: 1050, y: 600 } });
}
