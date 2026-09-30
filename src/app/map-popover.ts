import type { DatasetView, QuestRecord } from '../domain/dataset';
import type { QuestId, StepId, UiMapId } from '../domain/ids';
import { worldSourcedPoint, type Location, type WorldPoint } from '../domain/points';
import type { TaxiNodeRef } from '../domain/route';
import { makeFlightStep, makeHearthStep, makeTrainStep, makeTravelStep, makeVendorStep } from '../domain/step-factory';
import type { MapRef, PlaceItem, PlaceLayerInput, ServiceKind } from '../map/adapter';
import type { Difficulty } from '../rules/difficulty';
import { TRANSPORT_SEEDS } from '../rules/travel-seeds';
import { type Command, insertStep } from './commands';
import type { MapPopoverTarget } from './map-controller';
import type { PlacesModel } from './map-places';
import type { QuestStateEntry, QuestStateModel } from './quest-state';
import type { QuestStepPart } from './quest-steps';

/**
 * The map popover's content (docs/research/map-presentation.md §14.2, §8.5, §11; docs/UI.md §9 rule
 * 15; D-041 J; step MP.6): what a click on a pin, a stack or a point offers, as plain data the UI
 * draws (`src/ui/shell/MapPopover.tsx`) and runs. Built in the UI's lazy part when the popover opens,
 * from the controller's target (`MapPopoverTarget`), the dataset, the quest state and the places.
 *
 * - **Quests** (givers, turn-ins, objectives, a dungeon's quests inside): each with its state words,
 *   level and difficulty (for `DifficultyLabel`), the dataset's XP (Era, so marked so) and its
 *   provenance; "Accept", "Complete objectives" or "Turn in" after the step, the likely one primary
 *   (ui-refresh.md §7.2); "Show in Details"; "Open on Wowhead", marked external (D-041 J).
 * - **Flight points**: "Add flight from here" (a flight to be chosen in Details).
 * - **Dungeons** (§8.5): the entrance's instances, then their quests in the log or available.
 * - **Transport stops** (§10): "Add transport" where the stop's service is inferred; a stop of an
 *   unknown service is never used for a route, and says so.
 * - **Services** (§11): "Set hearth here", "Train here", "Buy here".
 * - **Any point**: "Go here" (a travel step to it), and "Fly from the nearest known flight point"
 *   (a flight from the known flight point nearest the character after the step to the known one
 *   nearest the point, both named).
 * - **A stack of steps**: each step, "Select step N", and "Select all".
 *
 * Every insert is the editor's insert-after-selection command (`Command`), announced by the UI as
 * the other inserts are. Nothing is invented: an unknown record, position or service is said, and its
 * action is unavailable with the reason.
 */

export type PopoverCommand =
  | { readonly kind: 'add-quest'; readonly questId: QuestId; readonly parts: readonly QuestStepPart[] }
  | { readonly kind: 'details'; readonly questIds: readonly QuestId[] }
  | { readonly kind: 'select'; readonly stepIds: readonly StepId[] }
  | { readonly kind: 'insert'; readonly command: Command }
  | { readonly kind: 'link'; readonly href: string }
  /** An unavailable action's: nothing runs. */
  | { readonly kind: 'none' };

export interface PopoverAction {
  /** Unique within the popover. */
  readonly key: string;
  readonly label: string;
  /**
   * The accessible name when the label does not say which quest it acts on (a stack's sections all
   * read "Accept after step 28"; review QA-18): "Accept Isha Awak after step 28". Omitted: the label.
   */
  readonly name?: string;
  /** `primary`: the one likely action of its section; `external`: a link to another site (opens a new tab). */
  readonly variant: 'primary' | 'default' | 'external';
  /** Why it cannot run now (then `aria-disabled`, with this as its description); null when it can. */
  readonly unavailable: string | null;
  readonly command: PopoverCommand;
}

export interface PopoverQuest {
  readonly questId: QuestId;
  /** The quest's level for the character, or null when unknown. */
  readonly level: number | null;
  readonly difficulty: Difficulty | null;
  /** The character's level is a lower bound (the chip's dashed edge). */
  readonly lowerBound: boolean;
  /** The dataset's quest XP with its basis (Era values unless entered or observed), or null when it has none. */
  readonly xp: QuestRecord['xp'];
  readonly provenance: QuestRecord['provenance'] | null;
}

export interface PopoverSection {
  readonly key: string;
  readonly heading: string;
  /** A quest's facts for its chips; null for a place, a step or a point. */
  readonly quest: PopoverQuest | null;
  /** Its state and where it is, in words. */
  readonly lines: readonly string[];
  readonly actions: readonly PopoverAction[];
}

export interface PopoverModel {
  /** The popover's name ("Quests at Gornek", "Flight point: Orgrimmar", "Here: Durotar"). */
  readonly title: string;
  readonly sections: readonly PopoverSection[];
  /** Actions for the whole point ("Go here after step 12", "Select all 3 steps"). */
  readonly footer: readonly PopoverAction[];
}

export interface PopoverContext {
  readonly dataset: DatasetView;
  readonly questState: QuestStateModel | null;
  readonly places: PlacesModel | null;
  /** Where the inserts go, in words: "after step 12", or "at the start of the route". */
  readonly after: string;
  /** Why the route cannot be edited now (every insert action then says so); null when it can. */
  readonly locked: string | null;
  /** A zone's name, for an empty point's title. */
  readonly zoneName: (id: UiMapId) => string | null;
  /** A step's number in the route, or null when it has left it. */
  readonly stepNumber: (id: StepId) => number | null;
}

/** The quest's page on Wowhead (D-041 J): only its id goes in the address. */
export const wowheadQuestUrl = (id: QuestId): string => `https://www.wowhead.com/classic/quest=${String(id)}`;

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

type Role = 'giver' | 'turn-in' | 'objective' | 'inside';

/** The part a quest's likely next action adds (ui-refresh.md §7.2), or null when none is likely. */
function likelyPart(entry: QuestStateEntry | null, role: Role): QuestStepPart | null {
  if (entry === null) return role === 'giver' ? 'accept' : role === 'turn-in' ? 'turnin' : 'complete';
  switch (entry.cls) {
    case 'in-log':
      return entry.turnIn?.kind === 'ready' ? 'turnin' : 'complete';
    case 'available':
    case 'low-level':
    case 'uncertain-level':
    case 'uncertain-history':
    case 'uncertain-other':
      return 'accept';
    // Nothing is likely: done, or not takeable now (the reason says why).
    case 'done':
    case 'locked':
    case 'unlocks-soon':
    case 'outside':
      return null;
  }
}

const PART_WORDS: Readonly<Record<QuestStepPart, string>> = { accept: 'Accept', complete: 'Complete objectives', turnin: 'Turn in' };

function questSection(ctx: PopoverContext, questId: QuestId, role: Role, where: string | null): PopoverSection {
  const quest = ctx.dataset.quest(questId);
  const entry = ctx.questState?.quests.get(questId) ?? null;
  const insert = (part: QuestStepPart, primary: boolean): PopoverAction => ({
    key: `quest:${String(questId)}:${part}`,
    label: `${PART_WORDS[part]} ${ctx.after}`,
    name: `${PART_WORDS[part]} ${quest?.name ?? `quest ${String(questId)}`} ${ctx.after}`,
    variant: primary ? 'primary' : 'default',
    unavailable: ctx.locked,
    command: { kind: 'add-quest', questId, parts: [part] },
  });
  if (quest === undefined) {
    return {
      key: `quest:${String(questId)}`,
      heading: `Quest ${String(questId)}`,
      quest: null,
      lines: ['Not in the dataset: nothing is known about it'],
      actions: [],
    };
  }
  const likely = likelyPart(entry, role);
  const parts: QuestStepPart[] = [];
  if (entry?.cls === 'in-log') parts.push('complete', 'turnin');
  else if (entry?.cls !== 'done') {
    if (role === 'turn-in') parts.push('turnin');
    else if (role === 'objective') parts.push('complete');
    else parts.push('accept');
  }
  const actions: PopoverAction[] = parts.map((part) => insert(part, part === likely));
  actions.push({ key: `quest:${String(questId)}:details`, label: 'Show in Details', name: `Show ${quest.name} in Details`, variant: 'default', unavailable: null, command: { kind: 'details', questIds: [questId] } });
  if (quest.provenance.source !== 'custom') {
    actions.push({ key: `quest:${String(questId)}:wowhead`, label: 'Open on Wowhead', name: `Open ${quest.name} on Wowhead`, variant: 'external', unavailable: null, command: { kind: 'link', href: wowheadQuestUrl(questId) } });
  }
  const lines: string[] = [];
  if (entry !== null) lines.push(entry.reason);
  else if (ctx.questState === null) lines.push('No route state yet: its state at the step is not known');
  if (where !== null) lines.push(where);
  return {
    key: `quest:${String(questId)}`,
    heading: quest.name,
    quest: {
      questId,
      level: entry?.level ?? quest.level,
      difficulty: entry?.difficulty ?? null,
      lowerBound: ctx.questState?.levelLowerBound ?? false,
      xp: quest.xp,
      provenance: quest.provenance,
    },
    lines,
    actions,
  };
}

const locationOf = (point: WorldPoint, uiMapId: UiMapId | null, label: string | null): Location => ({
  source: worldSourcedPoint(point.mapId, point.x, point.y, uiMapId),
  label,
  radius: null,
});

const insertAction = (ctx: PopoverContext, key: string, label: string, command: Command, variant: PopoverAction['variant'] = 'default'): PopoverAction => ({
  key,
  label,
  variant,
  unavailable: ctx.locked,
  command: { kind: 'insert', command },
});

/** The place item a ref stands for in a place layer (by the ref's identity or its equal). */
function placeItemOf(layer: PlaceLayerInput | null | undefined, ref: MapRef): PlaceItem | null {
  const key = JSON.stringify(ref);
  for (const item of layer?.items ?? []) {
    const descriptor = item.descriptor;
    if (descriptor.type !== 'marker') continue;
    if (descriptor.refs.some((candidate) => candidate === ref || JSON.stringify(candidate) === key)) return item;
  }
  return null;
}

/** A flight point's node for a flight step. */
function nodeRefOf(item: PlaceItem): TaxiNodeRef | null {
  const descriptor = item.descriptor;
  if (descriptor.type !== 'marker') return null;
  const ref = descriptor.ref;
  if (ref.kind === 'spawn' && ref.subject.kind === 'npc') return { npcId: ref.subject.id, taxiNodeId: item.node ?? null, name: item.name ?? null };
  if (ref.kind === 'taxi-node') return { npcId: null, taxiNodeId: ref.node, name: item.name ?? null };
  return null;
}

const distanceSq = (a: WorldPoint, b: WorldPoint): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/**
 * "Fly from the nearest known flight point" (§14.2): from the known flight point nearest the
 * character after the step, to the known one nearest `to`, on one world map; unavailable (with why)
 * when the character's place, or two known flight points, are not there.
 */
function flyAction(ctx: PopoverContext, from: WorldPoint | null, to: WorldPoint): PopoverAction {
  const base = { key: 'fly', variant: 'default' as const };
  const words = 'Fly from the nearest known flight point';
  if (ctx.places === null || ctx.places === undefined) return { ...base, label: words, unavailable: 'The flight points are not loaded yet', command: { kind: 'none' } };
  if (from === null) return { ...base, label: words, unavailable: `Where the character is ${ctx.after} is not known`, command: { kind: 'none' } };
  const known = ctx.places.flightPoints.items.filter(
    (item) => item.descriptor.type === 'marker' && item.descriptor.mark?.state === 'flight-known' && item.descriptor.point.mapId === to.mapId,
  );
  const nearest = (point: WorldPoint, skip: PlaceItem | null): PlaceItem | null => {
    let best: PlaceItem | null = null;
    let bestD = Infinity;
    for (const item of known) {
      if (item === skip || item.descriptor.type !== 'marker') continue;
      const d = distanceSq(item.descriptor.point, point);
      if (d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  };
  const start = from.mapId === to.mapId ? nearest(from, null) : null;
  const end = start === null ? null : nearest(to, start);
  const startRef = start === null ? null : nodeRefOf(start);
  const endRef = end === null ? null : nodeRefOf(end);
  if (start === null || end === null || startRef === null || endRef === null) {
    return { ...base, label: words, unavailable: `Two flight points known to the route ${ctx.after} are needed on this map`, command: { kind: 'none' } };
  }
  const label = `Fly from ${start.name ?? 'the nearest known flight point'} to ${end.name ?? 'the one nearest here'} ${ctx.after}`;
  return insertAction(ctx, 'fly', label, insertStep((ids) => makeFlightStep(ids, { mode: 'take', from: startRef, to: endRef }), null, 'Insert flight'));
}

/** A transport stop's service, when the stop was matched to a seed (its record id and name, and the other stops). */
function transportOf(ref: Extract<MapRef, { readonly kind: 'transport' }>): { readonly id: string; readonly name: string; readonly here: string; readonly to: readonly string[] } | null {
  for (const seed of TRANSPORT_SEEDS) {
    if (seed.clientPath !== ref.path) continue;
    const index = seed.stops.findIndex((stop) => stop.clientStop === ref.stop);
    const here = seed.stops[index];
    if (here === undefined) continue;
    return { id: seed.id, name: seed.name, here: here.name, to: seed.stops.filter((_, i) => i !== index).map((stop) => stop.name) };
  }
  return null;
}

/** A ride line's service (`stop` null: a line between two stops, not a stop; review TR-05), found by its client path: its name and its stops. */
function rideOf(ref: Extract<MapRef, { readonly kind: 'transport' }>): { readonly name: string; readonly stops: readonly string[] } | null {
  if (ref.stop !== null) return null;
  const seed = TRANSPORT_SEEDS.find((candidate) => candidate.clientPath === ref.path);
  return seed === undefined ? null : { name: seed.name, stops: seed.stops.map((stop) => stop.name) };
}

const SERVICE_ACTION: Readonly<Record<ServiceKind, string>> = { innkeeper: 'Set hearth here', trainer: 'Train here', vendor: 'Buy here' };

function serviceSection(ctx: PopoverContext, ref: Extract<MapRef, { readonly kind: 'service' }>, label: string | null, point: WorldPoint): PopoverSection {
  const npc = ctx.dataset.npc(ref.npc);
  const name = npc?.name ?? `NPC ${String(ref.npc)}`;
  const location = locationOf(point, null, name);
  const command =
    ref.service === 'innkeeper'
      ? insertStep((ids) => makeHearthStep(ids, { mode: 'bind', location }), null, 'Insert hearth')
      : ref.service === 'trainer'
        ? insertStep((ids) => makeTrainStep(ids, { skill: 'class', location }), null, 'Insert train')
        : insertStep((ids) => makeVendorStep(ids, { location }), null, 'Insert vendor');
  return {
    key: `service:${String(ref.npc)}:${String(ref.spawnIndex)}`,
    heading: name,
    quest: null,
    lines: label === null ? [] : [label],
    actions: [insertAction(ctx, `service:${String(ref.npc)}`, `${SERVICE_ACTION[ref.service]} ${ctx.after}`, command, 'primary')],
  };
}

/** The name of a spawn ref's NPC or object. */
function subjectName(dataset: DatasetView, ref: Extract<MapRef, { readonly kind: 'spawn' }>): string | null {
  const subject = ref.subject;
  if (subject.kind === 'npc') return dataset.npc(subject.id)?.name ?? null;
  if (subject.kind === 'object') return dataset.object(subject.id)?.name ?? null;
  return null;
}

const ROLE_OF: Readonly<Partial<Record<string, Role>>> = { 'available-quests': 'giver', 'turn-ins': 'turn-in', objectives: 'objective', 'flight-masters': 'giver' };

/** The popover's content for a target (`MapPopoverTarget`). */
export function buildMapPopover(target: MapPopoverTarget, ctx: PopoverContext): PopoverModel {
  const sections: PopoverSection[] = [];
  const point: WorldPoint = { mapId: target.point.mapId, x: target.point.x, y: target.point.y };
  const layer = target.layer;
  const seenQuests = new Set<QuestId>();
  const stepIds: StepId[] = [];
  let title: string | null = null;
  let isFlightPoint = false;
  let name: string | null = null;
  /** The quest givers or finishers of a stack, each once: a stack of several is headed with them all (review QA-18). */
  const subjects: string[] = [];

  const addQuest = (id: QuestId, role: Role, where: string | null): void => {
    if (seenQuests.has(id)) return;
    seenQuests.add(id);
    sections.push(questSection(ctx, id, role, where));
  };

  for (const [index, ref] of target.refs.entries()) {
    const label = target.labels[index] ?? null;
    switch (ref.kind) {
      case 'spawn': {
        const subject = subjectName(ctx.dataset, ref);
        if (layer === 'flight-masters') {
          isFlightPoint = true;
          const item = placeItemOf(ctx.places?.flightPoints, ref);
          name ??= item?.name ?? subject;
          sections.push(flightSection(ctx, item, ref, label, subject));
        } else name ??= subject;
        if (subject !== null && !subjects.includes(subject)) subjects.push(subject);
        for (const id of ref.questIds) addQuest(id, ROLE_OF[layer ?? ''] ?? 'giver', subject === null ? null : `At ${subject}`);
        break;
      }
      case 'taxi-node': {
        isFlightPoint = true;
        const item = placeItemOf(ctx.places?.flightPoints, ref);
        name ??= item?.name ?? null;
        sections.push(flightSection(ctx, item, ref, label, item?.name ?? null));
        break;
      }
      case 'dungeon': {
        const item = placeItemOf(ctx.places?.dungeons, ref);
        name ??= item?.name ?? null;
        title ??= `Dungeon entrance: ${item?.name ?? 'unnamed'}`;
        sections.push({ key: `dungeon:${String(ref.dungeon)}:${String(ref.entrance)}`, heading: label?.split(' · ')[0] ?? 'Dungeon entrance', quest: null, lines: label === null ? [] : [label], actions: [] });
        // §8.5: the quests inside that the route can do after the step: in the log, or available.
        for (const id of item?.quests ?? []) {
          const entry = ctx.questState?.quests.get(id) ?? null;
          if (entry === null || entry.cls === 'in-log' || entry.cls === 'available' || entry.cls.startsWith('uncertain')) addQuest(id, 'inside', 'Objectives inside');
        }
        break;
      }
      case 'transport': {
        if (ref.stop === null) {
          // A ride line (TR-05): its service named from its path; a transport is added at one of its stops, which a line is not.
          const ride = rideOf(ref);
          const rideTitle = ride === null ? 'Transport route (service unknown)' : `Transport route: ${ride.name}`;
          title ??= rideTitle;
          // An unknown service is said once, in the title (QA-04): the heading names the client path,
          // and the label drops its leading copy of the title.
          const unknownPrefix = ride === null && label !== null ? [`${rideTitle}: `, `${rideTitle} · `].find((prefix) => label.startsWith(prefix)) : undefined;
          const rideLabel = label === null || unknownPrefix === undefined ? label : `${label.charAt(unknownPrefix.length).toUpperCase()}${label.slice(unknownPrefix.length + 1)}`;
          sections.push({
            key: `ride:${String(ref.path)}`,
            heading: ride === null ? `Client transport path ${String(ref.path)}` : ride.name,
            quest: null,
            lines: [...(rideLabel === null ? [] : [rideLabel]), ...(ride === null ? [] : [`Between ${ride.stops.join(' and ')}`])],
            actions: [
              {
                key: `ride:${String(ref.path)}`,
                label: `Add transport ${ctx.after}`,
                variant: 'default',
                unavailable: ride === null ? 'This route’s service is not known: it is never used for a route' : 'Choose one of its stops to add it: a transport starts at a stop',
                command: { kind: 'none' },
              },
            ],
          });
          break;
        }
        const service = transportOf(ref);
        const stopTitle = service === null ? 'Transport stop (service unknown)' : `Transport stop: ${service.here}`;
        title ??= stopTitle;
        const action: PopoverAction =
          service === null
            ? { key: `transport:${String(ref.path)}:${String(ref.stop)}`, label: `Add transport ${ctx.after}`, variant: 'default', unavailable: 'This stop’s service is not known: it is never used for a route', command: { kind: 'none' } }
            : insertAction(
                ctx,
                `transport:${String(ref.path)}:${String(ref.stop)}`,
                `Add transport (${service.name}) ${ctx.after}`,
                // By id only: the stop's position is the client file's inferred one, so it is not
                // saved as a user dock (TIME-7; the graph keeps it `inferred`, with its record).
                insertStep((ids) => makeTravelStep(ids, { mode: 'transport', transport: { id: service.id, dock: null } }), null, 'Insert travel'),
                'primary',
              );
        // The service state is worded once (QA-04): the title says "service unknown", so the heading
        // names the client path and the label drops its leading copy of the title.
        const stopLabel = label !== null && label.startsWith(`${stopTitle} · `) ? label.slice(stopTitle.length + 3) : label;
        sections.push({
          key: `transport:${String(ref.path)}:${String(ref.stop)}`,
          heading: service === null ? `Client transport path ${String(ref.path)}` : `${service.name}: ${service.here}`,
          quest: null,
          lines: [...(stopLabel === null ? [] : [stopLabel]), ...(service === null ? [] : [`To ${service.to.join(', ')}; set the destination in Details`])],
          actions: [action],
        });
        break;
      }
      case 'service': {
        const section = serviceSection(ctx, ref, label, point);
        name ??= section.heading;
        title ??= `${capital(ref.service === 'trainer' ? 'class trainer' : ref.service)}: ${section.heading}`;
        sections.push(section);
        break;
      }
      case 'step': {
        if (stepIds.includes(ref.stepId)) break;
        stepIds.push(ref.stepId);
        const number = ctx.stepNumber(ref.stepId);
        sections.push({
          key: `step:${ref.stepId}`,
          heading: label ?? 'A step',
          quest: null,
          lines: [],
          actions: [{ key: `step:${ref.stepId}`, label: number === null ? 'Select this step' : `Select step ${String(number)}`, variant: 'default', unavailable: null, command: { kind: 'select', stepIds: [ref.stepId] } }],
        });
        break;
      }
      // Route lines, legs, clusters and zones never open the popover (the controller acts on them).
      case 'run':
      case 'leg':
      case 'transition':
      case 'connector':
      case 'departure':
      case 'aggregate':
      case 'cluster':
      case 'zone':
      case 'surface':
      case 'art':
      case 'terrain':
      case 'atlas-tiles':
      case 'taxi-edge':
        break;
    }
  }

  const footer: PopoverAction[] = [];
  const distinctSteps = stepIds;
  if (distinctSteps.length > 1) {
    footer.push({ key: 'steps:all', label: `Select all ${String(distinctSteps.length)} steps`, variant: 'default', unavailable: null, command: { kind: 'select', stepIds: distinctSteps } });
  }
  if (stepIds.length === 0) {
    // Any point: go there, or fly there from the nearest known flight point (not from a flight point itself).
    const here = name ?? (target.point.uiMapId === null ? null : ctx.zoneName(target.point.uiMapId));
    footer.push(insertAction(ctx, 'go', `Go here ${ctx.after}`, insertStep((ids) => makeTravelStep(ids, { location: locationOf(point, target.point.uiMapId, name) }), null, 'Insert travel')));
    if (!isFlightPoint) footer.push(flyAction(ctx, target.from, point));
    if (target.refs.length === 0) title = `Here: ${here ?? 'this point on the map'}`;
  }
  if (title === null) {
    if (distinctSteps.length > 0) title = `${String(distinctSteps.length)} steps here`;
    else if (isFlightPoint) title = `Flight point: ${name ?? 'unnamed'}`;
    else if (subjects.length > 1) title = `${String(seenQuests.size)} quests at ${subjects.length === 2 ? subjects.join(' and ') : `${subjects[0] ?? ''} and ${String(subjects.length - 1)} others`}`;
    else title = name === null ? `${String(seenQuests.size)} quests here` : `Quests at ${name}`;
  }
  return { title, sections, footer };
}

function flightSection(ctx: PopoverContext, item: PlaceItem | null, ref: MapRef, label: string | null, fallback: string | null): PopoverSection {
  const node = item === null ? null : nodeRefOf(item);
  const heading = item?.name ?? fallback ?? 'Flight point';
  const add =
    node === null
      ? { key: `flight:${JSON.stringify(ref)}`, label: `Add flight from here ${ctx.after}`, variant: 'default' as const, unavailable: 'This flight point is not in the flight network yet', command: { kind: 'none' as const } }
      : insertAction(ctx, `flight:${JSON.stringify(ref)}`, `Add flight from here ${ctx.after}`, insertStep((ids) => makeFlightStep(ids, { mode: 'take', from: node, to: null }), null, 'Insert flight'));
  return { key: `flight:${JSON.stringify(ref)}`, heading, quest: null, lines: label === null ? [] : [label], actions: [add] };
}
