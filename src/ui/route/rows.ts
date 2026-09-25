import type { StepKind } from '../../domain/route';
import type { Difficulty } from '../../rules/difficulty';
import type { IssueCounts } from '../lib/issues';
import type { Readout } from '../lib/readout';
import type { ForeverProvenance } from '../markers/provenance';

/**
 * View models for the route list. The app layer maps route steps and derived results into these;
 * the components never see the store or the domain step objects.
 */

export interface StepRowModel {
  readonly type: 'step';
  /** Stable key, normally the StepId. */
  readonly key: string;
  /** 1-based step number as shown (group headers are not numbered). */
  readonly number: number;
  readonly kind: StepKind;
  /** One line: quest name, destination, note text. Ellipsised when long. */
  readonly title: string;
  /** Dimmed secondary text after the title (for example a zone), or null. */
  readonly detail: string | null;
  /** Fractional level after this step (12.4 = level 12, 40%); unknown stays unknown. */
  readonly projectedLevel: Readout<number>;
  /** Quest level and difficulty for quest steps; null for the other kinds. */
  readonly quest: {
    readonly level: number | null;
    readonly difficulty: Difficulty | null;
    readonly uncertain: boolean;
    readonly provenance: ForeverProvenance;
  } | null;
  readonly issues: IssueCounts;
  readonly locked: boolean;
}

/** A header row for a group of steps (an imported RXP step). One line, like every row. */
export interface GroupRowModel {
  readonly type: 'group';
  readonly key: string;
  readonly label: string;
  readonly stepCount: number;
}

export type RouteRowModel = StepRowModel | GroupRowModel;

/** What the list says about each row beyond its own model: its step position and its group. */
export interface RouteRowContext {
  /** Per row: 1-based position among the step rows, or null for a group header. */
  readonly stepPosition: readonly (number | null)[];
  /** Per row: the label of the group header a step row sits under, or null. */
  readonly groupLabel: readonly (string | null)[];
  /** Number of step rows (header rows are not steps). */
  readonly stepCount: number;
}

/**
 * Step positions and group membership for a row list. A group header heads the `stepCount` step
 * rows that follow it (fewer if another header comes first), as `buildRouteView` lays them out.
 */
export function routeRowContext(rows: readonly RouteRowModel[]): RouteRowContext {
  const stepPosition: (number | null)[] = [];
  const groupLabel: (string | null)[] = [];
  let steps = 0;
  let group: string | null = null;
  let remaining = 0;
  for (const row of rows) {
    if (row.type === 'group') {
      group = row.label;
      remaining = row.stepCount;
      stepPosition.push(null);
      groupLabel.push(null);
      continue;
    }
    steps += 1;
    stepPosition.push(steps);
    groupLabel.push(remaining > 0 ? group : null);
    if (remaining > 0) remaining -= 1;
  }
  return { stepPosition, groupLabel, stepCount: steps };
}
