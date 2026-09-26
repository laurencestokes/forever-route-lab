/**
 * `src/rxp`: RestedXP custom-guide import and export (ARCHITECTURE §10, docs/RXP.md). An
 * independent implementation from the behavioural specification in docs/RXP.md and the
 * self-authored fixtures (D-019). Pure: imports only `domain` and `geo`; dataset and geometry
 * lookups are injected; no DOM, clock, randomness or bitwise operators. Load it lazily (dynamic
 * `import()`, ARCHITECTURE §12.1).
 *
 * Main entry points:
 * - `importRxp(input, ids, ctx, options)`: pasted text or a `.lua` file → `RxpImport`s with
 *   their groups, steps and diagnostics (protected strings are refused).
 * - `exportRxp(route, imports, ctx, options)`: route → guide text with the export guarantee;
 *   `exportRxpForms` gives the text and its Lua-wrapped form from one export.
 * - `relowerImport(imp, ids, ctx)`: lower a stored import again.
 * - `parseRxpCst` / `printRxpCst`: the lossless Layer 1 tree; `canonicalizeRxp`: canonical form.
 */
export { canonicalizeRxp, canonicalizeRxpCst, type CanonicalResult } from './canonical';
export { COMMAND_NAMES, commandSpec, type CommandSpec } from './commands';
export { guideDiagnostics, guideHeader, parseRxpCst, printRxpCst, type GuideHeader, type RxpCst, type RxpCstLine, type RxpLineKind } from './cst';
export { RXP_CODES, rxpCodeSpec, sortDiagnostics, type RxpCode, type RxpCodeSpec, type RxpDiagnostic, type RxpStage } from './diagnostics';
export { parseFilter, printFilter, type ParsedFilter } from './filter';
export { canonicalJson, groupFingerprint } from './fingerprint';
export { importRxp, relowerImport, type ImportedGuide, type RxpImportOptions, type RxpImportResult } from './import';
export type { RxpLowerContext, RxpLowerOptions, RxpQuestFacts } from './lower';
export {
  DEFAULT_TRAVEL_RADIUS,
  exportRxp,
  exportRxpForms,
  wrapLua,
  type RxpExportContext,
  type RxpExportError,
  type RxpExportForms,
  type RxpExportOptions,
  type RxpExportResult,
} from './serialize';
export { sha256Hex } from './sha256';
export { looksProtected, unwrapRxpInput, type UnwrapResult, type UnwrappedGuide } from './unwrap';
export { type ZoneKeyLookup, zoneKeyLookup } from './zone-keys';
