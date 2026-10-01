import { describe, expect, it } from 'vitest';
import { projectId, stepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { fixedClock } from './clock';
import { createPlaceholderProject } from './placeholder-project';
import { followSelection, openingStep, rememberedStep, rememberStep, SELECTION_MEMORY_KEY, SELECTION_MEMORY_LIMIT, type SelectionStorage } from './selection-memory';
import { sequentialIdSource } from './shell-support';
import { createEditorStore } from './store';

/** The step selected when a project opens (D-050 item 2; review UI-08). */

const NOW = '2026-09-25T12:00:00.000Z';

function memoryStorage(): SelectionStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const steps = (ids: readonly string[]): RouteStep[] => ids.map((id) => ({ id: stepId(id) }) as RouteStep);

describe('the selection memory', () => {
  it('opens at the remembered step while it is in the route, else at the last step; nothing for an empty route', () => {
    expect(openingStep(steps(['a', 'b', 'c']), stepId('b'))).toBe('b');
    expect(openingStep(steps(['a', 'b', 'c']), stepId('gone'))).toBe('c');
    expect(openingStep(steps(['a', 'b', 'c']), null)).toBe('c');
    expect(openingStep([], stepId('b'))).toBeNull();
  });

  it('remembers one step per project, the most recent first, up to the limit', () => {
    const storage = memoryStorage();
    rememberStep(() => storage, projectId('p1'), stepId('a'));
    rememberStep(() => storage, projectId('p2'), stepId('x'));
    rememberStep(() => storage, projectId('p1'), stepId('b'));
    expect(rememberedStep(() => storage, projectId('p1'))).toBe('b');
    expect(rememberedStep(() => storage, projectId('p2'))).toBe('x');
    expect(rememberedStep(() => storage, projectId('p3'))).toBeNull();
    for (let i = 0; i < SELECTION_MEMORY_LIMIT + 5; i += 1) rememberStep(() => storage, projectId(`q${String(i)}`), stepId('s'));
    const record = JSON.parse(storage.items.get(SELECTION_MEMORY_KEY) ?? '{}') as { last: unknown[] };
    expect(record.last).toHaveLength(SELECTION_MEMORY_LIMIT);
    expect(rememberedStep(() => storage, projectId('p1'))).toBeNull();
  });

  it('survives storage that is absent, throws or holds something unreadable', () => {
    const throwing: SelectionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => {
      rememberStep(() => throwing, projectId('p'), stepId('a'));
    }).not.toThrow();
    expect(rememberedStep(() => throwing, projectId('p'))).toBeNull();
    expect(rememberedStep(() => null, projectId('p'))).toBeNull();
    const odd = memoryStorage();
    for (const text of ['not json', '{"v":2,"last":[["p","a"]]}', '{"v":1,"last":"x"}', '{"v":1,"last":[["p",3],["p"]]}']) {
      odd.items.set(SELECTION_MEMORY_KEY, text);
      expect(rememberedStep(() => odd, projectId('p'))).toBeNull();
    }
  });

  it('selects the opening step of each project the store opens, and remembers each focus step', () => {
    const storage = memoryStorage();
    const project = createPlaceholderProject({ nowIso: NOW });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const stop = followSelection(store, () => storage);
    const ids = project.route.steps.map((step) => step.id);
    const second = ids[1];
    if (second === undefined) throw new Error('no step');
    expect(store.getState().selection.focus).toBe(ids.at(-1));
    store.select({ kind: 'single', id: second });
    expect(rememberedStep(() => storage, project.id)).toBe(second);
    // Clearing the selection keeps the memory of the last focus.
    store.select({ kind: 'none' });
    expect(rememberedStep(() => storage, project.id)).toBe(second);
    // Another project opens at its own last step, then the first opens again at its remembered one.
    const other = { ...project, id: projectId('other'), route: { ...project.route, steps: project.route.steps.slice(0, 2) } };
    store.replaceProject(other);
    expect(store.getState().selection.focus).toBe(second);
    expect(rememberedStep(() => storage, projectId('other'))).toBe(second);
    store.replaceProject(project);
    expect(store.getState().selection.focus).toBe(second);
    stop();
    store.replaceProject(other);
    expect(store.getState().selection.focus).toBeNull();
  });
});
