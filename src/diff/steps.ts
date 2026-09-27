import type { QuestId } from '../domain/ids';
import type { SourcedPoint } from '../domain/points';
import { QUEST_STEP_KINDS, type RouteStep } from '../domain/route';

/**
 * What the diff reads of a step: the quests it names, its host, and its semantic key.
 */

/**
 * The quests a step names: its quest and any-of candidates (accept, turn-in), its quest (abandon)
 * or its targets' quests (complete). Ascending, without repeats; empty for a non-quest step.
 */
export function stepQuestIds(step: RouteStep): QuestId[] {
  let ids: QuestId[];
  switch (step.kind) {
    case 'accept':
    case 'turnin':
      ids = step.anyOf === null ? [step.questId] : [step.questId, ...step.anyOf];
      break;
    case 'abandon':
      return [step.questId];
    case 'complete':
      ids = step.targets.map((target) => target.questId);
      break;
    case 'travel':
    case 'grind':
    case 'hearth':
    case 'flight':
    case 'train':
    case 'vendor':
    case 'note':
      return [];
  }
  if (ids.length === 1) return ids;
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * The index of each step's host: the step itself for a quest step (accept, complete, turn-in,
 * abandon), otherwise the next quest step, or -1 when none follows. It is the optimiser's binding
 * rule (docs/research/optimizer-m7.md §3.2: a non-quest step binds to the next quest step whatever
 * its group, so a unit is a contiguous run), applied to the whole sequence.
 */
export function hostIndices(steps: readonly RouteStep[]): Int32Array {
  const host = new Int32Array(steps.length);
  let next = -1;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step !== undefined && QUEST_STEP_KINDS.has(step.kind)) next = i;
    host[i] = next;
  }
  return host;
}

function pointKey(point: SourcedPoint): string {
  return point.space === 'world'
    ? `w:${String(point.mapId)}:${String(point.x)}:${String(point.y)}`
    : `z:${String(point.uiMapId)}:${point.frame}:${String(point.x)}:${String(point.y)}`;
}

/**
 * The default semantic key (docs/research/optimizer-m7.md §10): `kind|quest|location source` for a
 * quest step, with a complete's targets (`quest:objective`, `*` for all) in place of the quest, and
 * null for any other step (matched by id only). Pass it as `DiffOptions.semanticKey` to match an
 * imported update's steps to the route's.
 */
export function semanticStepKey(step: RouteStep): string | null {
  const where = step.location === null ? '-' : pointKey(step.location.source);
  switch (step.kind) {
    case 'accept':
    case 'turnin':
    case 'abandon':
      return `${step.kind}|${String(step.questId)}|${where}`;
    case 'complete':
      return `complete|${step.targets.map((t) => `${String(t.questId)}:${t.objective === null ? '*' : String(t.objective)}`).join(',')}|${where}`;
    case 'travel':
    case 'grind':
    case 'hearth':
    case 'flight':
    case 'train':
    case 'vendor':
    case 'note':
      return null;
  }
}
