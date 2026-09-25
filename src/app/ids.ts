import type { IdSource, ProjectV1 } from '../domain';

/**
 * Runtime IdSource for the app. Ids must stay unique across sessions, because a restored project
 * keeps its step ids and a counter restarting at 1 would collide with them (insertSteps throws on
 * a duplicate id). Each id is the prefix plus 64 random bits in hex: `step-3f9c0a1b2d4e5f60`.
 * `crypto.getRandomValues` works outside secure contexts too, unlike `crypto.randomUUID`.
 */
export function randomIdSource(randomBytes: (n: number) => Uint8Array = cryptoBytes): IdSource {
  return {
    next(prefix) {
      const hex = Array.from(randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
      return `${prefix}-${hex}`;
    },
  };
}

function cryptoBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Every id the project already uses: project, route, steps, groups and imports. */
export function usedIds(project: ProjectV1): Set<string> {
  const used = new Set<string>([project.id, project.route.id]);
  for (const s of project.route.steps) used.add(s.id);
  for (const key of Object.keys(project.route.groups)) used.add(key);
  for (const i of project.imports) used.add(i.id);
  return used;
}

/** A source that returns only the same id for this long is broken, not unlucky. */
const MAX_DRAWS = 1_000_000;

/**
 * Wraps `ids` so it never returns an id `project` already uses (or one it returned before),
 * drawing again instead. This keeps a counter-based source safe on a restored project. The set
 * of used ids is built on the first draw, so commands that make no ids pay nothing.
 */
export function collisionFreeIds(ids: IdSource, project: ProjectV1): IdSource {
  let taken: Set<string> | null = null;
  return {
    next(prefix) {
      taken ??= usedIds(project);
      for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
        const id = ids.next(prefix);
        if (!taken.has(id)) {
          taken.add(id);
          return id;
        }
      }
      throw new Error(`IdSource produced only ids already in use (last prefix "${prefix}")`);
    },
  };
}
