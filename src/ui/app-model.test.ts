import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture02 from '../../tests/fixtures/rxp/02-filters-and-step-tags.txt?raw';
import { fixtureView } from '../../tests/support/fixture-dataset';
import * as rxpTools from '../app/rxp-tools';
import { sequentialIdSource } from '../app/shell-support';
import { createPlaceholderWorkspace } from '../app/placeholder-project';
import type { AreaId, NpcId, QuestId, StepId, UiMapId, WorldMapId } from '../domain/ids';
import type { Location, SourcedPoint } from '../domain/points';
import type { Route, RouteStep } from '../domain/route';
import type { DatasetIdentity, DatasetView, EntityRef, QuestRecord, SpawnPoint } from '../domain/dataset';
import {
  NO_ACTIVE_TARGET,
  NOT_SIMULATED,
  PLACEHOLDER_DATA_NOTICE,
  buildRouteView,
  characterName,
  dataBadgeDetail,
  dropToIndex,
  grindTargetText,
  locationDetail,
  locationText,
  mapStepLabel,
  panelTabOf,
  publishedPointText,
  questName,
  questZoneName,
  resolveActiveTarget,
  rightTabOf,
  routeQuestIds,
  sameItems,
  selectedRowKeys,
  selectionMessage,
  startZonePreference,
  stepRowModel,
  stepTitle,
  type RouteView,
} from './app-model';
import { entityWhereText, objectiveWhere, spawnSummary } from './app/detail-text';
import { SIDE_PANEL_TAB_ORDER } from './shell/SidePanel';

const { project, dataset } = createPlaceholderWorkspace({ nowIso: '2026-09-25T12:00:00.000Z' });
const route = project.route;
const view = buildRouteView(route, dataset, project.character.startLevel);

const find = (predicate: (s: RouteStep) => boolean): RouteStep => {
  const step = route.steps.find(predicate);
  if (step === undefined) throw new Error('fixture step missing');
  return step;
};

/** A minimal route of note steps `a`, `b`, ... with the given group per step (null: none). */
function notesRoute(groups: readonly (string | null)[]): Route {
  const steps = groups.map(
    (group, i): RouteStep => ({
      id: `s-${String.fromCharCode(97 + i)}` as StepId,
      kind: 'note',
      text: `Placeholder ${String(i)}`,
      preserved: null,
      location: null,
      note: null,
      locked: false,
      groupId: group as RouteStep['groupId'],
      condition: null,
      durationOverride: null,
      origin: { source: 'manual', ref: null },
      rxp: null,
      ext: null,
    }),
  );
  return { id: 'route-1' as Route['id'], name: 'Placeholder', description: '', steps, groups: {} };
}

const ids = (view: RouteView, rows: readonly number[]): Set<StepId> =>
  new Set(rows.flatMap((row) => view.rowSteps[row] ?? []));

describe('buildRouteView', () => {
  it('has one row per step plus a header before the group run', () => {
    const headers = view.rows.filter((row) => row.type === 'group');
    expect(headers).toHaveLength(1);
    expect(view.rows).toHaveLength(route.steps.length + 1);
    const headerIndex = view.rows.findIndex((row) => row.type === 'group');
    const header = view.rows[headerIndex];
    expect(header?.type === 'group' ? header.stepCount : null).toBe(3);
    expect(view.rowSteps[headerIndex]).toEqual(route.steps.filter((s) => s.groupId !== null).map((s) => s.id));
  });

  it('numbers steps 1..n and maps ids to rows both ways', () => {
    route.steps.forEach((step, i) => {
      expect(view.numberOfStep.get(step.id)).toBe(i + 1);
      const row = view.rowOfStep.get(step.id);
      expect(row === undefined ? undefined : view.rows[row]?.key).toBe(step.id);
    });
    view.rows.forEach((row, i) => {
      expect(view.rowOfKey.get(row.key)).toBe(i);
    });
  });

  it('leaves derived numbers unknown and marks difficulty as taken from a lower-bound level', () => {
    for (const row of view.rows) {
      if (row.type !== 'step') continue;
      expect(row.projectedLevel.value).toBeNull();
      expect(row.projectedLevel.unknownReason).toBe(NOT_SIMULATED);
      expect(row.duration).toEqual(row.projectedLevel);
      expect(row.xpGained).toEqual(row.projectedLevel);
      expect(row.pending).toBeNull();
      if (row.quest !== null) {
        expect(row.quest.uncertain).toBe(true);
        expect(row.quest.difficulty).not.toBeNull();
        expect(row.quest.provenance).toEqual({ claim: 'unknown', declaredBy: null });
      }
    }
    const locked = view.rows.filter((row) => row.type === 'step' && row.locked);
    expect(locked).toHaveLength(1);
  });

  it('labels a group that is missing from route.groups, even when its id names an Object.prototype member', () => {
    const view = buildRouteView(notesRoute(['toString', 'toString', 'constructor']), dataset, 1);
    const labels = view.rows.flatMap((row) => (row.type === 'group' ? [row.label] : []));
    expect(labels).toEqual(['Step group', 'Step group']);
  });

  it('keeps the steps it was built from', () => {
    expect(view.steps).toBe(route.steps);
  });

  it('gives a group split by editing one header per run', () => {
    const split = buildRouteView(notesRoute(['g', 'g', null, 'g']), dataset, 1);
    expect(split.rows.map((row) => row.type)).toEqual(['group', 'step', 'step', 'step', 'group', 'step']);
    expect(new Set(split.rows.map((row) => row.key)).size).toBe(split.rows.length);
  });
});

describe('selectedRowKeys', () => {
  it('selects a header only when its whole run is selected', () => {
    const small = buildRouteView(notesRoute([null, 'g', 'g']), dataset, 1);
    expect([...selectedRowKeys(small, ids(small, [2]))]).toEqual(['s-b']);
    expect([...selectedRowKeys(small, ids(small, [2, 3]))].sort()).toEqual(['group:g:s-b', 's-b', 's-c']);
    expect(selectedRowKeys(small, new Set()).size).toBe(0);
  });
});

describe('dropToIndex', () => {
  const flat = buildRouteView(notesRoute([null, null, null, null, null]), dataset, 1);

  it('converts RouteList drop indices into a position among the steps that stay', () => {
    // Row 1 (b) dropped to end at index 3: b goes after d.
    expect(dropToIndex(flat, ids(flat, [1]), 1, 3)).toBe(3);
    // Row 4 (e) dropped to index 1: e goes after a.
    expect(dropToIndex(flat, ids(flat, [4]), 4, 1)).toBe(1);
    expect(dropToIndex(flat, ids(flat, [0]), 0, 4)).toBe(4);
  });

  it('counts only steps that are not moving, and never header rows', () => {
    // A selection {b, c} dragged by b down to index 3: the gap is above row 4 (e); a and d stay above it.
    expect(dropToIndex(flat, ids(flat, [1, 2]), 1, 3)).toBe(2);
    const grouped = buildRouteView(notesRoute([null, 'g', 'g', null]), dataset, 1);
    // Rows: a, [header], b, c, d. Dragging d (row 4) to index 1 lands it above the header.
    expect(dropToIndex(grouped, ids(grouped, [4]), 4, 1)).toBe(1);
  });
});

describe('texts', () => {
  it('titles steps from the dataset and the step itself', () => {
    const acceptStep = find((s) => s.kind === 'accept');
    expect(stepTitle(acceptStep, dataset)).toMatch(/^Placeholder Quest 1/);
    expect(stepTitle(find((s) => s.kind === 'travel'), dataset)).toBe('To Placeholder meadow');
    expect(stepTitle(find((s) => s.kind === 'grind'), dataset)).toBe('Until level 2');
    expect(stepTitle(find((s) => s.kind === 'hearth' && s.mode === 'bind'), dataset)).toBe('Set hearthstone');
    expect(stepTitle(find((s) => s.kind === 'flight' && s.mode === 'take'), dataset)).toBe('Fly to Placeholder Ridge');
    const group = find((s) => s.kind === 'complete' && s.targets.length === 2);
    // Quest 4 follows Quest 1 (its only pre-quest): its chain position is in the title.
    expect(stepTitle(group, dataset)).toBe('Placeholder Quest 3: object objective (objective 1) + Placeholder Quest 4: follow-up to Quest 1 (2/2) (objective 1)');
  });

  it('names unknown quests without inventing anything', () => {
    expect(questName(dataset, 5 as QuestId)).toBe('Quest 5 (not in the dataset)');
  });

  it('describes grind targets, including offsets', () => {
    expect(grindTargetText({ kind: 'duration', seconds: 900 })).toBe('For 15m 00s');
    expect(grindTargetText({ kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } })).toBe('Until level 10 + 2,500 XP');
    expect(grindTargetText({ kind: 'level', level: 10, offset: { kind: 'xpShort', xp: 300 } })).toBe('Until 300 XP short of level 10');
    expect(grindTargetText({ kind: 'level', level: 10, offset: { kind: 'fraction', fraction: 0.5 } })).toBe('Until level 10 and 50%');
  });

  it('prints grind fractions without floating-point loss (RXP .xp 10.29, 10.57)', () => {
    // 0.29 * 100 is 28.999999999999996 and 0.57 * 100 is 56.99999999999999 in IEEE doubles.
    expect(grindTargetText({ kind: 'level', level: 10, offset: { kind: 'fraction', fraction: 0.29 } })).toBe('Until level 10 and 29%');
    expect(grindTargetText({ kind: 'level', level: 10, offset: { kind: 'fraction', fraction: 0.57 } })).toBe('Until level 10 and 57%');
    expect(grindTargetText({ kind: 'level', level: 10, offset: { kind: 'fraction', fraction: 0.999 } })).toBe('Until level 10 and 99%');
  });

  it('prints locations with their zone and keeps authored lexemes', () => {
    const step = find((s) => s.kind === 'travel');
    expect(locationDetail(step.location, dataset)).toBe('Placeholder meadow · Placeholder Vale 38, 61.5');
    const authored: Location = {
      source: { space: 'zone', uiMapId: 900_902 as UiMapId, x: 1, y: 2, frame: 'forever', lexemes: ['1.00', '2.0'] },
      label: null,
      radius: null,
    };
    expect(locationText(authored, dataset)).toBe('Placeholder Ridge 1.00, 2.0');
    expect(locationText(null, dataset)).toBeNull();
  });

  it('names the axes of world points, swapping RXP world-form lexemes back to X, Y (COORD-7)', () => {
    const world = (lexemes: readonly [string, string] | null): Location => ({
      source: { space: 'world', mapId: 1 as WorldMapId, x: -500, y: -4000, uiMapId: null, lexemes },
      label: null,
      radius: null,
    });
    // Written by RXP as `1411/1,-4000.00,-500.00`: Y first, then X (coordinates.md §15).
    expect(locationText(world(['-4000.00', '-500.00']), dataset)).toBe('World map 1: X -500.00, Y -4000.00 yd');
    // The same point created in the app has no lexemes, and reads the same way round.
    expect(locationText(world(null), dataset)).toBe('World map 1: X -500, Y -4000 yd');
    // A world point that names its UiMap (a zone hint) says it after the point.
    const hinted: Location = { source: { space: 'world', mapId: 1 as WorldMapId, x: -500, y: -4000, uiMapId: 424242 as UiMapId, lexemes: null }, label: null, radius: null };
    expect(locationText(hinted, dataset)).toBe('World map 1: X -500, Y -4000 yd (UiMap 424242)');
    const published: SourcedPoint = { space: 'world', mapId: 0 as WorldMapId, x: -8835.74, y: 490.16, uiMapId: null, lexemes: null };
    expect(publishedPointText(dataset, published)).toBe('World map 0: X -8835.74, Y 490.16 yd');
  });

  it('names the character and maps the side-panel tabs both ways', () => {
    expect(characterName(project.character)).toBe('Orc Warrior');
    expect(characterName({ race: 'Scourge', class: 'MAGE' })).toBe('Undead Mage');
    for (const tab of SIDE_PANEL_TAB_ORDER) expect(panelTabOf(rightTabOf(tab))).toBe(tab);
  });
});

describe('instance-presence spawns (COORD-2, code-F5)', () => {
  const base = fixtureView();
  const GORNEK: EntityRef = { kind: 'npc', id: 3143 as NpcId };
  const cutting = base.quest(788 as QuestId);
  if (cutting === undefined) throw new Error('fixture quest 788 missing');
  /** The fixture view with Gornek inside an instance (area 491, Razorfen Kraul), entrance known or not. */
  const inside = (entrance: UiMapId | null): DatasetView => {
    const spawn: SpawnPoint = {
      source: { kind: 'instance', areaId: 491 as AreaId },
      world: entrance === null ? null : { mapId: 1 as WorldMapId, x: -4470, y: -1680 },
      uiMapId: entrance,
    };
    return { ...base, spawns: (ref) => (ref.kind === 'npc' && ref.id === GORNEK.id ? [spawn] : base.spawns(ref)) };
  };

  it('says the entity is inside an instance, never in the entrance’s zone', () => {
    const view = inside(1413 as UiMapId);
    expect(spawnSummary(view, GORNEK)).toBe('1 spawn in an instance (entrance in The Barrens)');
    expect(questZoneName(view, cutting)).toBe('Inside an instance (entrance in The Barrens)');
    expect(entityWhereText(view, GORNEK)).toBe('Gornek (NPC) · Inside an instance (area 491), entrance in The Barrens');
    const kill = cutting.objectives.find((o) => o.kind === 'kill');
    if (kill === undefined) throw new Error('fixture quest 788 has no kill objective');
    expect(objectiveWhere(view, { ...kill, npcId: GORNEK.id })).toBe('1 spawn in an instance (entrance in The Barrens)');
  });

  it('says only "an instance" when the entrance is unknown', () => {
    const view = inside(null);
    expect(spawnSummary(view, GORNEK)).toBe('1 spawn in an instance');
    expect(questZoneName(view, cutting)).toBe('Inside an instance');
    expect(entityWhereText(view, GORNEK)).toBe('Gornek (NPC) · Inside an instance (area 491), entrance unknown');
  });

  it('keeps naming the zone of an ordinary zone spawn', () => {
    expect(spawnSummary(base, GORNEK)).toBe('1 spawn in Durotar');
    expect(questZoneName(base, cutting)).toBe('Durotar');
  });

  it('says when the starters spawn in several places, and names the preferred one first (QA-20)', () => {
    const own = base.spawns(GORNEK)[0];
    if (own === undefined) throw new Error('fixture Gornek has no spawn');
    // Gornek standing in Dun Morogh first, then in Durotar and inside an instance, as Winter's Presents' giver does
    const dunMorogh: SpawnPoint = { ...own, uiMapId: 1426 as UiMapId };
    const instance: SpawnPoint = { source: { kind: 'instance', areaId: 491 as AreaId }, world: null, uiMapId: null };
    const several = (spawns: readonly SpawnPoint[]): DatasetView => ({ ...base, spawns: (ref) => (ref.kind === 'npc' && ref.id === GORNEK.id ? spawns : base.spawns(ref)) });
    expect(questZoneName(several([dunMorogh, own, dunMorogh]), cutting)).toBe('Dun Morogh and 1 other zone');
    expect(questZoneName(several([dunMorogh, own, instance]), cutting)).toBe('Dun Morogh and 2 other places');
    // a caller that knows the zones' sides names the character's first
    expect(questZoneName(several([dunMorogh, own]), cutting, (id) => id === (1411 as UiMapId))).toBe('Durotar and 1 other zone');
    expect(questZoneName(several([dunMorogh, own]), cutting, () => false)).toBe('Dun Morogh and 1 other zone');
    // Without route state the rows prefer the character's start zone, then its start continent.
    const inDurotar: Location = { source: { space: 'zone', uiMapId: 1411 as UiMapId, x: 50, y: 50, frame: 'forever', lexemes: null }, label: null, radius: null };
    const prefer = startZonePreference(several([dunMorogh, own]), inDurotar);
    expect(questZoneName(several([dunMorogh, own]), cutting, prefer)).toBe('Durotar and 1 other zone');
    expect(startZonePreference(base, null)).toBeUndefined();
    const onKalimdor: Location = { source: { space: 'world', mapId: 1 as WorldMapId, x: 0, y: 0, uiMapId: null, lexemes: null }, label: null, radius: null };
    expect(several([dunMorogh, own]).zone(1411 as UiMapId)?.worldMapId).toBe(1);
    expect(questZoneName(several([dunMorogh, own]), cutting, startZonePreference(several([dunMorogh, own]), onKalimdor))).toBe('Durotar and 1 other zone');
  });
});

describe('scaling quests in rows', () => {
  const quest = (patch: Partial<QuestRecord>): DatasetView => {
    const base = dataset.quests()[0];
    if (base === undefined) throw new Error('placeholder quest missing');
    const record: QuestRecord = { ...base, ...patch };
    return { ...dataset, quest: (id) => (id === record.id ? record : dataset.quest(id)) };
  };
  const accept = find((s) => s.kind === 'accept');
  const firstQuest = accept.kind === 'accept' ? accept.questId : (0 as QuestId);

  it('shows a level -1 quest at its effective level, never as -1 (QXP-7)', () => {
    const row = stepRowModel(accept, 2, quest({ id: firstQuest, level: -1, minLevel: 4 }), 10);
    expect(row.quest?.level).toBe(10);
    expect(row.quest?.difficulty).toBe('difficult');
    const low = stepRowModel(accept, 2, quest({ id: firstQuest, level: -1, minLevel: 4 }), 1);
    expect(low.quest?.level).toBe(4);
    expect(low.quest?.difficulty).toBe('verydifficult');
  });

  it('leaves other levels of 0 and below unknown', () => {
    const row = stepRowModel(accept, 2, quest({ id: firstQuest, level: 0 }), 10);
    expect(row.quest?.level).toBeNull();
    expect(row.quest?.difficulty).toBeNull();
  });
});

describe('resolveActiveTarget', () => {
  const small = buildRouteView(notesRoute([null, 'g', 'g']), dataset, 1);
  const [a, b] = small.steps;
  if (a === undefined || b === undefined) throw new Error('fixture steps missing');

  it('follows the store focus by default', () => {
    expect(resolveActiveTarget(small, null, null)).toBe(NO_ACTIVE_TARGET);
    expect(resolveActiveTarget(small, null, a.id)).toEqual({ index: 0, step: a, number: 1, header: false });
    expect(resolveActiveTarget(small, null, b.id)).toEqual({ index: 2, step: b, number: 2, header: false });
  });

  it('keeps the row the list moved to while the focus it was set under holds', () => {
    const header = { key: 'group:g:s-b', focus: a.id };
    expect(resolveActiveTarget(small, header, a.id)).toEqual({ index: 1, step: b, number: 2, header: true });
    // The focus moved on (a command, undo, a click elsewhere): the focused step's row wins.
    expect(resolveActiveTarget(small, header, b.id).index).toBe(2);
    // A remembered row that no longer exists falls back as well.
    expect(resolveActiveTarget(small, { key: 'gone', focus: a.id }, a.id).index).toBe(0);
  });
});

describe('slices and texts', () => {
  it('lists the quests the route acts on, once each, ascending', () => {
    const ids = routeQuestIds(route.steps);
    expect(ids.length).toBeGreaterThan(0);
    expect([...ids]).toEqual([...new Set(ids)].sort((x, y) => x - y));
    expect(routeQuestIds([])).toEqual([]);
  });

  it('compares arrays element by element', () => {
    expect(sameItems([1, 2], [1, 2])).toBe(true);
    expect(sameItems([1, 2], [2, 1])).toBe(false);
    expect(sameItems([1], [1, 1])).toBe(false);
    expect(sameItems([], [])).toBe(true);
  });

  it('gives placeholder data no build stamp, and real data its full identity', () => {
    const placeholder = dataBadgeDetail(dataset.identity);
    expect(placeholder.startsWith(PLACEHOLDER_DATA_NOTICE)).toBe(true);
    expect(placeholder).not.toMatch(/frame build/);
    const real: DatasetIdentity = {
      dataRevision: 'r-2026-10-01',
      frameBuild: '1.60.1.70009',
      upstreamCommit: 'b6f5b07b0acf',
      foreverContentVerified: false,
    };
    expect(dataBadgeDetail(real)).toBe(
      "Data revision r-2026-10-01, frame build 1.60.1.70009, QuestieDB commit b6f5b07b0acf. Forever content is not verified: every record's Forever status is unknown.",
    );
    expect(dataBadgeDetail({ ...real, foreverContentVerified: true })).toBe('Data revision r-2026-10-01, frame build 1.60.1.70009, QuestieDB commit b6f5b07b0acf.');
  });

  it('words selection counts', () => {
    expect(selectionMessage(0)).toBe('Selection cleared');
    expect(selectionMessage(1)).toBe('1 step selected');
    expect(selectionMessage(1200)).toBe('1,200 steps selected');
  });
});

describe('imported guide text (docs/RXP.md §12 row 32, UI-F7)', () => {
  function importedRoute(input: string): Route {
    const VIEW = fixtureView();
    const ctx = rxpTools.createRxpContext(VIEW, null);
    const built = rxpTools.rxpImportProject({ input, fileName: null, frame: 'forever' }, { guides: 'all', unknownQuests: 'warn' }, ctx, {
      identity: VIEW.identity,
      ids: sequentialIdSource(1),
      nowIso: '2026-09-26T00:00:00.000Z',
    });
    if (built === null) throw new Error('nothing imported');
    return built.project.route;
  }

  it('shows route rows, their spoken labels and map labels without colour tokens or escapes, and keeps the text as written', () => {
    for (const fixture of [fixture01, fixture02]) {
      const imported = importedRoute(fixture);
      const VIEW = fixtureView();
      const rows = buildRouteView(imported, VIEW, 1).rows;
      for (const row of rows) {
        const text = row.type === 'step' ? `${row.title} ${row.detail ?? ''}` : row.label;
        expect(text).not.toMatch(/\|c|\|r|\|T|RXP_[A-Z]+_/);
      }
      imported.steps.forEach((step, index) => {
        expect(mapStepLabel(step, index, VIEW)).not.toMatch(/\|c|\|r/);
      });
    }
    const imported = importedRoute(fixture01);
    const titles = buildRouteView(imported, fixtureView(), 1).rows.flatMap((row) => (row.type === 'step' ? [row.title] : []));
    expect(titles).toContain('Talk to Kaltunk');
    expect(titles).toContain('Hunt Mottled Boars south-east of the Den');
    // The step itself keeps the guide's text, so an unedited guide exports byte for byte.
    expect(imported.steps.some((step) => step.kind === 'note' && step.text === 'Talk to |cRXP_FRIENDLY_Kaltunk|r')).toBe(true);
  });
});
