import { describe, expect, it } from 'vitest';
import { fixtureView, placeholderGeometry } from '../../tests/support/fixture-dataset';
import { type Location, type ProjectV1, questId, sequentialIdSource, type StepId, uiMapId, zoneSourcedPoint } from '../domain';
import { parseProjectText, serializeProject } from '../project';
import { manualClock } from './clock';
import {
  type Command,
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  insertGrind,
  insertNote,
  insertTravel,
  joinSelectedSections,
  moveSelected,
  paste,
  renameRoute,
  setDurationOverride,
  setLockedSelected,
  setStepLocation,
  updateStepNote,
} from './commands';
import { buildCustomQuest, deleteCustomQuest, nextInventedQuestId, saveCustomQuest, updateSettings } from './project-commands';
import { addQuestSteps, QUEST_STEP_PARTS } from './quest-steps';
import { createSampleProject } from './sample-route';
import { createEditorStore, type EditorStore } from './store';

/**
 * Every project the editor can make is one the next start can open (M4 review CR-11): random
 * sequences of commands (inserts, moves, cut, copy and paste, join, locks, notes, durations,
 * locations, custom quests, settings, undo and redo), from a fixed seed, each result checked
 * against the project schema through a serialised file. A stored project that fails this would
 * open today and be refused at the next start.
 */

/** A seeded pseudo-random source (Park-Miller, ordinary arithmetic: no bitwise operators, D-012). */
function random(seed: number) {
  let state = seed;
  const next = (): number => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return {
    int: (n: number): number => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T | undefined => items[Math.floor(next() * items.length)],
    chance: (p: number): boolean => next() < p,
  };
}

const dataset = fixtureView();
const geometry = placeholderGeometry();
const questIds = dataset
  .quests()
  .map((q) => q.id)
  .slice(0, 20);

type Random = ReturnType<typeof random>;

function selectSome(store: EditorStore, rng: Random): void {
  const steps = store.getState().project.route.steps;
  if (steps.length === 0) {
    store.select({ kind: 'none' });
    return;
  }
  const from = rng.int(steps.length);
  const count = 1 + rng.int(Math.min(4, steps.length - from));
  store.select({ kind: 'set', ids: steps.slice(from, from + count).map((s) => s.id) });
}

const somewhere = (rng: Random): Location => ({ source: zoneSourcedPoint(uiMapId(1411), rng.int(10000) / 100, rng.int(10000) / 100), label: rng.chance(0.5) ? 'Here' : null, radius: rng.chance(0.3) ? 5 : null });

/** One random edit, as the editor would dispatch it. */
function randomCommand(store: EditorStore, rng: Random): Command | 'undo' | 'redo' | null {
  const project = store.getState().project;
  const steps = project.route.steps;
  const anyStep = (): StepId | null => rng.pick(steps)?.id ?? null;
  const at = (): number => rng.int(steps.length + 1);
  switch (rng.int(20)) {
    case 0:
      return insertNote({ text: `Note ${String(rng.int(1000))}` }, at());
    case 1:
      return insertTravel({ location: rng.chance(0.5) ? somewhere(rng) : null }, at());
    case 2:
      return insertGrind({ until: rng.chance(0.5) ? { kind: 'level', level: 1 + rng.int(60), offset: null } : { kind: 'duration', seconds: 60 * (1 + rng.int(30)) } }, at());
    case 3:
      return deleteSelected();
    case 4:
      return moveSelected(rng.chance(0.5) ? { by: rng.int(5) - 2 } : { toIndex: rng.int(Math.max(1, steps.length)) });
    case 5:
      return duplicateSelected();
    case 6:
      return setLockedSelected(rng.chance(0.5));
    case 7:
      return cutSelected();
    case 8:
      return copySelected();
    case 9:
      return paste(at());
    case 10:
      return joinSelectedSections();
    case 11:
      return renameRoute(rng.chance(0.2) ? '' : `Route ${String(rng.int(100))}`);
    case 12: {
      const id = anyStep();
      return id === null ? null : updateStepNote(id, rng.chance(0.3) ? null : `Remember ${String(rng.int(100))}`);
    }
    case 13: {
      const id = anyStep();
      return id === null ? null : setDurationOverride(id, rng.chance(0.3) ? null : rng.int(3600));
    }
    case 14: {
      const id = anyStep();
      return id === null ? null : setStepLocation(id, rng.chance(0.3) ? null : somewhere(rng));
    }
    case 15: {
      const invented = nextInventedQuestId(project);
      const quest = buildCustomQuest(
        {
          id: invented,
          name: `Custom ${String(Math.abs(invented))}`,
          level: rng.chance(0.5) ? 1 + rng.int(60) : null,
          minLevel: null,
          baseXp: null,
          foreverStatus: 'unknown',
          starterLocation: rng.chance(0.5) ? somewhere(rng) : null,
          finisherLocation: null,
        },
        null,
      );
      return saveCustomQuest(quest);
    }
    case 16: {
      const quest = rng.pick(project.customQuests);
      return quest === undefined ? null : deleteCustomQuest(quest.id);
    }
    case 17:
      return updateSettings({ character: { startLevel: 1 + rng.int(60), startXp: rng.int(1000) }, routeProfile: { hardcore: rng.chance(0.5), xpRate: 1 + rng.int(3) } });
    case 18: {
      const id = rng.pick(questIds) ?? questId(1);
      const parts = QUEST_STEP_PARTS.filter(() => rng.chance(0.6));
      return addQuestSteps(id, parts.length === 0 ? ['accept'] : parts, { dataset, geometry, at: at() });
    }
    default:
      return rng.chance(0.5) ? 'undo' : 'redo';
  }
}

function assertOpensAgain(project: ProjectV1, where: string): void {
  const parsed = parseProjectText(serializeProject(project));
  if (!parsed.ok) throw new Error(`${where}: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  expect(parsed.project).toEqual(project);
}

describe('projects made by the editor (CR-11)', () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`stay schema-valid through a random edit sequence (seed ${String(seed)})`, () => {
      const rng = random(seed);
      const clock = manualClock('2026-09-25T12:00:00.000Z');
      const store = createEditorStore({ project: createSampleProject({ dataset, nowIso: clock.nowIso() }), ids: sequentialIdSource(10_000), clock });
      for (let i = 0; i < 150; i += 1) {
        if (rng.chance(0.4)) selectSome(store, rng);
        const command = randomCommand(store, rng);
        if (command === 'undo') store.undo();
        else if (command === 'redo') store.redo();
        else if (command !== null) store.dispatch(command);
        clock.advance(1000);
        if (i % 10 === 9) assertOpensAgain(store.getState().project, `seed ${String(seed)}, edit ${String(i + 1)}`);
      }
      assertOpensAgain(store.getState().project, `seed ${String(seed)}, the end`);
      // The sequence really edited the project (most commands applied, not refused as no-ops).
      expect(store.getState().revision).toBeGreaterThan(60);
    });
  }
});
