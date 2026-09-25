import { describe, expect, it } from 'vitest';
import { groupId, type IdSource, sequentialIdSource } from '../domain';
import { collisionFreeIds, randomIdSource, usedIds } from './ids';
import { notesProject } from './test-helpers';

describe('randomIdSource', () => {
  it('formats the prefix and 64 bits of hex from the byte source', () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 17);
    expect(randomIdSource(bytes).next('step')).toBe('step-0011223344556677');
  });

  it('uses crypto by default and does not repeat', () => {
    const ids = randomIdSource();
    const drawn = new Set(Array.from({ length: 1000 }, () => ids.next('group')));
    expect(drawn.size).toBe(1000);
    for (const id of drawn) expect(id).toMatch(/^group-[0-9a-f]{16}$/);
  });
});

describe('collisionFreeIds', () => {
  it('skips ids the project already uses', () => {
    const base = notesProject('ab');
    const project = {
      ...base,
      route: {
        ...base.route,
        steps: base.route.steps.map((s, i) => ({ ...s, id: `step-${i + 1}` as typeof s.id })),
        groups: { 'group-5': { id: groupId('group-5'), rxp: null } },
      },
    };
    expect([...usedIds(project)].sort()).toEqual(['group-5', 'project-1', 'route-2', 'step-1', 'step-2'].sort());
    const ids = collisionFreeIds(sequentialIdSource(), project);
    expect([ids.next('step'), ids.next('step'), ids.next('group')]).toEqual(['step-3', 'step-4', 'group-6']);
  });

  it('never returns the same id twice', () => {
    const repeating: IdSource = { next: (prefix) => `${prefix}-x` };
    const ids = collisionFreeIds(repeating, notesProject('a'));
    expect(ids.next('step')).toBe('step-x');
    expect(() => ids.next('step')).toThrow(/already in use/);
  });

  it('builds the used set lazily', () => {
    let reads = 0;
    const base = notesProject('a');
    const project = new Proxy(base, {
      get(target, key, receiver) {
        if (key === 'route') reads += 1;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    collisionFreeIds(sequentialIdSource(), project);
    expect(reads).toBe(0);
  });
});
