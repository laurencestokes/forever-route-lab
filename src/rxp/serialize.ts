import type { FilterAst, StatePredicate, VariantTag } from '../domain/conditions';
import { type QuestId, type StepId, sequentialIdSource } from '../domain/ids';
import type { RxpImport } from '../domain/project';
import type { Location } from '../domain/points';
import type { GrindTarget, ObjectiveTarget, Route, RouteGroup, RouteStep, RxpCommandNode, RxpGroupData, Waypoint } from '../domain/route';
import type { MapGeometry } from '../geo/types';
import {
  BODY_INDENT,
  RxpUnrepresentable,
  buildCommandLine,
  buildNoteLine,
  buildStepLine,
  buildTagLine,
  canonicalCstLine,
  checkText,
  pointArguments,
  trailingComment,
} from './canonical';
import { commandSpec } from './commands';
import { type RxpCst, type RxpCstLine, guideHeader, parseRxpCst } from './cst';
import { type RxpCode, type RxpDiagnostic, rxpCodeSpec } from './diagnostics';
import { canonicalJson, groupContent, groupContentJson, stepRxpContent } from './fingerprint';
import { type LineRole, type LoweredGroup, type RxpQuestFacts, lowerRxpCst } from './lower';
import { parseLuaNumber } from './numbers';
import type { ZoneKeyLookup } from './points';
import { sha256Hex } from './sha256';
import { formatNumber, trimBlank } from './text';
import { longBracketLevelFor, luaQuoted } from './unwrap';

/**
 * Layer 2 serializer: route → guide text, with the export guarantee (docs/RXP.md §13,
 * ARCHITECTURE §10 step 5).
 *
 * 1. An unedited import exports as `imports[i].text`, byte for byte.
 * 2. Otherwise the output is the header, then the groups in route order: an unedited group run
 *    is copied from its original lines (endings included), every other group is written in
 *    canonical form from the model, reusing its template lines where the model did not change
 *    them. A group whose steps are no longer contiguous, or no longer share one location, is
 *    split into several RXP steps (`RXP040`). App-created steps follow §13.6.
 */

export interface RxpExportContext {
  /** The same zone-key table the import used, so template groups lower again identically. */
  readonly zoneKey: ZoneKeyLookup;
  /** Committed (or merged) geometry, for points created in the app (§13.4 rule 8). */
  readonly geometry: MapGeometry | null;
  /**
   * Dataset or custom quest facts, so a `complete` target meaning all objectives can be written as
   * one `.complete` per objective (§13.6). Omitted, or null for a quest: such a step is an `RXP042` note.
   */
  readonly quest?: ((id: QuestId) => RxpQuestFacts | null) | undefined;
}

export interface RxpExportOptions {
  /** `lua`: wrap the text in `RXPGuides.RegisterGuide(...)` (§13.4 rule 14). Default `none`. */
  readonly wrapper?: 'none' | 'lua';
}

export interface RxpExportError {
  readonly message: string;
  readonly stepId: StepId | null;
  readonly importId: string | null;
  /** Source line of the element, or 0. */
  readonly line: number;
}

export type RxpExportResult =
  | { readonly ok: true; readonly text: string; readonly unedited: boolean; readonly diagnostics: readonly RxpDiagnostic[] }
  | { readonly ok: false; readonly errors: readonly RxpExportError[]; readonly diagnostics: readonly RxpDiagnostic[] };

/** Radius written for an app-created travel destination without one (§13.6, our constant). */
export const DEFAULT_TRAVEL_RADIUS = 10;

const ALL_OBJECTIVES_UNKNOWN = 'a target means all objectives of a quest whose objective count is not known';

interface ImportTemplate {
  readonly imp: RxpImport;
  readonly cst: RxpCst;
  readonly groups: ReadonlyMap<number, LoweredGroup>;
  readonly headerEnd: number;
}

type Emitted = { readonly text: string; readonly role: 'goto' | 'location' | 'other' };

class Exporter {
  private readonly templates = new Map<string, ImportTemplate | null>();
  readonly diagnostics: RxpDiagnostic[] = [];
  readonly errors: RxpExportError[] = [];

  readonly geometry: MapGeometry | null;

  constructor(
    private readonly route: Route,
    private readonly imports: readonly RxpImport[],
    private readonly ctx: RxpExportContext,
  ) {
    this.geometry = ctx.geometry;
  }

  diag(code: RxpCode, importId: string, line: number, message: string): void {
    const spec = rxpCodeSpec(code);
    this.diagnostics.push({ code, severity: spec.severity, importId, line, column: line > 0 ? 1 : 0, rxpCompat: spec.rxpCompat, message });
  }

  fail(error: unknown, stepId: StepId | null, importId: string | null, line: number): void {
    if (!(error instanceof RxpUnrepresentable)) throw error;
    this.errors.push({ message: error.message, stepId, importId, line });
  }

  template(importId: string): ImportTemplate | null {
    const cached = this.templates.get(importId);
    if (cached !== undefined) return cached;
    const imp = this.imports.find((candidate) => candidate.id === importId) ?? null;
    let result: ImportTemplate | null = null;
    if (imp !== null) {
      const cst = parseRxpCst(imp.text);
      const lowered = lowerRxpCst(cst, imp.id, { changedZoneFrame: imp.options.changedZoneFrame, fingerprints: false }, sequentialIdSource(), { zoneKey: this.ctx.zoneKey });
      result = { imp, cst, groups: new Map(lowered.groups.map((group) => [group.stepIndex, group])), headerEnd: cst.stepLines[0] ?? cst.lines.length };
    }
    this.templates.set(importId, result);
    return result;
  }

  private readonly templateJson = new Map<string, string | null>();

  /**
   * §13.2: a run is unedited when its fingerprint equals the stored one. First, and much cheaper
   * than SHA-256 in pure TypeScript, its content is compared with its template group lowered
   * again: when they are equal, the original lines are exactly what the model says, so the run is
   * unedited whatever the stored fingerprint. Only a run whose content differs (edited, or
   * lowered differently since the import) is hashed.
   */
  runUnedited(rxp: RxpGroupData, steps: readonly RouteStep[]): boolean {
    const json = groupContentJson(groupContent(rxp), steps);
    const key = `${rxp.importId}\u0000${String(rxp.stepIndex)}`;
    let template = this.templateJson.get(key);
    if (template === undefined) {
      const lowered = this.template(rxp.importId)?.groups.get(rxp.stepIndex) ?? null;
      template = lowered?.group.rxp === null || lowered === null ? null : groupContentJson(groupContent(lowered.group.rxp), lowered.steps);
      this.templateJson.set(key, template);
    }
    return json === template || sha256Hex(json) === rxp.fingerprint;
  }

  groupOf(step: RouteStep): RouteGroup | null {
    if (step.groupId === null || !Object.hasOwn(this.route.groups, step.groupId)) return null;
    return this.route.groups[step.groupId] ?? null;
  }

  // -------------------------------------------------------------------------------------------

  /** §13.2: the route is exactly one import's groups, each unedited, in their original order. */
  uneditedImport(): RxpImport | null {
    const steps = this.route.steps;
    if (steps.length === 0) {
      const [only] = this.imports;
      return this.imports.length === 1 && only !== undefined && parseRxpCst(only.text).stepLines.length === 0 ? only : null;
    }
    const runs = this.runs();
    let importId: string | null = null;
    const seen = new Set<string>();
    for (const [index, run] of runs.entries()) {
      const rxp = run.group?.rxp ?? null;
      if (run.group === null || rxp === null) return null;
      if (importId !== null && rxp.importId !== importId) return null;
      importId = rxp.importId;
      if (seen.has(run.group.id) || rxp.stepIndex !== index) return null;
      seen.add(run.group.id);
      if (!this.runUnedited(rxp, run.steps)) return null;
    }
    if (importId === null) return null;
    const imp = this.imports.find((candidate) => candidate.id === importId);
    if (imp === undefined || (this.template(imp.id)?.cst.stepLines.length ?? -1) !== runs.length) return null;
    return imp;
  }

  /** Maximal runs of consecutive steps with the same group id (null ids form their own runs). */
  runs(): { readonly group: RouteGroup | null; readonly groupId: string | null; readonly steps: RouteStep[] }[] {
    const out: { group: RouteGroup | null; groupId: string | null; steps: RouteStep[] }[] = [];
    for (const step of this.route.steps) {
      const last = out[out.length - 1];
      if (last !== undefined && last.groupId === step.groupId && step.groupId !== null) last.steps.push(step);
      else if (last !== undefined && last.groupId === null && step.groupId === null) last.steps.push(step);
      else out.push({ group: this.groupOf(step), groupId: step.groupId, steps: [step] });
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------

  export(): string {
    const runs = this.runs();
    const chunks: string[] = [this.header(runs)];
    const plans = new Map<string, GroupPlan>();
    // Each group's runs, in route order (one pass instead of a filter per group).
    const runsOfGroup = new Map<string, RouteStep[][]>();
    for (const run of runs) {
      if (run.groupId === null) continue;
      const list = runsOfGroup.get(run.groupId) ?? [];
      list.push(run.steps);
      runsOfGroup.set(run.groupId, list);
    }
    for (const run of runs) {
      const rxp = run.group?.rxp ?? null;
      if (run.group === null || rxp === null) {
        chunks.push(this.ungrouped(run.steps));
        continue;
      }
      let plan = plans.get(run.group.id);
      if (plan === undefined) {
        plan = new GroupPlan(this, rxp, this.template(rxp.importId), runsOfGroup.get(run.group.id) ?? [run.steps]);
        plans.set(run.group.id, plan);
      }
      chunks.push(plan.emitRun(run.steps));
    }
    let out = '';
    for (const chunk of chunks) {
      if (chunk === '') continue;
      if (out !== '' && !/[\r\n]$/.test(out)) out += '\n';
      out += chunk;
    }
    return out;
  }

  header(runs: readonly { readonly group: RouteGroup | null }[]): string {
    const importIds = [...new Set(runs.map((run) => run.group?.rxp?.importId ?? null).filter((id) => id !== null))];
    const firstImport = importIds.map((id) => this.template(id)).find((tpl) => tpl !== null) ?? null;
    if (firstImport !== null) {
      if (importIds.length > 1) {
        this.diag('RXP043-header', '', 0, `The header of the first import is used; the headers of ${String(importIds.length - 1)} other import${importIds.length === 2 ? '' : 's'} are dropped.`);
      }
      return firstImport.cst.lines
        .slice(0, firstImport.headerEnd)
        .map((line) => line.raw + line.eol)
        .join('');
    }
    const name = trimBlank(this.route.name);
    try {
      if (name === '') throw new RxpUnrepresentable('the route has no name, so no "#name" header line can be written');
      checkText(name, 'the route name');
    } catch (error) {
      this.fail(error, null, null, 0);
      return '';
    }
    this.diag('RXP043-header', '', 0, 'No imported header: a header was generated from the route name.');
    return `#forever\n#name ${name}\n#version 1\n#group ${name}\n\n`;
  }

  // -------------------------------------------------------------------------------------------
  // §13.6: steps without a group sidecar

  ungrouped(steps: readonly RouteStep[]): string {
    const out: string[] = [];
    let index = 0;
    while (index < steps.length) {
      const first = steps[index];
      if (first === undefined) break;
      const run: RouteStep[] = [first];
      while (index + run.length < steps.length && sameLocation(steps[index + run.length]?.location ?? null, first.location)) {
        const next = steps[index + run.length];
        if (next === undefined) break;
        run.push(next);
      }
      index += run.length;
      out.push(...this.appStep(run));
    }
    return out.length === 0 ? '' : `${out.join('\n')}\n`;
  }

  appStep(run: readonly RouteStep[]): string[] {
    const lines = ['step'];
    const [first] = run;
    if (run.some((step) => step.kind === 'complete' && step.progress === 'partial')) lines.push(`${BODY_INDENT}#completewith next`);
    const location = first?.location ?? null;
    if (location !== null) {
      const hasTravel = run.some((step) => step.kind === 'travel');
      lines.push(BODY_INDENT + this.newLocationLine(location, hasTravel));
    }
    for (const step of run) for (const line of this.stepLines(step)) lines.push(BODY_INDENT + line);
    return lines;
  }

  /**
   * A `.goto` for a model location with no template line (§13.4 rule 8). A world point without a
   * UiMap that no committed frame contains has no RXP form: an `RXP042` note takes the line's place.
   */
  newLocationLine(location: Location, travel: boolean, importId = ''): string {
    try {
      const args: string[] = [...pointArguments(location.source, this.ctx.geometry)];
      const radius = location.radius ?? (travel ? DEFAULT_TRAVEL_RADIUS : null);
      if (radius !== null) args.push(number(radius));
      // Without a travel step the radius must not make the line an arrival objective (§13.6, §10.1).
      if (radius !== null && radius > 0 && !travel) args.push('0');
      return buildCommandLine({ command: 'goto', args, separator: 'comma', text: null, filter: null });
    } catch (error) {
      if (!(error instanceof RxpUnrepresentable)) throw error;
      return this.unrepresentable('location', error.message, importId);
    }
  }

  unrepresentable(kind: string, detail: string, importId: string, line = 0): string {
    this.diag('RXP042-unrepresentable-step', importId, line, `A ${kind} step has no RXP form (${detail}); it is exported as a note.`);
    const safe = detail.replace(/-{2,}/g, '-').replace(/<</g, '<').replace(/[\r\n\t]/g, ' ');
    return `>> (not representable in RXP) ${kind}: ${safe}`;
  }

  /** §13.6 table: the line(s) of one step without a template line. */
  stepLines(step: RouteStep, importId = ''): string[] {
    const text = step.rxp?.text ?? null;
    const filter = step.condition?.filter ?? null;
    const command = (name: string, args: readonly string[], lineText: string | null = text): string => {
      const spec = commandSpec(name);
      return buildCommandLine({ command: name, args, separator: spec?.separator ?? 'comma', text: lineText, filter });
    };
    try {
      switch (step.kind) {
        case 'accept':
          return [step.anyOf === null ? command('accept', [String(step.questId)]) : command('acceptmultiple', step.anyOf.map(String))];
        case 'complete': {
          const targets = this.objectiveTargets(step.targets);
          if (targets === null) return [this.unrepresentable('complete', ALL_OBJECTIVES_UNKNOWN, importId)];
          return targets.map((target, index) => command('complete', [String(target.questId), String(target.objective + 1)], index === 0 ? text : null));
        }
        case 'turnin':
          if (step.anyOf !== null) return [command('turninmultiple', step.anyOf.map(String))];
          return [command('turnin', [`${step.skipIfMissing ? '-' : ''}${String(step.questId)}`, ...(step.rewardIndex === null ? [] : [String(step.rewardIndex)])])];
        case 'abandon':
          return [command('abandon', [String(step.questId)])];
        case 'travel':
          return step.location === null ? [this.unrepresentable('travel', 'no destination', importId)] : [];
        case 'grind':
          if (step.until.kind === 'duration') return [this.unrepresentable('grind', `${number(step.until.seconds)} seconds`, importId)];
          return [command('xp', [xpExpression(step.until.level, step.until.offset)])];
        case 'hearth':
          return step.mode === 'use' ? [command('hs', [], text ?? 'Use the Hearthstone')] : [command('home', [])];
        case 'flight':
          if (step.nodeQuery === null) return [this.unrepresentable('flight', 'no flight-node name', importId)];
          return [command(step.mode === 'discover' ? 'fp' : 'fly', [step.nodeQuery])];
        case 'train':
          return [step.spellId === null ? command('trainer', []) : command('train', [String(step.spellId)])];
        case 'vendor':
          return [command('vendor', [], text ?? step.what)];
        case 'note':
          if (step.preserved !== null) return step.preserved.lines.map((line) => trimBlank(line)).filter((line) => line !== '');
          if (this.emptyNote(step)) return [];
          return [buildNoteLine('>>', step.text, filter)];
      }
    } catch (error) {
      this.fail(error, step.id, importId === '' ? null : importId, step.rxp?.line?.firstLine ?? 0);
      return [];
    }
  }

  /**
   * The targets of a `complete` step with every "all objectives" target (`objective: null`) written
   * as one target per objective, when the context knows the quest's objective count (§13.6).
   * Null when a count is not known. An expanded target that is already listed is not repeated.
   */
  objectiveTargets(targets: readonly ObjectiveTarget[]): { readonly questId: QuestId; readonly objective: number }[] | null {
    const out: { questId: QuestId; objective: number }[] = [];
    const listed = new Set(targets.filter((target) => target.objective !== null).map((target) => `${String(target.questId)}:${String(target.objective)}`));
    let expanded = false;
    for (const target of targets) {
      if (target.objective !== null) {
        out.push({ questId: target.questId, objective: target.objective });
        continue;
      }
      const count = this.ctx.quest?.(target.questId)?.objectiveCount ?? 0;
      if (!(count > 0)) return null;
      expanded = true;
      for (let objective = 0; objective < count; objective += 1) {
        const key = `${String(target.questId)}:${String(objective)}`;
        if (listed.has(key)) continue;
        listed.add(key);
        out.push({ questId: target.questId, objective });
      }
    }
    if (expanded) this.countExtra('"all objectives" target written as one .complete per objective');
    return out;
  }

  /** A note RXP would drop (no text): written as nothing, and counted (§13.6). */
  emptyNote(step: Extract<RouteStep, { kind: 'note' }>): boolean {
    if (step.preserved !== null || trimBlank(step.text) !== '') return false;
    this.countExtra('note without text');
    return true;
  }

  // -------------------------------------------------------------------------------------------

  /** One RXP041 per export: fields with no RXP form, with their counts (§13.6). */
  fieldsNotExported(): void {
    const counts = new Map<string, number>();
    const add = (what: string): void => {
      counts.set(what, (counts.get(what) ?? 0) + 1);
    };
    for (const step of this.route.steps) {
      if (step.note !== null) add('step note');
      if (step.locked) add('lock');
      if (step.durationOverride !== null) add('duration override');
      if (step.ext !== null) add('extension data');
      if (step.location?.label !== null && step.location?.label !== undefined) add('location label');
      if (step.condition !== null && (step.condition.variant !== null || step.condition.skipIf.length > 0)) add('line-level variant or skip condition');
      if (step.kind === 'travel') {
        if (step.mode !== 'auto') add('travel mode');
        if (step.transport !== null) add('travel transport');
      } else if (step.kind === 'train') {
        if (step.skill !== null) add('train skill');
        if (step.skillId !== null) add('train skill id');
        if (step.rank !== null) add('train rank');
        if (step.what !== null) add('train description');
        if (step.cost !== null) add('train cost');
      } else if (step.kind === 'grind') {
        if (step.mobLevel !== null) add('grind mob level');
        if (step.xpPerHour !== null) add('grind XP per hour');
      } else if (step.kind === 'turnin' && step.anyOf !== null) {
        if (step.rewardIndex !== null) add('reward choice of an any-of turn-in');
        if (step.skipIfMissing) add('skip-if-missing of an any-of turn-in');
      }
    }
    for (const [what, count] of this.extraCounts) counts.set(what, (counts.get(what) ?? 0) + count);
    if (counts.size === 0) return;
    const list = [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([what, count]) => `${what} × ${String(count)}`);
    this.diag('RXP041-app-fields-not-exported', '', 0, `Not exported (no RXP form): ${list.join(', ')}.`);
  }

  readonly extraCounts = new Map<string, number>();

  countExtra(what: string): void {
    this.extraCounts.set(what, (this.extraCounts.get(what) ?? 0) + 1);
  }
}

// ---------------------------------------------------------------------------------------------

const number = (value: number): string => {
  const text = formatNumber(value);
  if (text === null) throw new RxpUnrepresentable('a number is not finite');
  return text;
};

type LevelOffset = Extract<GrindTarget, { kind: 'level' }>['offset'];

function xpExpression(level: number, offset: LevelOffset): string {
  const base = number(level);
  if (offset === null) return base;
  if (offset.kind === 'xpInto') return `${base}+${number(offset.xp)}`;
  if (offset.kind === 'xpShort') return `${base}-${number(offset.xp)}`;
  const fraction = number(offset.fraction);
  if (!/^0\.\d+$/.test(fraction) && fraction !== '0') throw new RxpUnrepresentable(`the grind fraction ${fraction} is not between 0 and 1`);
  return `${base}.${fraction === '0' ? '0' : fraction.slice(2)}`;
}

const isOddNumber = (value: number): boolean => Math.abs(value) % 2 === 1;

/** A `.complete` (odd flags) or `.collect` (positive odd flags) line that is text-only in RXP (§12.3). */
function isTextOnlyLine(line: RxpCstLine): boolean {
  const args = line.command?.args ?? [];
  if (line.command?.name === 'complete') {
    const flags = args[3] === undefined ? null : parseLuaNumber(args[3]);
    return flags !== null && isOddNumber(flags);
  }
  if (line.command?.name === 'collect') {
    const flags = args[4] === undefined ? null : parseLuaNumber(args[4]);
    return flags !== null && flags > 0 && isOddNumber(flags);
  }
  return false;
}

const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

function sameLocation(a: Location | null, b: Location | null): boolean {
  if (a === null || b === null) return a === b;
  return sameJson(a.source, b.source) && a.radius === b.radius;
}

/** Everything the fingerprint covers except the location (handled per run). */
function stepCore(step: RouteStep): string {
  const content = stepRxpContent(step);
  delete content['location'];
  return canonicalJson(content);
}

/** Travel steps without a location (`.zone`, `.subzone`, `.explore`) do not pin a run's location. */
const locationNeutral = (step: RouteStep): boolean => step.kind === 'travel' && step.location === null;

function splitByLocation(steps: readonly RouteStep[]): RouteStep[][] {
  const out: RouteStep[][] = [];
  let current: RouteStep[] = [];
  let location: Location | null | undefined;
  for (const step of steps) {
    if (!locationNeutral(step)) {
      if (location !== undefined && !sameLocation(location, step.location)) {
        out.push(current);
        current = [];
      }
      location = step.location;
    }
    current.push(step);
  }
  if (current.length > 0) out.push(current);
  return out;
}

const runLocation = (steps: readonly RouteStep[]): Location | null => steps.find((step) => !locationNeutral(step))?.location ?? null;

type Anchor = number | 'start';

/** Per-group state for emitting edited, split or template-less groups (§13.5, §13.6). */
class GroupPlan {
  private readonly subRuns: RouteStep[][];
  private readonly claims = new Map<StepId, number>();
  private readonly claimedBy = new Map<number, RouteStep>();
  private readonly subRunOf = new Map<StepId, number>();
  private emittedSubRuns = 0;
  private readonly split: boolean;
  private readonly lineAnchor = new Map<number, Anchor>();
  private readonly commentOwner = new Map<number, number | 'end'>();
  private readonly droppedComments = new Set<number>();
  private readonly droppedTrailing = new Set<number>();
  private readonly variantsEqual: boolean;
  private readonly predicatesEqual: boolean;
  private readonly emittedMultiLines = new Set<number>();

  constructor(
    private readonly out: Exporter,
    private readonly rxp: RxpGroupData,
    private readonly tpl: ImportTemplate | null,
    runs: readonly (readonly RouteStep[])[],
  ) {
    this.subRuns = runs.flatMap((run) => splitByLocation(run));
    this.subRuns.forEach((subRun, index) => {
      for (const step of subRun) this.subRunOf.set(step.id, index);
    });
    const tg = this.lowered();
    this.split = this.subRuns.length > 1;
    if (this.split) {
      this.out.diag(
        'RXP040-group-split',
        rxp.importId,
        this.lineNumber(tg?.startLine ?? null),
        `RXP step ${String(rxp.stepIndex + 1)} of the import is exported as ${String(this.subRuns.length)} RXP steps, because its steps are no longer contiguous or no longer share one location.`,
      );
    }
    this.variantsEqual = tg === null || sameJson(tg.group.rxp?.condition?.variant ?? null, rxp.condition?.variant ?? null);
    this.predicatesEqual = tg === null || sameJson(tg.group.rxp?.condition?.skipIf ?? [], rxp.condition?.skipIf ?? []);
    if (tg !== null) this.prepare(tg, runs.flat());
  }

  private lowered(): LoweredGroup | null {
    return this.tpl?.groups.get(this.rxp.stepIndex) ?? null;
  }

  private line(index: number): RxpCstLine | null {
    return this.tpl?.cst.lines[index] ?? null;
  }

  private lineNumber(index: number | null): number {
    return index === null ? 0 : (this.line(index)?.line ?? 0);
  }

  private role(index: number): LineRole | null {
    const tg = this.lowered();
    return tg === null ? null : (tg.roles[index - tg.startLine] ?? null);
  }

  /** Template steps of a line (a step line, or the location line of a travel objective). */
  private stepsOfLine(index: number): readonly number[] {
    const role = this.role(index);
    if (role?.kind === 'steps') return role.steps;
    if (role?.kind === 'location' && role.travelStep !== null) return [role.travelStep];
    return [];
  }

  private prepare(tg: LoweredGroup, steps: readonly RouteStep[]): void {
    // Claims: model steps take template steps by source line (§13.5 rule 1).
    for (const step of steps) {
      const line = step.rxp?.line ?? null;
      if (line === null || line.importId !== this.rxp.importId) continue;
      const match = tg.steps.findIndex((candidate, index) => !this.claimedBy.has(index) && candidate.kind === step.kind && candidate.rxp?.line?.firstLine === line.firstLine);
      if (match >= 0) {
        this.claims.set(step.id, match);
        this.claimedBy.set(match, step);
      }
    }
    // Anchors: every line anchors to the nearest preceding step line, re-anchored past deleted steps.
    let lastStep: number | null = null;
    for (let index = tg.startLine + 1; index < tg.endLine; index += 1) {
      const own = this.stepsOfLine(index);
      this.lineAnchor.set(index, this.reanchor(lastStep));
      if (own.length > 0) lastStep = own[own.length - 1] ?? lastStep;
    }
    // Comments travel with the next non-comment line (§13.5 rule 1), or the end of the group.
    for (let index = tg.startLine + 1; index < tg.endLine; index += 1) {
      if (this.role(index)?.kind !== 'comment') continue;
      let owner: number | 'end' = 'end';
      for (let next = index + 1; next < tg.endLine; next += 1) {
        const kind = this.role(next)?.kind;
        if (kind !== 'comment' && kind !== 'blank') {
          owner = next;
          break;
        }
      }
      this.commentOwner.set(index, owner);
      // A comment on a deleted step line goes with it (§13.5 rule 2).
      const ownSteps = owner === 'end' ? [] : this.stepsOfLine(owner);
      if (owner !== 'end' && owner !== tg.locationLine && ownSteps.length > 0 && ownSteps.every((step) => !this.claimedBy.has(step))) {
        this.out.diag('RXP045-comment-dropped', this.rxp.importId, this.lineNumber(index), 'A comment attached to a deleted line is dropped.');
      }
    }
    // A trailing comment goes with its deleted line too.
    for (let index = tg.startLine + 1; index < tg.endLine; index += 1) {
      const own = this.stepsOfLine(index);
      if (index === tg.locationLine || own.length === 0 || own.some((step) => this.claimedBy.has(step)) || (this.line(index)?.comment ?? null) === null) continue;
      this.out.diag('RXP045-comment-dropped', this.rxp.importId, this.lineNumber(index), 'The trailing comment of a deleted line is dropped.');
    }
  }

  private reanchor(step: number | null): Anchor {
    for (let candidate = step; candidate !== null && candidate >= 0; candidate -= 1) if (this.claimedBy.has(candidate)) return candidate;
    return 'start';
  }

  /** The sub-run (index) in which a template line appears naturally. */
  private naturalSubRun(index: number): number | null {
    const anchor = this.lineAnchor.get(index) ?? 'start';
    if (anchor === 'start') return 0;
    const step = this.claimedBy.get(anchor);
    return step === undefined ? null : (this.subRunOf.get(step.id) ?? null);
  }

  emitRun(steps: readonly RouteStep[]): string {
    const tg = this.lowered();
    const fingerprintOk = this.out.runUnedited(this.rxp, steps);
    const allSteps = this.subRuns.flat();
    if (tg !== null && this.tpl !== null && fingerprintOk && allSteps.length === steps.length) {
      // Unedited group run: its original physical lines, byte for byte (§13.3 rule 2).
      return this.tpl.cst.lines
        .slice(tg.startLine, tg.endLine)
        .map((line) => line.raw + line.eol)
        .join('');
    }
    const parts: string[] = [];
    for (const subRun of splitByLocation(steps)) {
      const index = this.emittedSubRuns;
      this.emittedSubRuns += 1;
      parts.push(tg === null ? this.emitWithoutTemplate(subRun, index) : this.emitSubRun(tg, subRun, index));
    }
    return parts.join('');
  }

  // -------------------------------------------------------------------------------------------

  private emitSubRun(tg: LoweredGroup, subRun: readonly RouteStep[], runIndex: number): string {
    const first = runIndex === 0;
    const items: Emitted[] = [];
    const location = runLocation(subRun);
    const locationIndex = tg.locationLine;
    const travelTemplate = locationIndex === null ? null : this.travelStepOf(locationIndex);
    const travelModel = travelTemplate === null ? undefined : this.claimedBy.get(travelTemplate);
    const travelHere = travelModel !== undefined && subRun.includes(travelModel);
    const appTravel = subRun.some((step) => step.kind === 'travel' && step.location !== null && !this.claims.has(step.id));
    const locationNatural = locationIndex !== null && (travelHere || this.naturalSubRun(locationIndex) === runIndex);
    let locationDone = false;

    const push = (text: string | null, role: Emitted['role'] = 'other'): void => {
      if (text !== null) items.push({ text: BODY_INDENT + text, role });
    };
    const pushComments = (owner: number | 'end'): void => {
      for (const [comment, target] of this.commentOwner) {
        if (target !== owner) continue;
        const line = this.line(comment);
        if (line !== null) push(this.safe(() => canonicalCstLine(line)?.slice(BODY_INDENT.length) ?? null, comment));
      }
    };
    const emitLocation = (): void => {
      if (locationDone) return;
      locationDone = true;
      const text = this.locationLine(location, travelHere || appTravel, tg);
      if (text === null) {
        if (locationIndex !== null && locationNatural) this.dropComments(locationIndex);
        return;
      }
      // Comments stay with the natural occurrence; a repeated location line has none.
      if (locationIndex !== null && locationNatural) pushComments(locationIndex);
      push(text, 'location');
    };

    // The step line, with the model's group filter (§13.5 rule 4).
    const stepLine = this.line(tg.startLine);
    const modelFilter = this.rxp.condition?.filter ?? null;
    const header =
      stepLine !== null && sameJson(tg.group.rxp?.condition?.filter ?? null, modelFilter)
        ? this.safe(() => canonicalCstLine(stepLine), tg.startLine)
        : this.safe(() => buildStepLine(modelFilter), tg.startLine);
    const lines: string[] = [header ?? 'step'];

    // Tags (#label only in the first run), variant and predicate lines repeat in every run of a
    // split group (§13.6); where their anchor is in another run they come right after `step`.
    const repeated = (index: number): boolean => {
      const role = this.role(index);
      if (role?.kind === 'tag') return !this.tagIsLabel(role.entry) || first;
      return role?.kind === 'variant' || role?.kind === 'predicate';
    };
    for (let index = tg.startLine + 1; index < tg.endLine; index += 1) {
      if (repeated(index) && this.naturalSubRun(index) !== runIndex) push(this.groupLevelLine(index));
    }
    if (location !== null && !locationNatural) emitLocation();
    for (const text of this.modelOnlyLines(tg, !first)) push(text, text.startsWith('.goto') ? 'goto' : 'other');

    const emitAnchored = (anchor: Anchor): void => {
      for (let index = tg.startLine + 1; index < tg.endLine; index += 1) {
        if ((this.lineAnchor.get(index) ?? 'start') !== anchor) continue;
        if (index === locationIndex) {
          if (!travelHere && locationNatural) emitLocation();
          continue;
        }
        const role = this.role(index);
        if (role === null || role.kind === 'comment' || role.kind === 'blank' || role.kind === 'stepLine' || this.stepsOfLine(index).length > 0) continue;
        if (role.kind === 'tag' && this.tagIsLabel(role.entry) && !first) continue;
        const text = this.groupLevelLine(index);
        if (text === null) {
          this.dropComments(index);
          continue;
        }
        pushComments(index);
        push(text, this.isUnfilteredGoto(index) ? 'goto' : 'other');
      }
    };

    if (first) emitAnchored('start');
    for (const step of subRun) {
      const j = this.claims.get(step.id);
      if (j === undefined) {
        for (const text of this.out.stepLines(step, this.rxp.importId)) push(text);
        continue;
      }
      if (j === travelTemplate) emitLocation();
      else for (const part of this.stepText(step, j)) {
        if (part.commentsOf !== null) pushComments(part.commentsOf);
        push(part.text);
      }
      emitAnchored(j);
    }
    if (runIndex === this.subRuns.length - 1) pushComments('end');

    // Fix-up: the location line stays after every unfiltered point-yielding `.goto` (§12.4 rule 1).
    const locationAt = items.findIndex((item) => item.role === 'location');
    const lastGoto = items.map((item) => item.role).lastIndexOf('goto');
    if (locationAt >= 0 && lastGoto > locationAt) {
      const [moved] = items.splice(locationAt, 1);
      if (moved !== undefined) items.splice(lastGoto, 0, moved);
    }
    for (const item of items) lines.push(item.text);
    return `${lines.join('\n')}\n`;
  }

  private safe(build: () => string | null, index: number | null): string | null {
    try {
      return build();
    } catch (error) {
      this.out.fail(error, null, this.rxp.importId, this.lineNumber(index));
      return null;
    }
  }

  private travelStepOf(index: number): number | null {
    const role = this.role(index);
    return role?.kind === 'location' ? role.travelStep : null;
  }

  private tagIsLabel(entry: number): boolean {
    return this.lowered()?.group.rxp?.tags[entry]?.name === 'label';
  }

  private isUnfilteredGoto(index: number): boolean {
    const line = this.line(index);
    return line?.command?.name === 'goto' && line.filter === null && this.role(index)?.kind === 'waypoint';
  }

  /** A template line is not written: its comments, full-line and trailing, are dropped (`RXP045`). */
  private dropComments(index: number): void {
    for (const [comment, owner] of this.commentOwner) {
      if (owner !== index || this.droppedComments.has(comment)) continue;
      this.droppedComments.add(comment);
      this.out.diag('RXP045-comment-dropped', this.rxp.importId, this.lineNumber(comment), 'A comment attached to a deleted line is dropped.');
    }
    const line = this.line(index);
    if (line !== null) this.dropTrailing(line);
  }

  /** Line indices of template step `j` (its step lines, with the comments between merged lines). */
  private templateLinesOf(j: number): number[] {
    const tg = this.lowered();
    if (tg === null) return [];
    const out: number[] = [];
    for (let index = tg.startLine + 1; index < tg.endLine; index += 1) if (this.stepsOfLine(index).includes(j)) out.push(index);
    return out;
  }

  /** A group-level template line (tag, variant, predicate, waypoint, annotation, nothing), or null when deleted. */
  private groupLevelLine(index: number): string | null {
    const line = this.line(index);
    const role = this.role(index);
    const tg = this.lowered();
    if (line === null || role === null || tg?.group.rxp === null || tg === null) return null;
    const tplRxp = tg.group.rxp;
    if (tplRxp === null) return null;
    const canonical = (): string | null => this.safe(() => canonicalCstLine(line)?.slice(BODY_INDENT.length) ?? null, index);
    switch (role.kind) {
      case 'nothing':
        return canonical();
      case 'variant':
        return this.variantsEqual ? canonical() : null;
      case 'predicate':
        return this.predicatesEqual ? canonical() : null;
      case 'tag': {
        const tpl = tplRxp.tags[role.entry];
        const model = this.rxp.tags.find((tag) => tag.line?.firstLine === line.line && tag.line.importId === this.rxp.importId);
        if (tpl === undefined || model === undefined) return null;
        if (sameJson(tpl, model)) return canonical();
        return this.safe(() => buildTagLine(model.name, model.value, model.assignment, line.filter?.parsed.ast ?? null) + trailingComment(line), index);
      }
      case 'waypoint': {
        const tpl = tplRxp.waypoints[role.entry];
        const model = this.rxp.waypoints.find((waypoint) => waypoint.line?.firstLine === line.line && waypoint.line.importId === this.rxp.importId);
        if (tpl === undefined || model === undefined) return null;
        if (sameJson(tpl, model)) return canonical();
        return this.safe(() => this.waypointLine(model, line) + trailingComment(line), index);
      }
      case 'annotation': {
        const tpl = tplRxp.annotations[role.entry];
        const model = this.rxp.annotations.find((note) => note.line?.firstLine === line.line && note.line.importId === this.rxp.importId);
        if (tpl === undefined || model === undefined) return null;
        if (sameJson(tpl, model)) return canonical();
        return this.safe(() => annotationLine(model) + trailingComment(line), index);
      }
      case 'location':
      case 'steps':
      case 'stepLine':
      case 'blank':
      case 'comment':
        return canonical();
    }
  }

  /** Sidecar entries the template does not have, and rebuilt variant/predicate lists (§13.5). */
  private modelOnlyLines(tg: LoweredGroup, repeatOnly = false): string[] {
    const out: string[] = [];
    const inTemplate = (line: { readonly firstLine: number; readonly importId: string } | null): boolean =>
      line !== null && line.importId === this.rxp.importId && line.firstLine >= this.lineNumber(tg.startLine) && line.firstLine < this.lineNumber(tg.endLine - 1) + 1;
    for (const tag of this.rxp.tags) {
      if (inTemplate(tag.line)) continue;
      if (repeatOnly && tag.name === 'label') continue;
      const text = this.safe(() => buildTagLine(tag.name, tag.value, tag.assignment, null), null);
      if (text !== null) out.push(text);
    }
    if (!this.variantsEqual) for (const entry of this.rxp.condition?.variant ?? []) pushSafe(out, this, () => variantLine(entry));
    if (!this.predicatesEqual) for (const entry of this.rxp.condition?.skipIf ?? []) pushSafe(out, this, () => predicateLine(entry));
    if (!repeatOnly) {
      for (const waypoint of this.rxp.waypoints) if (!inTemplate(waypoint.line)) pushSafe(out, this, () => this.waypointLine(waypoint, null));
      for (const note of this.rxp.annotations) if (!inTemplate(note.line)) pushSafe(out, this, () => annotationLine(note));
    }
    return out;
  }

  failSafe(build: () => string): string | null {
    return this.safe(build, null);
  }

  private waypointLine(waypoint: Waypoint, template: RxpCstLine | null): string {
    const name = template?.command?.name ?? (waypoint.role === 'pin' ? 'goto' : 'goto');
    const args: string[] = [...pointArguments(waypoint.point, this.outGeometry())];
    const radius = waypoint.radius ?? (waypoint.role === 'pin' ? 0 : waypoint.role === 'closest' ? -1 : null);
    if (name !== 'pin' && radius !== null) args.push(number(radius));
    return buildCommandLine({ command: name, args, separator: 'comma', text: template?.text ?? null, filter: waypoint.filter });
  }

  private outGeometry(): MapGeometry | null {
    return this.out.geometry;
  }

  /** The location line of a (sub-)run (§13.5 rule 3). */
  private locationLine(location: Location | null, travel: boolean, tg: LoweredGroup): string | null {
    if (location === null) return null;
    const index = tg.locationLine;
    const line = index === null ? null : this.line(index);
    const tplLocation = tg.location;
    const travelStep = index === null ? null : this.travelStepOf(index);
    const travelModel = travelStep === null ? null : (this.claimedBy.get(travelStep) ?? null);
    const tplIsTravel = travelStep !== null;
    if (line === null || tplLocation === null) return this.out.newLocationLine(location, travel, this.rxp.importId);
    const args = line.command?.args ?? [];
    const same = sameLocation(location, tplLocation);
    const text = travel ? (travelModel?.rxp?.text ?? (tplIsTravel ? line.text : null)) : tplIsTravel ? null : line.text;
    if (same && tplIsTravel === travel && text === line.text) return this.safe(() => canonicalCstLine(line)?.slice(BODY_INDENT.length) ?? null, index);
    return this.safe(() => {
      const zoneToken = sameJson(location.source, tplLocation.source) ? (args[0] ?? null) : null;
      const out: string[] = [...pointArguments(location.source, this.outGeometry(), zoneToken)];
      const tplRadiusText = args[3];
      const tplRadius = tplRadiusText === undefined ? null : parseLuaNumber(tplRadiusText);
      let radius: string | null = null;
      if (location.radius !== null) radius = tplRadius === location.radius && tplRadiusText !== undefined ? tplRadiusText : number(location.radius);
      else if (tplRadius !== null && tplRadius <= 0 && tplRadiusText !== undefined) radius = tplRadiusText;
      if (travel && (radius === null || (parseLuaNumber(radius) ?? 0) <= 0)) radius = number(location.radius ?? DEFAULT_TRAVEL_RADIUS);
      if (radius !== null) {
        out.push(radius);
        const flag = args[4];
        if (flag !== undefined && !travel) out.push(flag);
        else if (!travel && (parseLuaNumber(radius) ?? 0) > 0) out.push('0');
      }
      return buildCommandLine({ command: 'goto', args: out, separator: 'comma', text, filter: null }) + trailingComment(line);
    }, index);
  }

  /**
   * The line(s) of a claimed template step (§13.5 rule 2): each template line in canonical form
   * when the step is unchanged, else rebuilt from the model. `commentsOf` names the template line
   * whose attached comments go right before the part.
   */
  private stepText(step: RouteStep, j: number): readonly { readonly text: string | null; readonly commentsOf: number | null }[] {
    const tg = this.lowered();
    const tplStep = tg?.steps[j];
    const lineIndices = this.templateLinesOf(j);
    const lines = lineIndices.map((index) => this.line(index)).filter((line): line is RxpCstLine => line !== null);
    const [firstLine] = lines;
    const fromModel = (): { text: string; commentsOf: null }[] => this.out.stepLines(step, this.rxp.importId).map((text) => ({ text, commentsOf: null }));
    if (tg === null || tplStep === undefined || firstLine === undefined) return fromModel();
    const canonical = (line: RxpCstLine): { text: string | null; commentsOf: number } => ({
      text: this.safe(() => canonicalCstLine(line)?.slice(BODY_INDENT.length) ?? null, line.index),
      commentsOf: line.index,
    });
    const shared = this.stepsOfLine(firstLine.index);
    if (shared.length > 1) {
      // One line, several steps (`.abandon a,b`): reuse it only when all of them are intact here.
      const intact = shared.every((k) => {
        const model = this.claimedBy.get(k);
        const tplShared = tg.steps[k];
        return model !== undefined && tplShared !== undefined && this.subRunOf.get(model.id) === this.subRunOf.get(step.id) && stepCore(model) === stepCore(tplShared);
      });
      if (!intact) return [{ text: null, commentsOf: firstLine.index }, ...fromModel()];
      if (this.emittedMultiLines.has(firstLine.index)) return [];
      this.emittedMultiLines.add(firstLine.index);
      return [canonical(firstLine)];
    }
    if (stepCore(step) === stepCore(tplStep)) return lines.map(canonical);
    const comments = lines.map((line) => ({ text: null, commentsOf: line.index }));
    try {
      const rebuilt = this.rebuild(step, tplStep, lines);
      if (rebuilt.length === 0) {
        // Written as nothing (an empty note): its comments go with it, as with a deleted line (§13.5 rule 2).
        for (const line of lines) this.dropComments(line.index);
        return [];
      }
      // A rebuilt line keeps the template line's trailing comment (§13.4 rule 11, §13.5 rule 2);
      // `.complete` lines place theirs per target, and preserved lines still hold their own.
      if (step.kind !== 'complete' && !(step.kind === 'note' && step.preserved !== null) && firstLine.comment !== null) {
        const [head = '', ...rest] = rebuilt;
        return [...comments, { text: head + trailingComment(firstLine), commentsOf: null }, ...rest.map((text) => ({ text, commentsOf: null }))];
      }
      return [...comments, ...rebuilt.map((text) => ({ text, commentsOf: null }))];
    } catch (error) {
      this.out.fail(error, step.id, this.rxp.importId, firstLine.line);
      return comments;
    }
  }

  /** `RXP045` for a trailing comment that cannot stay with a surviving line (§13.5 rule 2), once per line. */
  private dropTrailing(line: RxpCstLine): void {
    if (line.comment === null || this.droppedTrailing.has(line.index)) return;
    this.droppedTrailing.add(line.index);
    this.out.diag('RXP045-comment-dropped', this.rxp.importId, line.line, 'The trailing comment of a line that is no longer written is dropped.');
  }

  /** A changed element rebuilt from the model, keeping what only the template line holds (§13.5 rule 2). */
  private rebuild(step: RouteStep, tplStep: RouteStep, lines: readonly RxpCstLine[]): string[] {
    const [line] = lines;
    if (line === undefined) return this.out.stepLines(step, this.rxp.importId);
    const command = line.command;
    const tplArgs = command?.args ?? [];
    const text = step.rxp?.text ?? null;
    const filter = step.condition?.filter ?? null;
    const build = (name: string, args: readonly string[], lineText: string | null = text, lineFilter: FilterAst | null = filter): string =>
      buildCommandLine({ command: name, args, separator: commandSpec(name)?.separator ?? 'comma', text: lineText, filter: lineFilter });
    switch (step.kind) {
      case 'note': {
        if (step.preserved !== null) return step.preserved.lines.map((raw) => trimBlank(raw)).filter((raw) => raw !== '');
        if (this.out.emptyNote(step)) return [];
        if (line.kind === 'objective' || line.kind === 'star') {
          if (line.text !== null) return [`${checkText(line.lead ?? '', 'the label')} >> ${checkText(step.text, 'the note')}${filterText(filter)}`];
          return [buildNoteLine(line.kind === 'objective' ? '+' : '*', step.text, filter)];
        }
        return [buildNoteLine('>>', step.text, filter)];
      }
      case 'accept': {
        if (step.anyOf !== null) return [build(command?.name === 'daily' ? 'daily' : 'acceptmultiple', step.anyOf.map(String))];
        const extra = command?.name === 'accept' ? tplArgs.slice(1) : [];
        return [build('accept', [String(step.questId), ...extra])];
      }
      case 'turnin': {
        if (step.anyOf !== null) return [build(command?.name === 'dailyturnin' ? 'dailyturnin' : 'turninmultiple', step.anyOf.map(String))];
        const tplTurnin = tplStep.kind === 'turnin' ? tplStep : null;
        const flags = command?.name === 'turnin' ? tplArgs[2] : undefined;
        let reward: string | null = step.rewardIndex === null ? null : String(step.rewardIndex);
        if (reward === null && tplTurnin !== null && tplTurnin.rewardIndex === null && tplArgs[1] !== undefined && command?.name === 'turnin') reward = tplArgs[1];
        if (reward === null && flags !== undefined) reward = '0';
        const args = [`${step.skipIfMissing ? '-' : ''}${String(step.questId)}`, ...(reward === null ? [] : [reward]), ...(flags === undefined ? [] : [flags])];
        return [build('turnin', args)];
      }
      case 'complete':
        return this.rebuildComplete(step, tplStep, lines, build);
      case 'abandon':
        return [build('abandon', [String(step.questId)])];
      case 'travel':
        if (command !== null && command.name !== 'goto') return [build(command.name, tplArgs, text ?? line.text)];
        return [];
      case 'grind':
        if (step.until.kind === 'duration') return [this.out.unrepresentable('grind', `${number(step.until.seconds)} seconds`, this.rxp.importId, line.line)];
        return [build('xp', [xpExpression(step.until.level, step.until.offset)])];
      case 'hearth':
        if (step.mode === 'use') return [build('hs', [], text ?? line.text ?? 'Use the Hearthstone')];
        return [build('home', command?.name === 'home' ? tplArgs : [])];
      case 'flight': {
        if (step.nodeQuery === null) return [this.out.unrepresentable('flight', 'no flight-node name', this.rxp.importId, line.line)];
        const name = step.mode === 'discover' ? 'fp' : 'fly';
        const extra = command?.name === name ? tplArgs.slice(1) : [];
        return [build(name, [step.nodeQuery, ...extra])];
      }
      case 'train':
        if (step.spellId === null) return [build('trainer', command?.name === 'trainer' ? tplArgs : [])];
        return [build('train', [String(step.spellId)])];
      case 'vendor':
        return [build('vendor', command?.name === 'vendor' ? tplArgs : [], text ?? step.what)];
    }
  }

  private rebuildComplete(
    step: Extract<RouteStep, { kind: 'complete' }>,
    tplStep: RouteStep,
    lines: readonly RxpCstLine[],
    build: (name: string, args: readonly string[], text?: string | null, filter?: FilterAst | null) => string,
  ): string[] {
    const commandLines = lines.filter((line) => line.kind === 'command');
    const [first] = commandLines;
    const text = step.rxp?.text ?? null;
    const sticky = (this.rxp.tags ?? []).some((tag) => tag.name === 'sticky' || tag.name === 'completewith');
    // The text-only flag follows the model's progress (§13.5 rule 2), unless the template step was
    // partial only because a `.disablecheckbox` follows it: that annotation still makes it partial.
    const byDisable = tplStep.kind === 'complete' && tplStep.progress === 'partial' && !sticky && !(first !== undefined && isTextOnlyLine(first));
    let flagMode: 'set' | 'clear' | 'keep' = 'keep';
    if (step.progress === 'partial') flagMode = sticky || byDisable ? 'keep' : 'set';
    else if (sticky) this.out.countExtra('complete progress inside a sticky step');
    else if (byDisable) this.out.countExtra('finish progress of a step that a .disablecheckbox follows');
    else flagMode = 'clear';
    if (first?.command?.name === 'collect') {
      const quests = new Set(step.targets.map((target) => target.questId));
      const [quest] = quests;
      if (quests.size === 1 && quest !== undefined) {
        const args = [...first.command.args];
        let mask = 0;
        for (const target of step.targets) if (target.objective !== null) mask += 2 ** target.objective;
        const out = [args[0] ?? '', args[1] ?? '', String(quest), ...(mask > 0 || args.length > 4 ? [String(mask)] : []), ...args.slice(4)];
        if (flagMode === 'set') {
          while (out.length < 5) out.push('0');
          const flags = parseLuaNumber(out[4] ?? '0') ?? 0;
          if (!(flags > 0 && isOddNumber(flags))) out[4] = String(flags + 1);
        } else if (flagMode === 'clear') {
          const flags = out[4] === undefined ? null : parseLuaNumber(out[4]);
          if (flags !== null && flags > 0 && isOddNumber(flags)) out[4] = String(flags - 1);
        }
        return [build('collect', out) + trailingComment(first)];
      }
    }
    const targets = this.out.objectiveTargets(step.targets);
    if (targets === null) {
      for (const line of commandLines.slice(1)) this.dropTrailing(line);
      return [this.out.unrepresentable('complete', ALL_OBJECTIVES_UNKNOWN, this.rxp.importId, first?.line ?? 0) + (first === undefined ? '' : trailingComment(first))];
    }
    const tplTargets = tplStep.kind === 'complete' ? tplStep.targets : [];
    const claimed = new Set<number>();
    const commented = new Set<RxpCstLine>();
    const out = targets.map((target, index) => {
      const tplIndex = tplTargets.findIndex((candidate, k) => !claimed.has(k) && candidate.questId === target.questId && candidate.objective === target.objective);
      if (tplIndex >= 0) claimed.add(tplIndex);
      const tplLine = tplIndex >= 0 ? commandLines[tplIndex] : undefined;
      const tplArgs = tplLine?.command?.name === 'complete' ? tplLine.command.args : [];
      const sign = (tplArgs[0] ?? '').startsWith('-') ? '-' : '';
      const extra = [...tplArgs.slice(2)];
      if (flagMode === 'set') {
        while (extra.length < 2) extra.push('0');
        const flags = parseLuaNumber(extra[1] ?? '0') ?? 0;
        if (!isOddNumber(flags)) extra[1] = String(flags + 1);
      } else if (flagMode === 'clear') {
        const flags = extra[1] === undefined ? null : parseLuaNumber(extra[1]);
        // One step towards 0 clears the text-only bit and keeps the others (RXP reads the flags' absolute value).
        if (flags !== null && isOddNumber(flags)) extra[1] = String(flags - Math.sign(flags));
      }
      const built = build('complete', [`${sign}${String(target.questId)}`, String(target.objective + 1), ...extra], index === 0 ? text : null);
      if (tplLine === undefined || commented.has(tplLine)) return built;
      commented.add(tplLine);
      return built + trailingComment(tplLine);
    });
    // A merged line whose target is gone takes its trailing comment with it.
    for (const line of commandLines) if (!commented.has(line)) this.dropTrailing(line);
    const dropped = commandLines.slice(1).filter((line) => line.text !== null).length;
    if (dropped > 0) {
      this.out.diag('RXP044-text-dropped', this.rxp.importId, first?.line ?? 0, `The ">>" text of ${String(dropped)} merged ".complete" line${dropped === 1 ? '' : 's'} after the first is dropped, because the step was rebuilt.`);
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------

  /** A group whose import is missing: written from the model alone. */
  private emitWithoutTemplate(subRun: readonly RouteStep[], runIndex: number): string {
    const lines = [this.safe(() => buildStepLine(this.rxp.condition?.filter ?? null), null) ?? 'step'];
    const push = (text: string | null): void => {
      if (text !== null) lines.push(BODY_INDENT + text);
    };
    for (const tag of this.rxp.tags) if (runIndex === 0 || tag.name !== 'label') push(this.safe(() => buildTagLine(tag.name, tag.value, tag.assignment, null), null));
    for (const entry of this.rxp.condition?.variant ?? []) push(this.safe(() => variantLine(entry), null));
    for (const entry of this.rxp.condition?.skipIf ?? []) push(this.safe(() => predicateLine(entry), null));
    if (runIndex === 0) for (const waypoint of this.rxp.waypoints) push(this.safe(() => this.waypointLine(waypoint, null), null));
    const location = runLocation(subRun);
    if (location !== null) push(this.out.newLocationLine(location, subRun.some((step) => step.kind === 'travel' && step.location !== null), this.rxp.importId));
    if (runIndex === 0) for (const note of this.rxp.annotations) push(this.safe(() => annotationLine(note), null));
    for (const step of subRun) for (const text of this.out.stepLines(step, this.rxp.importId)) push(text);
    return `${lines.join('\n')}\n`;
  }
}

function pushSafe(out: string[], plan: GroupPlan, build: () => string): void {
  const text = plan.failSafe(build);
  if (text !== null) out.push(text);
}

const filterText = (filter: FilterAst | null): string => (filter === null ? '' : buildStepLine(filter).slice('step'.length));

function variantLine(entry: VariantTag): string {
  if (entry.name.startsWith('.')) {
    const name = entry.name.slice(1);
    return buildCommandLine({ command: name, args: entry.value === null ? [] : [entry.value], separator: 'rest', text: null, filter: entry.filter });
  }
  return buildTagLine(entry.name, entry.value, false, entry.filter);
}

function predicateLine(entry: StatePredicate): string {
  const plain = (name: string, args: readonly string[]): string => buildCommandLine({ command: name, args, separator: 'comma', text: null, filter: null });
  switch (entry.kind) {
    case 'opaque':
      return checkText(entry.raw, 'the condition');
    case 'levelAtLeast': {
      const level = `${entry.negate ? '<' : ''}${number(entry.level)}${entry.xp === null ? '' : `+${number(entry.xp)}`}`;
      return plain('xp', [level, '1']);
    }
    case 'questState': {
      const ids = entry.questIds.map(String);
      if (entry.match === 'all' && ids.length > 1) throw new RxpUnrepresentable('a quest-state condition that needs all of several quests');
      if (entry.state === 'onQuest') return plain(entry.negate ? 'isOnQuest' : 'isNotOnQuest', ids);
      if (entry.state === 'turnedIn') {
        if (entry.negate) return plain('isQuestTurnedIn', ids);
        if (ids.length === 1) return plain('isQuestAvailable', ids);
        throw new RxpUnrepresentable('a "not turned in" condition on several quests');
      }
      if (entry.state === 'complete' && ids.length === 1) return plain(entry.negate ? 'isQuestComplete' : 'isQuestNotComplete', ids);
      throw new RxpUnrepresentable(`a "${entry.state}" quest-state condition`);
    }
  }
}

function annotationLine(note: RxpCommandNode): string {
  const spec = commandSpec(note.command);
  return buildCommandLine({ command: note.command, args: note.args, separator: spec?.separator ?? 'comma', text: note.text, filter: note.filter });
}

/** Both forms of one export: the guide text, and the same text wrapped for an addon file (§13.4 rule 14). */
export interface RxpExportForms {
  readonly txt: RxpExportResult;
  readonly lua: RxpExportResult;
}

/**
 * Exports a route once and gives both forms (§13): the Lua form wraps the text form with `wrapLua`
 * instead of exporting again, so the two always agree. The Lua form never gets `RXP046` (the
 * wrapper keeps the call's arguments) and is never `unedited`.
 */
export function exportRxpForms(route: Route, imports: readonly RxpImport[], ctx: RxpExportContext): RxpExportForms {
  const exporter = new Exporter(route, imports, ctx);
  const unedited = exporter.uneditedImport();
  const text = unedited !== null ? unedited.text : exporter.export();
  exporter.fieldsNotExported();
  const headerImport = unedited ?? firstImport(route, imports);
  const luaArgs = headerImport?.options.lua ?? null;
  const luaDiagnostics = [...exporter.diagnostics];
  if (headerImport !== null && luaArgs !== null && (luaArgs.groupArg !== null || luaArgs.defaultFor !== null)) {
    exporter.diag('RXP046-wrapper-args', headerImport.id, 0, 'This guide was imported from the two/three-argument RegisterGuide form, whose group or defaultFor arguments are not in the text; export with the Lua wrapper to keep them.');
  }
  const diagnostics = [...exporter.diagnostics];
  if (exporter.errors.length > 0) {
    return { txt: { ok: false, errors: exporter.errors, diagnostics }, lua: { ok: false, errors: exporter.errors, diagnostics: luaDiagnostics } };
  }
  return {
    txt: { ok: true, text, unedited: unedited !== null, diagnostics },
    lua: { ok: true, text: wrapLua(text, luaArgs), unedited: false, diagnostics: luaDiagnostics },
  };
}

/** Exports a route (§13). `imports` are the project's `RxpImport`s. */
export function exportRxp(route: Route, imports: readonly RxpImport[], ctx: RxpExportContext, options: RxpExportOptions = {}): RxpExportResult {
  const forms = exportRxpForms(route, imports, ctx);
  return (options.wrapper ?? 'none') === 'lua' ? forms.lua : forms.txt;
}

function firstImport(route: Route, imports: readonly RxpImport[]): RxpImport | null {
  for (const step of route.steps) {
    if (step.groupId === null || !Object.hasOwn(route.groups, step.groupId)) continue;
    const importId = route.groups[step.groupId]?.rxp?.importId;
    const imp = imports.find((candidate) => candidate.id === importId);
    if (imp !== undefined) return imp;
  }
  return null;
}

/** §13.4 rule 14: `RXPGuides.RegisterGuide(` + optional group/defaultFor + long bracket + LF + text + close + `)` + LF. */
export function wrapLua(text: string, lua: RxpImport['options']['lua']): string {
  const level = longBracketLevelFor(text);
  const eq = '='.repeat(level);
  const args: string[] = [];
  if (lua !== null && (lua.groupArg !== null || lua.defaultFor !== null)) args.push(luaQuoted(lua.groupArg ?? ''));
  args.push(`[${eq}[\n${text}]${eq}]`);
  if (lua?.defaultFor !== null && lua?.defaultFor !== undefined) args.push(luaQuoted(lua.defaultFor));
  return `RXPGuides.RegisterGuide(${args.join(', ')})\n`;
}

/** Header name of an import text (`#name`), for display. */
export const importGuideName = (text: string): string | null => guideHeader(parseRxpCst(text)).name;

