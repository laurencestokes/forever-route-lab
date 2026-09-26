import type { RouteStep, RxpGroupData } from '../domain/route';
import { sha256Hex } from './sha256';

/**
 * Group fingerprints (docs/RXP.md §13.2): the SHA-256 of the canonical JSON of a group's RXP
 * content. Equal fingerprints mean "unedited", so an unedited group or import exports from its
 * original lines, byte for byte.
 */

/** JSON with object keys in code-unit order and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return 'null';
}

/** StepBase fields: excluded from the payload (the RXP-relevant ones are added back below). */
const BASE_KEYS: ReadonlySet<string> = new Set(['id', 'location', 'note', 'locked', 'groupId', 'condition', 'durationOverride', 'origin', 'rxp', 'ext']);

/**
 * The RXP content of one step: `kind` and the kind's payload, `location.source` and
 * `location.radius`, `condition`, `rxp.text` and `rxp.line`. Step id, lock, note, duration
 * override, origin, ext and `location.label` have no RXP form and are left out.
 */
export function stepRxpContent(step: RouteStep): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) if (!BASE_KEYS.has(key)) out[key] = value;
  out['location'] = step.location === null ? null : { source: step.location.source, radius: step.location.radius };
  out['condition'] = step.condition;
  out['rxp'] = step.rxp === null ? null : { text: step.rxp.text, line: step.rxp.line };
  return out;
}

export type GroupContent = Omit<RxpGroupData, 'fingerprint'>;

export function groupContent(rxp: RxpGroupData): GroupContent {
  return { importId: rxp.importId, stepIndex: rxp.stepIndex, tags: rxp.tags, condition: rxp.condition, waypoints: rxp.waypoints, annotations: rxp.annotations };
}

/** The canonical JSON a group's fingerprint hashes: the sidecar without its fingerprint, and its steps in route order. */
export function groupContentJson(content: GroupContent, steps: readonly RouteStep[]): string {
  return canonicalJson({ group: groupContent({ ...content, fingerprint: '' }), steps: steps.map(stepRxpContent) });
}

/** The fingerprint of a group sidecar (without its fingerprint) and its steps in route order. */
export function groupFingerprint(content: GroupContent, steps: readonly RouteStep[]): string {
  return sha256Hex(groupContentJson(content, steps));
}
