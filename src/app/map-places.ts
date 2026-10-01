import type { Faction } from '../domain/character';
import type { DatasetView, QuestRecord } from '../domain/dataset';
import type { NpcId, QuestId, StepId, UiMapId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { CharacterProfile } from '../domain/project';
import type { FlightStep } from '../domain/route';
import type { ReadonlyCharacterState, StepRecord } from '../engine/types';
import type { DatasetDungeon } from '../infra/data/dungeons';
import type { ClientDungeons, ClientInstanceMap, ClientLfgRow, ClientTaxi, ClientTaxiFlight } from '../infra/maps/client-tables';
import {
  type ConnectorDescriptor,
  MAX_POLYLINE_VERTICES,
  type MapCategoryId,
  type MapRef,
  type MarkerDescriptor,
  type MarkerMark,
  type PlaceItem,
  type PlaceLayerInput,
  type PolylineDescriptor,
  type ServiceKind,
  STEP_TOKEN,
} from '../map/adapter';
import type { ClustersOf } from '../map/layers';
import type { FlightSides, MarkState } from '../map/marks';
import { DIFFICULTY_LABELS, questDifficulty } from '../rules/difficulty';
import type { EffectiveRules } from '../rules/precedence';
import { resolveTaxiNodeRef, type TaxiNode, type TaxiNodeKey, type TravelGraph } from '../rules/travel-graph';
import { TRANSPORT_SEEDS, type TransportSeed } from '../rules/travel-seeds';
import { localTaxiRoute, type TaxiLegData } from '../sim/taxi';
import { characterName, CLASS_NAMES } from './character-names';
import type { MapLabels } from './map-labels';
import type { ZoneFillModel } from './map-zone-fill';
import type { QuestStateModel } from './quest-state';
import { withArticle } from './quest-state-text';
import { questOpenTo } from './shell-support';
import { levelRange, RATING_MAX_SPREAD, RATING_MIN_QUESTS, SPAN_MIN_QUESTS } from './zone-levels';

/**
 * The map's places (docs/research/map-presentation.md §8 to §10, §25.2.3, §25.4; D-039 B, E, F;
 * D-047; steps MP.5, MP.8, MP.9): dungeon and raid entrances, flight points with their state after
 * the active step and the flight network, and transport stops and rides, as plain descriptors in
 * world coordinates (`PlaceLayerInput`), with their layers' notes and the drawer's counts. Built in
 * the lazy derived pipeline, after the quest state, from the committed client tables
 * (`public/maps/client/`), the dataset and the walk; the map only keeps what its view shows.
 *
 * - **Dungeons (MP.5, §8).** Membership is the committed dungeon-finder table (the LFG rows,
 *   D-039 E), each row matched by hand to its client instance map and its dataset dungeon
 *   (`LFG_MATCHES`: the committed file has no `LFGDungeons.MapID`, so the match is recorded here,
 *   by id, not by name at run time), plus the three raids with no finder row (AQ20, AQ40,
 *   Naxxramas), in their own category, hidden by default (D-039 F). Entrances are the dataset's
 *   (`zones.json`); one pin per entrance, the instances sharing it counted ("×4"). Each has its
 *   LFG tuning level worded "LFG tuning level (client), meaning unverified", a "?" where the row
 *   disagrees with itself (Ruins of Lordaeron), and the dataset's dungeon-quest span over the
 *   quests open to the character, with the quests inside after the step. The announced Forever
 *   instances with no known entrance are named in the notes, never placed.
 * - **Flight points (MP.8, §9).** The TravelGraph's nodes: the dataset's flight masters (each with
 *   the client row it stands at) and the client rows no flight master stands at. The side is the
 *   client row's (`TaxiNodes.Flags`, INFERRED), else the dataset's; the other faction's are their
 *   own category, hidden by default. After the active step a node is known to the route (the
 *   walk's `knownFlightPaths`), not known, or, with an unknown history, may be known.
 * - **Flight network (MP.8, §9, §25.4).** One line per pair of nodes the side may use, along the
 *   committed shape (25 yd), with both directions' times in the hover from the client path lengths
 *   and the effective rules (TIME-6). At the zone and close bands the map draws only the flights of
 *   the hovered or selected flight point and the route's own (`PlaceItem.route`: the journeys the
 *   walk's flight steps take, routed as TIME-6 routes them).
 * - **Transports (MP.9, §10).** Every stop of the file's transport paths: a stop the seeds were
 *   matched to (`TransportSeed.clientPath`, `clientStop`) says its service is inferred and names
 *   the record; any other stop is "Transport stop (service unknown)", drawn and never given to the
 *   engine. Same-map rides are lines between the stops (straight: the file holds the stops, not the
 *   route between them); rides between the continents are the atlas's connectors.
 *
 * - **Services (MP.11, §11).** Innkeepers, the character's class trainers and the vendors the
 *   dataset carries (QuestieDB's Era `npcFlags` 128, 16 with the class's "<Class> Trainer" title, and
 *   4), of the character's side and both factions (`friendlyTo`): light pins at their spawns, with
 *   "Set hearth here", "Train here" and "Buy here" in the map popover (MP.6). The dataset holds only
 *   the vendors tied to quests, and the notes say so; an NPC with an unknown faction is not drawn,
 *   and one inside an instance is not placed at its entrance.
 *
 * Nothing is fabricated: a missing table leaves its layers empty and says why; a position the data
 * does not give is not drawn; every number carries its basis in the words.
 */

// =============================================================================================
// Inputs and outputs

/** A committed client table as the pipeline has it: loading, loaded, or failed with the reason. */
export type ClientTableState<T> = { readonly kind: 'checking' } | { readonly kind: 'loaded'; readonly table: T } | { readonly kind: 'failed'; readonly reason: string };

export interface PlacesInput {
  readonly taxi: ClientTableState<ClientTaxi>;
  readonly dungeons: ClientTableState<ClientDungeons>;
  /** The TravelGraph the walk used (seeded with the taxi file when it is loaded). */
  readonly graph: TravelGraph;
  /** The same per-leg data the walk used (TIME-6), or null (TIME-5). */
  readonly legs: TaxiLegData | null;
  readonly view: DatasetView;
  /** The dataset's dungeons for the character's faction, with entrances resolved; empty when the source has none. */
  readonly datasetDungeons: readonly DatasetDungeon[];
  readonly character: Pick<CharacterProfile, 'faction' | 'race' | 'class' | 'priorHistory'>;
  readonly rules: EffectiveRules;
  /** World map names ("Eastern Kingdoms"), for the transports' destinations. */
  readonly mapName: (mapId: WorldMapId) => string;
  /** The state after the active step; null without route state. */
  readonly selected: { readonly stepId: StepId; readonly after: ReadonlyCharacterState } | null;
  /** The walk's records (the route's flights), and the known flight paths at the route's start. */
  readonly records: readonly StepRecord[];
  readonly startKnown: ReadonlySet<TaxiNodeKey>;
  /** The quest state after the active step (the quests inside a dungeon); null without it. */
  readonly questState: QuestStateModel | null;
  /** The dataset's innkeepers, trainers and vendors in any faction variant (`DatasetSource.serviceNpcIds`); empty or omitted for none. */
  readonly serviceNpcIds?: readonly NpcId[];
}

/** The place layers the model feeds. */
export type PlaceLayerId = 'dungeons' | 'flight-masters' | 'flight-network' | 'transports' | 'services';

export interface PlacesModel {
  /** The step whose state the flight points and the dungeons' quests show; null without route state. */
  readonly stepId: StepId | null;
  readonly taxi: ClientTableState<ClientTaxi>['kind'];
  readonly dungeonTable: ClientTableState<ClientDungeons>['kind'];
  readonly dungeons: PlaceLayerInput;
  /** Every flight point, the other faction's included (their category is hidden by default). */
  readonly flightPoints: PlaceLayerInput;
  readonly flights: PlaceLayerInput;
  readonly transports: PlaceLayerInput;
  /** Innkeepers, the class trainers and the dataset's vendors of the side (MP.11). */
  readonly services: PlaceLayerInput;
  /** Each layer's notes (MAP-HONEST-5), in words without a step number. */
  readonly notes: Readonly<Record<PlaceLayerId, readonly string[]>>;
  /** Why a layer draws nothing (a table failed); absent while it loads or when it draws. */
  readonly unavailable: Readonly<Partial<Record<PlaceLayerId, string>>>;
  /** The drawer's place rows: instances, flight points of the side, flights, stops (§25.3.3). */
  readonly counts: Readonly<Partial<Record<MapCategoryId, number>>>;
  /** Flight points of the side known to the route after the step; null without route state. */
  readonly flightsKnown: number | null;
  /**
   * The labels canvas's names per base style (`app/map-labels.ts`, step MP.7), added by the derived
   * pipeline with the places: zones and cities with their cards, continents, dungeons and flight
   * points. Absent or null until built.
   */
  readonly labels?: MapLabels | null;
  /** The zone fills (`app/map-zone-fill.ts`, step MP.10): the fallback tints and the faction overlay, with their notes; absent or null until built. */
  readonly zoneFill?: ZoneFillModel | null;
  /**
   * The zone a point of the map is in, for the "Viewing" chip (`app/map-viewing.ts`'s
   * `zoneOfPoint`, review QA-01): by the terrain zone rings once the zone arcs are in, the zone
   * frames until then. Built by the derived pipeline, so the rings' lookup is not in the entry chunk
   * (ui-refresh.md §10.3); absent or null until built (the controller then names the frame).
   */
  readonly zoneAt?: ((point: WorldPoint) => UiMapId | null) | null;
  /**
   * The quest givers' and turn-ins' clusters (`app/map-clusters.ts`; map-presentation.md §25.2.5;
   * D-050 item 6), made in the derived publish for the model's inputs and on first use for any
   * other, so neither the clustering nor its words are in the entry chunk; absent or null until
   * built (the layers then count their points per zone below the zone band).
   */
  readonly clusters?: ClustersOf | null;
}

const NO_ITEMS: PlaceLayerInput = { items: [], unplaced: 0 };

const group = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many: string): string => `${group(n)} ${n === 1 ? one : many}`;

/** "a, b and c". */
function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

const pointKey = (p: WorldPoint): string => `${String(p.mapId)}:${String(p.x)}:${String(p.y)}`;

/** m:ss (whole seconds; hours as h:mm:ss). */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const s = total % 60;
  const minutes = (total - s) / 60;
  const m = minutes % 60;
  const h = (minutes - m) / 60;
  const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${String(m)}:${pad(s)}`;
}

/** Remembers the last result while every argument is the same (`Object.is`). */
function lastOf<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: { readonly args: A; readonly result: R } | null = null;
  return (...args) => {
    if (last !== null && last.args.length === args.length && last.args.every((value, i) => Object.is(value, args[i]))) return last.result;
    const result = compute(...args);
    last = { args, result };
    return result;
  };
}

// =============================================================================================
// Dungeons (MP.5; §8)

/**
 * The dungeon-finder rows of the committed table (1.60.1.70009), each with the client instance map
 * and the dataset dungeon (`zones.json` key) it is. Matched by hand in step MP.5, because the
 * committed file carries no `LFGDungeons.MapID`: by the row's name against the instance map's and
 * the dataset's (Onyxia's Lair by its row id 45, review MP-R11; the Sunken Temple is the dataset's
 * The Temple of Atal'Hakkar, 1477; Lower and Upper Blackrock Spire are one dataset dungeon, as are
 * the three Dire Maul wings), each checked against the map's top-level areas. `dungeon` null: the
 * dataset has no entry (the new Forever instances), so there is no entrance to draw.
 */
export const LFG_MATCHES: readonly { readonly lfg: number; readonly map: number; readonly dungeon: number | null }[] = [
  { lfg: 1, map: 43, dungeon: 718 },
  { lfg: 2, map: 289, dungeon: 2057 },
  { lfg: 3, map: 389, dungeon: 2437 },
  { lfg: 5, map: 36, dungeon: 1581 },
  { lfg: 7, map: 33, dungeon: 209 },
  { lfg: 9, map: 48, dungeon: 719 },
  { lfg: 11, map: 34, dungeon: 717 },
  { lfg: 13, map: 90, dungeon: 721 },
  { lfg: 15, map: 47, dungeon: 491 },
  { lfg: 17, map: 189, dungeon: 796 },
  { lfg: 19, map: 129, dungeon: 722 },
  { lfg: 21, map: 70, dungeon: 1337 },
  { lfg: 23, map: 209, dungeon: 1176 },
  { lfg: 25, map: 349, dungeon: 2100 },
  { lfg: 27, map: 109, dungeon: 1477 },
  { lfg: 29, map: 230, dungeon: 1584 },
  { lfg: 31, map: 229, dungeon: 1583 },
  { lfg: 33, map: 429, dungeon: 2557 },
  { lfg: 35, map: 429, dungeon: 2557 },
  { lfg: 37, map: 429, dungeon: 2557 },
  { lfg: 39, map: 329, dungeon: 2017 },
  { lfg: 41, map: 309, dungeon: 1977 },
  { lfg: 43, map: 229, dungeon: 1583 },
  { lfg: 45, map: 249, dungeon: 2159 },
  { lfg: 47, map: 409, dungeon: 2717 },
  { lfg: 49, map: 469, dungeon: 2677 },
  { lfg: 3271, map: 2959, dungeon: null },
  { lfg: 3272, map: 2999, dungeon: null },
  { lfg: 3273, map: 3065, dungeon: null },
  { lfg: 3274, map: 2998, dungeon: null },
];

/** The raid maps with no dungeon-finder row (AQ20, AQ40, Naxxramas; D-039 F: hidden by default), with their dataset dungeons. */
export const UNCONFIRMED_RAIDS: readonly { readonly map: number; readonly dungeon: number }[] = [
  { map: 509, dungeon: 3429 },
  { map: 531, dungeon: 3428 },
  { map: 533, dungeon: 3456 },
];

/** Instance maps of the client whose purpose is unknown (forever-game-rules.md §5.3): counted, not shown. */
export const UNKNOWN_PURPOSE_MAPS: readonly number[] = [3002, 3109];

/**
 * The Forever instances the official announcement names (forever-game-rules.md §5.3, S2; the two
 * raids unlock on 9 December), none with a known entrance: named in the layer's notes, never
 * placed. An entrance is added only from a sourced position (map-presentation.md §8.1).
 */
export const ANNOUNCED_INSTANCES: readonly { readonly name: string; readonly raid: boolean; readonly lfg: number | null }[] = [
  { name: 'Hall of Thanes', raid: false, lfg: 3273 },
  { name: 'Ruins of Lordaeron', raid: false, lfg: 3272 },
  { name: 'Whelgar excavation site', raid: false, lfg: 3274 },
  { name: 'City of Dalaran', raid: false, lfg: 3271 },
  { name: 'Blackmaw Hold', raid: false, lfg: null },
  { name: "Krol'dok Stronghold", raid: false, lfg: null },
  { name: "Shaper's Terrace", raid: false, lfg: null },
  { name: 'Drowned City', raid: false, lfg: null },
  { name: 'Alcaz Prison', raid: false, lfg: null },
  { name: 'Barrow Deeps', raid: true, lfg: null },
  { name: 'Hyjal Summit', raid: true, lfg: null },
];

/** An LFG row's level, one number or "?" with the reason, never a range (D-039 E; §8.4). */
export interface TuningLevel {
  readonly level: number | null;
  /** "LFG tuning level 17 (client LFGDungeons row 1 → ContentTuning 5254, build 1.60.1.70009; meaning unverified)". */
  readonly text: string;
}

/**
 * D-039 E: the row's `ContentTuning.MinLevelSquish`, labelled "meaning unverified". A row whose
 * own columns disagree (the squished levels differ, or a set `LfgMinLevel`/`LfgMaxLevel` differs
 * from them) is "?" with its numbers; 0 means none set.
 */
export function tuningLevelOf(row: ClientLfgRow, build: string): TuningLevel {
  const where = `client LFGDungeons row ${String(row.id)} → ContentTuning ${String(row.contentTuningId)}, build ${build}`;
  const values = [row.minLevelSquish, row.maxLevelSquish, row.lfgMinLevel, row.lfgMaxLevel].filter((value) => value > 0);
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length === 0) return { level: null, text: `LFG tuning level: none set (${where})` };
  if (distinct.length > 1 || row.minLevelSquish === 0) {
    return { level: null, text: `LFG tuning level ? (the client's row gives both ${listWords(distinct.map(String))}: ${where})` };
  }
  return { level: distinct[0] ?? null, text: `LFG tuning level ${String(distinct[0])} (${where}; meaning unverified)` };
}

interface DungeonMember {
  readonly dungeon: DatasetDungeon;
  readonly name: string;
  readonly raid: boolean;
  readonly confirmed: boolean;
  readonly rows: readonly ClientLfgRow[];
  readonly map: ClientInstanceMap | null;
}

interface DungeonSpan {
  readonly text: string;
  readonly open: number;
  readonly median: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

/** The value at share `p` of ascending `sorted` (the nearest rank by index, as zone-levels takes it). */
const at = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] ?? 0;

/** The dungeon's areas: its own and the dataset's alternatives (a quest's `zoneOrSort`). */
const areasOf = (dungeon: DatasetDungeon): ReadonlySet<number> => new Set<number>([dungeon.areaId, ...dungeon.alternativeAreaIds]);

/** The dataset's dungeon quests of `areas` (§8.4: `dungeonQuest` with a `zoneOrSort` of the instance's areas). */
function dungeonQuestsOf(view: DatasetView, areas: ReadonlySet<number>): readonly QuestRecord[] {
  const out: QuestRecord[] = [];
  for (const quest of view.quests()) if (quest.dungeonQuest && quest.zoneOrSort !== null && areas.has(quest.zoneOrSort)) out.push(quest);
  return out;
}

/** §8.4's dungeon-quest span over the quests open to the character: shown from 5 quests, with the count and the Era marker's words. */
function dungeonSpanOf(quests: readonly QuestRecord[], character: Pick<CharacterProfile, 'race' | 'class'>, who: string): DungeonSpan {
  const levels = quests
    .filter((quest) => questOpenTo(quest, character) === true)
    .flatMap((quest) => (quest.level !== null && Number.isInteger(quest.level) && quest.level >= 1 ? [quest.level] : []))
    .sort((a, b) => a - b);
  const open = levels.length;
  if (open < SPAN_MIN_QUESTS) {
    const text = open === 0 ? `no dungeon quests open to ${withArticle(who)}` : `${plural(open, 'dungeon quest', 'dungeon quests')} open to ${withArticle(who)}: too few for a span`;
    return { text, open, median: null, low: null, high: null };
  }
  const low = at(levels, 0.1);
  const high = at(levels, 0.9);
  const range = low === high ? `of level ${String(low)}` : levelRange(low, high);
  return { text: `dungeon quests ${range} (${group(open)} open to ${withArticle(who)}; Era quest levels from the dataset)`, open, median: at(levels, 0.5), low, high };
}

// =============================================================================================
// The builder

/** Builds the places model; static parts are kept while their inputs are the same objects. */
export function createPlacesBuilder(): (input: PlacesInput) => PlacesModel {
  const membersOf = lastOf(dungeonMembers);
  const spansOf = lastOf((view: DatasetView, members: readonly DungeonMember[], race: CharacterProfile['race'], cls: CharacterProfile['class']) => {
    const who = characterName({ race, class: cls });
    return new Map(members.map((member) => {
      const quests = dungeonQuestsOf(view, areasOf(member.dungeon));
      return [member.dungeon.areaId, { quests, span: dungeonSpanOf(quests, { race, class: cls }, who) }] as const;
    }));
  });
  const flightBaseOf = lastOf(flightBase);
  const linesOf = lastOf(flightLines);
  const transportsOf = lastOf(transportItems);
  const routePairsOf = lastOf(routeFlightPairs);
  const servicesOf = lastOf(serviceItems);

  return (input) => {
    const who = characterName(input.character);
    const taxi = input.taxi.kind === 'loaded' ? input.taxi.table : null;
    const table = input.dungeons.kind === 'loaded' ? input.dungeons.table : null;
    const known = input.selected?.after.knownFlightPaths ?? null;

    // Dungeons.
    const members = table === null ? [] : membersOf(table, input.datasetDungeons);
    const spans = spansOf(input.view, members, input.character.race, input.character.class);
    const dungeons = table === null ? { input: NO_ITEMS, counts: {} } : dungeonItems(members, spans, table, input);

    // Flight points and flights.
    const base = flightBaseOf(input.graph, input.view, input.character.faction, input.character.race, input.character.class);
    // With the taxi file, the flight points are its nodes (map-presentation.md §9), and the dataset's
    // flight masters at no node of it (review TR-10: the file keeps only the paid paths' rows, so
    // Vesprystus and the Moonglade masters, whose flights cost nothing, have none) are drawn as the
    // dataset gives them; a cited seed with no row stays out.
    const drawnBase = taxi === null ? base : base.filter((node) => node.row !== null || node.node.npcId !== null);
    const flightPoints = flightPointItems(drawnBase, known, input.character.priorHistory === 'unknown', who);
    const lines = taxi === null ? null : linesOf(taxi, input.character.faction, input.rules);
    const routePairs = taxi === null || input.legs === null ? NO_PAIRS : routePairsOf(input.records, input.graph, input.legs, input.startKnown, input.character.faction);
    const flights = lines === null ? NO_ITEMS : withRouteFlags(lines, routePairs);

    // Transports.
    const transports = taxi === null ? null : transportsOf(taxi, TRANSPORT_SEEDS, input.mapName);

    // Services (MP.11).
    const services = servicesOf(input.view, input.serviceNpcIds ?? NO_NPCS, input.character.faction, input.character.class);

    const usable = drawnBase.filter((node) => !node.other && node.point !== null);
    return {
      stepId: input.selected?.stepId ?? null,
      taxi: input.taxi.kind,
      dungeonTable: input.dungeons.kind,
      dungeons: dungeons.input,
      flightPoints,
      flights,
      transports: transports?.input ?? NO_ITEMS,
      services: services.input,
      notes: {
        dungeons: dungeonNotes(input, members, table),
        'flight-masters': flightPointNotes(input, drawnBase, who),
        'flight-network': flightNotes(input, lines),
        transports: transports?.notes ?? [],
        services: services.notes,
      },
      unavailable: unavailableOf(input),
      counts: {
        ...dungeons.counts,
        'flight-points': usable.length,
        'other-faction-flights': drawnBase.filter((node) => node.other && node.point !== null).length,
        ...(lines === null ? {} : { 'flight-network': lines.length }),
        ...(transports === null ? {} : { 'transport-stops': transports.stops }),
        ...services.counts,
      },
      flightsKnown: known === null ? null : usable.filter((node) => known.has(node.key)).length,
    };
  };
}

function unavailableOf(input: PlacesInput): Partial<Record<PlaceLayerId, string>> {
  const out: Partial<Record<PlaceLayerId, string>> = {};
  if (input.taxi.kind === 'failed') {
    const why = `The client taxi file could not be used (${input.taxi.reason})`;
    out['flight-network'] = `${why}: no flight lines are drawn, and flights are timed as a straight line × the detour factor at the taxi speed (TIME-5)`;
    out.transports = `${why}: no transport stops are drawn`;
  }
  if (input.dungeons.kind === 'failed') out.dungeons = `The client dungeon table could not be used (${input.dungeons.reason}): no dungeon entrances are drawn`;
  return out;
}

// ---- Dungeons

function dungeonMembers(table: ClientDungeons, datasetDungeons: readonly DatasetDungeon[]): readonly DungeonMember[] {
  const byArea = new Map(datasetDungeons.map((dungeon) => [dungeon.areaId as number, dungeon]));
  const maps = new Map(table.instanceMaps.map((map) => [map.id as number, map]));
  const rows = new Map(table.lfg.map((row) => [row.id, row]));
  const out = new Map<number, { dungeon: DatasetDungeon; rows: ClientLfgRow[]; map: ClientInstanceMap | null; confirmed: boolean }>();
  for (const match of LFG_MATCHES) {
    const row = rows.get(match.lfg);
    if (row === undefined || match.dungeon === null) continue;
    const dungeon = byArea.get(match.dungeon);
    if (dungeon === undefined) continue;
    const entry = out.get(match.dungeon) ?? { dungeon, rows: [], map: maps.get(match.map) ?? null, confirmed: true };
    entry.rows.push(row);
    out.set(match.dungeon, entry);
  }
  for (const raid of UNCONFIRMED_RAIDS) {
    const dungeon = byArea.get(raid.dungeon);
    const map = maps.get(raid.map);
    // Only while the client still has the raid's map with no finder row.
    if (dungeon === undefined || map === undefined || out.has(raid.dungeon)) continue;
    out.set(raid.dungeon, { dungeon, rows: [], map, confirmed: false });
  }
  return [...out.values()]
    .map(({ dungeon, rows: lfgRows, map, confirmed }) => ({
      dungeon,
      name: map?.name ?? dungeon.name,
      // Raid status is the client's Map.InstanceType (§8.3), not the player count.
      raid: map?.instanceType === 2,
      confirmed,
      rows: [...lfgRows].sort((a, b) => a.id - b.id),
      map,
    }))
    .sort((a, b) => a.dungeon.areaId - b.dungeon.areaId);
}

type SpanEntry = { readonly quests: readonly QuestRecord[]; readonly span: DungeonSpan };

/** One member's hover words (no step number: the controller puts "After step N: " before stated text). */
function memberWords(member: DungeonMember, span: DungeonSpan, input: PlacesInput, build: string, unverified: boolean): string {
  const kind = member.raid ? 'raid' : 'dungeon';
  const parts: string[] = [];
  const rows = member.rows.map((row) => {
    const tuning = tuningLevelOf(row, build);
    return member.rows.length > 1 ? `${row.name}: ${tuning.text}` : tuning.text;
  });
  if (rows.length > 0) parts.push(...rows);
  else parts.push('no dungeon-finder row in the client (unconfirmed raid, D-039 F)');
  parts.push(span.text);
  const model = input.questState;
  if (model !== null && span.median !== null && span.low !== null && span.high !== null && span.open >= RATING_MIN_QUESTS && span.high - span.low <= RATING_MAX_SPREAD) {
    try {
      const values = input.rules.values;
      const difficulty = questDifficulty(model.level, span.median, { yellowLowerBound: values.difficultyYellowLowerBound.value, greenRange: values.greenRange.value });
      parts.push(`median quest level ${String(span.median)}: ${DIFFICULTY_LABELS[difficulty].toLowerCase()} at level ${model.levelLowerBound ? 'at least ' : ''}${String(model.level)} after step ${STEP_TOKEN}`);
    } catch {
      // An invalid level is not rated: nothing is guessed.
    }
  }
  if (unverified) parts.push("position not verified by the dataset's audit");
  return `${member.name} (${kind} entrance) · ${parts.join(' · ')}`;
}

/** "Quests inside: 2 in the log · 1 available · 1 may be available" from the quest state, the uncertain counted apart (§8.5); null without state or none. */
function insideWords(quests: readonly QuestRecord[], model: QuestStateModel | null): string | null {
  if (model === null) return null;
  let log = 0;
  let available = 0;
  let uncertain = 0;
  for (const quest of quests) {
    const entry = model.quests.get(quest.id);
    if (entry === undefined) continue;
    if (entry.cls === 'in-log') log += 1;
    else if (entry.cls === 'available') available += 1;
    else if (entry.cls === 'uncertain-level' || entry.cls === 'uncertain-history' || entry.cls === 'uncertain-other') uncertain += 1;
  }
  const counts = [log > 0 ? `${group(log)} in the log` : null, available > 0 ? `${group(available)} available` : null, uncertain > 0 ? `${group(uncertain)} may be available` : null].filter(
    (text): text is string => text !== null,
  );
  return counts.length === 0 ? `no dungeon quests inside in the log or available after step ${STEP_TOKEN}` : `quests inside after step ${STEP_TOKEN}: ${counts.join(' · ')}`;
}

function dungeonItems(
  members: readonly DungeonMember[],
  spans: ReadonlyMap<number, SpanEntry>,
  table: ClientDungeons,
  input: PlacesInput,
): { readonly input: PlaceLayerInput; readonly counts: Partial<Record<MapCategoryId, number>> } {
  const pins = new Map<string, { point: WorldPoint; confirmed: boolean; members: { member: DungeonMember; entrance: number; unverified: boolean }[] }>();
  let unplaced = 0;
  const drawn = new Set<number>();
  for (const member of members) {
    member.dungeon.entrances.forEach((entrance, index) => {
      if (entrance.world === null) {
        unplaced += 1;
        return;
      }
      const key = `${pointKey(entrance.world)}${member.confirmed ? '' : ':unconfirmed'}`;
      const pin = pins.get(key) ?? { point: entrance.world, confirmed: member.confirmed, members: [] };
      if (!pin.members.some((entry) => entry.member === member)) pin.members.push({ member, entrance: index, unverified: !entrance.frameVerified });
      pins.set(key, pin);
      drawn.add(member.dungeon.areaId);
    });
  }
  const items: PlaceItem[] = [];
  for (const [key, pin] of [...pins].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const entries = [...pin.members].sort((a, b) => (a.member.name < b.member.name ? -1 : a.member.name > b.member.name ? 1 : 0));
    const anyDungeon = entries.some((entry) => !entry.member.raid);
    const unverified = entries.some((entry) => entry.unverified);
    const refs: MapRef[] = entries.map((entry) => ({ kind: 'dungeon', dungeon: entry.member.dungeon.areaId, entrance: entry.entrance }));
    const labels = entries.map((entry) => {
      const spanEntry = spans.get(entry.member.dungeon.areaId);
      const span = spanEntry?.span ?? { text: 'no dungeon quests in the dataset', open: 0, median: null, low: null, high: null };
      const inside = insideWords(spanEntry?.quests ?? [], input.questState);
      const words = memberWords(entry.member, span, input, table.build, entry.unverified);
      return inside === null ? words : `${words} · ${inside}`;
    });
    const category: MapCategoryId = !pin.confirmed ? 'unconfirmed-raids' : anyDungeon ? 'dungeons' : 'raids';
    const state: MarkState = anyDungeon ? 'dungeon' : 'raid';
    const mark: MarkerMark = { state, difficulty: null, dungeonQuest: false, progress: null, ...(unverified ? { positionUnverified: true } : {}) };
    const descriptor: MarkerDescriptor = {
      type: 'marker',
      id: `dungeon:${key}`,
      point: pin.point,
      kind: 'transition',
      style: 'neutral',
      emphasis: 'normal',
      label: labels[0] ?? null,
      badges: [],
      ref: refs[0] ?? { kind: 'dungeon', dungeon: 0, entrance: 0 },
      count: entries.length,
      refs,
      labels,
      mark,
      category,
    };
    const names = entries.map((entry) => entry.member.name);
    const name = names.length <= 2 ? names.join(' / ') : `${names[0] ?? ''} and ${String(names.length - 1)} more`;
    const quests = [...new Set(entries.flatMap((entry) => (spans.get(entry.member.dungeon.areaId)?.quests ?? []).map((quest) => quest.id)))].sort((a, b) => a - b);
    items.push(quests.length === 0 ? { descriptor, name } : { descriptor, name, quests });
  }
  const count = (pick: (member: DungeonMember) => boolean): number => members.filter((member) => pick(member) && drawn.has(member.dungeon.areaId)).length;
  return {
    input: { items, unplaced },
    counts: {
      dungeons: count((member) => member.confirmed && !member.raid),
      raids: count((member) => member.confirmed && member.raid),
      'unconfirmed-raids': count((member) => !member.confirmed),
    },
  };
}

function dungeonNotes(input: PlacesInput, members: readonly DungeonMember[], table: ClientDungeons | null): readonly string[] {
  if (input.dungeons.kind === 'checking') return ['Loading the client dungeon table…'];
  if (table === null) return [];
  const notes: string[] = [];
  notes.push(
    `The instances of the client's dungeon finder (LFGDungeons at ${table.build}, D-039 E), at the dataset's entrances; levels are the "LFG tuning level (client), meaning unverified", one number per row, "?" where the row disagrees with itself.`,
  );
  const unconfirmed = members.filter((member) => !member.confirmed).map((member) => member.name);
  if (unconfirmed.length > 0) notes.push(`Raids with no dungeon-finder row, hidden by default (D-039 F): ${listWords(unconfirmed)}.`);
  const rows = new Map(table.lfg.map((row) => [row.id, row]));
  const announced = ANNOUNCED_INSTANCES.map((instance) => {
    const row = instance.lfg === null ? undefined : rows.get(instance.lfg);
    if (row === undefined) return instance.name;
    const tuning = tuningLevelOf(row, table.build);
    return `${instance.name} (LFG tuning ${tuning.level === null ? '?' : String(tuning.level)})`;
  });
  notes.push(`${plural(ANNOUNCED_INSTANCES.length, 'announced Forever instance has', 'announced Forever instances have')} no known entrance (forever-game-rules.md §5.3): ${listWords(announced)}.`);
  const unknown = UNKNOWN_PURPOSE_MAPS.flatMap((id) => table.instanceMaps.filter((map) => map.id === id).map((map) => map.name));
  if (unknown.length > 0) notes.push(`${plural(unknown.length, 'instance map', 'instance maps')} of unknown purpose not shown: ${listWords(unknown)}.`);
  const withoutEntrance = members.filter((member) => member.dungeon.entrances.every((entrance) => entrance.world === null)).map((member) => member.name);
  if (withoutEntrance.length > 0) notes.push(`${listWords(withoutEntrance)}: no entrance position in the dataset, not drawn.`);
  const hidden = Object.entries(table.undecodedRows).filter(([name]) => name === 'LFGDungeons' || name === 'Map');
  if (hidden.length > 0) notes.push(`The client's lists may be incomplete: ${listWords(hidden.map(([name, rowsCount]) => `${plural(rowsCount, `${name} row`, `${name} rows`)}`))} are encrypted.`);
  notes.push("Quests inside: the dataset's dungeon quests of the instance (their zone is the dungeon), in the log or available after the step.");
  return notes;
}

// ---- Flight points

interface FlightBase {
  readonly key: TaxiNodeKey;
  readonly node: TaxiNode;
  readonly point: WorldPoint | null;
  /** The client row, when the node has one. */
  readonly row: number | null;
  readonly sides: FlightSides;
  readonly other: boolean;
  readonly faction: 'A' | 'H' | null;
  readonly title: string;
  /** The place's short name for the labels canvas (the node's place, else the flight master's name). */
  readonly name: string;
  readonly sideWords: string;
  readonly ref: MapRef;
  readonly questIds: readonly QuestId[];
  readonly starts: string | null;
}

function flightBase(graph: TravelGraph, view: DatasetView, faction: Faction, race: CharacterProfile['race'], cls: CharacterProfile['class']): readonly FlightBase[] {
  const character = { race, class: cls };
  const starts = new Map<number, QuestRecord[]>();
  const masters = new Set(graph.taxiNodes.flatMap((node) => (node.npcId === null ? [] : [node.npcId as number])));
  for (const quest of view.quests()) {
    if (questOpenTo(quest, character) !== true) continue;
    for (const ref of quest.starters) {
      if (ref.kind !== 'npc' || !masters.has(ref.id)) continue;
      const list = starts.get(ref.id) ?? [];
      list.push(quest);
      starts.set(ref.id, list);
    }
  }
  const out: FlightBase[] = [];
  for (const node of graph.taxiNodes) {
    const sides = node.clientSides ?? null;
    // The graph's one faction source (`TaxiNode.factions`, as the engine reads it; TR-08): the row's
    // sides when they name one, else the flight master's faction.
    const alliance = node.factions?.includes('Alliance') ?? false;
    const horde = node.factions?.includes('Horde') ?? false;
    const none = !alliance && !horde;
    const own = faction === 'Alliance' ? alliance : horde;
    const other = !none && !own;
    const both = alliance && horde;
    const basis = sides === null || (!sides.alliance && !sides.horde) ? 'dataset faction' : "client TaxiNodes flags, inferred";
    const sideWords = none ? `the client sets no side for this node` : both ? `both factions (${basis})` : `${alliance ? 'Alliance' : 'Horde'} (${basis})`;
    const npc = node.npcId === null ? undefined : view.npc(node.npcId);
    const place = node.taxiNodeId !== null && sides !== null ? (node.names[node.names.length - 1] ?? node.names[0] ?? '') : (node.names[1] ?? node.names[0] ?? '');
    const master = npc === undefined ? null : npc.subName === null ? npc.name : `${npc.name} <${npc.subName}>`;
    const title = master === null ? place : place === '' || place === npc?.name ? master : `${place} (${master})`;
    const spawns = node.npcId === null ? [] : view.spawns({ kind: 'npc', id: node.npcId });
    const spawnIndex = Math.max(0, spawns.findIndex((spawn) => spawn.world !== null));
    const quests = node.npcId === null ? [] : [...(starts.get(node.npcId) ?? [])].sort((a, b) => a.id - b.id);
    const ref: MapRef =
      node.npcId !== null ? { kind: 'spawn', subject: { kind: 'npc', id: node.npcId }, spawnIndex, questIds: quests.map((quest) => quest.id) } : { kind: 'taxi-node', node: node.taxiNodeId ?? 0 };
    out.push({
      key: node.key,
      node,
      point: node.point,
      row: node.taxiNodeId,
      sides: none ? 'none' : both ? 'both' : 'own',
      other,
      faction: other ? (alliance ? 'A' : 'H') : null,
      title,
      name: place === '' ? (npc?.name ?? title) : place,
      sideWords,
      ref,
      questIds: quests.map((quest) => quest.id),
      starts: quests.length === 0 ? null : quests.length === 1 ? (quests[0]?.name ?? null) : `${plural(quests.length, 'quest', 'quests')} (${listWords(quests.map((quest) => quest.name))})`,
    });
  }
  return out;
}

function flightPointItems(base: readonly FlightBase[], known: ReadonlySet<TaxiNodeKey> | null, historyUnknown: boolean, who: string): PlaceLayerInput {
  const items: PlaceItem[] = [];
  let unplaced = 0;
  for (const node of base) {
    if (node.point === null) {
      if (!node.other) unplaced += 1;
      continue;
    }
    let state: MarkState | null = null;
    let words: string;
    if (node.other) {
      state = 'flight-other-faction';
      words = `${node.faction === 'A' ? 'Alliance' : 'Horde'} only: not usable by ${withArticle(who)}`;
    } else if (known === null) words = 'known to the route or not: no route state yet';
    else if (known.has(node.key)) {
      state = 'flight-known';
      words = `known to the route after step ${STEP_TOKEN}`;
    } else if (historyUnknown) {
      state = 'flight-may-be-known';
      words = `not known to the route after step ${STEP_TOKEN}; may be known before the route (history unknown)`;
    } else {
      state = 'flight-not-known';
      words = `not known to the route after step ${STEP_TOKEN}`;
    }
    const label = `Flight point: ${node.title} · ${node.sideWords} · ${words}${node.starts === null ? '' : `; starts ${node.starts}`}`;
    const mark: MarkerMark | undefined =
      state === null
        ? undefined
        : { state, difficulty: null, dungeonQuest: false, progress: null, ...(node.sides === 'own' ? {} : { sides: node.sides }), ...(node.faction === null ? {} : { faction: node.faction }) };
    const descriptor: MarkerDescriptor = {
      type: 'marker',
      id: `flight:${node.key}`,
      point: node.point,
      kind: 'flight-master',
      style: 'neutral',
      emphasis: 'normal',
      label,
      badges: [],
      ref: node.ref,
      count: 1,
      refs: [node.ref],
      labels: [label],
      ...(mark === undefined ? {} : { mark }),
      category: node.other ? 'other-faction-flights' : 'flight-points',
    };
    items.push(node.row === null ? { descriptor, name: node.name } : { descriptor, node: node.row, name: node.name });
  }
  return { items, unplaced };
}

function flightPointNotes(input: PlacesInput, base: readonly FlightBase[], who: string): readonly string[] {
  const notes: string[] = [];
  const own = base.filter((node) => !node.other);
  const other = base.filter((node) => node.other).length;
  if (input.taxi.kind === 'loaded') notes.push(`Flight points of the client taxi file (${input.taxi.table.build}) at their flight masters; the side is the client's TaxiNodes flags (an inferred decode).`);
  else if (input.taxi.kind === 'checking') notes.push('Loading the client taxi file…');
  else notes.push('The dataset’s flight masters: the client taxi file could not be used.');
  if (input.selected === null) notes.push(`Known flight points need route state: select a step (${withArticle(who)}).`);
  else if (input.character.priorHistory === 'unknown') notes.push('History unknown: a flight point the route does not discover may be known before the route (dashed).');
  if (other > 0) notes.push(`${plural(other, 'flight point', 'flight points')} of the other faction, hidden by default (Other faction’s flight points).`);
  const noSide = own.filter((node) => node.sides === 'none').length;
  if (noSide > 0) notes.push(`${plural(noSide, 'flight point has', 'flight points have')} no side in the client (dashed edge).`);
  const noPosition = own.filter((node) => node.point === null).length;
  if (noPosition > 0) notes.push(`${plural(noPosition, 'flight master has', 'flight masters have')} no position in the dataset: not drawn.`);
  const report = input.graph.report.client;
  if (report !== null && report.unmatchedMasters.length > 0) {
    const one = report.unmatchedMasters.length === 1;
    const names = report.unmatchedMasters.map((id) => input.view.npc(id)?.name ?? `NPC ${String(id)}`);
    notes.push(
      `${plural(report.unmatchedMasters.length, 'flight master stands', 'flight masters stand')} at no node of the client taxi file, which keeps only the nodes of paths that cost something (${listWords(names)}): drawn where the dataset puts ${one ? 'it' : 'them'}, with the dataset's faction (it records no class restriction), and ${one ? 'its' : 'their'} flights timed by the straight-line estimate (TIME-5).`,
    );
  }
  return notes;
}

// ---- The flight network

interface FlightLine {
  readonly item: PlaceItem;
  readonly pair: string;
}

const pairKey = (a: number, b: number): string => (a < b ? `${String(a)}-${String(b)}` : `${String(b)}-${String(a)}`);

/** Splits `points` into pieces of at most `MAX_POLYLINE_VERTICES`, each sharing its first point with the previous piece's last. */
function pieces(points: readonly WorldPoint[]): readonly (readonly WorldPoint[])[] {
  if (points.length <= MAX_POLYLINE_VERTICES) return [points];
  const out: WorldPoint[][] = [];
  for (let start = 0; start < points.length - 1; start += MAX_POLYLINE_VERTICES - 1) out.push(points.slice(start, start + MAX_POLYLINE_VERTICES));
  return out;
}

function flightLines(taxi: ClientTaxi, faction: Faction, rules: EffectiveRules): readonly FlightLine[] {
  const rows = new Map(taxi.nodes.map((row) => [row.id, row]));
  const usable = (id: number): boolean => {
    const row = rows.get(id);
    if (row === undefined) return false;
    if (!row.alliance && !row.horde) return true;
    return faction === 'Alliance' ? row.alliance : row.horde;
  };
  const nameOf = (id: number): string => rows.get(id)?.name ?? `node ${String(id)}`;
  const byPair = new Map<string, ClientTaxiFlight[]>();
  for (const flight of taxi.flights) {
    if (!usable(flight.from) || !usable(flight.to)) continue;
    const key = pairKey(flight.from, flight.to);
    const list = byPair.get(key) ?? [];
    list.push(flight);
    byPair.set(key, list);
  }
  const values = rules.values;
  const speed = values.taxiSpeed.value * (1 + values.taxiSpeedBonusPct.value / 100);
  const speedWords = `${String(Math.round(speed * 10) / 10)} yd/s (${values.taxiSpeed.basis} taxi speed${values.taxiSpeedBonusPct.value === 0 ? '' : `, +${String(values.taxiSpeedBonusPct.value)}% (${values.taxiSpeedBonusPct.basis})`})`;
  const master = `${String(values.flightMasterSeconds.value)} s at the flight master (${values.flightMasterSeconds.basis})`;
  const out: FlightLine[] = [];
  for (const [key, flights] of [...byPair].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const sorted = [...flights].sort((a, b) => a.pathId - b.pathId);
    const first = sorted[0];
    if (first === undefined) continue;
    const low = Math.min(first.from, first.to);
    const high = Math.max(first.from, first.to);
    const there = sorted.find((flight) => flight.from === low);
    const back = sorted.find((flight) => flight.from === high);
    const leg = (flight: ClientTaxiFlight | undefined, from: number, to: number): string | null =>
      flight === undefined ? null : `${nameOf(from)} to ${nameOf(to)} ≈ ${clock(flight.l3dYards / speed)} (client path ${group(flight.l3dYards)} yd, TaxiPath ${String(flight.pathId)})`;
    const legs = [leg(there, low, high), leg(back, high, low)].filter((text): text is string => text !== null);
    const label = `Flight: ${legs.join('; ')} · at ${speedWords}, plus ${master}`;
    const shape = first.shape;
    const parts = pieces(shape);
    parts.forEach((points, index) => {
      if (points.length < 2) return;
      const descriptor: PolylineDescriptor = {
        type: 'polyline',
        id: `flight:${key}${parts.length > 1 ? `:${String(index)}` : ''}`,
        mapId: first.shape[0]?.mapId ?? rows.get(low)?.point.mapId ?? (0 as WorldMapId),
        points,
        style: 'network-flight',
        emphasis: 'normal',
        label,
        ref: { kind: 'taxi-edge', from: low, to: high },
      };
      out.push({ item: { descriptor, nodes: [low, high] }, pair: key });
    });
  }
  return out;
}

const NO_PAIRS: ReadonlySet<string> = new Set();

/** The flights the route's flight steps take (§25.4): each journey as TIME-6 routes it, with the flight points known when it is flown. */
function routeFlightPairs(records: readonly StepRecord[], graph: TravelGraph, legs: TaxiLegData, startKnown: ReadonlySet<TaxiNodeKey>, faction: Faction): ReadonlySet<string> {
  const byPoint = new Map<string, TaxiNode>();
  const byRow = new Map<number, TaxiNode[]>();
  for (const node of graph.taxiNodes) {
    if (node.point !== null && !byPoint.has(pointKey(node.point))) byPoint.set(pointKey(node.point), node);
    if (node.taxiNodeId !== null) byRow.set(node.taxiNodeId, [...(byRow.get(node.taxiNodeId) ?? []), node]);
  }
  const known = new Set(startKnown);
  const out = new Set<string>();
  for (const record of records) {
    const step = record.step;
    if (step.kind === 'flight' && step.mode === 'take') {
      // The nodes as the walker took them: the step's own refs, else where it walked to and where it arrived.
      const departure = [...record.legs].reverse().find((leg) => leg.purpose === 'flight-master')?.to.point ?? null;
      const arrival = record.delta.locationAfter;
      const byRef = (ref: FlightStep['from']): TaxiNode | undefined => {
        if (ref === null) return undefined;
        const lookup = resolveTaxiNodeRef(graph, ref, faction);
        return lookup.kind === 'node' ? lookup.node : undefined;
      };
      const from = byRef(step.from) ?? (departure === null ? undefined : byPoint.get(pointKey(departure)));
      const to = (arrival === null ? undefined : byPoint.get(pointKey(arrival))) ?? byRef(step.to);
      const fromRow = from?.taxiNodeId ?? null;
      const toRow = to?.taxiNodeId ?? null;
      if (fromRow !== null && toRow !== null && fromRow !== toRow) {
        const usable = (row: number): boolean => (byRow.get(row) ?? []).some((node) => known.has(node.key) && (node.factions === null || node.factions.includes(faction)));
        const journey = localTaxiRoute(legs, fromRow, toRow, usable);
        if (journey !== null) for (let i = 1; i < journey.nodes.length; i += 1) out.add(pairKey(journey.nodes[i - 1] ?? 0, journey.nodes[i] ?? 0));
      }
    }
    for (const key of record.delta.flightPathsLearned) known.add(key);
  }
  return out;
}

function withRouteFlags(lines: readonly FlightLine[], route: ReadonlySet<string>): PlaceLayerInput {
  return { items: lines.map((line) => (route.has(line.pair) ? { ...line.item, route: true } : line.item)), unplaced: 0 };
}

function flightNotes(input: PlacesInput, lines: readonly FlightLine[] | null): readonly string[] {
  if (input.taxi.kind === 'checking') return ['Loading the client taxi file…'];
  if (lines === null) return [];
  const pairs = new Set(lines.map((line) => line.pair)).size;
  return [
    `${plural(pairs, 'flight', 'flights')} the character's side may fly (client TaxiPath with a cost, D-039 B), along the client's path simplified to 25 yd.`,
    'Zoomed in: only the hovered or selected flight point’s flights and the route’s own (All flights when zoomed in shows the rest).',
    'Times: the client path length at the effective taxi speed (TIME-6); the route between flight points is an assumption, as the server’s routing is unknown.',
  ];
}

// ---- Transports

interface TransportParts {
  readonly input: PlaceLayerInput;
  readonly notes: readonly string[];
  readonly stops: number;
}

function transportItems(taxi: ClientTaxi, seeds: readonly TransportSeed[], mapName: (mapId: WorldMapId) => string): TransportParts {
  interface Stop {
    readonly point: WorldPoint;
    readonly uses: { readonly path: number; readonly index: number; readonly count: number; readonly seed: TransportSeed | null; readonly seedStop: number | null; readonly to: readonly WorldPoint[] }[];
  }
  const stops = new Map<string, Stop>();
  const lines: PlaceItem[] = [];
  for (const path of taxi.transports) {
    const seed = seeds.find((candidate) => candidate.clientPath === path.pathId) ?? null;
    path.stops.forEach((stop, index) => {
      const seedStop = seed === null ? -1 : seed.stops.findIndex((candidate) => candidate.clientStop === index && candidate.mapId === stop.point.mapId);
      const key = pointKey(stop.point);
      const entry = stops.get(key) ?? { point: stop.point, uses: [] };
      entry.uses.push({
        path: path.pathId,
        index,
        count: path.stops.length,
        seed: seedStop < 0 ? null : seed,
        seedStop: seedStop < 0 ? null : seedStop,
        to: path.stops.filter((_, other) => other !== index).map((other) => other.point),
      });
      stops.set(key, entry);
    });
    // Rides: consecutive distinct stops, a line on one map, a connector between two.
    const distinct = path.stops.filter((stop, index) => index === 0 || pointKey(stop.point) !== pointKey(path.stops[index - 1]?.point ?? stop.point));
    for (let i = 1; i < distinct.length; i += 1) {
      const a = distinct[i - 1]?.point;
      const b = distinct[i]?.point;
      if (a === undefined || b === undefined || pointKey(a) === pointKey(b)) continue;
      const service = seed === null ? 'Transport route (service unknown)' : `${seed.name} (service inferred from client transport path ${String(path.pathId)})`;
      const ref: MapRef = { kind: 'transport', path: path.pathId, stop: null };
      if (a.mapId === b.mapId) {
        const descriptor: PolylineDescriptor = {
          type: 'polyline',
          id: `ride:${String(path.pathId)}:${String(i)}`,
          mapId: a.mapId,
          points: [a, b],
          style: 'network-transport',
          emphasis: 'normal',
          label: `${service} · a straight line between its stops, not the ship’s course`,
          ref,
          // Hidden with its stops (the Transport stops row; review PR-11).
          category: 'transport-stops',
        };
        lines.push({ descriptor });
      } else {
        const descriptor: ConnectorDescriptor = {
          type: 'connector',
          id: `ride:${String(path.pathId)}:${String(i)}`,
          from: a,
          to: b,
          // The travel network's ride, never the route's own transport leg (review PR-11): thin muted
          // ink dashed 3-3 over its halo, with a neutral transition glyph; hidden with its stops.
          style: 'network-transport',
          emphasis: 'normal',
          label: `${service}: ${mapName(a.mapId)} to ${mapName(b.mapId)}`,
          ref,
          category: 'transport-stops',
        };
        lines.push({ descriptor });
      }
    }
  }
  const pins: PlaceItem[] = [];
  let matched = 0;
  let unknown = 0;
  for (const [key, stop] of [...stops].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const inferred = stop.uses.filter((use) => use.seed !== null);
    const labels = stop.uses.map((use) => {
      const record = `client transport path ${String(use.path)}, stop ${String(use.index + 1)} of ${String(use.count)}`;
      if (use.seed === null || use.seedStop === null) {
        const where = [...new Set(use.to.map((point) => (point.mapId === stop.point.mapId ? 'another stop on this map' : mapName(point.mapId))))];
        return `Transport stop (service unknown) · ${record} · ${where.length === 0 ? 'the path has no other stop' : `to ${listWords(where)}`}`;
      }
      const seed = use.seed;
      const here = seed.stops[use.seedStop]?.name ?? '';
      const destinations = seed.stops.filter((_, index) => index !== use.seedStop).map((other) => other.name);
      return `Transport stop: ${here}, ${seed.name} to ${listWords(destinations)} (service inferred from ${record}) · wait and ride times assumed (TIME-7)`;
    });
    if (inferred.length > 0) matched += 1;
    else unknown += 1;
    const refs: MapRef[] = stop.uses.map((use) => ({ kind: 'transport', path: use.path, stop: use.index }));
    const mark: MarkerMark = { state: inferred.length > 0 ? 'transport-inferred' : 'transport-unknown', difficulty: null, dungeonQuest: false, progress: null };
    const descriptor: MarkerDescriptor = {
      type: 'marker',
      id: `stop:${key}`,
      point: stop.point,
      kind: 'transition',
      style: 'neutral',
      emphasis: 'normal',
      label: labels[0] ?? null,
      badges: [],
      ref: refs[0] ?? { kind: 'transport', path: 0, stop: 0 },
      count: refs.length,
      refs,
      labels,
      mark,
      category: 'transport-stops',
    };
    pins.push({ descriptor });
  }
  const unmatchedPaths = taxi.transports.filter((path) => !seeds.some((seed) => seed.clientPath === path.pathId)).map((path) => String(path.pathId));
  const notes = [
    `Transport stops of the client taxi file (${taxi.build}): ${plural(matched, 'stop', 'stops')} of a service the route can use (which service a client path is, and which stop a dock is, is inferred), ${plural(unknown, 'stop', 'stops')} of a service not known: drawn only, never used for a route.`,
    `Rides are drawn between the stops: straight on one map, as an arc between the continents on the atlas.`,
    ...(unmatchedPaths.length === 0 ? [] : [`Client transport paths with no known service: ${listWords(unmatchedPaths)}.`]),
  ];
  return { input: { items: [...lines, ...pins], unplaced: 0 }, notes, stops: stops.size };
}

// ---- Services (MP.11)

const NO_NPCS: readonly NpcId[] = [];

/** QuestieDB's Era `npcFlags` bits the services read (questiedb-schema.md, NPC field 15), tested arithmetically (D-012). */
export const SERVICE_FLAGS = { vendor: 4, trainer: 16, innkeeper: 128 } as const;

const hasFlag = (flags: number, bit: number): boolean => Math.floor(flags / bit) % 2 === 1;

const SERVICE_CATEGORY: Readonly<Record<ServiceKind, MapCategoryId>> = { innkeeper: 'innkeepers', trainer: 'trainers', vendor: 'vendors' };

/**
 * What an NPC offers the character, the first that applies (one pin per NPC): an innkeeper, a trainer
 * of the character's class (the dataset's title "Warrior Trainer"), or a vendor; null for none.
 */
export function serviceKindOf(npc: { readonly npcFlags: number; readonly subName: string | null }, cls: CharacterProfile['class']): ServiceKind | null {
  if (hasFlag(npc.npcFlags, SERVICE_FLAGS.innkeeper)) return 'innkeeper';
  if (hasFlag(npc.npcFlags, SERVICE_FLAGS.trainer) && npc.subName === `${CLASS_NAMES[cls]} Trainer`) return 'trainer';
  // Another class's or a profession's trainer who also sells ("Martha Strain <Demon Trainer>") is
  // not drawn as a vendor for this character: its title says what it is (review PR-21).
  if (npc.subName !== null && npc.subName.endsWith(' Trainer')) return null;
  if (hasFlag(npc.npcFlags, SERVICE_FLAGS.vendor)) return 'vendor';
  return null;
}

/** The services layer's pins, notes and counts (§11): the side's and both factions' NPCs, one pin per placed spawn. */
function serviceItems(
  view: DatasetView,
  ids: readonly NpcId[],
  faction: Faction,
  cls: CharacterProfile['class'],
): { readonly input: PlaceLayerInput; readonly notes: readonly string[]; readonly counts: Partial<Record<MapCategoryId, number>> } {
  const side = faction === 'Alliance' ? 'A' : 'H';
  const className = CLASS_NAMES[cls];
  const items: PlaceItem[] = [];
  const drawn: Record<ServiceKind, number> = { innkeeper: 0, trainer: 0, vendor: 0 };
  let unplaced = 0;
  let unknownSide = 0;
  let inside = 0;
  for (const id of ids) {
    const npc = view.npc(id);
    if (npc === undefined) continue;
    const kind = serviceKindOf(npc, cls);
    if (kind === null) continue;
    if (npc.friendlyTo === null) {
      unknownSide += 1;
      continue;
    }
    if (!npc.friendlyTo.includes(side)) continue;
    const sideWords = npc.friendlyTo === 'AH' ? 'both factions' : faction;
    const label =
      kind === 'innkeeper'
        ? `Innkeeper: ${npc.name} · ${sideWords} · Set hearth here after step ${STEP_TOKEN}`
        : kind === 'trainer'
          ? `${className} trainer: ${npc.name} · ${sideWords} · Train here after step ${STEP_TOKEN}`
          : `Vendor: ${npc.name}${npc.subName === null ? '' : ` <${npc.subName}>`} (dataset only) · ${sideWords} · Buy here after step ${STEP_TOKEN}`;
    let placed = 0;
    view.spawns({ kind: 'npc', id }).forEach((spawn, index) => {
      // A spawn inside an instance is drawn at no entrance: the service is not reachable there.
      if (spawn.world === null || !('space' in spawn.source)) {
        if (spawn.world !== null) inside += 1;
        return;
      }
      placed += 1;
      const ref: MapRef = { kind: 'service', service: kind, npc: id, spawnIndex: index };
      const descriptor: MarkerDescriptor = {
        type: 'marker',
        id: `service:npc:${String(id)}:${String(index)}`,
        point: spawn.world,
        kind: 'transition',
        style: 'neutral',
        emphasis: 'normal',
        label,
        badges: [],
        ref,
        count: 1,
        refs: [ref],
        labels: [label],
        mark: { state: kind, difficulty: null, dungeonQuest: false, progress: null },
        category: SERVICE_CATEGORY[kind],
      };
      items.push({ descriptor, name: npc.name });
    });
    if (placed === 0) unplaced += 1;
    else drawn[kind] += 1;
  }
  const sideName = faction === 'Alliance' ? 'the Alliance' : 'the Horde';
  const notes = [
    `Innkeepers and ${className} trainers of ${sideName} and of both factions, from the dataset (QuestieDB's NPC flags, Era): drawn from zoom −2.75.`,
    `Vendors: only the ${plural(drawn.vendor, 'vendor', 'vendors')} the dataset carries for ${sideName} (those tied to quests); many vendors are missing. Drawn at the close band.`,
    'Profession trainers are not shown yet.',
    ...(unknownSide > 0 ? [`${plural(unknownSide, 'service NPC has', 'service NPCs have')} no faction in the dataset: not drawn.`] : []),
    ...(unplaced > 0 ? [`${plural(unplaced, 'service NPC has', 'service NPCs have')} no placed spawn in the dataset: not drawn.`] : []),
    ...(inside > 0 ? [`${plural(inside, 'spawn is', 'spawns are')} inside an instance: not drawn at its entrance.`] : []),
  ];
  return { input: { items, unplaced }, notes, counts: { innkeepers: drawn.innkeeper, trainers: drawn.trainer, vendors: drawn.vendor } };
}
