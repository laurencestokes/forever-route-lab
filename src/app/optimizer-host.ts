import type { ProjectV1 } from '../domain/project';
import type { TravelModel } from '../domain/travel';
import type { EngineContext, TravelPair } from '../engine/types';
import type { MapGeometry } from '../geo/types';
import type { MatrixCache } from '../optimizer/types';
import { createStraightLineTravelModel } from '../rules/straight-line';
import type { CommittedTaxi } from '../rules/travel-graph';
import { taxiLegDataOf } from '../sim/taxi';
import type { ValidatorContext } from '../validate/validator';
import { projectRules, projectTravelGraph, selectTravelModel, userDocksOf } from './derived-context';
import { type DatasetSource, datasetViewInputOf } from './dataset-source';
import { datasetBaseView } from './dataset-views';
import type { NavigationTravelModel } from './navigation-model';
import type { NavigationRuntime, NavigationState } from './navigation-runtime';

/**
 * What an optimiser run reads from the app (docs/research/optimizer-m7.md §9): the project of one
 * editor revision, the engine and validator contexts its private walks use, and "computing paths"
 * for the legs the section's matrix needs.
 *
 * The contexts are built with the same functions the derived pipeline's `contextFor` uses
 * (src/app/derived-context.ts: the effective rules, the TravelGraph with the route's user docks,
 * the travel model over the shared leg table and scheduler), so a run prices exactly what the
 * published results price. Until `DerivedActions.optimizationHost()` (plan M7.0) hands out the
 * pipeline's own context, `createOptimizationHost` builds one from the same inputs.
 *
 * The engine context's travel model is the **quiet** view (§5.3): it reads the leg table like the
 * navigation model but never records a missing leg for the scheduler's background drain, so neither
 * the run's walks nor compile queue legs behind the user's back; a leg still missing answers with
 * the pending fallback, and compile refuses a section with any (`missingLegs`).
 */

export interface OptimizationHost {
  /** The editor revision of `project`: a run on another revision is refused. */
  readonly revision: number;
  readonly project: ProjectV1;
  /** The run's engine context (no accept policy: the run's validator gives it). `travel` is the quiet view. */
  readonly engine: EngineContext;
  readonly validator: ValidatorContext;
  readonly travelModel: 'navigation' | 'straight-line';
  /**
   * Makes the legs of `pairs` complete in the leg table ("computing paths", terrain-navigation.md
   * §9.4) through the app's navigation scheduler, with progress in legs and cancel through the
   * signal (a cancelled call rejects with the signal's reason; legs computed so far are kept).
   * Resolves at once for the straight-line model.
   */
  computeLegs(pairs: readonly TravelPair[], options: { readonly signal: AbortSignal; readonly onProgress: (progress: { readonly done: number; readonly total: number }) => void }): Promise<{ readonly complete: boolean }>;
  /** The pairs whose legs (or the dock walks of a same-map transport) are still missing: 0 for the straight-line model. */
  missingLegs(pairs: readonly TravelPair[]): number;
  /**
   * What the matrix depends on beyond the model's id, revision, speeds and transports: the leg
   * table's unavailable maps (a map whose files failed takes the final fallback). Part of the
   * matrix cache key (`keyedMatrixCache`).
   */
  cacheKey(): string;
}

/**
 * The quiet view of a navigation model (§5.3; M7.0 adds it to `NavigationTravelModel` as `quiet`):
 * a leg the table can answer is the model's own leg; one it cannot (`legsNeeded` is not empty) is
 * the labelled fallback, pending, and nothing is recorded as missing. `legsNeeded` records nothing,
 * and `leg` records only what `legsNeeded` lists, so the model's answer is used exactly when it
 * would record nothing.
 */
export function quietTravelModel(model: NavigationTravelModel, fallback: TravelModel): TravelModel {
  return {
    id: model.id,
    revision: model.revision,
    leg(from, to, speeds) {
      if (model.legsNeeded(from, to).length > 0) return { ...fallback.leg(from, to, speeds), pending: true };
      return model.leg(from, to, speeds);
    },
    // The optimiser reads no polylines; the proposal overlay's come from the model itself (Milestone 8).
    path: () => null,
  };
}

/** The unavailable maps of a runtime's leg table, as the matrix cache key's extra part. */
function unavailableKey(runtime: NavigationRuntime): string {
  const { manifest, table } = runtime;
  if (table.unavailable(-1) !== null) return 'unavailable:all';
  const maps = manifest.maps
    .map((m) => m.mapId)
    .filter((id) => table.unavailable(id) !== null)
    .sort((a, b) => a - b);
  return `unavailable:${maps.join(',')}`;
}

/**
 * A matrix cache whose keys also carry `extra()` (the leg table's unavailable maps), so a map that
 * fails between two runs never serves the older matrix. It owns nothing itself: `inner` does.
 */
export function keyedMatrixCache(inner: MatrixCache, extra: () => string): MatrixCache {
  return {
    capacity: inner.capacity,
    size: () => inner.size(),
    lookup: (key, pairs) => inner.lookup(`${key}|${extra()}`, pairs),
    store: (key, pairs, matrix) => {
      inner.store(`${key}|${extra()}`, pairs, matrix);
    },
  };
}

export interface OptimizationHostInput {
  readonly project: ProjectV1;
  readonly revision: number;
  readonly data: DatasetSource;
  /** The map geometry resolution uses (`LoadedGeometry.geometry`). */
  readonly geometry: MapGeometry;
  /** Navigation as the pipeline knows it (checking and unavailable both give the straight-line model). */
  readonly navigation: NavigationState;
  /**
   * The committed client taxi file once the pipeline has loaded it (D-039 B): the host seeds its
   * TravelGraph with it and prices flights by TIME-6, as the pipeline's walk does. Null: TIME-5
   * (the file is still loading or failed). Required, so a caller cannot forget it and price the
   * route differently from the pipeline (review TR-12).
   */
  readonly taxi: CommittedTaxi | null;
}

/** The host for one revision of the project, from the inputs the derived pipeline walks with. */
export function createOptimizationHost(input: OptimizationHostInput): OptimizationHost {
  const { project, data, geometry } = input;
  const viewInput = datasetViewInputOf(project);
  const view = data.view(viewInput);
  const baseView = datasetBaseView(data, { faction: viewInput.faction, class: viewInput.class, questOverrides: viewInput.questOverrides });
  const rules = projectRules(project.rulesetId, project.assumptions);
  const taxi = input.taxi;
  const graph = projectTravelGraph(view, data.flightMasterIds, rules, userDocksOf(project.route.steps, geometry), taxi);
  const selection = selectTravelModel({ navigation: input.navigation, detourFactor: rules.values.groundDetourFactor.value, graph, faction: project.character.faction, dataset: view, geometry });
  const navigation = selection.navigation;
  const runtime = input.navigation.kind === 'available' ? input.navigation.runtime : null;
  const travel = navigation === null ? selection.model : quietTravelModel(navigation, createStraightLineTravelModel(rules.values.groundDetourFactor.value));
  const engine: EngineContext = { dataset: view, geometry, rules, travel, graph, zoneHints: selection.hints, localTaxi: taxi === null ? null : taxiLegDataOf(taxi) };
  const validator: ValidatorContext = { dataset: view, rules, baseDataset: baseView, graph };
  return {
    revision: input.revision,
    project,
    engine,
    validator,
    travelModel: navigation === null ? 'straight-line' : 'navigation',
    async computeLegs(pairs, options) {
      options.signal.throwIfAborted();
      if (navigation === null || runtime === null) {
        options.onProgress({ done: 0, total: 0 });
        return { complete: true };
      }
      const result = await runtime.scheduler.computeLegs(navigation, pairs, {
        signal: options.signal,
        onProgress: (p) => {
          options.onProgress({ done: p.done, total: p.total });
        },
      });
      return { complete: result.complete };
    },
    missingLegs(pairs) {
      if (navigation === null) return 0;
      let missing = 0;
      for (const pair of pairs) if (navigation.legsNeeded(pair.from, pair.to).length > 0) missing += 1;
      return missing;
    },
    cacheKey: () => (runtime === null ? 'straight-line' : unavailableKey(runtime)),
  };
}
