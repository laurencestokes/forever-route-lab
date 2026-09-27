import type { GroupId, QuestId, StepId } from '../domain/ids';
import type { RouteGroup, RouteStep } from '../domain/route';

/**
 * Route diff types (docs/ARCHITECTURE.md §13; docs/research/optimizer-m7.md §10, §11).
 *
 * A diff is a list of operations relative to `before`, grouped into change-sets the user selects.
 * Step ids name steps: `stepId` of a remove, move or modify is the step's id in `before`, and an
 * `after` anchor is the id, in `after`, of the step directly before the moved or inserted one.
 * The two ids differ only for a step matched by semantic key, which always has a modify op (its id
 * changed) in the same change-set.
 */
export type DiffOp =
  | { readonly kind: 'remove'; readonly stepId: StepId; readonly beforeIndex: number }
  | { readonly kind: 'insert'; readonly step: RouteStep; readonly after: StepId | null; readonly afterIndex: number }
  | {
      readonly kind: 'move';
      readonly stepId: StepId;
      readonly after: StepId | null;
      readonly beforeIndex: number;
      readonly afterIndex: number;
    }
  | {
      readonly kind: 'modify';
      readonly stepId: StepId;
      readonly before: RouteStep;
      readonly after: RouteStep;
      readonly beforeIndex: number;
      readonly afterIndex: number;
    }
  /** The `groups` sidecar (route-level diffs only, `diffRoute`): a group only `after` has. */
  | { readonly kind: 'group-add'; readonly groupId: GroupId; readonly group: RouteGroup }
  /** A group only `before` has. */
  | { readonly kind: 'group-remove'; readonly groupId: GroupId; readonly group: RouteGroup }
  /** A group both have, not structurally equal. */
  | { readonly kind: 'group-modify'; readonly groupId: GroupId; readonly before: RouteGroup; readonly after: RouteGroup };

export type DiffOpKind = DiffOp['kind'];

/**
 * What the user selects. `id` is `q:<lowest quest id>` for a set that touches quests,
 * `s:<step id>` for a step that touches none and has no host quest step (or has a step dependency
 * of its own, as the grind fill does), and `g:<group id>` for a change to the groups sidecar. `ops`
 * are indices into `RouteDiff.ops`, ascending; `requires` are the ids of the sets that applying
 * this one needs, in set order (`applyChangeSets` closes the selection over them).
 */
export interface ChangeSet {
  readonly id: string;
  readonly questIds: readonly QuestId[];
  readonly ops: readonly number[];
  readonly requires: readonly string[];
}

/**
 * Ops in this order: step removes (before order); step inserts and moves (after order); step
 * modifies (after order); then, for a route-level diff, group removes, adds and modifies (in the
 * key order of `before.groups`, `after.groups` and `after.groups`). Change-sets are sorted by
 * their first op.
 */
export interface RouteDiff {
  readonly ops: readonly DiffOp[];
  readonly changeSets: readonly ChangeSet[];
}

/**
 * The set holding `stepId`'s op requires the sets holding the ops of `requires`. A non-quest step
 * named by `stepId` takes no host quest: its op forms its own `s:<step id>` set.
 */
export interface StepDependency {
  readonly stepId: StepId;
  readonly requires: readonly StepId[];
}

/**
 * Quest relations, injected because `diff` imports only `domain` (docs/research/optimizer-m7.md
 * §10). Only quests some op touches are related; the others are ignored.
 */
export interface DiffRelations {
  /** Quests mutually exclusive with `q`: their ops are merged into one change-set. */
  exclusive(q: QuestId): readonly QuestId[];
  /**
   * Quests that `q` needs first. Placing `q` (a moved or inserted `q` step) requires placing them
   * (their moved or inserted steps); removing one of them (a removed step) requires removing `q`.
   */
  prerequisites(q: QuestId): readonly QuestId[];
}

export interface DiffOptions {
  /**
   * The key that matches steps whose ids differ (imported updates). Unset: steps match by id only.
   * `semanticStepKey` is the default key to pass.
   */
  readonly semanticKey?: (step: RouteStep) => string | null;
  readonly relations?: DiffRelations;
  /**
   * Steps that keep their place (weight n + 1 in the subsequence), asked of both versions of a
   * matched step (fixed when either is). Default: `step.locked`. The optimiser passes its locked
   * and implicit anchors.
   */
  readonly fixed?: (step: RouteStep) => boolean;
  readonly dependencies?: readonly StepDependency[];
}
