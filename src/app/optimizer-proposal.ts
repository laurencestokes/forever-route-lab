import type { QuestId, StepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { type DiffRelations, diffRoutes, type RouteDiff, type StepDependency } from '../diff';
import type { EngineDataset } from '../engine/types';

/**
 * The candidate steps of an optimiser result as a route diff (docs/research/optimizer-m7.md §10;
 * ARCHITECTURE §12.5, §13): what Milestone 8's proposal review shows and applies change-set by
 * change-set. The diff is of the whole route (so `applyChangeSets(route, diff, selected)` gives a
 * whole route), with:
 *
 * - the section's anchors (locked and implicit) as the fixed steps of the weighted subsequence, so
 *   only free steps are reported as moved;
 * - the dataset's quest relations (prerequisites become `requires` edges, exclusive quests share a
 *   set), injected because `diff` imports only `domain`;
 * - the optimiser's step dependencies (the grind fill requires every removal and every moved
 *   XP-granting step).
 *
 * Applying a selection gives steps the caller must re-walk and re-validate before use
 * (`verifyCandidate` with `estimatedMs: null`).
 */

/** The dataset's relations for the diff: VAL-8/9 prerequisites (with a group entry's quest) and VAL-12 exclusivity. */
export function datasetRelations(dataset: Pick<EngineDataset, 'quest'>): DiffRelations {
  return {
    exclusive: (q: QuestId) => dataset.quest(q)?.prerequisites.exclusiveTo ?? [],
    prerequisites: (q: QuestId) => {
      const pre = dataset.quest(q)?.prerequisites;
      return pre === undefined ? [] : [...pre.preQuestSingle, ...pre.preQuestGroup.map((entry) => Math.abs(entry) as QuestId)];
    },
  };
}

export interface ProposalDiffInput {
  /** The route before (the project's steps at the base revision). */
  readonly before: readonly RouteStep[];
  /** The section's route indices in `before`. */
  readonly section: { readonly first: number; readonly last: number };
  /** The candidate's section steps (original step objects reused; the fill is new). */
  readonly steps: readonly RouteStep[];
  readonly anchors: ReadonlySet<StepId>;
  readonly dependencies: readonly StepDependency[];
  readonly dataset: Pick<EngineDataset, 'quest'>;
}

export interface ProposalDiff {
  /** The whole route with the section replaced. */
  readonly route: readonly RouteStep[];
  readonly diff: RouteDiff;
}

/** The candidate's whole route and its diff against `before`. */
export function proposalDiff(input: ProposalDiffInput): ProposalDiff {
  const { before, section, steps, anchors } = input;
  const route = [...before.slice(0, section.first), ...steps, ...before.slice(section.last + 1)];
  const diff = diffRoutes(before, route, {
    relations: datasetRelations(input.dataset),
    fixed: (step) => step.locked || anchors.has(step.id),
    dependencies: input.dependencies,
  });
  return { route, diff };
}
