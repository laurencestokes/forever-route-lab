import type { ValidationIssue } from '../domain/issues';
import type { RouteStep } from '../domain/route';
import { routeGroup } from '../domain/route-ops';
import { createPlaces, type Places } from '../engine/places';
import { cloneState, createInitialState } from '../engine/state';
import { runStep, stepActivity } from '../engine/steps';
import type { EngineContext, RouteWalk, WalkProject, WalkVisitor } from '../engine/types';
import { createRouteWalker, type RouteWalker } from '../engine/walker';
import { copyMemo, replayEnv } from '../optimizer/core/replay';
import type { CompileAvailability, SectionProbe, SectionWalk } from '../optimizer/types';
import { type AcceptChecks, availabilitySubject, createAcceptChecks } from '../validate/availability';
import { createRouteValidator, type RouteValidator } from '../validate/validator';
import { compileAvailability, createSectionProbe } from './optimizer-availability';
import type { OptimizationHost } from './optimizer-host';

/**
 * An optimiser run's private walks (docs/research/optimizer-m7.md §5.1, review OP-11): the run
 * never reads the derived pipeline's shared walker, which re-walks whenever legs arrive. It keeps
 * its own validator and walker over the host's context (the quiet travel model, with the
 * validator's accept policy), and walks:
 *
 * 1. the analysis walk (no probe), before "computing paths";
 * 2. the baseline re-walk from the cast window, after it, with the probe;
 * 3. each candidate's verification re-walk from the section start.
 *
 * The walker replaces its records array on every walk, so a baseline's records stay as they were.
 * `stateBefore(first)` and `memoBefore(first)` (M7.0) are replayed here from the route start with the
 * engine's own step code and the run's one place cache (the stand-in core's test harness uses),
 * once per run (`sectionStart`).
 *
 * The place cache is one per host engine context (review PRF-07): `Places` holds only memoised
 * resolution for one context (dataset, geometry, zone hints), so every walk of a run, and every run
 * on the same host, resolves to the same endpoint objects. The analysis's leg pairs and compile's
 * matrix then share them, and the travel model's per-point request cache and the leg table's keys
 * are reused instead of rebuilt for every pair.
 */

const placesByContext = new WeakMap<EngineContext, Places>();

/** The place cache of a host's engine context, made on first use. */
function placesOf(context: EngineContext): Places {
  let places = placesByContext.get(context);
  if (places === undefined) {
    places = createPlaces(context);
    placesByContext.set(context, places);
  }
  return places;
}

export interface RunWalker {
  /** The host's engine context with the validator's accept policy. */
  readonly engine: EngineContext;
  readonly walker: RouteWalker;
  readonly validator: RouteValidator;
  readonly checks: AcceptChecks;
  readonly availability: CompileAvailability;
  /** The place cache of the host's engine context, shared by every walk of the run (and every run on that host). */
  readonly places: Places;
}

export function createRunWalker(host: Pick<OptimizationHost, 'engine' | 'validator'>): RunWalker {
  const validator = createRouteValidator(host.validator);
  const engine: EngineContext = { ...host.engine, acceptPolicy: validator.acceptPolicy };
  return {
    engine,
    walker: createRouteWalker(engine),
    validator,
    checks: createAcceptChecks({ dataset: host.validator.dataset, rules: host.validator.rules }),
    availability: compileAvailability(host.validator),
    places: placesOf(host.engine),
  };
}

export interface WalkedSection {
  readonly walk: SectionWalk;
  readonly route: RouteWalk;
  /** The validator's issues of this walk (a copy: the next walk replaces them). */
  readonly issues: readonly ValidationIssue[];
}

/** The state, walker memo and place cache before a section's first step (read-only for everyone who gets them). */
export type SectionStart = Pick<SectionWalk, 'start' | 'memo' | 'places'>;

/**
 * The state and walker memo before `first`, replayed from the route start with the engine's step
 * code. It depends only on the project and `first`, so a run replays it once and gives it to both
 * of its walks (`walkSection`'s `start`), in a task of its own (review RTD-05).
 */
export function sectionStart(run: RunWalker, project: WalkProject, first: number): SectionStart {
  return stateBeforeSection(run.engine, run.places, project, first);
}

function stateBeforeSection(engine: EngineContext, places: Places, project: WalkProject, first: number): SectionStart {
  const env = replayEnv(engine, project, places);
  const initial = createInitialState(project.character, { dataset: engine.dataset, rules: engine.rules, graph: engine.graph, places });
  const steps = project.route.steps;
  for (let i = 0; i < first; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const group = step.groupId === null ? null : routeGroup(project.route, step.groupId);
    runStep(env, initial.state, initial.memo, step, i, group, stepActivity(env, initial.state, initial.memo, step, group));
    env.recorder.current = null;
  }
  return { start: cloneState(initial.state), memo: copyMemo(initial.memo), places };
}

export interface WalkedRoute {
  readonly route: RouteWalk;
  /** The validator's issues of this walk (a copy: the next walk replaces them). */
  readonly issues: readonly ValidationIssue[];
  readonly probe: SectionProbe | null;
}

/**
 * Walks `project` on the run's walker with its validator (and the probe when asked), re-walking from
 * `from` (default: wherever the walker's checkpoints allow). The probe needs a walk that visits the
 * section from its first step.
 */
export function walkRoute(
  run: RunWalker,
  project: WalkProject,
  section: { readonly first: number; readonly last: number },
  options: { readonly probe: boolean; readonly from?: number },
): WalkedRoute {
  if (options.from !== undefined) run.walker.invalidate(options.from);
  const probe = options.probe
    ? createSectionProbe({
        checks: run.checks,
        subject: availabilitySubject(project.character),
        project,
        rules: run.engine.rules,
        predicates: { acceptPolicy: run.validator.acceptPolicy },
        section,
      })
    : null;
  const visitors: WalkVisitor[] = [run.validator.visitor];
  if (probe !== null) visitors.push(probe.visitor);
  const route = run.walker.walk(project, visitors);
  return { route, issues: [...run.validator.issues()], probe: probe === null ? null : probe.result() };
}

/**
 * A `SectionWalk` for compile (§5.1): the walk, and the state, memo and places before the section
 * (`options.start`, from `sectionStart` on the same project and first step, or replayed here).
 */
export function walkSection(
  run: RunWalker,
  project: WalkProject,
  section: { readonly first: number; readonly last: number },
  options: { readonly probe: boolean; readonly from?: number; readonly start?: SectionStart },
): WalkedSection {
  const walked = walkRoute(run, project, section, options);
  const start = options.start ?? stateBeforeSection(run.engine, run.places, project, section.first);
  return { walk: { records: walked.route.records, ...start, probe: walked.probe }, route: walked.route, issues: walked.issues };
}

/** The project with steps `first..last` replaced by `section`. */
export function spliceSection<P extends WalkProject>(project: P, first: number, last: number, section: readonly RouteStep[]): P {
  const steps = project.route.steps;
  return { ...project, route: { ...project.route, steps: [...steps.slice(0, first), ...section, ...steps.slice(last + 1)] } };
}
