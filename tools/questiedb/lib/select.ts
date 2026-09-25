import { hasBit } from './project';
import type { EntityRefRow, ItemRow, NpcRow, ObjectRow, QuestRow } from './shapes';

/**
 * Which entities ship (DATA_PROVENANCE §6.3, §6.4):
 *
 * - NPCs: quest-referenced (starters, finishers, kill and killCredit targets, `monster` refs of
 *   objective hints, drop sources of shipped items, and every NPC whose questStarts/questEnds is
 *   non-empty) ∪ flag-selected (npcFlags FLIGHT_MASTER, TRAINER or INNKEEPER; arithmetic tests);
 * - objects: quest-referenced in the same way (no flag selection);
 * - items: quest-referenced (starters, item objectives, spell-objective items, source and required
 *   source items, `item` refs of objective hints) ∪ every item whose startsQuest names a quest of
 *   the dataset, closed over `dropItems` (containers of selected items) to a fixed point.
 *
 * Every record variant a persona overlay can produce is scanned too, so a reference that only a
 * faction or class layer introduces still resolves.
 */

export interface SelectionInput<Q, Nr, Or, Ir> {
  readonly quests: readonly Q[];
  readonly npcs: ReadonlyMap<number, readonly Nr[]>;
  readonly objects: ReadonlyMap<number, readonly Or[]>;
  readonly items: ReadonlyMap<number, readonly Ir[]>;
  /** npcFlags values (powers of two) that select an NPC on their own. */
  readonly flagValues: { readonly flightMaster: number; readonly trainer: number; readonly innkeeper: number };
}

export interface UnresolvedReference {
  readonly kind: 'npc' | 'object' | 'item' | 'quest';
  readonly id: number;
  readonly referencedBy: string;
}

export interface Selection {
  readonly npcs: ReadonlySet<number>;
  readonly objects: ReadonlySet<number>;
  readonly items: ReadonlySet<number>;
  readonly npcCounts: {
    readonly questReferenced: number;
    readonly flightMaster: number;
    readonly trainer: number;
    readonly innkeeper: number;
    readonly flightMasterNotQuestReferenced: number;
    readonly trainerNotQuestReferenced: number;
    readonly innkeeperNotQuestReferenced: number;
    readonly flagOnly: number;
  };
  readonly unresolved: readonly UnresolvedReference[];
}

/** D-012 with the flag's value: `Math.floor(flags / value) % 2 === 1` for a power of two. */
export function hasFlag(flags: number, value: number): boolean {
  const bit = Math.log2(value);
  if (!Number.isInteger(bit)) throw new Error(`npcFlags value ${String(value)} is not a power of two`);
  return hasBit(flags, bit);
}

export function questEntityRefs(quest: Pick<QuestRow, 'starters' | 'finishers' | 'objectives' | 'objectiveHints' | 'requirements'>): readonly EntityRefRow[] {
  const refs: EntityRefRow[] = [...quest.starters, ...quest.finishers];
  for (const objective of quest.objectives) {
    switch (objective.kind) {
      case 'kill':
        refs.push({ kind: 'npc', id: objective.npcId });
        break;
      case 'object':
        refs.push({ kind: 'object', id: objective.objectId });
        break;
      case 'item':
        refs.push({ kind: 'item', id: objective.itemId });
        break;
      case 'killCredit':
        for (const id of objective.npcIds) refs.push({ kind: 'npc', id });
        refs.push({ kind: 'npc', id: objective.rootNpcId });
        break;
      case 'spell':
        if (objective.itemId !== null) refs.push({ kind: 'item', id: objective.itemId });
        break;
      case 'reputation':
      case 'event':
        break;
    }
  }
  for (const hint of quest.objectiveHints) refs.push(...hint.refs);
  if (quest.requirements.sourceItemId !== null) refs.push({ kind: 'item', id: quest.requirements.sourceItemId });
  for (const id of quest.requirements.requiredSourceItems) refs.push({ kind: 'item', id });
  return refs;
}

type Variants<T> = ReadonlyMap<number, readonly T[]>;

export function selectEntities(
  input: SelectionInput<
    Pick<QuestRow, 'id' | 'starters' | 'finishers' | 'objectives' | 'objectiveHints' | 'requirements'>,
    Pick<NpcRow, 'questStarts' | 'questEnds' | 'npcFlags'>,
    Pick<ObjectRow, 'questStarts' | 'questEnds'>,
    Pick<ItemRow, 'startsQuest' | 'dropNpcs' | 'dropObjects' | 'dropItems'>
  >,
): Selection {
  const npcs = new Set<number>();
  const objects = new Set<number>();
  const items = new Set<number>();
  const unresolved: UnresolvedReference[] = [];
  const known = { npc: input.npcs, object: input.objects, item: input.items } as const;
  const target = { npc: npcs, object: objects, item: items } as const;
  const add = (ref: EntityRefRow, referencedBy: string): void => {
    if (!(known[ref.kind] as Variants<unknown>).has(ref.id)) {
      unresolved.push({ kind: ref.kind, id: ref.id, referencedBy });
      return;
    }
    target[ref.kind].add(ref.id);
  };
  for (const quest of input.quests) for (const ref of questEntityRefs(quest)) add(ref, `quest ${String(quest.id)}`);
  for (const [id, variants] of input.npcs) if (variants.some((npc) => npc.questStarts.length > 0 || npc.questEnds.length > 0)) npcs.add(id);
  for (const [id, variants] of input.objects) if (variants.some((object) => object.questStarts.length > 0 || object.questEnds.length > 0)) objects.add(id);
  // The reverse link: an item that starts a quest of the dataset (a startsQuest naming a quest the
  // dataset lacks does not select the item on its own).
  const questIds = new Set(input.quests.map((quest) => quest.id));
  for (const [id, variants] of input.items) if (variants.some((item) => item.startsQuest !== null && questIds.has(item.startsQuest))) items.add(id);
  // dropItems closure: a selected item's containers are selected too.
  const queue = [...items];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    for (const item of input.items.get(id) ?? []) {
      for (const container of item.dropItems) {
        if (!input.items.has(container)) {
          unresolved.push({ kind: 'item', id: container, referencedBy: `item ${String(id)} dropItems` });
        } else if (!items.has(container)) {
          items.add(container);
          queue.push(container);
        }
      }
    }
  }
  for (const id of items) {
    for (const item of input.items.get(id) ?? []) {
      for (const npc of item.dropNpcs) add({ kind: 'npc', id: npc }, `item ${String(id)} dropNpcs`);
      for (const object of item.dropObjects) add({ kind: 'object', id: object }, `item ${String(id)} dropObjects`);
    }
  }
  const questReferenced = new Set(npcs);
  const flagged = { flightMaster: new Set<number>(), trainer: new Set<number>(), innkeeper: new Set<number>() };
  for (const [id, variants] of input.npcs) {
    for (const key of ['flightMaster', 'trainer', 'innkeeper'] as const) {
      if (variants.some((npc) => hasFlag(npc.npcFlags, input.flagValues[key]))) flagged[key].add(id);
    }
  }
  for (const set of Object.values(flagged)) for (const id of set) npcs.add(id);
  const notReferenced = (set: ReadonlySet<number>): number => [...set].filter((id) => !questReferenced.has(id)).length;
  const dedupe = new Map<string, UnresolvedReference>();
  for (const ref of unresolved) dedupe.set(`${ref.kind}:${String(ref.id)}:${ref.referencedBy}`, ref);
  return {
    npcs,
    objects,
    items,
    npcCounts: {
      questReferenced: questReferenced.size,
      flightMaster: flagged.flightMaster.size,
      trainer: flagged.trainer.size,
      innkeeper: flagged.innkeeper.size,
      flightMasterNotQuestReferenced: notReferenced(flagged.flightMaster),
      trainerNotQuestReferenced: notReferenced(flagged.trainer),
      innkeeperNotQuestReferenced: notReferenced(flagged.innkeeper),
      flagOnly: npcs.size - questReferenced.size,
    },
    unresolved: [...dedupe.values()].sort((a, b) => (a.kind === b.kind ? a.id - b.id || (a.referencedBy < b.referencedBy ? -1 : 1) : a.kind < b.kind ? -1 : 1)),
  };
}
