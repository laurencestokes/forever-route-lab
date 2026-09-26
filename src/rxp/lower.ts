import type { FilterAst, StatePredicate, StepCondition, VariantTag } from '../domain/conditions';
import { type IdSource, type QuestId, groupId as toGroupId, questId, spellId } from '../domain/ids';
import type { Location, SourcedPoint } from '../domain/points';
import type { ObjectiveTarget, RouteGroup, RouteStep, RxpCommandNode, RxpTag, SourceLineRef, Waypoint } from '../domain/route';
import {
  type CommonStepFields,
  makeAbandonStep,
  makeAcceptStep,
  makeCompleteStep,
  makeFlightStep,
  makeGrindStep,
  makeHearthStep,
  makeNoteStep,
  makeTrainStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
} from '../domain/step-factory';
import type { MapGeometry } from '../geo/types';
import { rowContainsWorldPoint } from '../geo/zones';
import { canonicalCode } from './canonical';
import type { CommandSpec } from './commands';
import type { RxpCst, RxpCstLine } from './cst';
import { type RawDiagnostic, type RxpCode, rawDiagnostic } from './diagnostics';
import { canonicalJson, groupFingerprint } from './fingerprint';
import { type XpExpression, parseLuaInteger, parseLuaNumber, parseXpExpression } from './numbers';
import { type ParsedPoint, type ZoneKeyLookup, parsePointArguments } from './points';
import { codePointColumn, trimBlank } from './text';
import { LOAD_TIME_TAGS } from './vocabulary';

/**
 * Layer 2: lowering one guide's CST to route groups and atomic steps (docs/RXP.md §12,
 * ARCHITECTURE §10 step 4, D-020). Deterministic: the output depends only on the text, the
 * options, the zone-key table and the id source. The dataset and geometry lookups add
 * diagnostics only (`RXP031`, `RXP032`, `RXP035`); they never change the model (§12.1).
 */

export interface RxpLowerOptions {
  /** Frame of percent points on the four frame-changed UiMaps (§10.4). */
  readonly changedZoneFrame: 'forever' | 'era';
  /**
   * Compute group fingerprints (default true). The serializer lowers template groups only for
   * their structure and turns this off; their `fingerprint` is then empty.
   */
  readonly fingerprints?: boolean;
}

/** What the dataset says about a quest, for `.complete` index checks. */
export interface RxpQuestFacts {
  readonly objectiveCount: number;
  /** A user-defined custom quest (its objectives are not checked). */
  readonly custom: boolean;
}

/** Injected lookups (ARCHITECTURE §4: `rxp` imports only `domain` and `geo`). */
export interface RxpLowerContext {
  /** The QuestieDB-derived English zone-key table (§10.3), exact and case-sensitive. */
  readonly zoneKey: ZoneKeyLookup;
  /** Dataset or custom quest facts; null for an unknown quest. Omitted: no `RXP031`/`RXP032`. */
  readonly quest?: ((id: QuestId) => RxpQuestFacts | null) | undefined;
  /** Committed (or merged) geometry; omitted or null: no `RXP035`. */
  readonly geometry?: MapGeometry | null | undefined;
}

/** What one physical line of a step lowered to; the serializer uses it to reuse template lines. */
export type LineRole =
  | { readonly kind: 'stepLine' }
  | { readonly kind: 'blank' }
  | { readonly kind: 'comment' }
  /** Indices into `LoweredGroup.steps` (several for `.abandon a,b`). */
  | { readonly kind: 'steps'; readonly steps: readonly number[] }
  /** The steps' shared location line; `travelStep` when it is also a travel objective (§12.4 rule 2). */
  | { readonly kind: 'location'; readonly travelStep: number | null }
  | { readonly kind: 'tag'; readonly entry: number }
  | { readonly kind: 'variant'; readonly entry: number }
  | { readonly kind: 'predicate'; readonly entry: number }
  | { readonly kind: 'waypoint'; readonly entry: number }
  | { readonly kind: 'annotation'; readonly entry: number }
  /** Lowered to nothing (for example an `RXP036` goto); kept through the source line. */
  | { readonly kind: 'nothing' };

export interface LoweredGroup {
  readonly stepIndex: number;
  readonly group: RouteGroup;
  readonly steps: readonly RouteStep[];
  /** Line index of the `step` line. */
  readonly startLine: number;
  /** Exclusive end line index (the next step line, or the end of the text). */
  readonly endLine: number;
  /** One role per line of `[startLine, endLine)`. */
  readonly roles: readonly LineRole[];
  readonly location: Location | null;
  /** Line index of the location line, or null. */
  readonly locationLine: number | null;
}

export interface LoweredGuide {
  readonly groups: readonly LoweredGroup[];
  /** Diagnostics with lines of the guide text. */
  readonly diagnostics: readonly RawDiagnostic[];
}

interface Env {
  readonly importId: string;
  readonly options: RxpLowerOptions;
  readonly ids: IdSource;
  readonly ctx: RxpLowerContext;
  readonly diagnostics: RawDiagnostic[];
  /** `.convertquest` remapping, in force from its line to the end of the guide (§12.3). */
  readonly remap: Map<number, number>;
}

const isOdd = (value: number): boolean => Math.abs(value) % 2 === 1;
const hasBit = (value: number, bit: number): boolean => Math.floor(Math.abs(value) / bit) % 2 === 1;

interface GotoInfo {
  readonly line: RxpCstLine;
  readonly parsed: ParsedPoint;
  readonly radius: number | null;
  readonly radiusBad: boolean;
  readonly hasFlag: boolean;
}

function report(env: Env, code: RxpCode, line: RxpCstLine, offset: number, message: string, severity?: RawDiagnostic['severity']): void {
  env.diagnostics.push(rawDiagnostic(code, line.line, codePointColumn(line.raw, offset), message, severity));
}

const argOffset = (line: RxpCstLine): number => line.command?.argsOffset ?? line.indent.length;

/** Reads `zone,x,y[,radius[,flag]]` of a location command and reports its point problems. */
function readGoto(env: Env, line: RxpCstLine, withRadius: boolean): GotoInfo {
  const args = line.command?.args ?? [];
  const parsed = parsePointArguments(args, env.ctx.zoneKey, env.options.changedZoneFrame);
  const radiusText = withRadius ? args[3] : undefined;
  const radius = radiusText === undefined ? null : parseLuaNumber(radiusText);
  const radiusBad = radiusText !== undefined && radius === null;
  if (parsed.problem !== null) report(env, parsed.problem.code, line, argOffset(line), parsed.problem.message);
  else if (radiusBad) report(env, 'RXP004-malformed-number', line, argOffset(line), `RXP cannot read the radius "${radiusText ?? ''}" as a number; no point is stored.`);
  return { line, parsed, radius, radiusBad, hasFlag: withRadius && args[4] !== undefined };
}

const pointOf = (info: GotoInfo): SourcedPoint | null => (info.radiusBad ? null : info.parsed.point);

function checkPoint(env: Env, info: GotoInfo): void {
  const point = pointOf(info);
  if (point === null) return;
  if (info.parsed.frameAmbiguous) {
    report(
      env,
      'RXP030-frame-ambiguous',
      info.line,
      argOffset(info.line),
      `UiMap ${String(point.uiMapId)} changed its frame between Era and Forever; this point is read in the ${env.options.changedZoneFrame === 'era' ? 'Era' : 'Forever'} frame (import option). RXP reads it in the running client's frame.`,
    );
  }
  const geometry = env.ctx.geometry;
  if (point.space === 'world' && point.uiMapId !== null && geometry !== null && geometry !== undefined) {
    const map = geometry.maps.get(point.uiMapId);
    if (map !== undefined && !map.assignments.some((row) => rowContainsWorldPoint(row, point))) {
      report(env, 'RXP035-goto-outside-map', info.line, argOffset(info.line), `The world point lies outside UiMap ${String(point.uiMapId)}'s frame; RXP drops such an element.`);
    }
  }
}

function stepLineRef(env: Env, first: RxpCstLine, last: RxpCstLine = first): SourceLineRef {
  return { importId: env.importId, firstLine: first.line, lastLine: last.line };
}

/** The whole guide. */
export function lowerRxpCst(cst: RxpCst, importId: string, options: RxpLowerOptions, ids: IdSource, ctx: RxpLowerContext): LoweredGuide {
  const env: Env = { importId, options, ids, ctx, diagnostics: [], remap: new Map() };
  const levelLine = cst.lines.find((line) => line.filter?.parsed.usesLevel === true);
  if (levelLine?.filter !== null && levelLine?.filter !== undefined) {
    report(env, 'RXP028-level-filter', levelLine, levelLine.filter.textOffset, 'Level words in filters are evaluated once, at the route’s start level, as RXP evaluates them when the guide loads.');
  }
  const groups: LoweredGroup[] = [];
  cst.stepLines.forEach((start, stepIndex) => {
    const end = cst.stepLines[stepIndex + 1] ?? cst.lines.length;
    groups.push(lowerStep(cst, stepIndex, start, end, env));
  });
  return { groups, diagnostics: env.diagnostics };
}

interface CompleteRun {
  readonly index: number;
  readonly filterKey: string;
  readonly textOnly: boolean;
  readonly targets: ObjectiveTarget[];
  readonly first: RxpCstLine;
  last: RxpCstLine;
}

function lowerStep(cst: RxpCst, stepIndex: number, start: number, end: number, env: Env): LoweredGroup {
  const stepLine = cst.lines[start];
  if (stepLine === undefined) throw new Error('step line out of range');
  const body = cst.lines.slice(start + 1, end);
  const gid = toGroupId(env.ids.next('group'));

  // Pass 1: gotos, the location (§12.4 rule 1) and the sticky tags (§12.3 progress).
  const gotos = new Map<number, GotoInfo>();
  let locationInfo: GotoInfo | null = null;
  let lastGoto: GotoInfo | null = null;
  let stickyWindow = false;
  for (const line of body) {
    if (line.kind === 'command' && line.command?.spec?.lowering.kind === 'goto') {
      const info = readGoto(env, line, true);
      gotos.set(line.index, info);
      lastGoto = info;
      if (line.filter === null && pointOf(info) !== null) locationInfo = info;
    }
    if (line.kind === 'tag' && (line.tag?.key === 'sticky' || line.tag?.key === 'completewith') && !line.tag.assignment) {
      stickyWindow = true;
      if (line.filter !== null) {
        report(env, 'RXP034-not-simulated', line, line.filter.markerOffset, `The filter on "#${line.tag.key}" is not modelled: the step is treated as a ${line.tag.key} step for every character.`);
      }
    }
  }
  const locationPoint = locationInfo === null ? null : pointOf(locationInfo);
  const location: Location | null =
    locationInfo === null || locationPoint === null
      ? null
      : { source: locationPoint, label: null, radius: locationInfo.radius !== null && locationInfo.radius > 0 ? locationInfo.radius : null };

  const steps: RouteStep[] = [];
  const tags: RxpTag[] = [];
  const variant: VariantTag[] = [];
  const skipIf: StatePredicate[] = [];
  const waypoints: Waypoint[] = [];
  const annotations: RxpCommandNode[] = [];
  const roles: LineRole[] = [{ kind: 'stepLine' }];
  let run: CompleteRun | null = null;

  const common = (line: RxpCstLine, fields: { readonly withLocation?: boolean; readonly text?: string | null } = {}): CommonStepFields => ({
    location: fields.withLocation === false ? null : location,
    groupId: gid,
    condition: line.filter === null ? null : { filter: line.filter.parsed.ast, variant: null, skipIf: [] },
    origin: { source: 'rxp', ref: env.importId },
    rxp: { text: fields.text === undefined ? line.text : fields.text, line: stepLineRef(env, line) },
  });
  const addStep = (step: RouteStep): number => {
    steps.push(step);
    return steps.length - 1;
  };
  const preserve = (line: RxpCstLine, text: string | null): LineRole => {
    // Display text: what RXP reads, in canonical spelling (comment left out); the physical line is kept in `preserved`.
    const note = makeNoteStep(env.ids, { ...common(line, { text }), text: canonicalCode(line), preserved: { format: 'rxp', lines: [line.raw] } });
    return { kind: 'steps', steps: [addStep(note)] };
  };
  const notSimulated = (line: RxpCstLine, message: string): void => report(env, 'RXP034-not-simulated', line, line.indent.length, message);
  const quest = (value: number): QuestId => questId(env.remap.get(value) ?? value);
  const checkObjective = (line: RxpCstLine, id: QuestId, objective: number): void => {
    const lookup = env.ctx.quest;
    if (lookup === undefined) return;
    const facts = lookup(id);
    if (facts === null || facts.custom) {
      report(env, 'RXP032-objective-unchecked', line, argOffset(line), `Quest ${String(id)} is ${facts === null ? 'not in the dataset' : 'a custom quest'}, so objective ${String(objective + 1)} is not checked.`);
    } else if (objective + 1 > facts.objectiveCount) {
      report(
        env,
        'RXP031-objective-out-of-range',
        line,
        argOffset(line),
        `Quest ${String(id)} has ${String(facts.objectiveCount)} objective${facts.objectiveCount === 1 ? '' : 's'} in the dataset, so objective ${String(objective + 1)} does not exist.`,
      );
    }
  };
  const flushRun = (): void => {
    if (run === null) return;
    const current = run;
    const step = steps[current.index];
    if (step?.kind === 'complete' && step.rxp !== null) {
      steps[current.index] = { ...step, targets: [...current.targets], rxp: { text: step.rxp.text, line: stepLineRef(env, current.first, current.last) } };
    }
    run = null;
  };
  const markPartial = (): void => {
    flushRun();
    const index = steps.length - 1;
    const step = steps[index];
    if (step?.kind === 'complete') steps[index] = { ...step, progress: 'partial' };
  };

  for (const line of body) {
    if (line.kind === 'blank' || line.kind === 'comment') {
      roles.push({ kind: line.kind });
      continue;
    }
    const spec = line.command?.spec ?? null;
    const isMergeableComplete = line.kind === 'command' && spec?.lowering.kind === 'complete';
    if (!isMergeableComplete) flushRun();
    roles.push(lowerLine(line, spec));
  }
  flushRun();

  function lowerLine(line: RxpCstLine, spec: CommandSpec | null): LineRole {
    switch (line.kind) {
      case 'tag':
        return lowerTag(line);
      case 'note':
        return { kind: 'steps', steps: [addStep(makeNoteStep(env.ids, { ...common(line, { text: null }), text: line.text ?? '' }))] };
      case 'objective':
      case 'star':
        return {
          kind: 'steps',
          steps: [addStep(makeNoteStep(env.ids, { ...common(line, { text: null }), text: line.text ?? trimBlank((line.lead ?? '').slice(1)) }))],
        };
      case 'stray':
        return preserve(line, null);
      case 'command':
        return spec === null ? preserve(line, line.text) : lowerCommand(line, spec);
      case 'step':
      case 'enabledFor':
      case 'blank':
      case 'comment':
        return { kind: 'nothing' };
    }
  }

  function lowerTag(line: RxpCstLine): LineRole {
    const tag = line.tag;
    if (tag === null) return { kind: 'nothing' };
    if (LOAD_TIME_TAGS.includes(tag.key) && !tag.assignment) {
      variant.push({ name: tag.key, value: tag.value, filter: line.filter?.parsed.ast ?? null });
      return { kind: 'variant', entry: variant.length - 1 };
    }
    tags.push({ name: tag.key, value: tag.value, assignment: tag.assignment, line: stepLineRef(env, line) });
    return { kind: 'tag', entry: tags.length - 1 };
  }

  function annotate(line: RxpCstLine): LineRole {
    const command = line.command;
    if (command === null) return { kind: 'nothing' };
    const args = command.name === 'link' ? command.args.map((arg) => arg.replace(/\\-/g, '-')) : [...command.args];
    annotations.push({ command: command.name, args, text: line.text, filter: line.filter?.parsed.ast ?? null, line: stepLineRef(env, line) });
    return { kind: 'annotation', entry: annotations.length - 1 };
  }

  function predicate(line: RxpCstLine, value: StatePredicate): LineRole {
    // Interim rule G1 (§12.2): a filtered predicate line becomes opaque, so it evaluates unknown.
    skipIf.push(line.filter === null ? value : { kind: 'opaque', raw: canonicalCode(line) });
    return { kind: 'predicate', entry: skipIf.length - 1 };
  }

  function opaque(line: RxpCstLine): LineRole {
    return predicate(line, { kind: 'opaque', raw: canonicalCode(line) });
  }

  function malformed(line: RxpCstLine, what: string): LineRole {
    report(env, 'RXP004-malformed-number', line, argOffset(line), `RXP cannot read ${what}; the line is kept as a preserved note.`);
    return preserve(line, line.text);
  }

  /** A quest ID of 0 or less where RXP gives it no meaning (§12.3; negative IDs are custom quests, ARCH §5.5). */
  function notAQuest(line: RxpCstLine, ids: readonly number[]): string | null {
    const bad = ids.find((id) => id <= 0);
    return bad === undefined ? null : `${String(bad)} is not a quest ID for ".${line.command?.name ?? ''}" (a quest ID is a positive whole number; negative IDs are kept for your own custom quests)`;
  }

  function badQuest(line: RxpCstLine, problem: string): LineRole {
    report(env, 'RXP004-malformed-number', line, argOffset(line), `${problem}; the line is kept as a preserved note.`);
    return preserve(line, line.text);
  }

  function lowerCommand(line: RxpCstLine, spec: CommandSpec): LineRole {
    const command = line.command;
    if (command === null) return { kind: 'nothing' };
    const args = command.args;
    const lowering = spec.lowering;
    if (spec.requiredText === 'always' && line.text === null) {
      report(env, 'RXP018-missing-text', line, command.nameOffset, `".${command.name}" needs a ">> text"; RXP drops the line without one. It is kept as a preserved note.`);
      return preserve(line, null);
    }
    if (spec.requiredText === 'nameOrText' && line.text === null && args.length === 0) {
      report(env, 'RXP018-missing-text', line, command.nameOffset, `".${command.name}" needs a node name or a ">> text"; RXP drops the line without either. It is kept as a preserved note.`);
      return preserve(line, null);
    }
    switch (lowering.kind) {
      case 'accept': {
        const id = parseLuaInteger(args[0] ?? '');
        if (id === null) return malformed(line, 'the quest ID');
        const problem = notAQuest(line, [id]);
        if (problem !== null) return badQuest(line, problem);
        const flags = args[1] === undefined ? null : parseLuaInteger(args[1]);
        if (flags !== null && hasBit(flags, 2)) notSimulated(line, 'The conditional completion of ".accept" (flag 2 with a required turn-in) is ignored by the route engine.');
        return { kind: 'steps', steps: [addStep(makeAcceptStep(env.ids, { ...common(line), questId: quest(id) }))] };
      }
      case 'acceptAny': {
        const ids = args.map(parseLuaInteger);
        if (ids.length === 0 || ids.some((id) => id === null)) return malformed(line, 'the quest IDs');
        const problem = notAQuest(line, ids.map((id) => id ?? 0));
        if (problem !== null) return badQuest(line, problem);
        const quests = ids.map((id) => quest(id ?? 0));
        return { kind: 'steps', steps: [addStep(makeAcceptStep(env.ids, { ...common(line), questId: quests[0] ?? questId(0), anyOf: quests }))] };
      }
      case 'turnin': {
        const id = parseLuaInteger(args[0] ?? '');
        if (id === null || id === 0) return malformed(line, 'the quest ID');
        const reward = args[1] === undefined ? null : parseLuaInteger(args[1]);
        if (args[1] !== undefined && reward === null) return malformed(line, 'the reward choice');
        if (id < 0 && reward !== null && reward > 0) notSimulated(line, '".turnin -id,reward" also skips an incomplete quest in RXP; the route engine only skips a missing one.');
        const rewardIndex = reward !== null && reward > 0 && id > 0 ? reward : null;
        return { kind: 'steps', steps: [addStep(makeTurnInStep(env.ids, { ...common(line), questId: quest(Math.abs(id)), rewardIndex, skipIfMissing: id < 0 }))] };
      }
      case 'turninAny': {
        const ids = args.map(parseLuaInteger);
        if (ids.length === 0 || ids.some((id) => id === null)) return malformed(line, 'the quest IDs');
        const problem = notAQuest(line, ids.map((id) => id ?? 0));
        if (problem !== null) return badQuest(line, problem);
        const quests = ids.map((id) => quest(id ?? 0));
        return { kind: 'steps', steps: [addStep(makeTurnInStep(env.ids, { ...common(line), questId: quests[0] ?? questId(0), anyOf: quests }))] };
      }
      case 'complete':
        return lowerComplete(line, args);
      case 'collect':
        return lowerCollect(line, args);
      case 'abandon': {
        const ids = args.map(parseLuaInteger);
        if (ids.length === 0 || ids.some((id) => id === null || id === 0)) return malformed(line, 'the quest IDs');
        return { kind: 'steps', steps: ids.map((id) => addStep(makeAbandonStep(env.ids, { ...common(line), questId: quest(Math.abs(id ?? 0)) }))) };
      }
      case 'goto':
        return lowerGoto(line);
      case 'waypoint': {
        const info = readGoto(env, line, lowering.role === 'leg');
        const point = pointOf(info);
        if (point === null) return { kind: 'nothing' };
        checkPoint(env, info);
        waypoints.push({ point, role: lowering.role, radius: lowering.role === 'leg' ? info.radius : null, filter: line.filter?.parsed.ast ?? null, line: stepLineRef(env, line) });
        return { kind: 'waypoint', entry: waypoints.length - 1 };
      }
      case 'travelArea':
        return { kind: 'steps', steps: [addStep(makeTravelStep(env.ids, { ...common(line, { withLocation: false }), mode: 'auto' }))] };
      case 'hearth':
        return { kind: 'steps', steps: [addStep(makeHearthStep(env.ids, { ...common(line), mode: lowering.mode }))] };
      case 'flight':
        return { kind: 'steps', steps: [addStep(makeFlightStep(env.ids, { ...common(line), mode: lowering.mode, nodeQuery: args[0] ?? null }))] };
      case 'xp':
        return lowerXp(line, args);
      case 'maxlevel': {
        const level = parseLuaInteger(args[0] ?? '');
        if (level === null) return malformed(line, 'the level');
        if (args[1] !== undefined) notSimulated(line, '".maxlevel N,label" jumps to the labelled step in RXP; the route engine treats it as a skip of this step.');
        return predicate(line, { kind: 'levelAtLeast', level: level + 1, xp: null, negate: false });
      }
      case 'train': {
        const id = parseLuaInteger(args[0] ?? '');
        if (id === null) return malformed(line, 'the spell ID');
        const flags = args[1] === undefined ? null : parseLuaInteger(args[1]);
        if (flags !== null && isOdd(flags)) return opaque(line);
        return { kind: 'steps', steps: [addStep(makeTrainStep(env.ids, { ...common(line), spellId: spellId(id) }))] };
      }
      case 'trainer':
        return { kind: 'steps', steps: [addStep(makeTrainStep(env.ids, common(line)))] };
      case 'vendor':
        return { kind: 'steps', steps: [addStep(makeVendorStep(env.ids, common(line)))] };
      case 'questState': {
        const ids = args.map(parseLuaInteger);
        if (ids.length === 0 || ids.some((id) => id === null) || (lowering.single && ids.length > 1)) return opaque(line);
        const problem = notAQuest(line, ids.map((id) => id ?? 0));
        if (problem !== null) {
          report(env, 'RXP004-malformed-number', line, argOffset(line), `${problem}; the condition is kept opaque (unknown).`);
          return opaque(line);
        }
        return predicate(line, { kind: 'questState', state: lowering.state, questIds: ids.map((id) => quest(id ?? 0)), match: 'any', negate: lowering.negate });
      }
      case 'skipIf':
        if (lowering.jump) notSimulated(line, `".${command.name}" jumps in RXP; the route engine treats it as a skip of this step.`);
        return opaque(line);
      case 'cooldown':
        return /^[<>]/.test(args[2] ?? '') ? opaque(line) : annotate(line);
      case 'skillCheck':
        if (args[lowering.skipArg] !== undefined) return opaque(line);
        notSimulated(line, `".${command.name}" without its skip argument is a blocking objective in RXP; it is kept as a preserved note and not simulated.`);
        return preserve(line, line.text);
      case 'variant':
        variant.push({ name: `.${command.name}`, value: command.argsRaw === '' ? null : command.argsRaw, filter: line.filter?.parsed.ast ?? null });
        return { kind: 'variant', entry: variant.length - 1 };
      case 'annotation':
        return annotate(line);
      case 'disablecheckbox':
        markPartial();
        return annotate(line);
      case 'convertquest': {
        const from = parseLuaInteger(args[0] ?? '');
        const to = parseLuaInteger(args[1] ?? '');
        if (from !== null && to !== null) {
          env.remap.set(from, to);
          report(env, 'RXP029-convertquest', line, line.indent.length, `Quest ${String(from)} is read as quest ${String(to)} in every later line of this guide, as RXP does.`);
        } else report(env, 'RXP004-malformed-number', line, argOffset(line), 'RXP cannot read the quest IDs of ".convertquest"; nothing is remapped.');
        return annotate(line);
      }
      case 'deathskip': {
        notSimulated(line, '".deathskip" is kept as a preserved note: the route engine sets the position to unknown after it; RXP also marks the step softcore.');
        variant.push({ name: 'softcore', value: null, filter: line.filter?.parsed.ast ?? null });
        return preserve(line, line.text);
      }
      case 'cast':
        if (line.text !== null) {
          notSimulated(line, '".cast" with a text is a blocking objective in RXP; it is kept as a preserved note and not simulated.');
          return preserve(line, line.text);
        }
        return annotate(line);
      case 'preserved':
        if (lowering.routeRelevant) notSimulated(line, `".${command.name}" is kept verbatim for export; the route engine ignores it.`);
        return preserve(line, line.text);
    }
  }

  function lowerGoto(line: RxpCstLine): LineRole {
    const info = gotos.get(line.index);
    if (info === undefined) return { kind: 'nothing' };
    const point = pointOf(info);
    if (point === null) return { kind: 'nothing' };
    checkPoint(env, info);
    if (info === locationInfo) {
      if (info.radius !== null && info.radius < 0) {
        notSimulated(line, 'RXP points at whichever of the step’s closest-point gotos is nearest; the route uses this last one as the location.');
      }
      if (info.radius !== null && info.radius > 0 && !info.hasFlag) {
        const travel = makeTravelStep(env.ids, { ...common(line), mode: 'auto' });
        return { kind: 'location', travelStep: addStep(travel) };
      }
      return { kind: 'location', travelStep: null };
    }
    let role: Waypoint['role'] = 'leg';
    if (info.radius !== null && info.radius === 0) role = 'pin';
    else if (info.radius !== null && info.radius < 0) role = 'closest';
    if (line.filter !== null) {
      const last = lastGoto === info;
      notSimulated(
        line,
        last
          ? 'A filtered ".goto" is never the location: it is kept as a waypoint with its filter, and because it is the step’s last one, the location is not character-specific.'
          : 'A filtered ".goto" is never the location: it is kept as a waypoint with its filter.',
      );
    } else if (info.radius !== null && info.radius > 0 && !info.hasFlag) {
      notSimulated(line, 'This radius ".goto" is a required visit in RXP but not the step’s location; the route treats it as a leg waypoint.');
    }
    waypoints.push({ point, role, radius: info.radius, filter: line.filter?.parsed.ast ?? null, line: stepLineRef(env, line) });
    return { kind: 'waypoint', entry: waypoints.length - 1 };
  }

  function lowerComplete(line: RxpCstLine, args: readonly string[]): LineRole {
    const id = parseLuaInteger(args[0] ?? '');
    const obj = parseLuaInteger(args[1] ?? '');
    if (id === null || id === 0) return malformed(line, 'the quest ID');
    if (obj === null || obj < 1) return malformed(line, 'the objective index (a positive integer)');
    const flags = args[3] === undefined ? null : parseLuaInteger(args[3]);
    const textOnly = flags !== null && isOdd(flags);
    if (id < 0) notSimulated(line, '".complete -id" is skipped by RXP when the quest is not in the log; the route engine ignores that rule.');
    const target: ObjectiveTarget = { questId: quest(Math.abs(id)), objective: obj - 1 };
    checkObjective(line, target.questId, obj - 1);
    // Same filter means the same meaning, not the same spelling (§12.3), so canonicalisation cannot change the merge.
    const filterKey = line.filter === null ? '' : canonicalJson(line.filter.parsed.ast);
    if (run !== null && run.filterKey === filterKey && run.textOnly === textOnly) {
      run.targets.push(target);
      run.last = line;
      return { kind: 'steps', steps: [run.index] };
    }
    flushRun();
    const progress = stickyWindow || textOnly ? 'partial' : 'finish';
    const index = addStep(makeCompleteStep(env.ids, { ...common(line), targets: [target], progress }));
    run = { index, filterKey, textOnly, targets: [target], first: line, last: line };
    return { kind: 'steps', steps: [index] };
  }

  function lowerCollect(line: RxpCstLine, args: readonly string[]): LineRole {
    const questArg = args[2] === undefined ? null : parseLuaInteger(args[2]);
    if (args[2] !== undefined && questArg === null) return malformed(line, 'the quest ID');
    if (questArg === null || questArg === 0) {
      notSimulated(line, '".collect" without a quest is an inventory objective; it is kept as a preserved note and not simulated.');
      return preserve(line, line.text);
    }
    const objFlags = args[3] === undefined ? 0 : parseLuaInteger(args[3]);
    if (objFlags === null || objFlags < 0) return malformed(line, 'the objective mask');
    const flags = args[4] === undefined ? null : parseLuaInteger(args[4]);
    const textOnly = flags !== null && flags > 0 && isOdd(flags);
    const id = quest(Math.abs(questArg));
    const targets: ObjectiveTarget[] = [];
    let mask = objFlags;
    for (let objective = 0; mask > 0; objective += 1) {
      if (mask % 2 === 1) targets.push({ questId: id, objective });
      mask = Math.floor(mask / 2);
    }
    if (targets.length === 0) targets.push({ questId: id, objective: null });
    for (const target of targets) if (target.objective !== null) checkObjective(line, id, target.objective);
    const progress = stickyWindow || textOnly ? 'partial' : 'finish';
    return { kind: 'steps', steps: [addStep(makeCompleteStep(env.ids, { ...common(line), targets, progress }))] };
  }

  /** `.xp expr` without a (readable) skip flag: a grind objective (§9.4). */
  function grindOrPreserve(line: RxpCstLine, expression: XpExpression): LineRole {
    if (expression.below) {
      notSimulated(line, '".xp <level" without a skip flag has no meaning for the route; it is kept as a preserved note.');
      return preserve(line, line.text);
    }
    if (expression.level < 1) return malformed(line, 'the level');
    const offset = expression.offset === null ? null : expression.offset.kind === 'fraction' ? { kind: 'fraction' as const, fraction: expression.offset.fraction } : expression.offset;
    return { kind: 'steps', steps: [addStep(makeGrindStep(env.ids, { ...common(line), until: { kind: 'level', level: expression.level, offset } }))] };
  }

  function lowerXp(line: RxpCstLine, args: readonly string[]): LineRole {
    const expression = parseXpExpression(args[0] ?? '');
    if (expression === null) return malformed(line, 'the level expression');
    if (expression.extra) {
      report(env, 'RXP004-malformed-number', line, argOffset(line), `RXP reads only "${expression.below ? '<' : ''}${String(expression.level)}${offsetText(expression.offset)}" of "${args[0] ?? ''}" and ignores the rest.`, 'warning');
    }
    const skipText = args[1];
    if (skipText === undefined) return grindOrPreserve(line, expression);
    const skip = parseLuaNumber(skipText);
    if (skip === null) {
      // RXP reads the flag with tonumber(): not a number means no flag, so the line stays a grind objective (§9.4).
      report(env, 'RXP004-malformed-number', line, argOffset(line), `RXP reads the skip flag "${skipText}" as no flag (it is not a number), so this line is an ordinary grind objective.`, 'warning');
      return grindOrPreserve(line, expression);
    }
    if (args[2] !== undefined) notSimulated(line, '".xp …,skip,label" jumps to the labelled step in RXP; the route engine treats it as a skip of this step.');
    const offset = expression.offset;
    if (skip > 0 && (offset === null || offset.kind === 'xpInto')) {
      return predicate(line, { kind: 'levelAtLeast', level: expression.level, xp: offset === null ? null : offset.xp, negate: expression.below });
    }
    return opaque(line);
  }

  const condition: StepCondition | null =
    stepLine.filter === null && variant.length === 0 && skipIf.length === 0
      ? null
      : { filter: stepLine.filter?.parsed.ast ?? null, variant: variant.length === 0 ? null : variant, skipIf };

  if (steps.length === 0) {
    // A carrier note keeps the group's place in the route (§12.1).
    steps.push(
      makeNoteStep(env.ids, { location, groupId: gid, origin: { source: 'rxp', ref: env.importId }, text: '', preserved: { format: 'rxp', lines: [] } }),
    );
  }
  const content = { importId: env.importId, stepIndex, tags, condition, waypoints, annotations };
  const group: RouteGroup = { id: gid, rxp: { ...content, fingerprint: env.options.fingerprints === false ? '' : groupFingerprint(content, steps) } };
  return {
    stepIndex,
    group,
    steps,
    startLine: start,
    endLine: end,
    roles,
    location,
    locationLine: locationInfo?.line.index ?? null,
  };
}

function offsetText(offset: XpExpression['offset']): string {
  if (offset === null) return '';
  if (offset.kind === 'xpInto') return `+${String(offset.xp)}`;
  if (offset.kind === 'xpShort') return `-${String(offset.xp)}`;
  return `.${offset.digits}`;
}

/** The filter AST of a line, or null. */
export const lineFilter = (line: RxpCstLine): FilterAst | null => line.filter?.parsed.ast ?? null;
