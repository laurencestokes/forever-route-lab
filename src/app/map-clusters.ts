import type { SpawnPoint } from '../domain/dataset';
import type { QuestId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { ClusterMember, MapRef, MarkerDescriptor, MarkerMark, MarkerQuest, SpawnLayerId, SpawnLayerInput, WorldBounds } from '../map/adapter';
import {
  CLUSTER_LEVELS,
  CLUSTERED_LAYERS,
  groupDigits,
  mergeGroups,
  SPAWN_MARKER,
  spawnCategory,
  type ClusterCell,
  type ClusterCellPoint,
  type ClustersOf,
  type ClusterSource,
  type LayerCandidate,
  type MergedGroup,
} from '../map/layers';
import type { MarkDifficulty, MarkState } from '../map/marks';

/**
 * The quest givers' and turn-ins' clusters (map-presentation.md §25.2.5; D-050 item 6), built in the
 * derived publish and outside the entry chunk: this module is imported by the derived pipeline
 * only, and the map's layer builder takes its `ClusterSource` through the places model
 * (`PlacesModel.clusters`).
 *
 * - **Every level at once, per input.** A fixed grid in world yards per world map, with nested
 *   levels (`CLUSTER_LEVELS`: 512 to 4,096 yd), so a cluster splits only where its cell halves. The
 *   pipeline makes the model's inputs' levels in its quest-state task (`warm`), so the map's sync at
 *   a band crossing or a selection change only looks them up; any other input (another set of
 *   drawer rows, the quests open by race and class) is made on first use and kept while it lives.
 * - **Cells, then pins.** A cell's points are its placed spawns in group and spawn order. The layer
 *   builder leaves out the points it draws raw (a focused quest's, the zone jumped to): a cell left
 *   with one point is that point's own marker, one with more is a cluster pin (`cluster`), the
 *   whole cell's made once and a subset's made once per subset.
 * - **The pin** (§25.2.5): anchored at the member point nearest the members' centroid (so its point
 *   is always a real giver), counting quests (one member per quest, best state first), places and
 *   points; its glyph and badge are the best member's, with a difficulty only when every member of
 *   that rank shares it; its hover words the states and difficulties.
 */

/** A point of a cell with what its cluster pin needs. */
interface CellPoint extends ClusterCellPoint {
  readonly merged: MergedGroup;
  readonly world: WorldPoint;
}

interface Cell extends ClusterCell {
  readonly points: readonly CellPoint[];
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n: number, one: string, many: string): string => `${groupDigits(n)} ${n === 1 ? one : many}`;

/** Quest-mark rank for a cluster's members: the best first (available, may be, needs; ready, in progress, record unknown). */
const MEMBER_RANK: Readonly<Partial<Record<MarkState, number>>> = {
  available: 0,
  uncertain: 1,
  locked: 2,
  'unlocks-soon': 3,
  'low-level': 4,
  ready: 0,
  'in-progress': 1,
  'record-unknown': 2,
};

const memberRank = (member: ClusterMember): number => (member.mark === null ? 9 : (MEMBER_RANK[member.mark.state] ?? 9));

const STATE_WORDS: Readonly<Partial<Record<MarkState, readonly [one: string, many: string]>>> = {
  available: ['available', 'available'],
  uncertain: ['may be available', 'may be available'],
  locked: ['needs a prerequisite', 'need a prerequisite'],
  'unlocks-soon': ['unlocks soon', 'unlock soon'],
  'low-level': ['low level', 'low level'],
  ready: ['ready', 'ready'],
  'in-progress': ['in progress', 'in progress'],
  'record-unknown': ['record unknown', 'record unknown'],
};

const DIFFICULTY_WORDS: Readonly<Record<MarkDifficulty, string>> = {
  trivial: 'trivial',
  standard: 'standard',
  difficult: 'difficult',
  verydifficult: 'very difficult',
  impossible: 'impossible',
};

const DIFFICULTY_ORDER: readonly MarkDifficulty[] = ['trivial', 'standard', 'difficult', 'verydifficult', 'impossible'];

/**
 * A cluster's hover (§25.2.5), without a step number (the label provider adds "After step N: "):
 * "12 quests at 7 givers near here: 9 available, 2 may be available, 1 needs a prerequisite; 7
 * standard, 5 difficult. Zoom in to separate them."
 */
export function clusterLabel(layer: SpawnLayerId, members: readonly ClusterMember[], places: number): string {
  const quests = plural(members.length, 'quest', 'quests');
  const where = layer === 'turn-ins' ? `to turn in at ${plural(places, 'place', 'places')}` : `at ${plural(places, 'giver', 'givers')}`;
  const byState = new Map<MarkState, number>();
  const byDifficulty = new Map<MarkDifficulty, number>();
  let unknownDifficulty = 0;
  let stated = 0;
  for (const member of members) {
    const mark = member.mark;
    if (mark === null) continue;
    stated += 1;
    byState.set(mark.state, (byState.get(mark.state) ?? 0) + 1);
    if (mark.difficulty === null) unknownDifficulty += 1;
    else byDifficulty.set(mark.difficulty, (byDifficulty.get(mark.difficulty) ?? 0) + 1);
  }
  const states = [...byState.entries()]
    .sort(([a], [b]) => (MEMBER_RANK[a] ?? 9) - (MEMBER_RANK[b] ?? 9))
    .map(([state, n]) => {
      const words = STATE_WORDS[state] ?? [state, state];
      return `${groupDigits(n)} ${n === 1 ? words[0] : words[1]}`;
    });
  const difficulties = DIFFICULTY_ORDER.filter((key) => (byDifficulty.get(key) ?? 0) > 0).map((key) => `${groupDigits(byDifficulty.get(key) ?? 0)} ${DIFFICULTY_WORDS[key]}`);
  if (unknownDifficulty > 0 && difficulties.length > 0) difficulties.push(`${groupDigits(unknownDifficulty)} of unknown difficulty`);
  const detail = stated === 0 ? '' : `: ${states.join(', ')}${difficulties.length > 0 ? `; ${difficulties.join(', ')}` : ''}`;
  return `${quests} ${where} near here${detail}. Zoom in to separate them.`;
}

/** The members' best mark (the pin's glyph and badge), with a difficulty only when every member of that rank shares it. */
function clusterMark(members: readonly ClusterMember[]): MarkerMark | undefined {
  const [first] = members;
  if (first?.mark === null || first === undefined) return undefined;
  const rank = memberRank(first);
  const top = members.filter((member) => memberRank(member) === rank);
  const difficulty = top.every((member) => member.mark?.difficulty === first.mark?.difficulty) ? first.mark.difficulty : null;
  return { state: first.mark.state, difficulty, dungeonQuest: top.some((member) => member.mark?.dungeonQuest === true), progress: null };
}

const minDistanceSqIndex = (points: readonly WorldPoint[], x: number, y: number): number => {
  let best = 0;
  let bestSq = Infinity;
  points.forEach((point, index) => {
    const dx = point.x - x;
    const dy = point.y - y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = index;
    }
  });
  return best;
};

/** The cluster pin of `members` (two or more of a cell's points) on `mapId` at `level` (§25.2.5). */
function clusterPin(layer: SpawnLayerId, members: readonly CellPoint[], mapId: WorldMapId, level: number, cell: ClusterCell): LayerCandidate {
  const worlds = members.map((member) => member.world);
  const n = worlds.length;
  const centroidX = worlds.reduce((sum, p) => sum + p.x, 0) / n;
  const centroidY = worlds.reduce((sum, p) => sum + p.y, 0) / n;
  const anchor = worlds[minDistanceSqIndex(worlds, centroidX, centroidY)] ?? { mapId, x: centroidX, y: centroidY };
  const quests = new Map<QuestId, { readonly quest: MarkerQuest; readonly subjects: Set<string> }>();
  const places = new Set<string>();
  for (const member of members) {
    places.add(member.merged.key);
    for (const quest of member.merged.quests) {
      const entry = quests.get(quest.questId) ?? { quest, subjects: new Set<string>() };
      entry.subjects.add(member.merged.key);
      quests.set(quest.questId, entry);
    }
  }
  const clusterMembers: ClusterMember[] = [...quests.values()]
    .map(({ quest, subjects }) => ({ questId: quest.questId, mark: quest.mark, category: spawnCategory(layer, quest.mark), subjects: [...subjects].sort(compareStrings) }))
    .sort((a, b) => memberRank(a) - memberRank(b) || a.questId - b.questId);
  const bounds: WorldBounds = {
    mapId,
    xMin: Math.min(...worlds.map((p) => p.x)),
    xMax: Math.max(...worlds.map((p) => p.x)),
    yMin: Math.min(...worlds.map((p) => p.y)),
    yMax: Math.max(...worlds.map((p) => p.y)),
  };
  const ref: MapRef = { kind: 'cluster', layer, bounds, quests: clusterMembers.length, places: places.size };
  const label = clusterLabel(layer, clusterMembers, places.size);
  const mark = clusterMark(clusterMembers);
  const descriptor: MarkerDescriptor = {
    type: 'marker',
    id: `cluster:${layer}:${String(level)}:${String(cell.cx)}:${String(cell.cy)}`,
    point: { mapId: anchor.mapId, x: anchor.x, y: anchor.y },
    kind: SPAWN_MARKER[layer],
    style: 'neutral',
    emphasis: 'normal',
    label,
    badges: [],
    ref,
    count: 1,
    refs: [ref],
    labels: [label],
    ...(mark === undefined ? {} : { mark }),
    category: clusterMembers[0]?.category ?? spawnCategory(layer, null),
    cluster: { members: clusterMembers, places: places.size, points: n, bounds, cellYards: level },
  };
  return { descriptor, tier: 1, anchor: { kind: 'point', x: anchor.x, y: anchor.y } };
}

/** The cells of one level on one world map from its points (in group and spawn order), ordered by (cx, cy). */
function cellsOf(points: readonly CellPoint[], level: number): readonly Cell[] {
  const cells = new Map<string, { readonly cx: number; readonly cy: number; readonly points: CellPoint[] }>();
  for (const point of points) {
    const cx = Math.floor(point.world.x / level);
    const cy = Math.floor(point.world.y / level);
    const key = `${String(cx)}:${String(cy)}`;
    const cell = cells.get(key) ?? { cx, cy, points: [] };
    cell.points.push(point);
    cells.set(key, cell);
  }
  return [...cells.values()].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
}

/** A clustered layer's index of one input: every world map's placed points, and each level's cells and pins made once. */
export interface ClusterIndex extends ClusterSource {
  /** Makes every level of every world map the input has points on, and each whole cell's pin (the derived publish). */
  warm(): void;
}

/** The cluster index of one input of a clustered layer (`available-quests` or `turn-ins`). */
export function createClusterIndex(layer: SpawnLayerId, input: SpawnLayerInput): ClusterIndex {
  if (!CLUSTERED_LAYERS.includes(layer)) throw new Error(`createClusterIndex: ${layer} is not clustered`);
  // Every placed point by world map, in group and spawn order (the builder's `SpawnBase` order).
  const byMap = new Map<WorldMapId, CellPoint[]>();
  for (const merged of mergeGroups(input.groups)) {
    merged.spawns.forEach((spawn: SpawnPoint, spawnIndex) => {
      const world = spawn.world;
      if (world === null) return;
      const list = byMap.get(world.mapId) ?? [];
      list.push({ id: `spawn:${merged.key}:${String(spawnIndex)}`, group: merged.key, zone: spawn.uiMapId, merged, world });
      byMap.set(world.mapId, list);
    });
  }
  const levels = new Map<string, readonly Cell[]>();
  /** Each cell's whole pin, and its subsets' pins by their member indices. */
  const pins = new WeakMap<ClusterCell, Map<string, LayerCandidate>>();
  const cells = (mapId: WorldMapId, level: number): readonly Cell[] => {
    const key = `${String(mapId)}:${String(level)}`;
    let made = levels.get(key);
    if (made === undefined) {
      made = cellsOf(byMap.get(mapId) ?? [], level);
      levels.set(key, made);
    }
    return made;
  };
  const cluster = (cell: ClusterCell, level: number, mapId: WorldMapId, members: readonly number[] | null): LayerCandidate => {
    const own = cell as Cell;
    let made = pins.get(own);
    if (made === undefined) {
      made = new Map();
      pins.set(own, made);
    }
    const key = members === null ? '' : members.join(',');
    let pin = made.get(key);
    if (pin === undefined) {
      const chosen = members === null ? own.points : members.flatMap((index) => own.points[index] ?? []);
      if (chosen.length < 2) throw new Error('A cluster needs two or more points');
      pin = clusterPin(layer, chosen, mapId, level, own);
      made.set(key, pin);
    }
    return pin;
  };
  return {
    cells,
    cluster,
    warm() {
      for (const mapId of byMap.keys()) {
        for (const level of CLUSTER_LEVELS) for (const cell of cells(mapId, level)) if (cell.points.length > 1) cluster(cell, level, mapId, null);
      }
    },
  };
}

/**
 * The clusters of every input asked for, each index made once and kept while its input lives
 * (`PlacesModel.clusters`); `warm` makes an input's levels ahead of the map (the derived publish).
 */
export interface MapClusterer {
  readonly of: ClustersOf;
  warm(layer: SpawnLayerId, input: SpawnLayerInput): void;
}

export function createMapClusterer(): MapClusterer {
  const indexes = new Map<SpawnLayerId, WeakMap<SpawnLayerInput, ClusterIndex>>();
  const indexOf = (layer: SpawnLayerId, input: SpawnLayerInput): ClusterIndex => {
    let byInput = indexes.get(layer);
    if (byInput === undefined) {
      byInput = new WeakMap();
      indexes.set(layer, byInput);
    }
    let index = byInput.get(input);
    if (index === undefined) {
      index = createClusterIndex(layer, input);
      byInput.set(input, index);
    }
    return index;
  };
  return {
    of: indexOf,
    warm(layer, input) {
      indexOf(layer, input).warm();
    },
  };
}
