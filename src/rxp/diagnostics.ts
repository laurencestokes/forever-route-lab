import type { IssueSeverity } from '../domain/issues';

/**
 * Parser diagnostics (docs/RXP.md §11.1, ARCHITECTURE §10 step 3). They describe text, not steps,
 * so they are their own type rather than `ValidationIssue`; the UI lists both side by side.
 * `rxpCompat: true` means RestedXP itself would drop or change the line.
 */
export interface RxpDiagnostic {
  /** Registry code, for example `RXP001-unknown-command`. */
  readonly code: RxpCode;
  readonly severity: IssueSeverity;
  /** `RxpImport.id`; empty for export diagnostics that concern the whole route. */
  readonly importId: string;
  /**
   * 1-based physical line: of the import text, or of the Lua file for diagnostics made while a
   * wrapped guide is imported (§3.2 rule 5). 0 when the diagnostic has no source line (an
   * app-created step, or a route-level export note).
   */
  readonly line: number;
  /** 1-based column in Unicode code points; 0 with `line` 0. */
  readonly column: number;
  readonly rxpCompat: boolean;
  readonly message: string;
}

export type RxpStage = 'unwrap' | 'cst' | 'lowering' | 'export';

export interface RxpCodeSpec {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly stage: RxpStage;
  readonly rxpCompat: boolean;
  /** What the code means, in our words (docs/RXP.md §11.1). */
  readonly meaning: string;
}

/**
 * The RXP family of the diagnostic registry (docs/RXP.md §11.1). Numbers are never reused:
 * RXP008 and RXP023 are unassigned and RXP033 is retired. `src/validate/codes.ts` holds the other
 * families; it does not re-export this table (`validate` may not import `rxp`, ARCHITECTURE §4),
 * and tests/validate-e2e.test.ts checks that both follow one grammar.
 */
export const RXP_CODES = [
  { code: 'RXP001-unknown-command', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'command name not in our list' },
  { code: 'RXP002-stray-line', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'line with no recognised prefix' },
  { code: 'RXP003-goto-missing-zone', severity: 'error', stage: 'lowering', rxpCompat: true, meaning: '.goto whose first argument is a number' },
  { code: 'RXP004-malformed-number', severity: 'error', stage: 'lowering', rxpCompat: true, meaning: 'a number RXP cannot read' },
  { code: 'RXP005-empty-field', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'empty argument field collapsed' },
  { code: 'RXP006-filter-before-text', severity: 'error', stage: 'cst', rxpCompat: true, meaning: '<< before >> on one line' },
  { code: 'RXP007-inline-comment', severity: 'info', stage: 'cst', rxpCompat: true, meaning: '-- cuts >> text or a rest-of-line argument' },
  { code: 'RXP009-localized-zone-name', severity: 'error', stage: 'lowering', rxpCompat: true, meaning: 'zone key not in the English key table' },
  { code: 'RXP010-step-prefix', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'line starts with step but is not step or step <<…' },
  { code: 'RXP011-step-typo', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'stray or filtered line that looks like step' },
  { code: 'RXP012-unknown-tag', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'unknown or typo’d tag key' },
  { code: 'RXP013-shadowed-tag', severity: 'info', stage: 'cst', rxpCompat: true, meaning: 'later duplicate of a first-wins tag' },
  { code: 'RXP014-function-tag', severity: 'info', stage: 'cst', rxpCompat: false, meaning: '#key = functionName, kept opaque' },
  { code: 'RXP015-header-command', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'command before the first step' },
  { code: 'RXP016-filter-quirk', severity: 'info', stage: 'cst', rxpCompat: true, meaning: 'double <<, unknown filter word, parenthesis or ! oddity, number-like word' },
  { code: 'RXP017-command-case', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'command known only in another case' },
  { code: 'RXP018-missing-text', severity: 'error', stage: 'lowering', rxpCompat: true, meaning: 'command whose >> text is required' },
  { code: 'RXP019-protected-format', severity: 'error', stage: 'unwrap', rxpCompat: false, meaning: 'protected import string; input refused' },
  { code: 'RXP020-lua-dynamic', severity: 'warning', stage: 'unwrap', rxpCompat: false, meaning: 'non-literal RegisterGuide argument; call skipped' },
  { code: 'RXP021-lua-guard-ignored', severity: 'info', stage: 'unwrap', rxpCompat: false, meaning: 'top-level Lua other than registration calls' },
  { code: 'RXP022-unterminated-comment', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'comment on a last line without a line break' },
  { code: 'RXP024-other-game', severity: 'warning', stage: 'cst', rxpCompat: true, meaning: 'only other games’ tags in the header' },
  { code: 'RXP025-missing-name-or-group', severity: 'error', stage: 'cst', rxpCompat: true, meaning: '#name or #group missing' },
  { code: 'RXP026-bom', severity: 'info', stage: 'cst', rxpCompat: false, meaning: 'UTF-8 byte-order mark' },
  { code: 'RXP027-classic-header', severity: 'info', stage: 'cst', rxpCompat: false, meaning: '#classic without #forever' },
  { code: 'RXP028-level-filter', severity: 'info', stage: 'lowering', rxpCompat: false, meaning: 'level words evaluated at the route’s start level' },
  { code: 'RXP029-convertquest', severity: 'warning', stage: 'lowering', rxpCompat: false, meaning: 'quest IDs remapped for the rest of the guide' },
  { code: 'RXP030-frame-ambiguous', severity: 'warning', stage: 'lowering', rxpCompat: false, meaning: 'percent point on 1412/1423/1433/1453; frame from the import option' },
  { code: 'RXP031-objective-out-of-range', severity: 'warning', stage: 'lowering', rxpCompat: false, meaning: '.complete index beyond the quest’s objective count' },
  { code: 'RXP032-objective-unchecked', severity: 'info', stage: 'lowering', rxpCompat: false, meaning: '.complete on a custom or unknown quest' },
  { code: 'RXP034-not-simulated', severity: 'info', stage: 'lowering', rxpCompat: false, meaning: 'construct kept for export, approximated or ignored by the engine' },
  { code: 'RXP035-goto-outside-map', severity: 'warning', stage: 'lowering', rxpCompat: true, meaning: 'world point outside the named UiMap' },
  { code: 'RXP036-pseudo-zone-unconverted', severity: 'warning', stage: 'lowering', rxpCompat: false, meaning: 'StormwindNew/EPLNew point; no location' },
  { code: 'RXP040-group-split', severity: 'info', stage: 'export', rxpCompat: false, meaning: 'a group exported as several RXP steps' },
  { code: 'RXP041-app-fields-not-exported', severity: 'info', stage: 'export', rxpCompat: false, meaning: 'once per export: counts of fields with no RXP form' },
  { code: 'RXP042-unrepresentable-step', severity: 'warning', stage: 'export', rxpCompat: false, meaning: 'step emitted as a >> note' },
  { code: 'RXP043-header', severity: 'info', stage: 'export', rxpCompat: false, meaning: 'header generated, or headers of other imports dropped' },
  { code: 'RXP044-text-dropped', severity: 'info', stage: 'export', rxpCompat: false, meaning: '>> texts of merged .complete lines after the first, when the step was rebuilt' },
  { code: 'RXP045-comment-dropped', severity: 'info', stage: 'export', rxpCompat: false, meaning: 'comment attached to a deleted line' },
  { code: 'RXP046-wrapper-args', severity: 'warning', stage: 'export', rxpCompat: false, meaning: 'raw export of a guide imported from the two/three-argument Lua form' },
] as const satisfies readonly RxpCodeSpec[];

export type RxpCode = (typeof RXP_CODES)[number]['code'];

const SPECS: ReadonlyMap<string, RxpCodeSpec> = new Map(RXP_CODES.map((spec) => [spec.code, spec]));

export function rxpCodeSpec(code: RxpCode): RxpCodeSpec {
  const spec = SPECS.get(code);
  if (spec === undefined) throw new Error(`unregistered RXP diagnostic code ${code}`);
  return spec;
}

/**
 * A diagnostic before it is attached to an import: `line` is a line of the text being parsed.
 * `severity` overrides the registry default (only `RXP004` inside a `.xp` expression, §9.4).
 */
export interface RawDiagnostic {
  readonly code: RxpCode;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity?: IssueSeverity;
}

export const rawDiagnostic = (code: RxpCode, line: number, column: number, message: string, severity?: IssueSeverity): RawDiagnostic =>
  severity === undefined ? { code, line, column, message } : { code, line, column, message, severity };

/** Maps a line of an extracted guide text to its Lua file line and column offset. */
export interface LineMapping {
  readonly line: (textLine: number) => number;
  readonly column: (textLine: number, column: number) => number;
}

export const IDENTITY_LINES: LineMapping = { line: (textLine) => textLine, column: (_line, column) => column };

export function finishDiagnostic(raw: RawDiagnostic, importId: string, mapping: LineMapping = IDENTITY_LINES): RxpDiagnostic {
  const spec = rxpCodeSpec(raw.code);
  const line = raw.line > 0 ? mapping.line(raw.line) : 0;
  const column = raw.line > 0 && raw.column > 0 ? mapping.column(raw.line, raw.column) : 0;
  return { code: raw.code, severity: raw.severity ?? spec.severity, importId, line, column, rxpCompat: spec.rxpCompat, message: raw.message };
}

/** Stable order: line, column, code, message (a deterministic listing for the UI and snapshots). */
export function sortDiagnostics<T extends { readonly line: number; readonly column: number; readonly code: string; readonly message: string }>(
  diagnostics: readonly T[],
): T[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column || cmp(a.code, b.code) || cmp(a.message, b.message));
}
