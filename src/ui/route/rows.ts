import type { IssueSeverity } from '../../domain/issues';
import type { StepKind } from '../../domain/route';
import type { Difficulty } from '../../rules/difficulty';
import type { IssueCounts } from '../lib/issues';
import type { Readout } from '../lib/readout';
import type { PendingTravel } from '../markers/PendingMarker';
import type { ForeverProvenance } from '../markers/provenance';

/**
 * View models for the route list. The app layer maps route steps and derived results into these;
 * the components never see the store or the domain step objects.
 */

/**
 * Which estimate a step row shows in its right-hand column (the row has room for one; its
 * accessible name and tooltip always say all three): the level after the step, the XP it gains,
 * or the time it takes.
 */
export type EstimateColumn = 'level' | 'xp' | 'time';

export const ESTIMATE_COLUMNS: readonly EstimateColumn[] = ['level', 'xp', 'time'];

export const ESTIMATE_COLUMN_LABELS: Readonly<Record<EstimateColumn, string>> = {
  level: 'Level after',
  xp: 'XP gained',
  time: 'Step time',
};

/**
 * The top number of a two-line row (docs/research/ui-refresh.md §6.1): the XP gained (default) or
 * the step time; the level after the step sits under it. One-line rows keep one `EstimateColumn`.
 */
export type TopNumber = 'xp' | 'time';

export const TOP_NUMBERS: readonly TopNumber[] = ['xp', 'time'];

/**
 * A quest step's mark in the route list (ui-refresh.md §5.2; the one state table of
 * map-presentation.md §25.2.3): an accept is available, may be available (a doubt at the step) or
 * locked (an error at the step); a turn-in is ready, may be ready, locked, or its readiness is unknown
 * (before the walk has reached it).
 */
export type RowMarkState = 'available' | 'uncertain' | 'locked' | 'ready' | 'record-unknown';

/** The worst issue at a step (error, then warning, then info), which line 2 of a two-line row shows in words. */
export interface RowIssue {
  readonly severity: IssueSeverity;
  /** The validator's full message: the row's name and line 2's tooltip. */
  readonly message: string;
  /**
   * Line 2's short form: the message without the step's own quest ("Needs Cutting Teeth turned in
   * first", "No step finishes objective 1"), since line 1 already names it (review UI-01);
   * omitted: the message.
   */
  readonly short?: string | undefined;
}

/** Line 2's place, short (two-line rows): who or what, and the zone, without the coordinates the tooltip and the name keep (review UI-01). */
export interface RowPlace {
  /** The NPC, object or label ("Kaltunk"); null for none. */
  readonly lead: string | null;
  /** The zone's name ("Durotar"); null when the point names none. */
  readonly zone: string | null;
}

export interface StepRowModel {
  readonly type: 'step';
  /** Stable key, normally the StepId. */
  readonly key: string;
  /** 1-based step number as shown (group headers are not numbered). */
  readonly number: number;
  readonly kind: StepKind;
  /** What the step does, first in line 1 (D-048 A): "Accept", "Turn in", "Complete", "Travel", "Grind". */
  readonly verb: string;
  /** What it does it to, after the verb: the quest's name (without its chain label), "to Razor Hill", the note's text. Ellipsised when long. */
  readonly title: string;
  /** The quest's place in its chain ("1/2" after the title, spoken "1 of 2"); null for none. */
  readonly chain: { readonly index: number; readonly length: number } | null;
  /**
   * Where the step happens, in words ("Kaltunk · Durotar 43.3, 68.5"): line 2 of a two-line row, and
   * dimmed after the title in a one-line row; null for none. Filled in as the row renders
   * (`createRowDeriver`, cached by dataset view and step), so building the rows formats nothing.
   */
  readonly detail: string | null;
  /** `detail`'s short form for line 2 of a two-line row (the lead gives way, the zone stays); omitted or null: `detail` as it is. */
  readonly place?: RowPlace | null | undefined;
  /** Fractional level after this step (12.4 = level 12, 40%); unknown stays unknown. */
  readonly projectedLevel: Readout<number>;
  /** Seconds the step takes (docs/ARCHITECTURE.md §9.3); unknown stays unknown. */
  readonly duration: Readout<number>;
  /** XP the step gains (quest and kill XP); unknown stays unknown. */
  readonly xpGained: Readout<number>;
  /**
   * Why the step's travel time is provisional, or null when it is final: `path`, a travel leg of the
   * step is still being computed; `checking`, the navigation data is still being checked. Its time
   * is the straight-line estimate for now (terrain-navigation.md §9.3). Said in the row's name, and
   * drawn with the pending marker beside the time when the row shows the step time.
   */
  readonly pending: PendingTravel | null;
  /** The ruleset parameters the step's numbers read that are assumptions or Era values, in words; null for none. */
  readonly assumptions: string | null;
  /** Quest level and difficulty for quest steps; null for the other kinds. */
  readonly quest: {
    readonly level: number | null;
    readonly difficulty: Difficulty | null;
    readonly uncertain: boolean;
    readonly provenance: ForeverProvenance;
  } | null;
  readonly issues: IssueCounts;
  /** The worst issue at the step, or null for none (filled in with the walk's issues). */
  readonly issue: RowIssue | null;
  /** The mark's state for an accept or a turn-in; null for the other kinds (their neutral disc has no state). */
  readonly mark: RowMarkState | null;
  /** The whole level the step reaches when the level after it crosses one ("↑2.3", "reaches level 2"); null otherwise. */
  readonly levelUp: number | null;
  readonly locked: boolean;
}

/** A header row for a group of steps (an imported RXP step). As tall as the list's step rows. */
export interface GroupRowModel {
  readonly type: 'group';
  readonly key: string;
  readonly label: string;
  readonly stepCount: number;
  /** An imported RXP step (said on line 2 of a two-line header). */
  readonly imported: boolean;
  /** The level after the group's first and last steps (filled in with the walk's numbers); null before. */
  readonly levelSpan: { readonly from: Readout<number>; readonly to: Readout<number> } | null;
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
