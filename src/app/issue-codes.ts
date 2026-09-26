import { isRegisteredCode, issueCodeSpec } from '../validate/codes';

/**
 * The issue-code registry for the ui (docs/ARCHITECTURE.md §4: ui imports values from app only).
 * Only the validation panel reads it, and that panel loads on first use (src/ui/app/lazy-parts.ts),
 * so the registry stays out of the entry chunk; nothing in the entry chunk may import this file.
 */

/** What a code means, from src/validate/codes.ts; null for a code the registry does not list (an RXP code, say). */
export function issueExplanation(code: string): string | null {
  return isRegisteredCode(code) ? issueCodeSpec(code).explanation : null;
}

/** The SIMULATION rule (`VAL-4`, `SIM-17`) or section that defines a registered code; null otherwise. */
export function issueRule(code: string): string | null {
  return isRegisteredCode(code) ? issueCodeSpec(code).rule : null;
}
