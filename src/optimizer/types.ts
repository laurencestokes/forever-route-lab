import type { IdSource, StepId, UiMapId } from '../domain/ids';
import type { ProjectV1 } from '../domain/project';
import type { RouteStep } from '../domain/route';
import type {
  ContractSummary,
  MatrixCache,
  SearchOutcome,
  SearchSolution,
  SearchStats,
  SearchTermination,
  SectionAnalysis,
  SectionWalk,
  StepDependency,
} from './core/types';

/**
 * The optimiser's public types (docs/research/optimizer-m7.md §11; ARCHITECTURE §11.1 as amended
 * by the plan's §17). `optimizer/worker` may import this file; `optimizer/core` may not, so the core's
 * own types live in `core/types.ts` and are re-exported here.
 *
 * The UI and every document say "best route found under these assumptions", never "optimal".
 */

export type {
  AdvanceResult,
  AvailabilityDependencies,
  CompiledProblem,
  CompileAvailability,
  CompileFailure,
  CompileInput,
  ContractSummary,
  DecodeTable,
  MatrixCache,
  OptimizationGoal,
  ReadonlyWalkMemo,
  SearchOptions,
  SearchOutcome,
  SearchProblem,
  SearchProgress,
  SearchSolution,
  SearchStats,
  SearchTermination,
  SectionAnalysis,
  SectionProbe,
  SectionWalk,
  StepDependency,
  StepProbe,
  Stepper,
} from './core/types';

export interface OptimizationRequest {
  readonly project: ProjectV1;
  /** The editor revision the request was made against; a run on another revision is refused. */
  readonly baseRevision: number;
  readonly section: { readonly firstStepId: StepId; readonly lastStepId: StepId };
  /** `allowNewQuests` is refused until stage 2 (§2); `zones` and `levelWindow` only filter new quests. */
  readonly scope: { readonly allowNewQuests: boolean; readonly zones: readonly UiMapId[] | null; readonly levelWindow: readonly [number, number] | null };
  readonly goal: {
    readonly kind: 'min-time';
    /** Known XP the section must gain: the original section's (`keep-original`) or a number. */
    readonly targetXp: 'keep-original' | number;
    /**
     * What the terminal grind fill may cover (D-042, review OP-08): `shortfall` (the default) only
     * the XP a reorder loses, with every droppable quest kept; `replace-quests` also dropped quests.
     */
    readonly grindFill?: 'shortfall' | 'replace-quests';
  };
}

export interface OptimizationOptions {
  readonly beamWidth: number;
  readonly maxEvaluations: number;
  /** A wall-clock limit the worker host enforces; a run it ends is not reproducible. */
  readonly maxMillis: number | null;
  /** Seconds per unit scheduled out of original order. */
  readonly divergencePenalty: number;
}

export const DEFAULT_OPTIMIZATION_OPTIONS: OptimizationOptions = { beamWidth: 256, maxEvaluations: 4_000_000, maxMillis: null, divergencePenalty: 0 };

export type OptimizationPhase = 'paths' | 'compiling' | 'searching' | 'finishing';

export interface OptimizationProgress {
  readonly phase: OptimizationPhase;
  readonly depth: number;
  readonly evaluations: number;
  readonly beamSize: number;
  readonly incumbentSeconds: number;
  readonly bestSeconds: number | null;
  readonly elapsedMs: number;
  /** "Computing paths" (phase `paths`): legs filled of those the section needs. */
  readonly legs: { readonly done: number; readonly total: number } | null;
}

/** What `optimize` compiles from: the analysis (before "computing paths") and the baseline walk (after). */
export interface OptimizationContext {
  readonly analysis: SectionAnalysis;
  readonly baseline: SectionWalk;
  readonly cache?: MatrixCache;
}

export interface OptimizerRun<R> {
  readonly result: Promise<R>;
  cancel(): void;
  onProgress(cb: (progress: OptimizationProgress) => void): () => void;
}

/** A searched section, before the app's verification re-walk (§9). */
export type SearchedSection =
  | {
      readonly status: 'searched';
      readonly termination: Exclude<SearchTermination, 'cancelled'>;
      /** False when `maxMillis` ended the run. */
      readonly reproducible: boolean;
      /** Up to four decoded candidates, best first, for verification in order. */
      readonly candidates: readonly { readonly steps: readonly RouteStep[]; readonly dependencies: readonly StepDependency[]; readonly solution: SearchSolution }[];
      readonly incumbent: SearchSolution;
      /**
       * The incumbent decoded (§7.5): the original section, plus the grind fill a numeric target
       * needs when the original misses it. Candidates are judged against its re-walk.
       */
      readonly incumbentSection: { readonly steps: readonly RouteStep[]; readonly dependencies: readonly StepDependency[] };
      /** Closes refused only because no grind fill may follow unknown XP (XP-4; review PAR-04), or null. */
      readonly unknownXpBlocked: SearchOutcome['unknownXpBlocked'];
      readonly summary: ContractSummary;
      readonly stats: SearchStats;
    }
  | { readonly status: 'cancelled'; readonly stats: SearchStats }
  | { readonly status: 'infeasible' | 'failed'; readonly reason: string; readonly stats: SearchStats };

/** Compiles and searches (phases `compiling` and `searching`); the app runs `paths` before and `finishing` after. */
export interface Optimizer {
  optimize(request: OptimizationRequest, options: OptimizationOptions, context: OptimizationContext, ids: IdSource): OptimizerRun<SearchedSection>;
  dispose(): void;
}
