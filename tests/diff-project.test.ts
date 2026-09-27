import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupId, type ProjectV1, questId, type RouteGroup, type RouteStep, sequentialIdSource, stepId } from '../src/domain';
import { makeAcceptStep, makeNoteStep, makeTurnInStep } from '../src/domain/step-factory';
import { applyRouteChangeSets, diffRoute, type DiffOptions, type RouteDiff, semanticStepKey } from '../src/diff';
import { pick, seeded, shuffled } from '../src/diff/test-helpers';
import { parseProject, parseProjectText, serializeProject } from '../src/project';

/**
 * The route diff against the project schema (docs/ARCHITECTURE.md §8.2, §13): applying any
 * selection of change-sets to a valid project's route gives a project the schema accepts, with
 * every set the `after` project and with none the `before` one. The base is the rich fixture
 * (every step kind and every sidecar, with RXP groups).
 */

const RICH = join(import.meta.dirname, 'fixtures', 'projects', 'valid-rich.json');

function richProject(): ProjectV1 {
  const parsed = parseProjectText(readFileSync(RICH, 'utf8').replace(/\r\n/g, '\n'));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.project;
}

function valid(project: ProjectV1): ProjectV1 {
  const parsed = parseProject(JSON.parse(serializeProject(project)) as unknown);
  if (!parsed.ok) throw new Error(`invalid project: ${JSON.stringify(parsed.errors, null, 2)}`);
  return parsed.project;
}

const withSteps = (project: ProjectV1, steps: readonly RouteStep[], groups = project.route.groups): ProjectV1 => ({
  ...project,
  route: { ...project.route, steps: [...steps], groups },
});

/** The variants of the rich route: reordered, edited (steps and groups), and re-imported under new ids. */
function variants(base: ProjectV1): { readonly name: string; readonly after: ProjectV1; readonly options: DiffOptions }[] {
  const steps = base.route.steps;
  const ids = sequentialIdSource(7000);
  const group1 = base.route.groups['group-1'] as RouteGroup;
  const g9 = groupId('group-9');
  const added: RouteGroup = { ...group1, id: g9, rxp: group1.rxp === null ? null : { ...group1.rxp, stepIndex: 9, fingerprint: '9'.repeat(64) } };
  const edited: RouteStep[] = steps
    .filter((s) => s.id !== stepId('step-103') && s.id !== stepId('step-110'))
    .map((s) => (s.id === stepId('step-104') ? { ...s, note: 'edited', locked: !s.locked } : s));
  const moved = edited.splice(2, 3);
  edited.splice(8, 0, ...moved);
  edited.splice(5, 0, makeAcceptStep(ids, { questId: questId(-77), groupId: g9 }), makeNoteStep(ids, { text: 'inserted' }));
  edited.push(makeTurnInStep(ids, { questId: questId(-77), groupId: g9 }));
  const groups: Record<string, RouteGroup> = {};
  for (const [key, group] of Object.entries(base.route.groups)) {
    if (key === 'group-2') continue;
    groups[key] = key === 'group-1' && group.rxp !== null ? { ...group, rxp: { ...group.rxp, fingerprint: 'a'.repeat(64) } } : group;
  }
  groups[g9] = added;
  const reimported = steps.map((s) => ({ ...s, id: stepId(`new-${s.id}`) }));
  return [
    { name: 'reversed', after: withSteps(base, [...steps].reverse()), options: {} },
    { name: 'shuffled', after: withSteps(base, shuffled(steps, seeded(7))), options: {} },
    { name: 'edited steps and groups', after: withSteps(base, edited, groups), options: {} },
    { name: 're-imported under new ids', after: withSteps(base, shuffled(reimported, seeded(8))), options: { semanticKey: semanticStepKey } },
  ];
}

const everySet = (diff: RouteDiff): Set<string> => new Set(diff.changeSets.map((set) => set.id));

describe('route diff and the project schema', () => {
  const base = richProject();

  it.each(variants(base).map((v) => [v.name, v] as const))('%s: every selection gives a valid project; all gives after, none gives before', (_, variant) => {
    const after = valid(variant.after);
    const diff = diffRoute(base.route, after.route, variant.options);
    expect(diff.ops.length).toBeGreaterThan(0);
    const applyTo = (selected: ReadonlySet<string>): ProjectV1 => valid({ ...base, route: applyRouteChangeSets(base.route, diff, selected) });
    expect(serializeProject(applyTo(everySet(diff)))).toBe(serializeProject(after));
    expect(serializeProject(applyTo(new Set()))).toBe(serializeProject(base));
    const next = seeded(variant.name.length);
    for (let trial = 0; trial < 50; trial += 1) {
      const selected = new Set(diff.changeSets.filter(() => pick(next, 2) === 0).map((set) => set.id));
      const once = applyTo(selected);
      // Deterministic and idempotent.
      expect(serializeProject(applyTo(selected))).toBe(serializeProject(once));
      expect(serializeProject(valid({ ...once, route: applyRouteChangeSets(once.route, diff, selected) }))).toBe(serializeProject(once));
      // Step ids stay unique (the schema checks it), and every step comes from before or after.
      const known = new Set([...base.route.steps, ...after.route.steps].map((s) => s.id));
      expect(once.route.steps.every((s) => known.has(s.id))).toBe(true);
    }
  });

  it('the edited variant links its changes: the inserted quest needs its new group, and removing group-2 removes its step', () => {
    const variant = variants(base).find((v) => v.name === 'edited steps and groups');
    if (variant === undefined) throw new Error('missing variant');
    const diff = diffRoute(base.route, variant.after.route);
    const set = (id: string) => diff.changeSets.find((s) => s.id === id);
    expect(set('q:-77')?.requires).toEqual(['g:group-9']);
    const removal = set('g:group-2');
    expect(removal?.requires.length).toBe(1);
    const needed = diff.changeSets.find((s) => s.id === removal?.requires[0]);
    expect(needed?.ops.map((k) => diff.ops[k])).toContainEqual({ kind: 'remove', stepId: 'step-103', beforeIndex: 3 });
    const applied = applyRouteChangeSets(base.route, diff, new Set(['q:-77']));
    expect(Object.keys(applied.groups)).toContain('group-9');
    expect(valid({ ...base, route: applied }).route.steps.filter((s) => s.groupId === groupId('group-9'))).toHaveLength(2);
  });
});
