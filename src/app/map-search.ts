import type { DatasetView, EntityRef, NpcId, ObjectId, QuestId, UiMapId, WorldPoint } from '../domain';
import type { MapCategoryId } from '../map/adapter';

/**
 * The map search (docs/research/map-presentation.md §25.3.5; D-047; step MP.4c): one index of the
 * names the map can show — quests, the NPCs and objects the quests name (givers, finishers,
 * objective targets), flight points (the flight masters) and zones — matched by substring, ignoring
 * case and accents, prefix matches first. It is built on the search field's first focus, in the
 * lazy Map layers drawer (never in the entry chunk), and answers a query in well under a
 * millisecond (§25.3.5 MEASURED 0.58 ms median over 11,212 names).
 *
 * The places model's places join it (review PR-05): dungeons and raids by their instances' names,
 * every flight point by its client node's name (client-only nodes too), transport stops, and the
 * services by name and by kind ("innkeeper", "Warrior trainer", "vendor"). The drawer hands them in
 * from the places model (`MapSearchPlace`), so nothing is invented here: a place the model does not
 * draw is not found.
 */

export type MapSearchGroup = 'quests' | 'instances' | 'travel' | 'services' | 'zones';

/** The results' groups, in the drawer's order (§25.3.5). */
export const MAP_SEARCH_GROUPS: readonly MapSearchGroup[] = ['quests', 'instances', 'travel', 'services', 'zones'];

export const MAP_SEARCH_GROUP_TITLES: Readonly<Record<MapSearchGroup, string>> = {
  quests: 'Quests',
  instances: 'Instances',
  travel: 'Travel',
  services: 'Services',
  zones: 'Zones',
};

export type MapSearchKind = 'quest' | 'npc' | 'object' | 'flight-point' | 'zone' | 'dungeon' | 'raid' | 'taxi-node' | 'transport' | 'service';

/** The place kinds the places model hands in (review PR-05). */
export type MapSearchPlaceKind = Extract<MapSearchKind, 'dungeon' | 'raid' | 'taxi-node' | 'transport' | 'service'>;

/** The group of each place kind (§25.3.5): Instances, Travel, Services. */
export const MAP_SEARCH_PLACE_GROUPS: Readonly<Record<MapSearchPlaceKind, MapSearchGroup>> = {
  dungeon: 'instances',
  raid: 'instances',
  'taxi-node': 'travel',
  transport: 'travel',
  service: 'services',
};

/** A place of the places model, for the index (review PR-05): its pins, its point and its words. */
export interface MapSearchPlace {
  /** Unique in the index: `place:<pin id>`, or a service NPC's `npc:<id>` (so it is not listed again as a quest NPC). */
  readonly key: string;
  readonly kind: MapSearchPlaceKind;
  /** The NPC's id for a service; 0 otherwise. */
  readonly id: number;
  readonly name: string;
  /** Other words it is found by, such as a service's kind ("innkeeper"); none for none. */
  readonly also?: string | undefined;
  /** Its pins' ids (a service NPC has one per spawn): the map's mask keeps them while it is found, and the chosen one is ringed. */
  readonly pins: readonly string[];
  /** Where it is drawn (its first pin); null for none. */
  readonly point: WorldPoint | null;
  /** Its result line's first words ("Dungeon entrance", "Flight point", "Innkeeper"). */
  readonly what: string;
  /** The drawer row that shows or hides its pins (a result of a hidden row says so). */
  readonly category: MapCategoryId;
}

export interface MapSearchItem {
  /** `quest:788`, `npc:3143`, `object:1619`, `zone:1411`: a flight point is its NPC's `npc:` key; a place `place:<pin id>`. */
  readonly key: string;
  readonly kind: MapSearchKind;
  readonly group: MapSearchGroup;
  readonly id: number;
  readonly name: string;
  /** The name folded for matching (`foldText`), with a place's other words after it. */
  readonly folded: string;
  /** A place of the places model (review PR-05); absent for the dataset's quests, NPCs, objects and zones. */
  readonly place?: MapSearchPlace | undefined;
}

/** A query starts at two characters (§25.3.5)… */
export const MAP_SEARCH_MIN_CHARS = 2;
/** …150 ms after the last key. */
export const MAP_SEARCH_DEBOUNCE_MS = 150;
/** The results listed at most; the count line gives the whole (with the drawing rule, `map-search-draw.ts`). */
export { MAP_SEARCH_LIST_MAX } from './map-search-draw';

/** Lower case, accents removed (NFD, combining marks dropped): "Zul'Farrak" → "zul'farrak", "Ragnaros" → "ragnaros". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export interface MapSearchHits {
  /** Prefix matches first, then other substring matches; each part by name, then key. */
  readonly items: readonly MapSearchItem[];
}

export interface MapSearchIndex {
  readonly size: number;
  /** Every match of `query` (none below two characters). */
  search(query: string): MapSearchHits;
}

const NO_HITS: MapSearchHits = { items: [] };

const compareItems = (a: MapSearchItem, b: MapSearchItem): number => (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The NPC and object refs a quest names: its givers, its finishers and its objective targets. */
function questRefs(dataset: DatasetView, id: QuestId): readonly EntityRef[] {
  const record = dataset.quest(id);
  if (record === undefined) return [];
  const refs: EntityRef[] = [...record.starters, ...record.finishers];
  for (const objective of record.objectives) {
    if (objective.kind === 'kill') refs.push({ kind: 'npc', id: objective.npcId });
    else if (objective.kind === 'killCredit') refs.push(...objective.npcIds.map((npcId): EntityRef => ({ kind: 'npc', id: npcId })));
    else if (objective.kind === 'object') refs.push({ kind: 'object', id: objective.objectId });
  }
  return refs;
}

/** Builds the index over the dataset view, the flight masters of the dataset, the places model's places and the zones it names. */
export function createMapSearchIndex(dataset: DatasetView, flightMasterIds: readonly NpcId[], places: readonly MapSearchPlace[] = []): MapSearchIndex {
  const items: MapSearchItem[] = [];
  const seen = new Set<string>();
  const add = (key: string, kind: MapSearchKind, group: MapSearchGroup, id: number, name: string | null | undefined): void => {
    if (name === null || name === undefined || name === '' || seen.has(key)) return;
    seen.add(key);
    items.push({ key, kind, group, id, name, folded: foldText(name) });
  };
  // The places first: a service NPC is found under Services, not again as a quest's NPC.
  for (const place of places) {
    if (place.name === '' || seen.has(place.key)) continue;
    seen.add(place.key);
    const folded = place.also === undefined || place.also === '' ? foldText(place.name) : `${foldText(place.name)} \u0000${foldText(place.also)}`;
    items.push({ key: place.key, kind: place.kind, group: MAP_SEARCH_PLACE_GROUPS[place.kind], id: place.id, name: place.name, folded, place });
  }
  const flights = new Set<number>(flightMasterIds);
  for (const id of flightMasterIds) add(`npc:${String(id)}`, 'flight-point', 'travel', id, dataset.npc(id)?.name);
  for (const quest of dataset.quests()) {
    add(`quest:${String(quest.id)}`, 'quest', 'quests', quest.id, quest.name);
    for (const ref of questRefs(dataset, quest.id)) {
      if (ref.kind === 'npc' && !flights.has(ref.id)) add(`npc:${String(ref.id)}`, 'npc', 'quests', ref.id, dataset.npc(ref.id)?.name);
      else if (ref.kind === 'object') add(`object:${String(ref.id)}`, 'object', 'quests', ref.id, dataset.object(ref.id)?.name);
    }
  }
  for (const zone of dataset.zones()) add(`zone:${String(zone.uiMapId)}`, 'zone', 'zones', zone.uiMapId, zone.name);
  items.sort(compareItems);
  return {
    size: items.length,
    search(query) {
      const folded = foldText(query.trim());
      if (folded.length < MAP_SEARCH_MIN_CHARS) return NO_HITS;
      const prefix: MapSearchItem[] = [];
      const inner: MapSearchItem[] = [];
      for (const item of items) {
        const at = item.folded.indexOf(folded);
        if (at === 0) prefix.push(item);
        else if (at > 0) inner.push(item);
      }
      return { items: [...prefix, ...inner] };
    },
  };
}

/** A result's place on the map: a quest's first placed giver, an NPC's or object's first placed spawn; null for none (a zone jumps instead). */
export function resultPoint(dataset: DatasetView, item: MapSearchItem): WorldPoint | null {
  const first = (ref: EntityRef): WorldPoint | null => {
    for (const spawn of dataset.spawns(ref)) if (spawn.world !== null) return spawn.world;
    return null;
  };
  if (item.place !== undefined) return item.place.point;
  switch (item.kind) {
    case 'quest': {
      const record = dataset.quest(item.id as QuestId);
      for (const ref of record?.starters ?? []) {
        if (ref.kind === 'item') continue;
        const point = first(ref);
        if (point !== null) return point;
      }
      return null;
    }
    case 'npc':
    case 'flight-point':
      return first({ kind: 'npc', id: item.id as NpcId });
    case 'object':
      return first({ kind: 'object', id: item.id as ObjectId });
    case 'zone':
    case 'dungeon':
    case 'raid':
    case 'taxi-node':
    case 'transport':
    case 'service':
      return null;
  }
}

/** The map mask of a result set (`MapMask.only`): the places found (NPCs and objects by key, the places model's by pin) and the quests found. */
export function searchFilterOf(items: readonly MapSearchItem[]): { readonly subjects: readonly string[]; readonly quests: readonly QuestId[]; readonly places: readonly string[] } {
  const subjects: string[] = [];
  const quests: QuestId[] = [];
  const places: string[] = [];
  for (const item of items) {
    if (item.place !== undefined) places.push(...item.place.pins);
    else if (item.kind === 'quest') quests.push(item.id as QuestId);
    else if (item.kind !== 'zone') subjects.push(item.key);
  }
  return { subjects, quests, places };
}

/** A zone result's UiMap. */
export const resultZone = (item: MapSearchItem): UiMapId | null => (item.kind === 'zone' ? (item.id as UiMapId) : null);

// What a search draws (review QA-09) is in `map-search-draw.ts`, so the map controller (entry chunk)
// holds none of the index (lazy, with the drawer).
export { SEARCH_DRAWN_MAX, searchDrawQuests, type SearchDrawQuests } from './map-search-draw';
