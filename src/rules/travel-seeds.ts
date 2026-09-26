import type { Faction } from '../domain/character';
import { type NpcId, type WorldMapId, worldMapId } from '../domain/ids';
import type { RuleBasis } from './ruleset';

/**
 * Cited seed data for the TravelGraph (docs/ARCHITECTURE.md §9.1, docs/SIMULATION.md TIME-5 and
 * TIME-7, docs/research/forever-game-rules.md §6.4-§6.5). Individual client values are cited with
 * table and build (D-022); no bulk client table, no taxi-derived timing and nothing from RXPGuides
 * (D-019, D-024) is here.
 */

/** One stop of a transport, in the order of its client path. */
export interface TransportStopSeed {
  readonly name: string;
  readonly mapId: WorldMapId;
  /**
   * Dataset NPCs (zeppelin and dock masters) whose spawn is the dock (TIME-7). Empty when none is
   * known: the dock then has no position until the user enters one (`TransportRef.dock`).
   */
  readonly dockNpcIds: readonly NpcId[];
}

export interface TransportSeed {
  /** The record id `TransportRef.id` names. */
  readonly id: string;
  readonly name: string;
  readonly stops: readonly TransportStopSeed[];
  /** Who may ride; null when unknown (faction restrictions are UNKNOWN in the client data). */
  readonly factions: readonly Faction[] | null;
  /** What is known about the transport's existence. A client path does not prove a server route. */
  readonly basis: RuleBasis;
  readonly source: string;
  readonly build?: string;
  readonly note?: string;
}

/** A taxi node known only by a cited client `TaxiNodes` row (new Forever nodes have no dataset NPC). */
export interface TaxiNodeSeed {
  readonly taxiNodeId: number;
  readonly name: string;
  readonly mapId: WorldMapId;
  /** `TaxiNodes.Pos_0`, `Pos_1` (world x, y), as the research doc records them (whole yards). */
  readonly x: number;
  readonly y: number;
  readonly factions: readonly Faction[] | null;
  readonly source: string;
  readonly build: string;
  readonly note?: string;
}

const EK = worldMapId(0);
const KALIMDOR = worldMapId(1);
const ZEPHRAS_ISLE = worldMapId(2991);

const stop = (name: string, mapId: WorldMapId): TransportStopSeed => ({ name, mapId, dockNpcIds: [] });

/**
 * Transports the research docs identify, with the world map of each stop. No dock NPC ids are
 * recorded: the docs name none, and the dataset ships quest-referenced NPCs, flight masters,
 * innkeepers and trainers (ARCHITECTURE §5.2), not zeppelin or dock masters, so the docks have no
 * seeded position until the user enters one (TIME-7). Wait and ride times are the assumed
 * defaults. Which stop pairs a multi-stop ship serves, and in which direction, is UNKNOWN; the
 * graph offers every ordered pair (an assumption).
 */
export const TRANSPORT_SEEDS: readonly TransportSeed[] = [
  {
    id: 'stormwind-auberdine',
    name: 'Stormwind Harbor – Auberdine ship',
    stops: [stop('Auberdine', KALIMDOR), stop('Stormwind Harbor', EK)],
    factions: null,
    basis: 'official',
    source: 'forever-game-rules.md §6.5: S3; client TaxiPathNode path 11616 (C3)',
    build: '1.60.1.69977',
  },
  {
    id: 'menethil-southshore-auberdine',
    name: 'Menethil – Southshore – Auberdine ship',
    stops: [stop('Menethil', EK), stop('Southshore', EK), stop('Auberdine', KALIMDOR)],
    factions: null,
    basis: 'official',
    source: 'forever-game-rules.md §6.5: S3; client TaxiPathNode path 11167 (C3)',
    build: '1.60.1.69977',
  },
  {
    id: 'steamwheedle-powderfuse',
    name: 'Steamwheedle Port – Powderfuse Port ship',
    stops: [stop('Steamwheedle Port, Tanaris', KALIMDOR), stop('Powderfuse Port, Riverglades', EK)],
    factions: null,
    basis: 'official',
    source: 'forever-game-rules.md §6.5: S3, R8; client TaxiPathNode path 11391 (C3)',
    build: '1.60.1.69977',
  },
  {
    id: 'dalaran-zephras',
    name: 'Dalaran – Zephras Isle transport',
    stops: [stop('Dalaran, Alterac Mountains', EK), stop('Zephras Isle', ZEPHRAS_ISLE)],
    factions: null,
    basis: 'client-data',
    source: 'forever-game-rules.md §6.5: client TaxiPathNode path 11398 (C3)',
    build: '1.60.1.69977',
    note: 'R11 (weak, unsourced) calls it a Skycutter; whether the server runs it is UNKNOWN',
  },
  {
    id: 'mulgore-zephras',
    name: 'Mulgore – Zephras Isle transport',
    stops: [stop('Mulgore, north of Thunder Bluff', KALIMDOR), stop('Zephras Isle', ZEPHRAS_ISLE)],
    factions: null,
    basis: 'client-data',
    source: 'forever-game-rules.md §6.5: client TaxiPathNode path 11457 (C3)',
    build: '1.60.1.69977',
    note: 'R11 (weak) reports a Horde Skycutter; whether the server runs it is UNKNOWN',
  },
  {
    id: 'rutheran-auberdine',
    name: "Rut'theran – Auberdine boat",
    stops: [stop("Rut'theran Village", KALIMDOR), stop('Auberdine', KALIMDOR)],
    factions: null,
    basis: 'client-data',
    source: "forever-game-rules.md §6.5: Era path 293 (Rut'theran – Auberdine), geometry changed in Forever (C3); terrain-navigation.md §9.3",
    build: '1.60.1.69977',
  },
  {
    id: 'menethil-auberdine',
    name: 'Menethil – Auberdine ship',
    stops: [stop('Menethil', EK), stop('Auberdine', KALIMDOR)],
    factions: null,
    basis: 'client-data',
    source: 'forever-game-rules.md §6.5: the old Menethil – Auberdine path 295 still exists (C3)',
    build: '1.60.1.69977',
  },
];

/**
 * Era transport paths that are still in the Forever client (forever-game-rules.md §6.5, C3) but
 * whose docks the research docs do not name, so they seed no record. A user-entered dock
 * (`TransportRef.dock`) still gives a transport step its departure (TIME-7).
 */
export const UNMAPPED_ERA_TRANSPORT_PATHS: readonly number[] = [241, 285, 292, 301, 302, 303, 436];

/**
 * The live new Forever taxi nodes (forever-game-rules.md §6.4, C2: TaxiNodes 1.60.1.69977; faction
 * from `Flags` bit 0 Alliance, bit 1 Horde). Nodes 3274 (Powderfuse Port, Horde mount) and 3205
 * (Tidegear Coast) have no paths, and 3206-3208 and 3260-3262 are deprecated or quest-scripted, so
 * they are not seeded.
 */
export const FOREVER_TAXI_NODE_SEEDS: readonly TaxiNodeSeed[] = [
  {
    taxiNodeId: 559,
    name: 'Summit of Eternity, Mount Hyjal',
    mapId: KALIMDOR,
    x: 5283,
    y: -3307,
    factions: ['Alliance', 'Horde'],
    source: 'forever-game-rules.md §6.4 (C2): TaxiNodes Pos_0, Pos_1, Flags 1027',
    build: '1.60.1.69977',
  },
  {
    taxiNodeId: 3242,
    name: 'Tainted Foothills, Mount Hyjal',
    mapId: KALIMDOR,
    x: 4394,
    y: -2836,
    factions: ['Alliance', 'Horde'],
    source: 'forever-game-rules.md §6.4 (C2): TaxiNodes Pos_0, Pos_1, Flags 1027',
    build: '1.60.1.69977',
  },
  {
    taxiNodeId: 3203,
    name: "Rog'mar, Riverglades",
    mapId: EK,
    x: -7924,
    y: -4783,
    factions: ['Horde'],
    source: 'forever-game-rules.md §6.4 (C2): TaxiNodes Pos_0, Pos_1, Flags 1026',
    build: '1.60.1.69977',
  },
  {
    taxiNodeId: 3276,
    name: 'Farholde Keep, Riverglades',
    mapId: EK,
    x: -9104,
    y: -4830,
    factions: ['Alliance'],
    source: 'forever-game-rules.md §6.4 (C2): TaxiNodes Pos_0, Pos_1, Flags 1025',
    build: '1.60.1.69977',
  },
  {
    taxiNodeId: 3275,
    name: 'Powderfuse Port, Riverglades',
    mapId: EK,
    x: -8180,
    y: -5616,
    factions: null,
    source: 'forever-game-rules.md §6.4 (C2): TaxiNodes Pos_0, Pos_1, Flags 1024',
    build: '1.60.1.69977',
    note: 'Alliance mount but no faction bit; its only path goes to Farholde Keep',
  },
];
