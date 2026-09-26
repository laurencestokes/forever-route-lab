import type { DatasetView, QuestId, QuestRecord } from '../domain';

/**
 * Quest chain positions for titles, "(2/5)" (ARCHITECTURE §12.4; docs/research/ux-benchmark.md),
 * from the dataset's own links and nothing else:
 *
 * - **next:** the quest's `nextQuestInChain`, else the one quest whose only pre-quest
 *   (`preQuestSingle` of length one) is this quest;
 * - **previous:** the one quest whose `nextQuestInChain` is this quest, else this quest's only
 *   pre-quest.
 *
 * A link to a quest the view does not have, or an ambiguous one (two quests name the same next
 * quest, two quests follow the same pre-quest), ends the chain there: a position is never guessed.
 * A cycle ends it too. A quest with no link either way has no position (null), and neither does a
 * chain of one. Positions are per view: custom quests and overrides take part like dataset quests.
 */

export interface ChainPosition {
  /** 1-based. */
  readonly index: number;
  readonly length: number;
  /** The chain in order, this quest included. */
  readonly quests: readonly QuestId[];
}

interface ChainIndex {
  /** Quest → the one quest naming it as `nextQuestInChain`; null where two do. */
  readonly namedBy: ReadonlyMap<QuestId, QuestId | null>;
  /** Quest → the one quest whose only pre-quest it is; null where two are. */
  readonly followedBy: ReadonlyMap<QuestId, QuestId | null>;
  readonly positions: Map<QuestId, ChainPosition | null>;
}

const indexes = new WeakMap<DatasetView, ChainIndex>();

/** Adds `value` under `key`, or marks the key ambiguous (null) when a different value is already there. */
function addUnique(map: Map<QuestId, QuestId | null>, key: QuestId, value: QuestId): void {
  const known = map.get(key);
  if (known === undefined) map.set(key, value);
  else if (known !== value) map.set(key, null);
}

function indexOf(dataset: DatasetView): ChainIndex {
  const cached = indexes.get(dataset);
  if (cached !== undefined) return cached;
  const namedBy = new Map<QuestId, QuestId | null>();
  const followedBy = new Map<QuestId, QuestId | null>();
  for (const quest of dataset.quests()) {
    const next = quest.prerequisites.nextQuestInChain;
    if (next !== null && next !== quest.id) addUnique(namedBy, next, quest.id);
    const pre = quest.prerequisites.preQuestSingle;
    const [only] = pre;
    if (pre.length === 1 && only !== undefined && only !== quest.id) addUnique(followedBy, only, quest.id);
  }
  const index: ChainIndex = { namedBy, followedBy, positions: new Map() };
  indexes.set(dataset, index);
  return index;
}

function nextOf(dataset: DatasetView, index: ChainIndex, quest: QuestRecord): QuestRecord | null {
  const named = quest.prerequisites.nextQuestInChain;
  if (named !== null && named !== quest.id) return dataset.quest(named) ?? null;
  const follower = index.followedBy.get(quest.id) ?? null;
  return follower === null ? null : (dataset.quest(follower) ?? null);
}

function previousOf(dataset: DatasetView, index: ChainIndex, quest: QuestRecord): QuestRecord | null {
  const by = index.namedBy.get(quest.id);
  if (by !== undefined) return by === null ? null : (dataset.quest(by) ?? null);
  const pre = quest.prerequisites.preQuestSingle;
  const [only] = pre;
  if (pre.length !== 1 || only === undefined || only === quest.id) return null;
  return dataset.quest(only) ?? null;
}

/** Where `id` sits in its chain, or null when it is in none (see above). */
export function questChainPosition(dataset: DatasetView, id: QuestId): ChainPosition | null {
  const index = indexOf(dataset);
  const known = index.positions.get(id);
  if (known !== undefined) return known;
  const quest = dataset.quest(id);
  let position: ChainPosition | null = null;
  if (quest !== undefined) {
    const seen = new Set<QuestId>([quest.id]);
    const before: QuestId[] = [];
    for (let at = previousOf(dataset, index, quest); at !== null && !seen.has(at.id); at = previousOf(dataset, index, at)) {
      seen.add(at.id);
      before.push(at.id);
    }
    const after: QuestId[] = [];
    for (let at = nextOf(dataset, index, quest); at !== null && !seen.has(at.id); at = nextOf(dataset, index, at)) {
      seen.add(at.id);
      after.push(at.id);
    }
    const quests = [...before.reverse(), quest.id, ...after];
    position = quests.length < 2 ? null : { index: before.length + 1, length: quests.length, quests };
  }
  index.positions.set(id, position);
  return position;
}

/** "(2/5)", or null when the quest is in no chain. */
export function questChainLabel(dataset: DatasetView, id: QuestId): string | null {
  const position = questChainPosition(dataset, id);
  return position === null ? null : `(${String(position.index)}/${String(position.length)})`;
}

/** The quest's name with its chain position, "Cutting Teeth (2/3)"; `name` alone when it is in no chain. */
export function withChainLabel(dataset: DatasetView, id: QuestId, name: string): string {
  const label = questChainLabel(dataset, id);
  return label === null ? name : `${name} ${label}`;
}
