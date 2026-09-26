import type { CustomQuest, DatasetIdentity, DatasetView, IdSource, ProjectV1, QuestId, RouteGroup, RouteStep, StepId } from '../domain';
import { createEmptyProject, defaultCharacter, sequentialIdSource } from '../domain';
import type { MapGeometry } from '../geo/types';
import { type ImportedGuide, type RxpDiagnostic, importRxp, unwrapRxpInput } from '../rxp';
import { systemClock } from './clock';
import type { Command } from './commands';
import type { DatasetSource, DatasetViewInput } from './dataset-source';
import { collisionFreeIds, randomIdSource } from './ids';
import { buildCustomQuest } from './project-commands';
import { type RxpContext, createRxpContext } from './rxp-context';
import type { RxpFrame, RxpImportTarget, RxpUnknownQuestPolicy } from './rxp-options';

/**
 * Importing an RXP custom guide into a project (docs/UI.md §15, ARCHITECTURE §10, docs/RXP.md §12).
 *
 * - `previewRxpImport` checks pasted text or a file: unwrap, CST, diagnostics and lowering, with
 *   throwaway ids. The dialog shows its diagnostics and the quests the data lacks.
 * - `rxpImportCommand` adds the chosen guides to the end of the open route as **one command**
 *   (one undo entry); `rxpImportProject` builds a new project from them, which the project session
 *   stores and opens. Both lower the text again with the ids they are given: the pipeline is
 *   deterministic (the same text, options, lookups and ids give the same steps), so what is added is
 *   exactly what the preview showed.
 * - Every guide's text goes into `project.imports` verbatim, so an unedited guide exports byte for
 *   byte (docs/RXP.md §13.3).
 * - Quests the data does not have (docs/RXP.md §15.4) become placeholder custom quests with their
 *   real ids (ARCHITECTURE §5.5) or stay unknown, as the user chooses. A placeholder knows only its
 *   id: no name from the game, level, objectives, givers or XP (unknown, never made up).
 */

export interface RxpImportRequest {
  /** Pasted text, or the text of an opened `.lua` or `.txt` file. */
  readonly input: string;
  /** The opened file's name: the name of a guide without `#name`. Null for pasted text. */
  readonly fileName: string | null;
  /** Frame of percent points on the four frame-changed zone maps (docs/RXP.md §10.4). */
  readonly frame: RxpFrame;
}

export interface RxpImportChoice {
  /** Indices of the guides to import (a Lua file can hold several), or all of them. */
  readonly guides: readonly number[] | 'all';
  readonly unknownQuests: RxpUnknownQuestPolicy;
}

export interface RxpGuideSummary {
  readonly index: number;
  /** The preview's (throwaway) import id, which the guide's diagnostics carry. */
  readonly importId: string;
  readonly name: string;
  /** RXP steps (route groups). */
  readonly rxpSteps: number;
  /** Route steps (an RXP step lowers to one or more). */
  readonly steps: number;
  /** Sorted by line; for a Lua file, lines of the file (docs/RXP.md §3.2 rule 5). */
  readonly diagnostics: readonly RxpDiagnostic[];
}

/** A quest the guide's steps use that the data (and the project's custom quests) do not have. */
export interface RxpUnknownQuest {
  readonly questId: QuestId;
  /** Indices of the guides whose steps use it. */
  readonly guides: readonly number[];
  /** How many steps use it, over all guides. */
  readonly uses: number;
  /** 1-based line of the input where a step first uses it; 0 when no source line is known. */
  readonly line: number;
}

export type RxpImportPreview =
  | {
      /** A RestedXP protected import string (docs/RXP.md §3.3): refused, never decoded or kept. */
      readonly status: 'refused';
      readonly message: string;
      readonly diagnostics: readonly RxpDiagnostic[];
    }
  | {
      readonly status: 'ok';
      /** `raw`: guide text; `lua`: guides read from `RegisterGuide` calls of a Lua file. */
      readonly source: 'raw' | 'lua';
      /** Empty when a Lua file has no call whose text could be read. */
      readonly guides: readonly RxpGuideSummary[];
      /** Diagnostics of the Lua file itself (`RXP020`, `RXP021`), with lines of the file. */
      readonly diagnostics: readonly RxpDiagnostic[];
      /** Ascending by id. */
      readonly unknownQuests: readonly RxpUnknownQuest[];
    };

/** What an import added. */
export interface RxpImportApplied {
  readonly project: ProjectV1;
  readonly guides: readonly ImportedGuide[];
  /** Ids of the steps added, in route order. */
  readonly stepIds: readonly StepId[];
  /** Placeholder custom quests added, ascending by id. */
  readonly placeholders: readonly QuestId[];
  /** Quests the guides use that stay unknown, ascending. */
  readonly unknown: readonly QuestId[];
}

export interface RxpNewProject {
  readonly project: ProjectV1;
  /** The project's name: the guide's `#name` (for several guides, the file's name). */
  readonly name: string;
  readonly applied: RxpImportApplied;
}

/** The name of a guide without `#name` and without a file name. */
export const DEFAULT_GUIDE_NAME = 'Imported RXP guide';

/** A guide name from a file name: `Horde-01_Durotar.lua` → `Horde-01_Durotar`; null when nothing is left. */
export function guideNameFromFileName(fileName: string | null): string | null {
  if (fileName === null) return null;
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.(lua|txt)$/i, '')
    .trim();
  return base === '' ? null : base;
}

// Quest ids -------------------------------------------------------------------------------------

/** The quests a step is about: accept and turn-in (with their any-of alternatives), complete targets, abandon. */
export function questIdsOfStep(step: RouteStep): readonly QuestId[] {
  switch (step.kind) {
    case 'accept':
    case 'turnin':
      return step.anyOf === null ? [step.questId] : [step.questId, ...step.anyOf];
    case 'complete':
      return step.targets.map((target) => target.questId);
    case 'abandon':
      return [step.questId];
    case 'travel':
    case 'grind':
    case 'hearth':
    case 'flight':
    case 'train':
    case 'vendor':
    case 'note':
      return [];
  }
}

/**
 * The name of a placeholder custom quest. It is a label, not the quest's name in the game, which
 * the data does not have: the user can rename it in the custom quest editor.
 */
export const placeholderQuestName = (id: QuestId): string => `Quest ${String(id)} (placeholder from an RXP guide)`;

/**
 * A placeholder custom quest for a quest the data lacks (ARCHITECTURE §5.5): its real id and
 * nothing else. Level, required level, XP, givers, receivers and objectives are unknown (an empty
 * objective list on a custom quest means "none listed", not "none", `buildCustomQuest`), and its
 * Forever status is unknown.
 */
export function placeholderCustomQuest(id: QuestId): CustomQuest {
  return buildCustomQuest(
    { id, name: placeholderQuestName(id), level: null, minLevel: null, baseXp: null, foreverStatus: 'unknown', starterLocation: null, finisherLocation: null },
    null,
  );
}

// Preview ---------------------------------------------------------------------------------------

function fallbackNameOf(request: RxpImportRequest): string | undefined {
  return guideNameFromFileName(request.fileName) ?? undefined;
}

function runImport(request: RxpImportRequest, ids: IdSource, ctx: RxpContext) {
  const fallbackName = fallbackNameOf(request);
  return importRxp(request.input, ids, ctx.lower, fallbackName === undefined ? { changedZoneFrame: request.frame } : { changedZoneFrame: request.frame, fallbackName });
}

/**
 * Checks `request` without changing anything: what each guide lowers to, its diagnostics, and the
 * quests its steps use that `ctx` does not know. Ids are throwaway (`sequentialIdSource`).
 */
export function previewRxpImport(request: RxpImportRequest, ctx: RxpContext): RxpImportPreview {
  const result = runImport(request, sequentialIdSource(), ctx);
  if (result.status === 'refused') {
    const first = result.diagnostics[0];
    return { status: 'refused', message: first?.message ?? 'This input is not supported.', diagnostics: result.diagnostics };
  }
  // The unwrap again, for the file line of each guide text line (the lowered steps carry lines of their guide text).
  const unwrapped = unwrapRxpInput(request.input);
  const fileLineOf = (guideIndex: number, textLine: number): number => {
    const guide = unwrapped.guides[guideIndex];
    if (guide === undefined || guide.form === 'raw') return textLine;
    return guide.fileLines[textLine - 1] ?? 0;
  };
  const unknown = new Map<QuestId, { guides: Set<number>; uses: number; line: number }>();
  const guides = result.guides.map((guide, index): RxpGuideSummary => {
    for (const step of guide.steps) {
      const textLine = step.rxp?.line?.firstLine ?? 0;
      const line = textLine > 0 ? fileLineOf(index, textLine) : 0;
      for (const id of new Set(questIdsOfStep(step))) {
        if (ctx.questFacts(id) !== null) continue;
        const entry = unknown.get(id) ?? { guides: new Set<number>(), uses: 0, line: 0 };
        entry.guides.add(index);
        entry.uses += 1;
        if (line > 0 && (entry.line === 0 || line < entry.line)) entry.line = line;
        unknown.set(id, entry);
      }
    }
    return { index, importId: guide.import.id, name: guide.import.name, rxpSteps: Object.keys(guide.groups).length, steps: guide.steps.length, diagnostics: guide.diagnostics };
  });
  const unknownQuests = [...unknown]
    .sort(([a], [b]) => a - b)
    .map(([questId, entry]): RxpUnknownQuest => ({ questId, guides: [...entry.guides].sort((a, b) => a - b), uses: entry.uses, line: entry.line }));
  return { status: 'ok', source: result.source, guides, diagnostics: result.diagnostics, unknownQuests };
}

// Applying --------------------------------------------------------------------------------------

const selected = (choice: RxpImportChoice, index: number): boolean => choice.guides === 'all' || choice.guides.includes(index);

/**
 * `project` with the chosen guides added at the end of its route: their steps and groups, their
 * `RxpImport`s, and (by `choice.unknownQuests`) placeholder custom quests for the quests neither
 * `ctx` nor the project's custom quests know. Null when the input is refused or no guide is chosen.
 * Ids come from `ids`; the caller makes them collision-free (the store's command context does).
 */
export function applyRxpImport(project: ProjectV1, request: RxpImportRequest, choice: RxpImportChoice, ctx: RxpContext, ids: IdSource): RxpImportApplied | null {
  const result = runImport(request, ids, ctx);
  if (result.status === 'refused') return null;
  const guides = result.guides.filter((_guide, index) => selected(choice, index));
  if (guides.length === 0) return null;
  const steps: RouteStep[] = [];
  const groups: Record<string, RouteGroup> = { ...project.route.groups };
  for (const guide of guides) {
    steps.push(...guide.steps);
    Object.assign(groups, guide.groups);
  }
  const custom = new Set<number>(project.customQuests.map((quest) => quest.id));
  const unknown = new Set<QuestId>();
  for (const step of steps) for (const id of questIdsOfStep(step)) if (ctx.questFacts(id) === null && !custom.has(id)) unknown.add(id);
  const unknownIds = [...unknown].sort((a, b) => a - b);
  const placeholders = choice.unknownQuests === 'placeholder' ? unknownIds : [];
  const next: ProjectV1 = {
    ...project,
    route: { ...project.route, steps: [...project.route.steps, ...steps], groups },
    imports: [...project.imports, ...guides.map((guide) => guide.import)],
    customQuests: placeholders.length === 0 ? project.customQuests : [...project.customQuests, ...placeholders.map(placeholderCustomQuest)],
  };
  return {
    project: next,
    guides,
    stepIds: steps.map((step) => step.id),
    placeholders,
    unknown: choice.unknownQuests === 'placeholder' ? [] : unknownIds,
  };
}

/** Adds the chosen guides to the end of the open route: one command, so one undo removes it all. */
export function rxpImportCommand(request: RxpImportRequest, choice: RxpImportChoice, ctx: RxpContext): Command {
  return {
    label: 'Import RXP guide',
    apply(project, commandCtx) {
      return applyRxpImport(project, request, choice, ctx, commandCtx.ids)?.project ?? project;
    },
  };
}

/** The view inputs of a new project's character (the default one, no custom quests or overrides). */
const NO_CUSTOM_QUESTS: readonly CustomQuest[] = [];
const NO_OVERRIDES: DatasetViewInput['questOverrides'] = {};

export function newProjectViewInput(): DatasetViewInput {
  const character = defaultCharacter();
  return { faction: character.faction, class: character.class, customQuests: NO_CUSTOM_QUESTS, questOverrides: NO_OVERRIDES };
}

export interface RxpNewProjectOptions {
  /** The loaded dataset's identity: the project records its data revision and frame build. */
  readonly identity: DatasetIdentity;
  /** Default: random ids (`randomIdSource`). */
  readonly ids?: IdSource | undefined;
  /** Default: the system clock. */
  readonly nowIso?: string | undefined;
}

/**
 * A new project holding the chosen guides, with the default character (as "New project" makes it)
 * on the loaded data. Its name is the guide's `#name`; for several guides, the file's name (else
 * the first guide's). Null when the input is refused or no guide is chosen.
 */
export function rxpImportProject(request: RxpImportRequest, choice: RxpImportChoice, ctx: RxpContext, opts: RxpNewProjectOptions): RxpNewProject | null {
  const ids = opts.ids ?? randomIdSource();
  const empty = createEmptyProject({
    ids,
    nowIso: opts.nowIso ?? systemClock.nowIso(),
    name: DEFAULT_GUIDE_NAME,
    dataRevision: opts.identity.dataRevision,
    gameBuild: opts.identity.frameBuild,
  });
  const applied = applyRxpImport(empty, request, choice, ctx, collisionFreeIds(ids, empty));
  if (applied === null) return null;
  const [first] = applied.guides;
  const name = (applied.guides.length > 1 ? guideNameFromFileName(request.fileName) : null) ?? first?.import.name ?? DEFAULT_GUIDE_NAME;
  const project: ProjectV1 = { ...applied.project, route: { ...applied.project.route, name } };
  return { project, name, applied: { ...applied, project } };
}

// Context ---------------------------------------------------------------------------------------

export interface RxpContextSources {
  /** The open project's view (dataset, custom quests, overrides, character overlays). */
  readonly dataset: DatasetView;
  /** The loaded dataset, for a new project's view; null: the open project's view stands in. */
  readonly data: DatasetSource | null;
  readonly geometry: MapGeometry | null;
}

/**
 * The lookups for an import into `target`. Appending checks quests against the open project (its
 * custom quests count as known). A new project has no custom quests, so its quests are checked
 * against the dataset alone, through `data`. Without `data` the open project's view stands in: a
 * quest known there only as one of its custom quests then counts as known, so no placeholder is
 * made for it (never one that could replace a dataset quest), and the validator reports it later.
 */
export function rxpImportContext(target: RxpImportTarget, sources: RxpContextSources): RxpContext {
  const view = target === 'new-project' && sources.data !== null ? sources.data.view(newProjectViewInput()) : sources.dataset;
  return createRxpContext(view, sources.geometry);
}
