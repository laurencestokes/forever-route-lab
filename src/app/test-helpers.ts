import {
  createEmptyProject,
  makeNoteStep,
  type ProjectV1,
  type RouteStep,
  sequentialIdSource,
  type StepId,
  stepId,
} from '../domain';

/**
 * Fixtures for the app tests. Steps are placeholder notes `Placeholder a`, `Placeholder b`, ...
 * with ids `s-a`, `s-b`, ..., so orders read as strings. Not exported from the app index.
 */

export const T0 = '2026-01-01T00:00:00.000Z';

export const sid = (letter: string): StepId => stepId(`s-${letter}`);

export const idSet = (...letters: string[]): ReadonlySet<StepId> => new Set(letters.map(sid));

export function notes(letters: string): RouteStep[] {
  return [...letters].map((letter) => makeNoteStep({ next: () => `s-${letter}` }, { text: `Placeholder ${letter}` }));
}

export function notesProject(letters: string): ProjectV1 {
  const project = createEmptyProject({ ids: sequentialIdSource(), nowIso: T0, name: 'Placeholder route' });
  return { ...project, route: { ...project.route, steps: notes(letters) } };
}

/** One character per step: a note's last letter, otherwise the first letter of its kind in upper case. */
export function order(steps: readonly RouteStep[] | ProjectV1): string {
  const list = 'route' in steps ? steps.route.steps : steps;
  return list.map((s) => (s.kind === 'note' ? s.text.slice(-1) : s.kind.charAt(0).toUpperCase())).join('');
}

/** Selected ids as sorted strings, for readable assertions. */
export const sorted = (ids: ReadonlySet<StepId>): string[] => [...ids].map(String).sort();
