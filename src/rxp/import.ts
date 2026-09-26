import type { IdSource } from '../domain/ids';
import type { RxpImport } from '../domain/project';
import type { RouteGroup, RouteStep } from '../domain/route';
import { guideDiagnostics, guideHeader, parseRxpCst } from './cst';
import { type LineMapping, type RawDiagnostic, type RxpDiagnostic, IDENTITY_LINES, finishDiagnostic, sortDiagnostics } from './diagnostics';
import { type LoweredGroup, type RxpLowerContext, lowerRxpCst } from './lower';
import { sha256Hex } from './sha256';
import { type UnwrappedGuide, unwrapRxpInput } from './unwrap';

/**
 * The import pipeline (ARCHITECTURE §10 steps 1-4): unwrap → CST → diagnostics → lowering. Each
 * guide becomes an `RxpImport` (text kept verbatim for lossless export) plus its groups and steps.
 */

export interface RxpImportOptions {
  /** Frame for percent points on 1412/1423/1433/1453 (§10.4). Default `forever`. */
  readonly changedZoneFrame?: 'forever' | 'era';
  /** Name for a guide without `#name` (for example the file name). */
  readonly fallbackName?: string;
}

export interface ImportedGuide {
  readonly import: RxpImport;
  /** Steps in source order. */
  readonly steps: readonly RouteStep[];
  /** Keyed by GroupId, like `Route.groups`. */
  readonly groups: Readonly<Record<string, RouteGroup>>;
  /** Diagnostics sorted by line; Lua-wrapped guides report Lua-file lines (§3.2 rule 5). */
  readonly diagnostics: readonly RxpDiagnostic[];
}

export type RxpImportResult =
  | { readonly status: 'refused'; readonly guides: readonly []; readonly diagnostics: readonly RxpDiagnostic[] }
  | {
      readonly status: 'ok';
      /** `raw`: the input was guide text; `lua`: guides were extracted from RegisterGuide calls. */
      readonly source: 'raw' | 'lua';
      readonly guides: readonly ImportedGuide[];
      /** Unwrap diagnostics (RXP020, RXP021), with Lua-file lines and an empty import id. */
      readonly diagnostics: readonly RxpDiagnostic[];
    };

const DEFAULT_NAME = 'Imported RXP guide';

function lineMapping(guide: UnwrappedGuide): LineMapping {
  if (guide.form === 'raw') return IDENTITY_LINES;
  return {
    line: (textLine) => guide.fileLines[textLine - 1] ?? guide.fileLines[guide.fileLines.length - 1] ?? textLine,
    column: (textLine, column) => (textLine === 1 && guide.form === 'long-bracket' ? column + guide.firstLineColumnOffset : column),
  };
}

export interface LoweredImport {
  readonly steps: readonly RouteStep[];
  readonly groups: Readonly<Record<string, RouteGroup>>;
  readonly lowered: readonly LoweredGroup[];
  readonly diagnostics: readonly RawDiagnostic[];
}

/** Lowers a stored import again (for example after the dataset changed); diagnostics use lines of `imp.text`. */
export function lowerImport(imp: RxpImport, ids: IdSource, ctx: RxpLowerContext): LoweredImport {
  const cst = parseRxpCst(imp.text);
  const lowered = lowerRxpCst(cst, imp.id, { changedZoneFrame: imp.options.changedZoneFrame }, ids, ctx);
  const raw = [...cst.diagnostics, ...guideDiagnostics(cst, { groupArg: imp.options.lua?.groupArg ?? null }), ...lowered.diagnostics];
  const groups: Record<string, RouteGroup> = {};
  for (const group of lowered.groups) groups[group.group.id] = group.group;
  return { steps: lowered.groups.flatMap((group) => group.steps), groups, lowered: lowered.groups, diagnostics: raw };
}

/** `lowerImport` with finished diagnostics. */
export function relowerImport(imp: RxpImport, ids: IdSource, ctx: RxpLowerContext): Omit<ImportedGuide, 'import'> {
  const result = lowerImport(imp, ids, ctx);
  return { steps: result.steps, groups: result.groups, diagnostics: sortDiagnostics(result.diagnostics.map((raw) => finishDiagnostic(raw, imp.id))) };
}

/**
 * Imports pasted text or a custom-guide `.lua` file. Never executes Lua and never decodes a
 * protected import string (`status: 'refused'`). IDs (imports, groups, steps) come from `ids`.
 */
export function importRxp(input: string, ids: IdSource, ctx: RxpLowerContext, options: RxpImportOptions = {}): RxpImportResult {
  const unwrapped = unwrapRxpInput(input);
  const unwrapDiagnostics = unwrapped.diagnostics.map((raw) => finishDiagnostic(raw, ''));
  if (unwrapped.kind === 'refused') return { status: 'refused', guides: [], diagnostics: unwrapDiagnostics };
  const guides = unwrapped.guides.map((guide): ImportedGuide => {
    const id = ids.next('import');
    const header = guideHeader(parseRxpCst(guide.text));
    const imp: RxpImport = {
      id,
      name: header.name ?? options.fallbackName ?? DEFAULT_NAME,
      sourceHash: sha256Hex(guide.text),
      text: guide.text,
      options: {
        changedZoneFrame: options.changedZoneFrame ?? 'forever',
        lua: guide.form === 'raw' ? null : { groupArg: guide.groupArg, defaultFor: guide.defaultForArg },
      },
    };
    const lowered = lowerImport(imp, ids, ctx);
    const mapping = lineMapping(guide);
    return {
      import: imp,
      steps: lowered.steps,
      groups: lowered.groups,
      diagnostics: sortDiagnostics(lowered.diagnostics.map((raw) => finishDiagnostic(raw, id, mapping))),
    };
  });
  return { status: 'ok', source: unwrapped.kind, guides, diagnostics: sortDiagnostics(unwrapDiagnostics) };
}
