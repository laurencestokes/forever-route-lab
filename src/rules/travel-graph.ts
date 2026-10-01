import type { Faction } from '../domain/character';
import type { DatasetView } from '../domain/dataset';
import type { AreaId, NpcId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { TaxiNodeRef } from '../domain/route';
import type { EffectiveRules, EffectiveValue } from './precedence';
import type { RuleBasis } from './ruleset';
import { berthBoarding } from './berths';
import { isFlightMaster } from './travel-graph-flags';
import { FOREVER_TAXI_NODE_SEEDS, type TaxiNodeSeed, TRANSPORT_SEEDS, type TransportSeed } from './travel-seeds';

/**
 * The TravelGraph (docs/ARCHITECTURE.md §9.1; docs/SIMULATION.md TIME-5, TIME-6, TIME-7;
 * terrain-navigation.md §9.3). It holds what joins places beyond walking: transports, taxi nodes
 * and their flights, and instance entrance edges. Moves between world maps go through it; so do
 * same-map pairs that the navigation data cannot walk between but a transport joins.
 *
 * With the committed client taxi file (D-039 B, `CommittedTaxi`; map-presentation.md §9, §10):
 * its nodes are joined to the dataset's flight masters (the nearest within
 * `CLIENT_NODE_MATCH_YARDS`, INFERRED), the rows no flight master stands at become nodes of their
 * own, its flights become the taxi edges (their path lengths are TIME-6's per-leg data), and the
 * stops of the transport paths the seeds cite give the seeded docks an inferred position (TIME-7;
 * NAV-08): the client berths, which lie in the water beside the piers, each with its boarding
 * point on walkable ground (`TransportDock.boarding`, src/rules/berths.ts). A node's
 * factions (`TaxiNode.factions`) are the one faction source of the engine and the map.
 * Without it the graph is the dataset's flight masters, the cited seeds and TIME-5.
 *
 * `rules` may import only `domain` values, so the dataset comes in through `TravelGraphSource`,
 * whose points are already resolved world points (the app resolves them with `geo`), and the taxi
 * file through `CommittedTaxi`, which the app's loader decodes (`src/infra/maps/client-tables.ts`).
 */

// =============================================================================================
// Types

/** A taxi node's identity in the graph: a dataset flight master, or a TaxiNodes row (cited, or from the committed file). */
export type TaxiNodeKey = `npc:${number}` | `taxi:${number}`;

/** Which sides a client TaxiNodes row lets fly (`Flags` bits 0 and 1; an INFERRED decode). */
export interface ClientSides {
  readonly alliance: boolean;
  readonly horde: boolean;
}

export interface TaxiNode {
  readonly key: TaxiNodeKey;
  readonly npcId: NpcId | null;
  /** The TaxiNodes row: cited, the committed file's, or the one a dataset flight master was matched to. */
  readonly taxiNodeId: number | null;
  /** Names a query can match: the flight master's name and its zone, the client node name, or the cited node name. */
  readonly names: readonly string[];
  /** Null when the flight master's spawns resolve to no world point. */
  readonly point: WorldPoint | null;
  /**
   * Who may use the node; null when unknown. The one faction source of the engine (TIME-5, TIME-6:
   * endpoints, intermediate nodes, queries) and of the map: a node with a committed client row
   * takes the row's sides when they name one (`Flags`, an INFERRED decode), else the dataset
   * flight master's faction; a cited node its seed's.
   */
  readonly factions: readonly Faction[] | null;
  /**
   * `dataset`: a flight master's spawn (a source input); `cited`: a client TaxiNodes row cited in
   * the seeds (D-022); `client`: a row of the committed taxi file no flight master stands at (D-039 B).
   */
  readonly origin: 'dataset' | 'cited' | 'client';
  readonly source: string;
  /** The sides the committed file's row lets fly; null or absent without a row. */
  readonly clientSides?: ClientSides | null;
}

/**
 * A direct taxi flight between two graph nodes: one `TaxiPath` of the committed file, or a leg
 * given by the caller (`TravelGraphSeedOptions.taxiEdges`), as `report.client.edgeSource` says.
 * It says only which flights exist: TIME-6's lengths are the per-leg data the walker is given
 * (`EngineContext.localTaxi`, `taxiLegDataOf`), so the graph does not carry them a second time.
 */
export interface TaxiEdge {
  readonly from: TaxiNodeKey;
  readonly to: TaxiNodeKey;
}

export interface TransportDock {
  /** Index of the stop in the seed's stop list. */
  readonly stop: number;
  readonly name: string;
  readonly mapId: WorldMapId;
  /** Null until a dock NPC, a user-entered location or a matched client transport stop gives it (TIME-7). */
  readonly point: WorldPoint | null;
  /**
   * Where the position comes from: a dock NPC's spawn, a user-entered location, or `inferred`, the
   * committed taxi file's stop that the seed was matched to by hand (map-presentation.md §10: which
   * service a client path is, and which of its stops a dock is, is INFERRED; `record` names it).
   */
  readonly pointFrom: 'dock-npc' | 'user' | 'inferred' | null;
  readonly npcId: NpcId | null;
  /** For an inferred dock, its matching record: "client transport path 11167, stop 2 of 3"; absent otherwise. */
  readonly record?: string;
  /**
   * For an inferred dock (a client berth, in the water beside its pier): where walks to and from
   * the dock end, the nearest walkable navmesh point within `BOARDING_RADIUS_YD` of the berth
   * (TIME-7, src/rules/berths.ts); the step between it and the berth is timed at run speed (D-052
   * item 1). Absent for other docks and for a berth without one: walks then end at `point`.
   */
  readonly boarding?: DockBoarding;
}

/** A client berth's boarding point and its straight-line yards from the berth (TIME-7). */
export interface DockBoarding {
  readonly point: WorldPoint;
  readonly fromBerthYd: number;
}

/** One directed transport crossing: board at `from`, leave at `to`. */
export interface TransportEdge {
  /** `${transportId}:${from.stop}>${to.stop}`. */
  readonly id: string;
  /** The record `TransportRef.id` names. */
  readonly transportId: string;
  readonly name: string;
  readonly from: TransportDock;
  readonly to: TransportDock;
  /** The assumed defaults (TIME-7); a record carries no measured times. */
  readonly waitS: EffectiveValue<number>;
  readonly rideS: EffectiveValue<number>;
  readonly factions: readonly Faction[] | null;
  /** What is known about the transport's existence (a client path does not prove a server route). */
  readonly basis: RuleBasis;
  readonly source: string;
}

/**
 * A zero-wait link between a dungeon entrance on its outdoor map and the dungeon's instance map
 * (TIME-7). It works both ways: entering and leaving. Basis `assumption` (zero wait, zero
 * in-instance distance).
 */
export interface EntranceEdge {
  readonly dungeonAreaId: AreaId;
  readonly name: string;
  readonly instanceMapId: WorldMapId;
  /** The entrance on the outdoor map. */
  readonly outdoor: WorldPoint;
  /** Index of the entrance in the dungeon's entrance list. */
  readonly index: number;
  /** True when the instance is a raid (KXP-5: raid elites take the open-world multiplier). */
  readonly raid: boolean;
}

/** A dungeon as the seed needs it: resolved entrances and its instance world map. */
export interface DungeonEntrances {
  readonly dungeonAreaId: AreaId;
  readonly name: string;
  /** The dungeon's instance `WorldMapId`; null when the dataset has none (no edge, TIME-7). */
  readonly instanceMapId: WorldMapId | null;
  /**
   * True for a raid, from the instance type in `zones.json` (KXP-5). Absent or false: a five-player
   * dungeon, which is also the assumption while the dataset does not give the type.
   */
  readonly raid?: boolean;
  /**
   * In dataset order. `point` is the resolved outdoor position (null when it does not resolve);
   * `frameVerified: false` marks an entrance QuestieDB's coordinate audit leaves unverified
   * (DATA_PROVENANCE §6.6, M2 review COORD-4), which seeds no edge.
   */
  readonly entrances: readonly { readonly point: WorldPoint | null; readonly frameVerified: boolean }[];
}

/**
 * The dataset seen by the seed: the project's `DatasetView` (faction variant) plus what a view
 * cannot list, the candidate flight masters and the dungeons with their entrances (for the
 * character's faction: three battleground entrances differ by faction).
 */
export interface TravelGraphSource extends Pick<DatasetView, 'npc' | 'spawns' | 'zone'> {
  /** NPC ids that may be flight masters in any faction variant; the seed checks each record's flags. */
  readonly flightMasterIds: readonly NpcId[];
  readonly dungeons: readonly DungeonEntrances[];
}

/** A dock position the user entered for a stop of a seeded transport. */
export interface UserDock {
  readonly transportId: string;
  readonly stop: number;
  readonly point: WorldPoint;
}

/**
 * The committed client taxi file as the seed reads it (D-039 B; `public/maps/client/taxi.json`,
 * decoded and hash-checked by the app's loader, whose `ClientTaxi` has this shape). Positions are
 * world points (D-017). Every number is the client's: nothing here is estimated.
 */
export interface CommittedTaxi {
  /** The client build the file was read from (`1.60.1.70009`). */
  readonly build: string;
  /** `TaxiNodes` rows on paid paths of maps 0 and 1, ascending by id. */
  readonly nodes: readonly CommittedTaxiNode[];
  /** `TaxiPath` rows with `Cost` > 0 between two of those nodes, ascending by path id. */
  readonly flights: readonly CommittedTaxiFlight[];
  /** The transport paths (`TaxiPath` rows with `Delay` stops), ascending by path id. */
  readonly transports: readonly CommittedTransportPath[];
}

export interface CommittedTaxiNode {
  readonly id: number;
  /** `TaxiNodes.Name_lang` ("Crossroads, The Barrens"). */
  readonly name: string;
  readonly point: WorldPoint;
  /** `Flags` bit 0 (value 1): Alliance; an INFERRED decode. */
  readonly alliance: boolean;
  /** `Flags` bit 1 (value 2): Horde; an INFERRED decode. */
  readonly horde: boolean;
}

export interface CommittedTaxiFlight {
  readonly pathId: number;
  readonly from: number;
  readonly to: number;
  /** The 3D length along the path's `TaxiPathNode` points (TIME-6), rounded to 1 yd. */
  readonly l3dYards: number;
}

export interface CommittedTransportPath {
  readonly pathId: number;
  readonly maps: readonly WorldMapId[];
  /** The path's `Delay` stops in `NodeIndex` order. */
  readonly stops: readonly { readonly point: WorldPoint; readonly delaySeconds: number }[];
}

export interface TravelGraphSeedOptions {
  /** Default TRANSPORT_SEEDS. */
  readonly transports?: readonly TransportSeed[];
  /** Default FOREVER_TAXI_NODE_SEEDS. */
  readonly taxiNodes?: readonly TaxiNodeSeed[];
  readonly userDocks?: readonly UserDock[];
  /** Known direct taxi legs given by the caller (for example a local extraction); none by default. */
  readonly taxiEdges?: readonly TaxiEdge[];
  /**
   * The committed client taxi file (D-039 B): nodes, flights and the transport stops the seeds'
   * docks are matched to. Null or absent: none (TIME-5, docks from dock NPCs and the user only).
   */
  readonly taxi?: CommittedTaxi | null;
}

/** What the seed made of the committed taxi file (`TravelGraphReport.client`). */
export interface ClientTaxiReport {
  readonly build: string;
  /** Client rows a dataset flight master was matched to, and the rows that became nodes of their own. */
  readonly matchedNodes: number;
  readonly clientNodes: number;
  /** Dataset flight masters with a position and no client row within `CLIENT_NODE_MATCH_YARDS`, ascending. */
  readonly unmatchedMasters: readonly NpcId[];
  /** Cited node seeds the file has a row for, which its row replaces, ascending. */
  readonly citedReplaced: readonly number[];
  /** The graph's taxi edges (`TravelGraph.taxiEdges`), and where they come from. */
  readonly edges: number;
  /** `file`: the file's flights; `caller`: the legs given in `TravelGraphSeedOptions.taxiEdges`, which replace them. */
  readonly edgeSource: 'file' | 'caller';
  /** Seeded docks positioned from a matched client stop (a user dock or dock NPC wins over it). */
  readonly inferredDocks: number;
  /** Client transport paths no seed cites: their stops never reach the graph, ascending. */
  readonly unmatchedPaths: readonly number[];
}

/** What the seed found and what it had to leave out. */
export interface TravelGraphReport {
  readonly taxiNodes: { readonly dataset: number; readonly cited: number; readonly withoutPosition: number };
  readonly transports: {
    readonly records: number;
    readonly edges: number;
    readonly positionedEdges: number;
    readonly docksFromNpc: number;
    readonly docksFromUser: number;
    /** User docks naming no seeded stop, or on another world map than the stop. */
    readonly userDocksIgnored: number;
  };
  readonly entrances: {
    readonly edges: number;
    readonly frameUnverified: number;
    readonly noInstanceMap: number;
    readonly unresolved: number;
  };
  /** The committed taxi file's part; null when the graph was seeded without it. */
  readonly client: ClientTaxiReport | null;
}

export interface TravelGraph {
  /** Ascending by `taxiNodeOrder` (dataset nodes by NPC id, then cited nodes by TaxiNodes id). */
  readonly taxiNodes: readonly TaxiNode[];
  readonly taxiEdges: readonly TaxiEdge[];
  /** In seed order, then by stop pair. */
  readonly transports: readonly TransportEdge[];
  /** By dungeon area id, then entrance index. */
  readonly entrances: readonly EntranceEdge[];
  readonly report: TravelGraphReport;
}

// =============================================================================================
// Seeding

export { FLIGHT_MASTER_FLAG, isFlightMaster } from './travel-graph-flags';

/** The key of a dataset flight master's node. */
export const npcNodeKey = (id: NpcId): TaxiNodeKey => `npc:${id}`;

const FACTIONS_OF: Readonly<Record<'A' | 'H' | 'AH', readonly Faction[]>> = {
  A: ['Alliance'],
  H: ['Horde'],
  AH: ['Alliance', 'Horde'],
};

/** The order of taxi nodes: dataset nodes by NPC id, then the TaxiNodes rows (cited or the committed file's) by id. */
export function taxiNodeOrder(a: TaxiNode, b: TaxiNode): number {
  const aDataset = a.origin === 'dataset';
  if (aDataset !== (b.origin === 'dataset')) return aDataset ? -1 : 1;
  const idA = a.npcId ?? a.taxiNodeId ?? 0;
  const idB = b.npcId ?? b.taxiNodeId ?? 0;
  return idA - idB;
}

/**
 * How far a dataset flight master may stand from a TaxiNodes row of the committed file to be that
 * node (INFERRED, as TIME-6's local rule): measured at 1.60.1.70009, the 60 flight masters on paid
 * paths stand within 11.5 yd of their row, and the next nearest (the Moonglade druid flight
 * masters, whose paths cost nothing) 338 yd away. A row further away is another node.
 */
export const CLIENT_NODE_MATCH_YARDS = 50;

/** The factions a client row's side flags name; null when it names none (the client sets no side). */
export function factionsOfSides(sides: ClientSides): readonly Faction[] | null {
  if (sides.alliance && sides.horde) return FACTIONS_OF.AH;
  if (sides.alliance) return FACTIONS_OF.A;
  if (sides.horde) return FACTIONS_OF.H;
  return null;
}

function datasetTaxiNode(source: TravelGraphSource, id: NpcId): TaxiNode | null {
  const npc = source.npc(id);
  if (npc === undefined || !isFlightMaster(npc)) return null;
  // The first spawn with a world point, in dataset order (a flight master has one in practice).
  const spawn = source.spawns({ kind: 'npc', id }).find((candidate) => candidate.world !== null);
  const names = [npc.name];
  const zoneId = spawn?.uiMapId ?? null;
  const zoneName = zoneId === null ? null : (source.zone(zoneId)?.name ?? null);
  if (zoneName !== null && zoneName !== npc.name) names.push(zoneName);
  return {
    key: npcNodeKey(id),
    npcId: id,
    taxiNodeId: null,
    names,
    point: spawn?.world ?? null,
    factions: npc.friendlyTo === null ? null : FACTIONS_OF[npc.friendlyTo],
    origin: 'dataset',
    source: 'dataset flight master (npcFlags FLIGHT_MASTER)',
  };
}

function citedTaxiNode(seed: TaxiNodeSeed): TaxiNode {
  return {
    key: `taxi:${seed.taxiNodeId}`,
    npcId: null,
    taxiNodeId: seed.taxiNodeId,
    names: [seed.name],
    point: { mapId: seed.mapId, x: seed.x, y: seed.y },
    factions: seed.factions,
    origin: 'cited',
    source: `${seed.source}, ${seed.build}`,
  };
}

function clientTaxiNode(row: CommittedTaxiNode, build: string): TaxiNode {
  const sides: ClientSides = { alliance: row.alliance, horde: row.horde };
  return {
    key: `taxi:${row.id}`,
    npcId: null,
    taxiNodeId: row.id,
    names: [row.name],
    point: row.point,
    factions: factionsOfSides(sides),
    origin: 'client',
    source: `client TaxiNodes row ${String(row.id)} (committed taxi file, build ${build})`,
    clientSides: sides,
  };
}

/** The committed row nearest `point` on its world map within `CLIENT_NODE_MATCH_YARDS`; ties go to the lower id. */
function nearestClientRow(rows: readonly CommittedTaxiNode[], point: WorldPoint): CommittedTaxiNode | null {
  let best: CommittedTaxiNode | null = null;
  let bestYards = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const yards = planarYards(point, row.point);
    if (yards === null || yards > CLIENT_NODE_MATCH_YARDS) continue;
    if (yards < bestYards || (yards === bestYards && best !== null && row.id < best.id)) {
      best = row;
      bestYards = yards;
    }
  }
  return best;
}

/**
 * A dataset flight master's node with the committed row it stands at: the row's id, name and
 * sides, and the sides as its factions when they name one (the one faction source, `factions`).
 */
function withClientRow(node: TaxiNode, row: CommittedTaxiNode, build: string): TaxiNode {
  const names = node.names.includes(row.name) ? node.names : [...node.names, row.name];
  const sides: ClientSides = { alliance: row.alliance, horde: row.horde };
  return {
    ...node,
    taxiNodeId: row.id,
    names,
    factions: factionsOfSides(sides) ?? node.factions,
    source: `${node.source}; client TaxiNodes row ${String(row.id)} (committed taxi file, build ${build}; matched by position, INFERRED)`,
    clientSides: sides,
  };
}

function dockOf(
  source: TravelGraphSource,
  seed: TransportSeed,
  index: number,
  userDocks: readonly UserDock[],
  taxi: CommittedTaxi | null,
): TransportDock {
  const stop = seed.stops[index];
  if (stop === undefined) throw new RangeError(`Transport ${seed.id} has no stop ${String(index)}`);
  const user = userDocks.find((dock) => dock.transportId === seed.id && dock.stop === index && dock.point.mapId === stop.mapId);
  if (user !== undefined) return { stop: index, name: stop.name, mapId: stop.mapId, point: user.point, pointFrom: 'user', npcId: null };
  for (const npcId of stop.dockNpcIds) {
    const world = source.spawns({ kind: 'npc', id: npcId }).find((candidate) => candidate.world?.mapId === stop.mapId)?.world ?? null;
    if (world !== null) return { stop: index, name: stop.name, mapId: stop.mapId, point: world, pointFrom: 'dock-npc', npcId };
  }
  const inferred = inferredDock(seed, index, taxi);
  if (inferred !== null) {
    const dock: TransportDock = { stop: index, name: stop.name, mapId: stop.mapId, point: inferred.point, pointFrom: 'inferred', npcId: null, record: inferred.record };
    return inferred.boarding === null ? dock : { ...dock, boarding: inferred.boarding };
  }
  return { stop: index, name: stop.name, mapId: stop.mapId, point: null, pointFrom: null, npcId: null };
}

/**
 * A seeded stop's position from the committed taxi file (TIME-7, map-presentation.md §10): the
 * `clientStop`-th stop of the seed's `clientPath`, when the file has that path and that stop is on
 * the seed stop's world map; null otherwise (a stop on another map is never taken). With it, the
 * berth's boarding point (src/rules/berths.ts), or null when the table has none for this berth.
 */
export function inferredDock(
  seed: TransportSeed,
  index: number,
  taxi: CommittedTaxi | null,
): { readonly point: WorldPoint; readonly record: string; readonly boarding: DockBoarding | null } | null {
  const stop = seed.stops[index];
  const pathId = seed.clientPath ?? null;
  const at = stop?.clientStop ?? null;
  if (taxi === null || stop === undefined || pathId === null || at === null) return null;
  const path = taxi.transports.find((candidate) => candidate.pathId === pathId);
  const point = path?.stops[at]?.point;
  if (path === undefined || point === undefined || point.mapId !== stop.mapId) return null;
  const board = berthBoarding(pathId, at, point);
  const boarding = board === null || board.boarding === null ? null : { point: board.boarding, fromBerthYd: board.fromBerthYd ?? 0 };
  return { point, record: `client transport path ${String(pathId)}, stop ${String(at + 1)} of ${String(path.stops.length)}`, boarding };
}

/**
 * Builds the TravelGraph from the dataset, the cited seeds, the committed taxi file when given and
 * the project's effective rules (for the assumed transport wait and ride times). Deterministic:
 * the output order depends only on ids.
 *
 * - Taxi nodes: every candidate NPC whose record has FLIGHT_MASTER, at its first resolved spawn,
 *   plus the cited new Forever nodes (TIME-5). With the taxi file, each flight master takes the
 *   row it stands at (`CLIENT_NODE_MATCH_YARDS`; its `taxiNodeId`, the row's name and sides), each
 *   row no flight master stands at is a node of its own (`taxi:<id>`), and a cited seed the file
 *   has a row for is replaced by that row.
 * - Taxi edges: the caller's legs, or the file's flights (which flights exist; their lengths are
 *   TIME-6's per-leg data, not the graph's).
 * - Transports: one directed edge per ordered pair of stops of each seed, docks from user docks,
 *   dock NPCs, or the file's matched stops (`inferred`, TIME-7).
 * - Entrance edges: one per entrance of a dungeon with an instance map, skipping entrances with
 *   `frameVerified: false`, entrances that do not resolve and entrances already on the instance
 *   map.
 */
export function seedTravelGraph(source: TravelGraphSource, rules: EffectiveRules, options: TravelGraphSeedOptions = {}): TravelGraph {
  const transportSeeds = options.transports ?? TRANSPORT_SEEDS;
  const taxiSeeds = options.taxiNodes ?? FOREVER_TAXI_NODE_SEEDS;
  const userDocks = options.userDocks ?? [];
  const taxi = options.taxi ?? null;

  const datasetNodes: TaxiNode[] = [];
  const matchedRows = new Set<number>();
  const unmatchedMasters: NpcId[] = [];
  for (const id of [...new Set(source.flightMasterIds)].sort((a, b) => a - b)) {
    const node = datasetTaxiNode(source, id);
    if (node === null) continue;
    const row = taxi === null || node.point === null ? null : nearestClientRow(taxi.nodes, node.point);
    if (row !== null && taxi !== null) {
      matchedRows.add(row.id);
      datasetNodes.push(withClientRow(node, row, taxi.build));
    } else {
      if (taxi !== null && node.point !== null) unmatchedMasters.push(id);
      datasetNodes.push(node);
    }
  }
  const fileRows = new Set(taxi?.nodes.map((row) => row.id) ?? []);
  const citedNodes = [...taxiSeeds].filter((seed) => !fileRows.has(seed.taxiNodeId)).map(citedTaxiNode);
  const clientNodes = taxi === null ? [] : taxi.nodes.filter((row) => !matchedRows.has(row.id)).map((row) => clientTaxiNode(row, taxi.build));
  const rowNodes = [...citedNodes, ...clientNodes].sort(taxiNodeOrder);
  const taxiNodes = [...datasetNodes, ...rowNodes];
  const nodeKeys = new Set(taxiNodes.map((node) => node.key));
  // A row's node for the file's flights: the first in graph order that has it (a row two flight masters share keeps one).
  const byRow = new Map<number, TaxiNodeKey>();
  for (const node of taxiNodes) if (node.taxiNodeId !== null && !byRow.has(node.taxiNodeId)) byRow.set(node.taxiNodeId, node.key);
  const fileEdges: TaxiEdge[] = [];
  for (const flight of taxi?.flights ?? []) {
    const from = byRow.get(flight.from);
    const to = byRow.get(flight.to);
    if (from !== undefined && to !== undefined && from !== to) fileEdges.push({ from, to });
  }
  const taxiEdges = options.taxiEdges === undefined ? fileEdges : options.taxiEdges.filter((edge) => nodeKeys.has(edge.from) && nodeKeys.has(edge.to) && edge.from !== edge.to);

  const transports: TransportEdge[] = [];
  let docksFromNpc = 0;
  let docksFromUser = 0;
  let docksInferred = 0;
  for (const seed of transportSeeds) {
    const docks = seed.stops.map((_, index) => dockOf(source, seed, index, userDocks, taxi));
    for (const dock of docks) {
      if (dock.pointFrom === 'dock-npc') docksFromNpc += 1;
      if (dock.pointFrom === 'user') docksFromUser += 1;
      if (dock.pointFrom === 'inferred') docksInferred += 1;
    }
    for (const from of docks) {
      for (const to of docks) {
        if (from.stop === to.stop) continue;
        transports.push({
          id: `${seed.id}:${String(from.stop)}>${String(to.stop)}`,
          transportId: seed.id,
          name: seed.name,
          from,
          to,
          waitS: rules.values.transportWaitSeconds,
          rideS: rules.values.transportRideSeconds,
          factions: seed.factions,
          basis: seed.basis,
          source: seed.source,
        });
      }
    }
  }
  const userDocksIgnored = userDocks.filter(
    (dock) => !transportSeeds.some((seed) => seed.id === dock.transportId && seed.stops[dock.stop]?.mapId === dock.point.mapId),
  ).length;
  const citedPaths = new Set(transportSeeds.flatMap((seed) => (seed.clientPath === undefined || seed.clientPath === null ? [] : [seed.clientPath])));

  const entrances: EntranceEdge[] = [];
  let frameUnverified = 0;
  let noInstanceMap = 0;
  let unresolved = 0;
  for (const dungeon of [...source.dungeons].sort((a, b) => a.dungeonAreaId - b.dungeonAreaId)) {
    dungeon.entrances.forEach((entrance, index) => {
      if (!entrance.frameVerified) frameUnverified += 1;
      else if (dungeon.instanceMapId === null) noInstanceMap += 1;
      else if (entrance.point === null || entrance.point.mapId === dungeon.instanceMapId) unresolved += 1;
      else {
        entrances.push({
          dungeonAreaId: dungeon.dungeonAreaId,
          name: dungeon.name,
          instanceMapId: dungeon.instanceMapId,
          outdoor: entrance.point,
          index,
          raid: dungeon.raid === true,
        });
      }
    });
  }

  return {
    taxiNodes,
    taxiEdges,
    transports,
    entrances,
    report: {
      taxiNodes: {
        dataset: datasetNodes.length,
        cited: citedNodes.length,
        withoutPosition: taxiNodes.filter((node) => node.point === null).length,
      },
      transports: {
        records: transportSeeds.length,
        edges: transports.length,
        positionedEdges: transports.filter((edge) => edge.from.point !== null && edge.to.point !== null).length,
        docksFromNpc,
        docksFromUser,
        userDocksIgnored,
      },
      entrances: { edges: entrances.length, frameUnverified, noInstanceMap, unresolved },
      client:
        taxi === null
          ? null
          : {
              build: taxi.build,
              matchedNodes: matchedRows.size,
              clientNodes: clientNodes.length,
              unmatchedMasters,
              citedReplaced: taxiSeeds
                .filter((seed) => fileRows.has(seed.taxiNodeId))
                .map((seed) => seed.taxiNodeId)
                .sort((a, b) => a - b),
              edges: taxiEdges.length,
              edgeSource: options.taxiEdges === undefined ? 'file' : 'caller',
              inferredDocks: docksInferred,
              unmatchedPaths: taxi.transports.filter((path) => !citedPaths.has(path.pathId)).map((path) => path.pathId),
            },
    },
  };
}

// =============================================================================================
// Queries

/** Straight-line yards on one world map (Math.sqrt, not hypot: ARCHITECTURE §11.4); null across maps. */
export function planarYards(a: WorldPoint, b: WorldPoint): number | null {
  if (a.mapId !== b.mapId) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function taxiNodeByKey(graph: TravelGraph, key: TaxiNodeKey): TaxiNode | undefined {
  return graph.taxiNodes.find((node) => node.key === key);
}

/** The outcome of resolving a `TaxiNodeRef` or a name query (SIMULATION TIME-5, SIM-8). */
export type TaxiNodeLookup =
  | { readonly kind: 'node'; readonly node: TaxiNode }
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly nodes: readonly TaxiNode[] };

/**
 * Nodes whose names contain `query` case-insensitively (RXP `.fp`/`.fly` match a substring of the
 * node name, RXP.md §9.3), restricted to nodes `faction` may use (unknown factions are kept). An
 * exact name match wins over substring matches. Empty or blank queries match nothing.
 */
export function findTaxiNodes(graph: TravelGraph, query: string, faction: Faction | null = null): TaxiNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const usable = graph.taxiNodes.filter((node) => faction === null || taxiNodeOpenTo(node, faction));
  const exact = usable.filter((node) => node.names.some((name) => name.toLowerCase() === needle));
  if (exact.length > 0) return exact;
  return usable.filter((node) => node.names.some((name) => name.toLowerCase().includes(needle)));
}

/**
 * Resolves a `TaxiNodeRef` (TIME-5): by `npcId` to that flight master's node, else by
 * `taxiNodeId` to the cited node, else by `name` through `findTaxiNodes`. Two refs are the same
 * node when they resolve to the same key.
 */
export function resolveTaxiNodeRef(graph: TravelGraph, ref: TaxiNodeRef, faction: Faction | null = null): TaxiNodeLookup {
  if (ref.npcId !== null) {
    const node = taxiNodeByKey(graph, npcNodeKey(ref.npcId));
    if (node !== undefined) return { kind: 'node', node };
  }
  if (ref.taxiNodeId !== null) {
    const node = graph.taxiNodes.find((candidate) => candidate.taxiNodeId === ref.taxiNodeId);
    if (node !== undefined) return { kind: 'node', node };
  }
  if (ref.npcId === null && ref.taxiNodeId === null && ref.name !== null) return lookupOf(findTaxiNodes(graph, ref.name, faction));
  return { kind: 'none' };
}

/** A name query (`FlightStep.nodeQuery`) as a lookup. */
export function resolveTaxiNodeQuery(graph: TravelGraph, query: string, faction: Faction | null = null): TaxiNodeLookup {
  return lookupOf(findTaxiNodes(graph, query, faction));
}

function lookupOf(nodes: readonly TaxiNode[]): TaxiNodeLookup {
  const [first, ...rest] = nodes;
  if (first === undefined) return { kind: 'none' };
  return rest.length === 0 ? { kind: 'node', node: first } : { kind: 'several', nodes };
}

/**
 * The node nearest to `point` on its world map among those `accept` admits (TIME-5: a flight
 * with `from: null` starts at the nearest known node). Ties go to the earlier node in graph order.
 */
export function nearestTaxiNode(graph: TravelGraph, point: WorldPoint, accept: (node: TaxiNode) => boolean = () => true): TaxiNode | null {
  let best: TaxiNode | null = null;
  let bestYards = Number.POSITIVE_INFINITY;
  for (const node of graph.taxiNodes) {
    if (node.point === null || !accept(node)) continue;
    const yards = planarYards(point, node.point);
    if (yards !== null && yards < bestYards) {
      best = node;
      bestYards = yards;
    }
  }
  return best;
}

/** The directed edges of a transport record (`TransportRef.id`), or the one edge with that edge id. */
export function transportEdges(graph: TravelGraph, id: string): TransportEdge[] {
  return graph.transports.filter((edge) => edge.transportId === id || edge.id === id);
}

/** Edges that board on `fromMapId` and arrive on `toMapId` (TIME-7: the walker picks the quickest). */
export function transportsBetweenMaps(graph: TravelGraph, fromMapId: WorldMapId, toMapId: WorldMapId): TransportEdge[] {
  return graph.transports.filter((edge) => edge.from.mapId === fromMapId && edge.to.mapId === toMapId);
}

/**
 * Edges whose two docks are on `mapId` and both have a position: the transports the navigation
 * model may use between components of one map (terrain-navigation.md §9.3 case 2, D-034 item 2),
 * for example Rut'theran ↔ Auberdine.
 */
export function sameMapTransports(graph: TravelGraph, mapId: WorldMapId): TransportEdge[] {
  return graph.transports.filter(
    (edge) => edge.from.mapId === mapId && edge.to.mapId === mapId && edge.from.point !== null && edge.to.point !== null,
  );
}

/**
 * The edge boarded at a user-entered dock (`TransportRef.dock`, TIME-7), or null when the dock is
 * on another world map than the edge's departure.
 */
export function withDeparture(edge: TransportEdge, point: WorldPoint): TransportEdge | null {
  if (point.mapId !== edge.from.mapId) return null;
  const { record: _record, boarding: _boarding, ...dock } = edge.from;
  return { ...edge, from: { ...dock, point, pointFrom: 'user', npcId: null } };
}

/** Whether `faction` may use `node` (TIME-5, TIME-6): its factions include it, or are unknown. */
export function taxiNodeOpenTo(node: TaxiNode, faction: Faction): boolean {
  return node.factions === null || node.factions.includes(faction);
}

/** Whether any entrance edge leads into `mapId`, i.e. `mapId` is a known instance map. */
export function isInstanceMap(graph: TravelGraph, mapId: WorldMapId): boolean {
  return graph.entrances.some((edge) => edge.instanceMapId === mapId);
}

/**
 * What kind of instance `mapId` is (KXP-5): `raid` or `dungeon` for a known instance map, null for
 * any other map (the open world).
 */
export function instanceKindOf(graph: TravelGraph, mapId: WorldMapId): 'dungeon' | 'raid' | null {
  const edge = graph.entrances.find((candidate) => candidate.instanceMapId === mapId);
  return edge === undefined ? null : edge.raid ? 'raid' : 'dungeon';
}

/** The entrance edges into one instance map. */
export function entrancesOf(graph: TravelGraph, instanceMapId: WorldMapId): EntranceEdge[] {
  return graph.entrances.filter((edge) => edge.instanceMapId === instanceMapId);
}

/**
 * The entrance of `instanceMapId` nearest to `near` on `near`'s world map (TIME-7: entering walks
 * to the nearest entrance; leaving without a remembered entrance uses the one nearest the step).
 * Null when no entrance of that instance is on `near`'s map. Ties go to graph order.
 */
export function nearestEntrance(graph: TravelGraph, instanceMapId: WorldMapId, near: WorldPoint): EntranceEdge | null {
  let best: EntranceEdge | null = null;
  let bestYards = Number.POSITIVE_INFINITY;
  for (const edge of graph.entrances) {
    if (edge.instanceMapId !== instanceMapId) continue;
    const yards = planarYards(near, edge.outdoor);
    if (yards !== null && yards < bestYards) {
      best = edge;
      bestYards = yards;
    }
  }
  return best;
}
