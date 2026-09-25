/**
 * Wall-clock time for the app shell. Pure modules never read the clock; the store stamps
 * `project.updatedAt` and passes `nowIso` to commands through the CommandContext.
 */
export interface Clock {
  /** The current time as an ISO-8601 UTC string (`Date.prototype.toISOString` format). */
  nowIso(): string;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};

/** A clock that always reads `iso`. */
export function fixedClock(iso: string): Clock {
  return { nowIso: () => iso };
}

/** A clock that only moves when told to, for tests of time-dependent behaviour (coalescing). */
export interface ManualClock extends Clock {
  advance(ms: number): void;
  set(iso: string): void;
}

export function manualClock(startIso = '2026-01-01T00:00:00.000Z'): ManualClock {
  const start = parseIsoMs(startIso);
  if (start === null) throw new RangeError(`Not an ISO timestamp: ${startIso}`);
  let ms = start;
  return {
    nowIso: () => new Date(ms).toISOString(),
    advance(delta) {
      ms += delta;
    },
    set(iso) {
      const next = parseIsoMs(iso);
      if (next === null) throw new RangeError(`Not an ISO timestamp: ${iso}`);
      ms = next;
    },
  };
}

/** Milliseconds since the epoch, or null when `iso` does not parse. */
export function parseIsoMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
