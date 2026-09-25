import type { QuestId } from './ids';

/**
 * Conditions attached to steps and groups. Filters are kept as ASTs and evaluated by the engine
 * against the character and route profile, never at parse time (docs/ARCHITECTURE.md §9.2).
 * The RXP parser produces these (Milestone 5); the shapes may grow until schema v1 freezes (M6).
 */

/** An RXP `<<` character filter: `/` is OR, juxtaposition is AND, `!` is NOT. */
export type FilterAst =
  | { readonly kind: 'word'; readonly word: string }
  | { readonly kind: 'minLevel'; readonly level: number }
  | { readonly kind: 'not'; readonly expr: FilterAst }
  | { readonly kind: 'and'; readonly exprs: readonly FilterAst[] }
  | { readonly kind: 'or'; readonly exprs: readonly FilterAst[] };

/** A load-time variant tag such as `#xprate <1.5` or `#softcore`, kept verbatim. */
export interface VariantTag {
  readonly name: string;
  readonly value: string | null;
  readonly filter: FilterAst | null;
}

/** Runtime skip predicates (RXP `.isOnQuest`, `.xp L,1` and similar). */
export type StatePredicate =
  | {
      readonly kind: 'questState';
      readonly state: 'onQuest' | 'complete' | 'turnedIn' | 'available';
      readonly questIds: readonly QuestId[];
      /** Whether any or all of `questIds` must be in the state (RXP lists mean any). */
      readonly match: 'any' | 'all';
      readonly negate: boolean;
    }
  | { readonly kind: 'levelAtLeast'; readonly level: number; readonly xp: number | null; readonly negate: boolean }
  | { readonly kind: 'opaque'; readonly raw: string };

export interface StepCondition {
  readonly filter: FilterAst | null;
  readonly variant: readonly VariantTag[] | null;
  readonly skipIf: readonly StatePredicate[];
}

/** Three-valued result: unresolvable tokens (for example an unknown race token) give `unknown`. */
export type Truth = 'true' | 'false' | 'unknown';
