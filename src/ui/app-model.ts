import type { RightTab } from '../app';
import { characterName } from '../app/character-names';
import { withChainLabel } from '../app/quest-chains';
import { SAMPLE_ORIGIN_REF } from '../app/sample-route';
import { routeGroup } from '../app/rules-exports';
import { effectiveQuestLevel, questDifficultyAt, stepQuestIds } from '../app/shell-support';
import { plainGuideText } from '../app/ui-text';
import type { DatasetIdentity, DatasetView, EntityRef, ObjectiveDef, PublishedPoint, QuestRecord, RecordProvenance, SpawnPoint } from '../domain/dataset';
import type { GroupId, QuestId, StepId, UiMapId } from '../domain/ids';
import type { Location } from '../domain/points';
import type { GrindTarget, Route, RouteStep, StepOrigin, TaxiNodeRef } from '../domain/route';
import { formatDuration, formatInteger, formatPercent, plural } from './lib/format';
import { NO_ISSUES } from './lib/issues';
import { type Readout, unknownReadout } from './lib/readout';
import { UNKNOWN_FOREVER_PROVENANCE, foreverProvenanceOf } from './markers/provenance';
import { STEP_KIND_LABELS } from './markers/StepTypeGlyph';
import type { GroupRowModel, RouteRowModel, StepRowModel } from './route/rows';
import type { SidePanelTabId } from './shell/SidePanel';

/**
 * View models for src/ui/App.tsx: route steps and dataset records mapped to the kit's row models
 * and to one-line texts. Pure functions of their inputs; no store, no React.
 */

/** Why derived numbers are unknown in Milestone 1. Shown as the reason of every `?`. */
export const SIMULATION_PENDING = 'Simulation arrives in Milestone 6';

export const PLACEHOLDER_DATA_NOTICE = 'Placeholder data — real Forever data arrives in Milestone 2';

/** The one visible key to every `?` in rows and the status bar (their reasons are tooltips). */
export const UNKNOWN_LEGEND = '? = unknown until simulation (Milestone 6)';

/** The legend's spoken form: screen readers may skip a bare question mark. */
export const UNKNOWN_LEGEND_SPOKEN = 'A question mark means unknown until simulation arrives in Milestone 6.';

const PANEL_TAB: Readonly<Record<RightTab, SidePanelTabId>> = {
  available: 'available',
  context: 'questLog',
  details: 'details',
  validation: 'validation',
};

const RIGHT_TAB: Readonly<Record<SidePanelTabId, RightTab>> = {
  available: 'available',
  questLog: 'context',
  details: 'details',
  validation: 'validation',
};

export const panelTabOf = (tab: RightTab): SidePanelTabId => PANEL_TAB[tab];
export const rightTabOf = (tab: SidePanelTabId): RightTab => RIGHT_TAB[tab];

// Names -----------------------------------------------------------------------------------------

/** "Orc Warrior" (the names live in app, where the sample route uses them too). */
export { characterName };

export function questName(dataset: DatasetView, id: QuestId): string {
  return dataset.quest(id)?.name ?? `Quest ${String(id)} (not in the dataset)`;
}

/** The quest's name with its chain position, `Cutting Teeth (2/3)` (src/app/quest-chains.ts); a quest in no chain has none. */
export function questTitle(dataset: DatasetView, id: QuestId): string {
  const record = dataset.quest(id);
  return record === undefined ? questName(dataset, id) : withChainLabel(dataset, id, record.name);
}

export function entityName(dataset: DatasetView, ref: EntityRef): string {
  switch (ref.kind) {
    case 'npc':
      return dataset.npc(ref.id)?.name ?? `NPC ${String(ref.id)}`;
    case 'object':
      return dataset.object(ref.id)?.name ?? `Object ${String(ref.id)}`;
    case 'item':
      return dataset.item(ref.id)?.name ?? `Item ${String(ref.id)}`;
  }
}

/** A spawn inside an instance (QuestieDB's `[-1, -1]` presence). */
const isInstanceSpawn = (spawn: SpawnPoint): boolean => !('space' in spawn.source) && spawn.source.kind === 'instance';

/**
 * Where an instance-presence spawn is, in words: `an instance (entrance in Westfall)`, or `an
 * instance` when the entrance is unknown. Its `uiMapId` is the entrance's (where its world point
 * is), never the zone the entity is in (M2 review COORD-2, code-F5).
 */
function instanceWhere(dataset: DatasetView, spawn: SpawnPoint): string {
  return spawn.uiMapId === null ? 'an instance' : `an instance (entrance in ${zoneLabel(dataset, spawn.uiMapId)})`;
}

/**
 * Where a quest is picked up, from its starters' spawns in order: the first spawn's zone name, or
 * `Inside an instance (entrance in The Barrens)` when that spawn is inside an instance; null when
 * no spawn says.
 */
export function questZoneName(dataset: DatasetView, quest: QuestRecord): string | null {
  for (const starter of quest.starters) {
    for (const spawn of dataset.spawns(starter)) {
      if (isInstanceSpawn(spawn)) return `Inside ${instanceWhere(dataset, spawn)}`;
      if (spawn.uiMapId === null) continue;
      const name = dataset.zone(spawn.uiMapId)?.name ?? null;
      if (name !== null) return name;
    }
  }
  return null;
}

export function objectiveText(dataset: DatasetView, objective: ObjectiveDef): string {
  const count = (n: number | null): string => (n === null ? ' (count unknown)' : ` × ${formatInteger(n)}`);
  switch (objective.kind) {
    case 'kill':
      return `Kill ${objective.label ?? entityName(dataset, { kind: 'npc', id: objective.npcId })}${count(objective.count)}`;
    case 'object':
      return `Use ${objective.label ?? entityName(dataset, { kind: 'object', id: objective.objectId })}${count(objective.count)}`;
    case 'item':
      return `Collect ${objective.label ?? entityName(dataset, { kind: 'item', id: objective.itemId })}${count(objective.count)}`;
    case 'reputation':
      return `Reach ${formatInteger(objective.value)} reputation with faction ${String(objective.factionId)}`;
    case 'killCredit':
      return `${objective.label ?? `Kill credit for ${entityName(dataset, { kind: 'npc', id: objective.rootNpcId })}`}${count(objective.count)}`;
    case 'spell':
      return objective.label ?? `Cast spell ${String(objective.spellId)}`;
    case 'event':
      return objective.text ?? 'Event objective';
  }
}

// Locations -------------------------------------------------------------------------------------

/** A UiMap's validated name, else its id. */
export function zoneLabel(dataset: DatasetView, id: UiMapId): string {
  return dataset.zone(id)?.name ?? `UiMap ${String(id)}`;
}

type UnmappedReason = Extract<PublishedPoint, { readonly kind: 'unmapped' }>['reason'];

const UNMAPPED_TEXT: Readonly<Record<UnmappedReason, string>> = {
  suppressed: 'an area no map shows',
  'instance-area': 'inside an instance, on no world map',
  'no-uimap': 'an area with no map',
};

/**
 * A world point with its axes named, `World map 1: X -500, Y -4000 yd` (Blizzard X north, Y west;
 * coordinates.md §2). The axes are always labelled, because RXP writes world points as `Y, X`
 * (coordinates.md §15) and an unlabelled pair reads either way (M2 review COORD-7).
 */
function worldPointText(mapId: number, x: string, y: string): string {
  return `World map ${String(mapId)}: X ${x}, Y ${y} yd`;
}

/**
 * A published point as zone name and percent, exactly as published (`Durotar 42.06, 68.33`).
 * Instance presence and unmapped areas say what they are instead of inventing a position.
 */
export function publishedPointText(dataset: DatasetView, point: PublishedPoint): string {
  if ('space' in point) {
    if (point.space === 'zone') {
      return `${zoneLabel(dataset, point.uiMapId)} ${String(point.x)}, ${String(point.y)}${point.frame === 'era' ? ' (Era frame)' : ''}`;
    }
    return worldPointText(point.mapId, String(point.x), String(point.y));
  }
  if (point.kind === 'instance') return `Inside an instance (area ${String(point.areaId)})`;
  return `Area ${String(point.areaId)} ${String(point.x)}, ${String(point.y)} (${UNMAPPED_TEXT[point.reason]})`;
}

/** A spawn: its published point, and for instance presence the entrance's zone when one is known. */
export function spawnText(dataset: DatasetView, spawn: SpawnPoint): string {
  const text = publishedPointText(dataset, spawn.source);
  if ('space' in spawn.source || spawn.source.kind !== 'instance') return text;
  return spawn.uiMapId === null ? `${text}, entrance unknown` : `${text}, entrance in ${zoneLabel(dataset, spawn.uiMapId)}`;
}

const KIND_WORD: Readonly<Record<EntityRef['kind'], string>> = { npc: 'NPC', object: 'object', item: 'item' };

/**
 * Where a quest giver or receiver is: `Gornek (NPC) · Durotar 42.06, 68.33`, with the number of
 * further spawns. Items have no spawns; an entity without a published point says so.
 */
export function entityWhereText(dataset: DatasetView, ref: EntityRef): string {
  const name = `${entityName(dataset, ref)} (${KIND_WORD[ref.kind]})`;
  if (ref.kind === 'item') return `${name} · an item, no map position`;
  const spawns = dataset.spawns(ref);
  const [first] = spawns;
  if (first === undefined) return `${name} · no published spawn`;
  const more = spawns.length > 1 ? ` (+${plural(spawns.length - 1, 'more spawn')})` : '';
  return `${name} · ${spawnText(dataset, first)}${more}`;
}

/** Where one spawn is, for the summary: its zone, `an instance (entrance in …)`, or `unmapped areas`. */
const spawnZone = (dataset: DatasetView, spawn: SpawnPoint): string => {
  if (isInstanceSpawn(spawn)) return instanceWhere(dataset, spawn);
  if (spawn.uiMapId !== null) return zoneLabel(dataset, spawn.uiMapId);
  return 'unmapped areas';
};

/**
 * The zones an entity spawns in, most spawns first: `45 spawns in Durotar`, `3 spawns in Durotar
 * and 1 in The Barrens`, `1 spawn in an instance (entrance in Westfall)`.
 */
export function spawnSummary(dataset: DatasetView, ref: EntityRef): string | null {
  const spawns = dataset.spawns(ref);
  if (spawns.length === 0) return null;
  const counts = new Map<string, number>();
  for (const spawn of spawns) {
    const where = spawnZone(dataset, spawn);
    counts.set(where, (counts.get(where) ?? 0) + 1);
  }
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([where, n], i) => (i === 0 ? `${plural(n, 'spawn')} in ${where}` : `${formatInteger(n)} in ${where}`));
  const shown = parts.slice(0, 3);
  const rest = parts.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${plural(rest, 'other zone')}`;
  return shown.length === 2 ? shown.join(' and ') : shown.join(', ');
}

/** Where an objective is done, from the dataset: its target's spawns, its item's drop sources, its event points. */
export function objectiveWhere(dataset: DatasetView, objective: ObjectiveDef): string | null {
  switch (objective.kind) {
    case 'kill':
      return spawnSummary(dataset, { kind: 'npc', id: objective.npcId });
    case 'killCredit':
      return spawnSummary(dataset, { kind: 'npc', id: objective.rootNpcId });
    case 'object':
      return spawnSummary(dataset, { kind: 'object', id: objective.objectId });
    case 'item': {
      const item = dataset.item(objective.itemId);
      if (item === undefined) return null;
      const sources = [
        ...item.dropNpcs.map((id) => entityName(dataset, { kind: 'npc', id })),
        ...item.dropObjects.map((id) => entityName(dataset, { kind: 'object', id })),
        ...item.dropItems.map((id) => entityName(dataset, { kind: 'item', id })),
      ];
      if (sources.length === 0) return 'No drop source in the dataset';
      const shown = sources.slice(0, 3).join(', ');
      return sources.length > 3 ? `From ${shown} and ${plural(sources.length - 3, 'other source')}` : `From ${shown}`;
    }
    case 'event': {
      const [first] = objective.points;
      if (first === undefined) return null;
      const more = objective.points.length > 1 ? ` (+${plural(objective.points.length - 1, 'more point')})` : '';
      return `${publishedPointText(dataset, first)}${more}`;
    }
    case 'reputation':
    case 'spell':
      return null;
  }
}

const UPSTREAM_DIFF_TEXT: Readonly<Record<RecordProvenance['upstreamDiff'], string>> = {
  era: 'Era baseline',
  'era-coords': 'Era baseline, coordinates re-projected for Forever',
  'forever-new': "New in QuestieDB's Forever data",
  'forever-changed': "Changed in QuestieDB's Forever data",
};

/** What QuestieDB says about a record (DATA_PROVENANCE §9.3), in words. A fact about the source, not about the game. */
export function upstreamProvenanceText(provenance: RecordProvenance): string {
  if (provenance.source === 'custom') return 'Custom: entered in this project';
  const correction = provenance.created ? '; created by a QuestieDB correction' : provenance.corrected ? '; changed by a QuestieDB correction' : '';
  return `${UPSTREAM_DIFF_TEXT[provenance.upstreamDiff]}${correction}`;
}

// Texts -----------------------------------------------------------------------------------------

/**
 * A point as authored: RXP lexemes when present, else the stored numbers. Zone lexemes are
 * `[x, y]` in written order; world lexemes are `[Y, X]` (RXP writes `UiMapID/instance,Y,X`,
 * coordinates.md §15), so they are swapped back and the axes named (`X -500.00, Y -4000.00`). A
 * world point that names its UiMap (an RXP world-form goto, a point picked on the map with its
 * zone hint) says it after: `World map 1: X -500, Y -4000 yd (Durotar)`.
 */
function pointText(location: Location, dataset: DatasetView): string {
  const p = location.source;
  if (p.space === 'zone') {
    const [x, y] = p.lexemes ?? [String(p.x), String(p.y)];
    const zone = dataset.zone(p.uiMapId)?.name ?? `UiMap ${String(p.uiMapId)}`;
    return `${zone} ${x}, ${y}${p.frame === 'era' ? ' (Era frame)' : ''}`;
  }
  const [x, y] = p.lexemes === null ? [String(p.x), String(p.y)] : [p.lexemes[1], p.lexemes[0]];
  const text = worldPointText(p.mapId, x, y);
  return p.uiMapId === null ? text : `${text} (${zoneLabel(dataset, p.uiMapId)})`;
}

/** The location's label, else its point. */
export function locationText(location: Location | null, dataset: DatasetView): string | null {
  if (location === null) return null;
  return location.label ?? pointText(location, dataset);
}

/** The label and the point, for Details. */
export function locationDetail(location: Location | null, dataset: DatasetView): string | null {
  if (location === null) return null;
  const point = pointText(location, dataset);
  return location.label === null ? point : `${location.label} · ${point}`;
}

export function grindTargetText(until: GrindTarget): string {
  if (until.kind === 'duration') return `For ${formatDuration(until.seconds)}`;
  const offset = until.offset;
  if (offset === null) return `Until level ${String(until.level)}`;
  switch (offset.kind) {
    case 'xpInto':
      return `Until level ${String(until.level)} + ${formatInteger(offset.xp)} XP`;
    case 'xpShort':
      return `Until ${formatInteger(offset.xp)} XP short of level ${String(until.level)}`;
    case 'fraction':
      // formatPercent guards the float error: 0.29 * 100 is 28.999999999999996.
      return `Until level ${String(until.level)} and ${formatPercent(offset.fraction)}`;
  }
}

const nodeName = (node: TaxiNodeRef | null, query: string | null): string | null => node?.name ?? query;

/**
 * The one-line title of a step, as plain text: RXP colour tokens and the game's colour and texture
 * escapes in imported guide text are removed for display (`plainGuideText`, docs/RXP.md §12 row
 * 32); the step keeps its text as written, for export.
 */
export function stepTitle(step: RouteStep, dataset: DatasetView): string {
  const plain = plainGuideText(rawStepTitle(step, dataset));
  // A note of nothing but icon or colour codes still says what it is.
  return plain === '' ? '(note with only icon or colour codes)' : plain;
}

function rawStepTitle(step: RouteStep, dataset: DatasetView): string {
  switch (step.kind) {
    case 'accept':
    case 'turnin':
    case 'abandon':
      return questTitle(dataset, step.questId);
    case 'complete': {
      const parts = step.targets.map((t) =>
        t.objective === null ? questTitle(dataset, t.questId) : `${questTitle(dataset, t.questId)} (objective ${String(t.objective + 1)})`,
      );
      const text = parts.length === 0 ? 'No objectives set' : parts.join(' + ');
      return step.progress === 'partial' ? `Partly: ${text}` : text;
    }
    case 'travel': {
      const to = locationText(step.location, dataset);
      const how = step.mode === 'auto' ? '' : ` (${step.mode})`;
      return to === null ? `Travel to an unknown place${how}` : `To ${to}${how}`;
    }
    case 'grind':
      return grindTargetText(step.until);
    case 'hearth':
      return step.mode === 'use' ? 'Use hearthstone' : 'Set hearthstone';
    case 'flight': {
      const name = nodeName(step.to, step.nodeQuery);
      if (step.mode === 'discover') return name === null ? 'Discover flight path' : `Discover flight path: ${name}`;
      return name === null ? 'Fly (destination not set)' : `Fly to ${name}`;
    }
    case 'train':
      return step.what ?? (step.skill === null ? 'Train' : `Train ${step.skill}`);
    case 'vendor':
      return step.what ?? 'Visit a vendor';
    case 'note':
      return step.text.trim() === '' ? '(empty note)' : step.text;
  }
}

/** A step's hover text on the map: `12 · Accept quest: Your Place in the World` (the map controller's `describeStep`). */
export function mapStepLabel(step: RouteStep, index: number, dataset: DatasetView): string {
  return `${formatInteger(index + 1)} · ${STEP_KIND_LABELS[step.kind]}: ${stepTitle(step, dataset)}`;
}

/** Dimmed text after the title: where the step happens (travel titles already say it). Plain text, as `stepTitle`. */
export function stepDetail(step: RouteStep, dataset: DatasetView): string | null {
  if (step.kind === 'travel') return null;
  const text = locationText(step.location, dataset);
  return text === null ? null : plainGuideText(text);
}

export function originText(origin: StepOrigin): string {
  const from = origin.ref === null ? '' : ` of ${origin.ref}`;
  switch (origin.source) {
    case 'manual':
      return origin.ref === SAMPLE_ORIGIN_REF ? 'Generated for the sample route' : 'Added by hand';
    case 'rxp':
      return origin.ref === null ? 'Imported from an RXP guide' : `Imported from an RXP guide (${origin.ref})`;
    case 'optimizer':
      return 'Proposed by the optimiser';
    case 'duplicate':
      return `Duplicate${from}`;
    case 'paste':
      return `Pasted copy${from}`;
  }
}

// Route rows ------------------------------------------------------------------------------------

export interface RouteView {
  /** The steps the rows were built from (the route's, in order). */
  readonly steps: readonly RouteStep[];
  readonly rows: readonly RouteRowModel[];
  /** The steps each row stands for: one for a step row, the whole run for a group header. */
  readonly rowSteps: readonly (readonly StepId[])[];
  readonly rowOfKey: ReadonlyMap<string, number>;
  readonly rowOfStep: ReadonlyMap<StepId, number>;
  /** 1-based step number by id. */
  readonly numberOfStep: ReadonlyMap<StepId, number>;
}

function groupLabel(route: Route, groupKey: GroupId, importNames: ReadonlyMap<string, string>): string {
  // routeGroup reads own keys only: a group id such as "toString" is never Object.prototype's.
  const rxp = routeGroup(route, groupKey)?.rxp ?? null;
  if (rxp === null) return 'Step group';
  // A guide's #name may carry colour tokens (RXP's #displayname does): shown plain.
  const name = plainGuideText(importNames.get(rxp.importId) ?? 'RXP guide');
  return `${name}, step ${String(rxp.stepIndex + 1)}`;
}

/**
 * The row model of one step. Quest difficulty is taken at `playerLevel` (the character's start
 * level until simulation exists), which is a lower bound for the level at the step, so it is
 * always marked uncertain. A scaling quest shows its effective level at `playerLevel` (QXP-7).
 * The level after the step stays unknown.
 */
export function stepRowModel(step: RouteStep, number: number, dataset: DatasetView, playerLevel: number | null): StepRowModel {
  const firstQuest = stepQuestIds(step)[0];
  const record = firstQuest === undefined ? undefined : dataset.quest(firstQuest);
  const questLevel = record?.level ?? null;
  const minLevel = record?.minLevel ?? null;
  const level = effectiveQuestLevel(playerLevel, questLevel, minLevel);
  const projectedLevel: Readout<number> = unknownReadout(SIMULATION_PENDING);
  return {
    type: 'step',
    key: step.id,
    number,
    kind: step.kind,
    title: stepTitle(step, dataset),
    detail: stepDetail(step, dataset),
    projectedLevel,
    quest:
      firstQuest === undefined
        ? null
        : {
            level,
            difficulty: questDifficultyAt(playerLevel, questLevel, minLevel),
            uncertain: true,
            provenance: record === undefined ? UNKNOWN_FOREVER_PROVENANCE : foreverProvenanceOf(record.provenance),
          },
    issues: NO_ISSUES,
    locked: step.locked,
  };
}

/**
 * Rows for the route list: every step, with a header row before each contiguous run of steps
 * that share a group (a group split by editing gets a header per run).
 */
export function buildRouteView(
  route: Route,
  dataset: DatasetView,
  playerLevel: number | null,
  importNames: ReadonlyMap<string, string> = new Map(),
): RouteView {
  const rows: RouteRowModel[] = [];
  const rowSteps: StepId[][] = [];
  const rowOfKey = new Map<string, number>();
  const rowOfStep = new Map<StepId, number>();
  const numberOfStep = new Map<StepId, number>();
  const steps = route.steps;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const group = step.groupId;
    if (group !== null && steps[i - 1]?.groupId !== group) {
      const run: StepId[] = [];
      for (let j = i; j < steps.length && steps[j]?.groupId === group; j += 1) {
        const member = steps[j];
        if (member !== undefined) run.push(member.id);
      }
      const header: GroupRowModel = {
        type: 'group',
        key: `group:${group}:${step.id}`,
        label: groupLabel(route, group, importNames),
        stepCount: run.length,
      };
      rowOfKey.set(header.key, rows.length);
      rows.push(header);
      rowSteps.push(run);
    }
    numberOfStep.set(step.id, i + 1);
    rowOfStep.set(step.id, rows.length);
    rowOfKey.set(step.id, rows.length);
    rows.push(stepRowModel(step, i + 1, dataset, playerLevel));
    rowSteps.push([step.id]);
  }
  return { steps, rows, rowSteps, rowOfKey, rowOfStep, numberOfStep };
}

/** Row keys to show as selected: step rows in the selection, and headers whose whole run is. */
export function selectedRowKeys(view: RouteView, selected: ReadonlySet<StepId>): ReadonlySet<string> {
  const keys = new Set<string>();
  if (selected.size === 0) return keys;
  view.rows.forEach((row, i) => {
    const ids = view.rowSteps[i] ?? [];
    if (ids.length > 0 && ids.every((id) => selected.has(id))) keys.add(row.key);
  });
  return keys;
}

/**
 * Where a drag and drop moves the `moving` steps, as a `toIndex` in the step list without them.
 * `from` is the dragged row and `to` the row index it lands at after the move (RouteList's
 * `onDrop` convention), so the gap it was dropped into is `to + 1` when moving down, else `to`.
 * The result counts the steps above that gap that are not moving; header rows count nothing.
 */
export function dropToIndex(view: RouteView, moving: ReadonlySet<StepId>, from: number, to: number): number {
  const slot = to > from ? to + 1 : to;
  let index = 0;
  for (let row = 0; row < slot && row < view.rows.length; row += 1) {
    if (view.rows[row]?.type !== 'step') continue;
    const id = view.rowSteps[row]?.[0];
    if (id !== undefined && !moving.has(id)) index += 1;
  }
  return index;
}

// Active row --------------------------------------------------------------------------------------

/** The row that holds keyboard focus in the list, remembered with the store focus it was set under. */
export interface ActiveRow {
  readonly key: string;
  readonly focus: StepId | null;
}

export interface ActiveTarget {
  /** Row index in the route view, or null when no row is active. */
  readonly index: number | null;
  /** The step Details, the status bar and the map show: the active row's (first) step. */
  readonly step: RouteStep | null;
  /** 1-based number of `step`, 0 when there is none. */
  readonly number: number;
  /** The active row is a group header (Details shows its first step). */
  readonly header: boolean;
}

export const NO_ACTIVE_TARGET: ActiveTarget = { index: null, step: null, number: 0, header: false };

/**
 * The active row: the one the list last moved to, while the store focus is still the one it was
 * set under; otherwise the row of the focused step (after commands, undo, clicks elsewhere).
 */
export function resolveActiveTarget(view: RouteView, activeRow: ActiveRow | null, focus: StepId | null): ActiveTarget {
  const local = activeRow !== null && activeRow.focus === focus ? (view.rowOfKey.get(activeRow.key) ?? null) : null;
  const index = local ?? (focus === null ? null : (view.rowOfStep.get(focus) ?? null));
  if (index === null) return NO_ACTIVE_TARGET;
  const first = view.rowSteps[index]?.[0];
  const number = first === undefined ? 0 : (view.numberOfStep.get(first) ?? 0);
  const step = view.steps[number - 1];
  return { index, step: step ?? null, number: step === undefined ? 0 : number, header: view.rows[index]?.type === 'group' };
}

// Slices ------------------------------------------------------------------------------------------

/** Element-wise equality, for selectors that build a new array on every call. */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
}

/** The quests the route acts on, ascending and without repeats. */
export function routeQuestIds(steps: readonly RouteStep[]): readonly QuestId[] {
  return [...new Set(steps.flatMap(stepQuestIds))].sort((a, b) => a - b);
}

// Texts for the status bar and announcements ----------------------------------------------------

/**
 * The data badge's tooltip. Placeholder data has no frame build or upstream commit, so none is
 * printed: synthetic records must not carry a real-looking build stamp.
 */
export function dataBadgeDetail(identity: DatasetIdentity): string {
  if (identity.dataRevision === 'placeholder') {
    return `${PLACEHOLDER_DATA_NOTICE}. The records are invented, not taken from any game build or QuestieDB commit.`;
  }
  const verified = identity.foreverContentVerified ? '' : " Forever content is not verified: every record's Forever status is unknown.";
  return `Data revision ${identity.dataRevision}, frame build ${identity.frameBuild}, QuestieDB commit ${identity.upstreamCommit}.${verified}`;
}

/** The data badge's label: the first 8 hex digits of the revision (the tooltip has all of it). */
export function dataBadgeLabel(identity: DatasetIdentity): string {
  return identity.dataRevision === 'placeholder' ? 'placeholder' : identity.dataRevision.slice(0, 8);
}

/** What the live region says after a selection change (debounced by the caller). */
export function selectionMessage(count: number): string {
  return count === 0 ? 'Selection cleared' : `${plural(count, 'step')} selected`;
}
