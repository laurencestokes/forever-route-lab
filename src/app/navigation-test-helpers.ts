import { estimate, unknownEstimate } from '../domain/estimate';
import { worldMapId } from '../domain/ids';
import type { TravelEndpoint, TravelModel } from '../domain/travel';
import { TILE_YD } from '../nav/grid';
import type { NavManifest } from '../nav/manifest';
import type { NavLegResult } from '../nav/worker/protocol';
import type { NavTimers } from './navigation-scheduler';

/**
 * Test doubles for the navigation app files (navigation-*.test.ts): a manifest listing maps
 * without blocks, a straight-line fallback, endpoints, worker results and manual timers. Not used
 * by application code.
 */

export const TEST_NAV_REVISION = 'ab'.repeat(32);

/** A manifest that lists `mapIds` (no blocks: the app files never read them). */
export function testNavManifest(mapIds: readonly number[] = [1], passages: readonly string[] = ['undercity-west-tunnel']): NavManifest {
  const cs = TILE_YD / 1024;
  return {
    navRevision: TEST_NAV_REVISION,
    params: { cs, ch: 0.25, tileVoxels: 256, tileYd: cs * 256, perAdt: 4, blockAdts: 4, mapOriginZ: 0, climbYd: 1.5, snapRadiusYd: 6, ruleBMinPolygons: 20, longSwimYd: 200 },
    connectors: [],
    passages,
    maps: mapIds.map((mapId) => ({
      mapId,
      name: `Map ${String(mapId)}`,
      polygons: 0,
      components: 0,
      mapFile: { path: `${String(mapId)}/map.bin`, bytes: 0, sha256: TEST_NAV_REVISION },
      blocks: [],
      hintRollup: new Map([[363, 14]]),
    })),
  };
}

export const endpoint = (mapId: number, x: number, y: number, zoneHint = 0): TravelEndpoint => ({ point: { mapId: worldMapId(mapId), x, y }, zoneHint });

/** The labelled straight-line fallback as src/rules defines it: distance × detour / ground speed, basis assumption. */
export function straightLineModel(detour = 1.25): TravelModel {
  return {
    id: 'straight-line',
    revision: 'straight-line',
    leg(from, to, speeds) {
      if (from.point.mapId !== to.point.mapId) return { seconds: unknownEstimate(), method: 'straight-line', pending: false, warnings: [] };
      const dx = to.point.x - from.point.x;
      const dy = to.point.y - from.point.y;
      return { seconds: estimate((Math.sqrt(dx * dx + dy * dy) * detour) / speeds.groundYps, 'assumption'), method: 'straight-line', pending: false, warnings: [] };
    },
    path: () => null,
  };
}

/** A walkable worker result. */
export function walkable(groundTenths: number, extra: Partial<NavLegResult> = {}): NavLegResult {
  return {
    reachable: true,
    reason: 'ok',
    groundTenths,
    swimTenths: 0,
    connectorTenthsSeconds: 0,
    longestSwimYd: 0,
    flags: [],
    passages: [],
    from: { snapped: true, ambiguous: false },
    to: { snapped: true, ambiguous: false },
    ...extra,
  };
}

/** A result with no walking path between two snapped endpoints. */
export const otherComponent = (): NavLegResult => ({ ...walkable(0), reachable: false, reason: 'other-component' });

/** A result whose ends did not snap. */
export const unsnapped = (from: boolean, to: boolean): NavLegResult => ({ ...walkable(0), reachable: false, reason: 'unsnapped', from: { snapped: !from, ambiguous: false }, to: { snapped: !to, ambiguous: false } });

/** Timers that run only when the test advances time. */
export class ManualTimers implements NavTimers {
  now = 0;
  private nextId = 1;
  private readonly queue: { id: number; at: number; callback: () => void }[] = [];

  set(callback: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.queue.push({ id, at: this.now + ms, callback });
    return id;
  }

  clear(handle: unknown): void {
    const i = this.queue.findIndex((t) => t.id === handle);
    if (i >= 0) this.queue.splice(i, 1);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Runs every timer due within `ms`, in time order (timers they set included), and moves the clock. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.queue.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.queue.splice(this.queue.indexOf(due), 1);
      this.now = due.at;
      due.callback();
    }
    this.now = end;
  }
}
