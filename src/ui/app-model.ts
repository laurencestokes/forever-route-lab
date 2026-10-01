import type { RightTab } from '../app';
import { characterName } from '../app/character-names';
import { questChainPosition, withChainLabel } from '../app/quest-chains';
import { routeGroup } from '../app/rules-exports';
import { effectiveQuestLevel, questDifficultyAt, stepQuestIds } from '../app/shell-support';
import { plainGuideText } from '../app/ui-text';
import type { DatasetIdentity, DatasetView, EntityRef, PublishedPoint, QuestRecord, SpawnPoint } from '../domain/dataset';
import type { GroupId, QuestId, StepId, UiMapId } from '../domain/ids';
import type { Location } from '../domain/points';
import type { GrindTarget, Route, RouteStep, TaxiNodeRef } from '../domain/route';
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

/**
 * Why derived numbers are unknown where no route simulation is connected (component tests, a view
 * without one). With one, the reasons come from its state (src/ui/app/derived-view.ts).
 */
export const NOT_SIMULATED = 'Not simulated: no route simulation is connected';

export const PLACEHOLDER_DATA_NOTICE = 'Placeholder data — real Forever data arrives in Milestone 2';

/** The visible key to the marks on numbers in rows and the status bar (each mark's reason is its tooltip). */
export const ESTIMATE_LEGEND = ['? unknown', '≈ assumed', 'E Era value', 'time pending'] as const;

/** The legend's spoken form: screen readers may skip a bare question mark or glyph. */
export const ESTIMATE_LEGEND_SPOKEN =
  'Key to the marks on numbers: a question mark means unknown, with the reason in its tooltip; ≈ means the number depends on assumptions; ' +
  'a boxed E means Era values stand in for unknown Forever values; an hourglass beside a step time means its travel is a straight-line estimate for now, while its walking path is computed or the navigation data is checked.';

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
export const isInstanceSpawn = (spawn: SpawnPoint): boolean => !('space' in spawn.source) && spawn.source.kind === 'instance';

/**
 * Where an instance-presence spawn is, in words: `an instance (entrance in Westfall)`, or `an
 * instance` when the entrance is unknown. Its `uiMapId` is the entrance's (where its world point
 * is), never the zone the entity is in (M2 review COORD-2, code-F5).
 */
export function instanceWhere(dataset: DatasetView, spawn: SpawnPoint): string {
  return spawn.uiMapId === null ? 'an instance' : `an instance (entrance in ${zoneLabel(dataset, spawn.uiMapId)})`;
}

/**
 * Every place a quest is picked up, from its starters' spawns in order, each once: a zone name, or
 * `Inside an instance (entrance in The Barrens)` for a spawn inside an instance.
 */
export function questPlaces(dataset: DatasetView, quest: QuestRecord): readonly { readonly uiMapId: UiMapId | null; readonly text: string }[] {
  const out: { uiMapId: UiMapId | null; text: string }[] = [];
  const seen = new Set<string>();
  for (const starter of quest.starters) {
    for (const spawn of dataset.spawns(starter)) {
      const place = isInstanceSpawn(spawn)
        ? { uiMapId: null, text: `Inside ${instanceWhere(dataset, spawn)}` }
        : spawn.uiMapId === null
          ? null
          : { uiMapId: spawn.uiMapId, text: dataset.zone(spawn.uiMapId)?.name ?? null };
      if (place === null || place.text === null || seen.has(place.text)) continue;
      seen.add(place.text);
      out.push({ uiMapId: place.uiMapId, text: place.text });
    }
  }
  return out;
}

/**
 * Where a quest is picked up, from its starters' spawns in order: the first place's name (a zone, or
 * `Inside an instance (entrance in The Barrens)`); null when no spawn says. When the starters spawn
 * in several places it says so, `Dun Morogh and 6 other zones`, so a row never names one of them as
 * the only one (review finding QA-20: the Horde copy of Winter's Presents showed only its giver's
 * Dun Morogh spawn). `prefer` names first the first place the first of its tests accepts, then the
 * second's, and so on: the character's start zone, then a zone on its start continent
 * (`startZonePreference`), or a zone on the character's side when the caller knows the zones'
 * factions (the client zone table, D-039 C).
 */
export function questZoneName(dataset: DatasetView, quest: QuestRecord, prefer?: ZonePreference): string | null {
  const places = questPlaces(dataset, quest);
  const tests = prefer === undefined ? [] : typeof prefer === 'function' ? [prefer] : prefer;
  let first: (typeof places)[number] | undefined;
  for (const test of tests) {
    first = places.find((p) => p.uiMapId !== null && test(p.uiMapId));
    if (first !== undefined) break;
  }
  first ??= places[0];
  if (first === undefined) return null;
  const others = places.filter((p) => p !== first);
  if (others.length === 0) return first.text;
  const noun = others.every((p) => p.uiMapId !== null) ? (others.length === 1 ? 'zone' : 'zones') : others.length === 1 ? 'place' : 'places';
  return `${first.text} and ${String(others.length)} other ${noun}`;
}

/** Which places `questZoneName` names first: one test, or several in order. */
export type ZonePreference = ((uiMapId: UiMapId) => boolean) | readonly ((uiMapId: UiMapId) => boolean)[];

/**
 * The character's side as far as the shell knows it without route state (review QA-20): its start
 * zone first, then any zone on its start's world map; none without a start location.
 */
export function startZonePreference(dataset: Pick<DatasetView, 'zone'>, start: Location | null): ZonePreference | undefined {
  const source = start?.source ?? null;
  if (source === null) return undefined;
  const zone = source.uiMapId;
  const mapId = source.space === 'world' ? source.mapId : (dataset.zone(source.uiMapId)?.worldMapId ?? null);
  const tests: ((uiMapId: UiMapId) => boolean)[] = [];
  if (zone !== null) tests.push((id) => id === zone);
  if (mapId !== null) tests.push((id) => dataset.zone(id)?.worldMapId === mapId);
  return tests.length === 0 ? undefined : tests;
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

/**
 * Where a step happens, in words: the place's label and its point ("Kaltunk · Durotar 43.3, 68.5",
 * the NPC and the zone of a quest step), plain text as `stepTitle`. Null for travel (its title names
 * the destination) and for a step without a location. Line 2 of a two-line route row, formatted only
 * for the rows in view (`createRowDeriver`'s line-2 cache).
 */
export function stepDetail(step: RouteStep, dataset: DatasetView): string | null {
  if (step.kind === 'travel') return null;
  const text = locationDetail(step.location, dataset);
  return text === null ? null : plainGuideText(text);
}

/**
 * Line 2's short place (docs/research/ui-refresh.md §6.1; review UI-01): the location's label (the
 * NPC or object) and its zone's name, without the coordinates, so the zone fits beside the chip and
 * the row actions at a 340 px panel. `stepDetail` keeps the whole ("Kaltunk · Durotar 43.3, 68.5")
 * for the row's tooltip and name. Null for a travel step, no location, or a point with neither.
 */
export function stepPlace(step: RouteStep, dataset: DatasetView): { readonly lead: string | null; readonly zone: string | null } | null {
  if (step.kind === 'travel' || step.location === null) return null;
  const location = step.location;
  const uiMapId = location.source.uiMapId;
  const zone = uiMapId === null ? null : (dataset.zone(uiMapId)?.name ?? null);
  const label = location.label === null ? null : plainGuideText(location.label);
  const lead = label === '' ? null : label;
  return lead === null && zone === null ? null : { lead, zone };
}

/** A route row's words: the verb, what it acts on, and a quest's chain position (docs/research/ui-refresh.md §6.1). */
export interface RowWords {
  readonly verb: string;
  readonly title: string;
  readonly chain: { readonly index: number; readonly length: number } | null;
}

/** A quest's name for a row (its chain position is said apart). */
function rowQuestName(dataset: DatasetView, id: QuestId): string {
  return dataset.quest(id)?.name ?? questName(dataset, id);
}

function chainOf(dataset: DatasetView, id: QuestId): RowWords['chain'] {
  const position = questChainPosition(dataset, id);
  return position === null ? null : { index: position.index, length: position.length };
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * A route row's line 1, verb first (D-048 A; review UO-07): "Accept" Your Place in the World,
 * "Travel" to Razor Hill, "Grind" for 15m 00s. The title reads after the verb and after the kind's
 * spoken label alike ("Travel: to Razor Hill"). Plain text, as `stepTitle`; the chain label is apart.
 */
export function stepRowWords(step: RouteStep, dataset: DatasetView): RowWords {
  const words = rawRowWords(step, dataset);
  const plain = plainGuideText(words.title);
  if (plain === words.title) return words;
  return { ...words, title: plain === '' ? '(note with only icon or colour codes)' : plain };
}

function rawRowWords(step: RouteStep, dataset: DatasetView): RowWords {
  switch (step.kind) {
    case 'accept':
      return { verb: 'Accept', title: rowQuestName(dataset, step.questId), chain: chainOf(dataset, step.questId) };
    case 'turnin':
      return { verb: 'Turn in', title: rowQuestName(dataset, step.questId), chain: chainOf(dataset, step.questId) };
    case 'abandon':
      return { verb: 'Abandon', title: rowQuestName(dataset, step.questId), chain: chainOf(dataset, step.questId) };
    case 'complete': {
      const [only] = step.targets;
      const parts = step.targets.map((t) =>
        t.objective === null ? rowQuestName(dataset, t.questId) : `${rowQuestName(dataset, t.questId)} (objective ${String(t.objective + 1)})`,
      );
      const text = parts.length === 0 ? 'no objectives set' : parts.join(' + ');
      const chain = step.targets.length === 1 && only !== undefined ? chainOf(dataset, only.questId) : null;
      return { verb: 'Complete', title: step.progress === 'partial' ? `part of ${text}` : text, chain };
    }
    case 'travel': {
      const to = locationText(step.location, dataset);
      const how = step.mode === 'auto' ? '' : ` (${step.mode})`;
      return { verb: 'Travel', title: to === null ? `to an unknown place${how}` : `to ${to}${how}`, chain: null };
    }
    case 'grind':
      return { verb: 'Grind', title: lowerFirst(grindTargetText(step.until)), chain: null };
    case 'hearth':
      return step.mode === 'use' ? { verb: 'Hearth', title: 'to the bind point', chain: null } : { verb: 'Set', title: 'the bind point here', chain: null };
    case 'flight': {
      const name = nodeName(step.to, step.nodeQuery);
      if (step.mode === 'discover') return { verb: 'Discover', title: name === null ? 'a flight path' : `flight path: ${name}`, chain: null };
      return { verb: 'Fly', title: name === null ? '(destination not set)' : `to ${name}`, chain: null };
    }
    case 'train':
      return { verb: 'Train', title: step.what ?? step.skill ?? '(what not set)', chain: null };
    case 'vendor':
      return { verb: 'Buy', title: step.what ?? '(what not set)', chain: null };
    case 'note':
      return { verb: 'Note', title: step.text.trim() === '' ? '(empty note)' : step.text, chain: null };
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
  // The step number leads, so headers of one guide tell apart before the ellipsis (review QA-17); the guide's name follows.
  return `RXP step ${String(rxp.stepIndex + 1)} · ${name}`;
}

/** What a row says before the walk's numbers fill it in (`RouteList deriveRow`). */
const NOT_SIMULATED_READOUT: Readout<number> = unknownReadout(NOT_SIMULATED);

/**
 * The row model of one step, from the route and the dataset alone. Quest difficulty is taken at
 * `playerLevel` (the character's start level), which is a lower bound for the level at the step,
 * so it is marked uncertain. A scaling quest shows its effective level at `playerLevel` (QXP-7).
 * The estimates are unknown here: the walk's numbers, the difficulty at the level the step starts
 * at, the mark's state, the worst issue and line 2's words are filled in as the row renders
 * (src/ui/app/derived-view.ts `createRowDeriver`), so a new walk never rebuilds the rows and a route
 * edit formats no place names.
 */
export function stepRowModel(step: RouteStep, number: number, dataset: DatasetView, playerLevel: number | null): StepRowModel {
  const firstQuest = stepQuestIds(step)[0];
  const record = firstQuest === undefined ? undefined : dataset.quest(firstQuest);
  const questLevel = record?.level ?? null;
  const minLevel = record?.minLevel ?? null;
  const level = effectiveQuestLevel(playerLevel, questLevel, minLevel);
  const words = stepRowWords(step, dataset);
  return {
    type: 'step',
    key: step.id,
    number,
    kind: step.kind,
    verb: words.verb,
    title: words.title,
    chain: words.chain,
    detail: null,
    projectedLevel: NOT_SIMULATED_READOUT,
    duration: NOT_SIMULATED_READOUT,
    xpGained: NOT_SIMULATED_READOUT,
    pending: null,
    assumptions: null,
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
    issue: null,
    // Before the walk nothing is known at the step: "not sure" for an accept, readiness unknown for a turn-in.
    mark: step.kind === 'accept' ? 'uncertain' : step.kind === 'turnin' ? 'record-unknown' : null,
    levelUp: null,
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
        imported: (routeGroup(route, group)?.rxp ?? null) !== null,
        levelSpan: null,
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
