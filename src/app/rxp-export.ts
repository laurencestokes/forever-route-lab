import type { ProjectV1, RxpImport } from '../domain';
import { type RxpDiagnostic, type RxpExportResult, exportRxpForms } from '../rxp';
import { type DownloadFile, PROJECT_FILE_EXTENSION, projectFileName } from './persistence';
import type { RxpContext } from './rxp-context';
import type { RxpExportFormat } from './rxp-options';

/**
 * Exporting the open route as an RXP custom guide (docs/UI.md §15, docs/RXP.md §13): the guide text
 * (`.txt`) or an addon file (`.lua`, the text wrapped in `RXPGuides.RegisterGuide(...)`), what the
 * export guarantee made of it, and the diagnostics of what has no RXP form.
 */

/**
 * - `identical`: the route is one imported guide, unedited: the guide text is that import's text,
 *   byte for byte (docs/RXP.md §13.3 rule 1).
 * - `rewritten`: the route holds imported RXP steps but is not one unedited guide: unedited RXP
 *   steps keep their original lines, edited, split and new steps are written in canonical form
 *   (§13.3 rules 2 and 3).
 * - `canonical`: nothing in the route came from an import: all of it is written in canonical form.
 */
export type RxpExportMode = 'identical' | 'rewritten' | 'canonical';

/** Why a step could not be exported. */
export interface RxpExportProblem {
  readonly message: string;
  /** 1-based position of the step in the route, or null for the route as a whole. */
  readonly stepNumber: number | null;
  readonly importId: string | null;
  /** Line of the import's text, or 0. */
  readonly line: number;
}

export interface RxpExportVariant {
  readonly format: RxpExportFormat;
  /** The text; null when the export failed (`problems`). */
  readonly text: string | null;
  readonly file: DownloadFile | null;
  /** Lossy constructs and notes (docs/RXP.md §11.1, codes RXP040-RXP046). */
  readonly diagnostics: readonly RxpDiagnostic[];
  readonly problems: readonly RxpExportProblem[];
}

export interface RxpExportPreview {
  readonly mode: RxpExportMode;
  /** The import the guide text is byte-identical to (mode `identical`). */
  readonly identicalTo: RxpImport | null;
  /** The imports the route's steps come from, in route order. */
  readonly sources: readonly RxpImport[];
  readonly txt: RxpExportVariant;
  readonly lua: RxpExportVariant;
}

export const RXP_EXPORT_MIME = 'text/plain';

/** A file name for an exported guide: the name, with characters file systems refuse replaced, plus `.txt` or `.lua`. */
export function rxpFileName(name: string, format: RxpExportFormat): string {
  const base = projectFileName(name).slice(0, -PROJECT_FILE_EXTENSION.length);
  return `${base}.${format}`;
}

/** The imports the route's RXP groups come from, in route order (each once). */
export function routeImports(project: Pick<ProjectV1, 'route' | 'imports'>): readonly RxpImport[] {
  const byId = new Map(project.imports.map((imp) => [imp.id, imp]));
  const out: RxpImport[] = [];
  const seen = new Set<string>();
  for (const step of project.route.steps) {
    if (step.groupId === null || !Object.hasOwn(project.route.groups, step.groupId)) continue;
    const importId = project.route.groups[step.groupId]?.rxp?.importId;
    if (importId === undefined || seen.has(importId)) continue;
    const imp = byId.get(importId);
    if (imp === undefined) continue;
    seen.add(importId);
    out.push(imp);
  }
  return out;
}

function variant(project: ProjectV1, result: RxpExportResult, format: RxpExportFormat, name: string): RxpExportVariant & { readonly unedited: boolean } {
  if (!result.ok) {
    const position = new Map(project.route.steps.map((step, index) => [step.id, index + 1]));
    const problems = result.errors.map(
      (error): RxpExportProblem => ({
        message: error.message,
        stepNumber: error.stepId === null ? null : (position.get(error.stepId) ?? null),
        importId: error.importId,
        line: error.line,
      }),
    );
    return { format, text: null, file: null, diagnostics: result.diagnostics, problems, unedited: false };
  }
  const file: DownloadFile = { fileName: rxpFileName(name, format), text: result.text, mimeType: RXP_EXPORT_MIME };
  return { format, text: result.text, file, diagnostics: result.diagnostics, problems: [], unedited: result.unedited };
}

/**
 * Both export forms of `project`'s route, from one export (the `.lua` form wraps the `.txt` text,
 * docs/RXP.md §13.4 rule 14). `name` names the files when the route has no name of its own (the
 * project's name). Deterministic: the same project gives the same text.
 *
 * The export sees the quest facts of the context, so a step that completes all objectives of a
 * quest is written as one `.complete` per objective when the quest's objective count is known, and
 * as an `RXP042` note otherwise (docs/RXP.md §13.6); it never blocks the export.
 */
export function previewRxpExport(project: ProjectV1, ctx: RxpContext, name: string): RxpExportPreview {
  const fileBase = project.route.name.trim() === '' ? name : project.route.name;
  const forms = exportRxpForms(project.route, project.imports, { ...ctx.export, quest: ctx.questFacts });
  const txt = variant(project, forms.txt, 'txt', fileBase);
  const lua = variant(project, forms.lua, 'lua', fileBase);
  const sources = routeImports(project);
  // Unedited means the text is one import's text (`exportRxpForms`); name that import.
  const identicalTo = txt.unedited ? (project.imports.find((imp) => imp.text === txt.text) ?? null) : null;
  const mode: RxpExportMode = identicalTo !== null ? 'identical' : sources.length > 0 ? 'rewritten' : 'canonical';
  const strip = ({ unedited: _unedited, ...rest }: RxpExportVariant & { readonly unedited: boolean }): RxpExportVariant => rest;
  return { mode, identicalTo, sources, txt: strip(txt), lua: strip(lua) };
}
