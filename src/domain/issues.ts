import type { QuestId, StepId } from './ids';

export type IssueSeverity = 'info' | 'warning' | 'error';

/**
 * A machine-readable problem found by validation, simulation, data checks or the RXP parser.
 * `code` follows one grammar: family prefix and number, then a slug (`VAL004-min-level`,
 * `RXP001-unknown-command`, `DATA001-custom-shadowed`); the registry lives in src/validate/codes.ts.
 * Like every other domain contract type, absent values are explicit nulls, never missing keys, so
 * issues serialise and snapshot with a fixed shape.
 */
export interface ValidationIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  /** The step the issue is about, or null for a route-level issue. */
  readonly stepId: StepId | null;
  /** The quest the issue is about, or null. */
  readonly questId: QuestId | null;
  readonly message: string;
  /** Machine-readable details for the message, or null. */
  readonly data: Readonly<Record<string, string | number | boolean | null>> | null;
}
