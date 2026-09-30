import type { DatasetView, EntityRef, QuestId } from '../domain';

/**
 * What a map search draws (map-presentation.md §25.3.5 "Reach"; review QA-09): kept apart from the
 * index (`map-search.ts`, a lazy part with the Map layers drawer), because the map controller, in
 * the entry chunk, reads it (fix-ui: the entry's ledger, ui-refresh.md §10.3).
 */

/** The results listed at most; the count line gives the whole. */
export const MAP_SEARCH_LIST_MAX = 60;

/** The results a search draws with pins of their own (review QA-09): the first this many places and the first this many quests, and the chosen one always. */
export const SEARCH_DRAWN_MAX = MAP_SEARCH_LIST_MAX;

/**
 * The quests whose points draw a search's results (map-presentation.md §25.3.5 "Reach"; review
 * QA-09): a found place or quest is drawn with its own pin whatever its row or state, not only when
 * a layer already draws it. The map's mask then keeps only the found places and quests.
 *
 * - `givers`: the quests found, and the quests a found NPC or object starts (its giver pin, with
 *   the quest's state);
 * - `targets`: the quests a found NPC or object is an objective of (and does not start);
 * - `finishers`: the quests a found NPC or object only finishes.
 *
 * Flight points need none (their layer draws every one). Each list is in the results' order,
 * without repeats; `chosen` (the chosen result) comes first.
 */
export interface SearchDrawQuests {
  readonly givers: readonly QuestId[];
  readonly targets: readonly QuestId[];
  readonly finishers: readonly QuestId[];
}

interface QuestRoles {
  readonly starts: QuestId[];
  readonly ends: QuestId[];
  readonly targets: QuestId[];
}

/** Each NPC's and object's quests by role (`npc:3143`), from the quests' own records, once per dataset view. */
const rolesByView = new WeakMap<DatasetView, ReadonlyMap<string, QuestRoles>>();

function questRolesOf(dataset: DatasetView): ReadonlyMap<string, QuestRoles> {
  const known = rolesByView.get(dataset);
  if (known !== undefined) return known;
  const roles = new Map<string, QuestRoles>();
  const add = (ref: EntityRef, role: keyof QuestRoles, questId: QuestId): void => {
    if (ref.kind === 'item') return;
    const key = `${ref.kind}:${String(ref.id)}`;
    let entry = roles.get(key);
    if (entry === undefined) {
      entry = { starts: [], ends: [], targets: [] };
      roles.set(key, entry);
    }
    if (!entry[role].includes(questId)) entry[role].push(questId);
  };
  for (const quest of dataset.quests()) {
    for (const ref of quest.starters) add(ref, 'starts', quest.id);
    for (const ref of quest.finishers) add(ref, 'ends', quest.id);
    for (const objective of quest.objectives) {
      if (objective.kind === 'kill') add({ kind: 'npc', id: objective.npcId }, 'targets', quest.id);
      else if (objective.kind === 'killCredit') for (const npcId of objective.npcIds) add({ kind: 'npc', id: npcId }, 'targets', quest.id);
      else if (objective.kind === 'object') add({ kind: 'object', id: objective.objectId }, 'targets', quest.id);
    }
  }
  rolesByView.set(dataset, roles);
  return roles;
}

export function searchDrawQuests(
  dataset: DatasetView,
  only: { readonly subjects: readonly string[]; readonly quests: readonly QuestId[] },
  chosen: { readonly subject?: string | undefined; readonly questId?: QuestId | undefined } | null,
): SearchDrawQuests {
  const roles = questRolesOf(dataset);
  const givers: QuestId[] = [];
  const targets: QuestId[] = [];
  const finishers: QuestId[] = [];
  const push = (list: QuestId[], ids: readonly QuestId[]): void => {
    for (const id of ids) if (!list.includes(id)) list.push(id);
  };
  // A place is drawn in one role per quest: as its giver, else as its target, else as where it is turned in.
  const place = (subject: string): void => {
    const entry = roles.get(subject);
    if (entry === undefined) return;
    push(givers, entry.starts);
    push(targets, entry.targets.filter((id) => !entry.starts.includes(id)));
    push(finishers, entry.ends.filter((id) => !entry.starts.includes(id) && !entry.targets.includes(id)));
  };
  if (chosen?.questId !== undefined) push(givers, [chosen.questId]);
  if (chosen?.subject !== undefined) place(chosen.subject);
  push(givers, only.quests.slice(0, SEARCH_DRAWN_MAX));
  for (const subject of only.subjects.slice(0, SEARCH_DRAWN_MAX)) place(subject);
  return { givers, targets, finishers };
}
