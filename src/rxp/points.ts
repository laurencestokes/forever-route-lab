import { type UiMapId, uiMapId, worldMapId } from '../domain/ids';
import type { SourcedPoint } from '../domain/points';
import { ERA_CHANGED_UIMAP_IDS } from '../geo/era';
import { parseLuaNumber } from './numbers';

/**
 * The zone argument of `.goto` and the other location commands (docs/RXP.md §10.1, §10.4), and
 * the `SourcedPoint` it yields. Zone keys resolve through the injected, QuestieDB-derived key
 * table (§10.3); RXP's own zone table is never used (D-019).
 */

/** English zone key → UiMapID, exact and case-sensitive (RXP table lookups are). */
export type ZoneKeyLookup = (name: string) => UiMapId | null;

/** Self-authored pseudo-zone keys (§10.3, §10.4): the `…Classic` maps are read unchanged. */
const PSEUDO_CLASSIC: Readonly<Record<string, number>> = { StormwindClassic: 1453, EPLClassic: 1423 };
/** RXP converts these with coefficients this project does not have (§10.4): no point, `RXP036`. */
const PSEUDO_NEW: readonly string[] = ['StormwindNew', 'EPLNew'];

export type ZoneArgument =
  | { readonly kind: 'key'; readonly name: string; readonly uiMapId: UiMapId }
  | { readonly kind: 'uiMap'; readonly uiMapId: UiMapId }
  | { readonly kind: 'world'; readonly uiMapId: UiMapId; readonly mapId: number }
  | { readonly kind: 'pseudo'; readonly name: string; readonly uiMapId: UiMapId }
  | { readonly kind: 'pseudoNew'; readonly name: string }
  /** A number that cannot be a UiMapID: the zone is missing (`RXP003`). */
  | { readonly kind: 'number' }
  /** `UiMapID/instance` with a UiMapID that is not a positive safe integer, or an instance that is not a safe integer (`RXP004`, §10.4). */
  | { readonly kind: 'badWorld'; readonly text: string }
  | { readonly kind: 'unknownKey'; readonly name: string };

export function parseZoneArgument(argument: string, zoneKey: ZoneKeyLookup): ZoneArgument {
  const world = /^(\d+)\/(\d+)$/.exec(argument);
  if (world !== null) {
    const ui = Number(world[1]);
    const instance = Number(world[2]);
    return Number.isSafeInteger(ui) && ui > 0 && Number.isSafeInteger(instance) ? { kind: 'world', uiMapId: uiMapId(ui), mapId: instance } : { kind: 'badWorld', text: argument };
  }
  const number = parseLuaNumber(argument);
  if (number !== null) return Number.isSafeInteger(number) && number > 0 ? { kind: 'uiMap', uiMapId: uiMapId(number) } : { kind: 'number' };
  const pseudo = PSEUDO_CLASSIC[argument];
  if (pseudo !== undefined && Object.hasOwn(PSEUDO_CLASSIC, argument)) return { kind: 'pseudo', name: argument, uiMapId: uiMapId(pseudo) };
  if (PSEUDO_NEW.includes(argument)) return { kind: 'pseudoNew', name: argument };
  const id = zoneKey(argument);
  return id === null ? { kind: 'unknownKey', name: argument } : { kind: 'key', name: argument, uiMapId: id };
}

/** True for the four UiMaps whose frame differs between Era and Forever (§10.4). */
export const isFrameChangedUiMap = (id: UiMapId): boolean => ERA_CHANGED_UIMAP_IDS.includes(id);

export type PointProblem =
  | { readonly code: 'RXP003-goto-missing-zone'; readonly message: string; readonly arg: number }
  | { readonly code: 'RXP004-malformed-number'; readonly message: string; readonly arg: number }
  | { readonly code: 'RXP009-localized-zone-name'; readonly message: string; readonly arg: number }
  | { readonly code: 'RXP036-pseudo-zone-unconverted'; readonly message: string; readonly arg: number };

export interface ParsedPoint {
  readonly point: SourcedPoint | null;
  readonly zone: ZoneArgument | null;
  readonly problem: PointProblem | null;
  /** The point is a percent point on a frame-changed UiMap (`RXP030`). */
  readonly frameAmbiguous: boolean;
}

/**
 * Reads `zone,x,y` from the first three arguments. `frame` is `options.changedZoneFrame`, used
 * only on the four frame-changed UiMaps. Lexemes keep the number strings in source order.
 */
export function parsePointArguments(args: readonly string[], zoneKey: ZoneKeyLookup, frame: 'forever' | 'era'): ParsedPoint {
  const [zoneText, first, second] = args;
  const fail = (problem: PointProblem, zone: ZoneArgument | null = null): ParsedPoint => ({ point: null, zone, problem, frameAmbiguous: false });
  if (zoneText === undefined) return fail({ code: 'RXP003-goto-missing-zone', message: 'No zone and no coordinates.', arg: 0 });
  const zone = parseZoneArgument(zoneText, zoneKey);
  if (zone.kind === 'number' || (parseLuaNumber(zoneText) !== null && second === undefined && zone.kind !== 'world')) {
    return fail(
      { code: 'RXP003-goto-missing-zone', message: `The first argument "${zoneText}" is a number, so RXP reads it as the zone and drops the line. Write the zone first (a zone name, a UiMapID or UiMapID/instance).`, arg: 0 },
      zone,
    );
  }
  if (zone.kind === 'badWorld') {
    return fail(
      {
        code: 'RXP004-malformed-number',
        message: `"${zone.text}" names no map: the UiMapID before "/" must be a positive whole number and the instance after it a whole number, small enough to be stored exactly; no point is stored.`,
        arg: 0,
      },
      zone,
    );
  }
  if (zone.kind === 'unknownKey') {
    return fail(
      { code: 'RXP009-localized-zone-name', message: `"${zone.name}" is not an English zone key or UiMapID; RXP only knows English zone keys, so it would drop the line.`, arg: 0 },
      zone,
    );
  }
  if (first === undefined || second === undefined) {
    return fail({ code: 'RXP004-malformed-number', message: 'A coordinate is missing: RXP needs two numbers after the zone.', arg: first === undefined ? 1 : 2 }, zone);
  }
  const a = parseLuaNumber(first);
  const b = parseLuaNumber(second);
  if (a === null || b === null) {
    const bad = a === null ? first : second;
    return fail({ code: 'RXP004-malformed-number', message: `RXP cannot read "${bad}" as a number, so it drops the line; no point is stored.`, arg: a === null ? 1 : 2 }, zone);
  }
  if (zone.kind === 'pseudoNew') {
    return fail(
      { code: 'RXP036-pseudo-zone-unconverted', message: `"${zone.name}" points are converted by RXP with coefficients this project does not have; the line is kept for export but gives no location.`, arg: 0 },
      zone,
    );
  }
  const lexemes: readonly [string, string] = [first, second];
  if (zone.kind === 'world') {
    // HereBeDragons order: the first number is world Y, the second world X (§10.1).
    return { point: { space: 'world', mapId: worldMapId(zone.mapId), x: b, y: a, uiMapId: zone.uiMapId, lexemes }, zone, problem: null, frameAmbiguous: false };
  }
  const id = zone.uiMapId;
  const ambiguous = isFrameChangedUiMap(id);
  return {
    point: { space: 'zone', uiMapId: id, x: a, y: b, frame: ambiguous ? frame : 'forever', lexemes },
    zone,
    problem: null,
    frameAmbiguous: ambiguous,
  };
}
