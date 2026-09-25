import { describe, expect, it } from 'vitest';
import { STEP_KINDS, type RouteStep } from '../domain';
import { parseProject, serializeProject } from '../project';
import { createPlaceholderProject, createPlaceholderWorkspace, PLACEHOLDER_ROUTE_NAME } from './placeholder-project';
import { stepQuestIds } from './shell-support';

const NOW = '2026-09-25T12:00:00.000Z';
const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
const steps = project.route.steps;

const kindsOf = (list: readonly RouteStep[]): Set<string> => new Set(list.map((s) => s.kind));

describe('placeholder project', () => {
  it('has about forty steps covering the common step kinds', () => {
    expect(steps.length).toBeGreaterThanOrEqual(36);
    expect(steps.length).toBeLessThanOrEqual(44);
    const kinds = kindsOf(steps);
    for (const kind of ['accept', 'complete', 'turnin', 'travel', 'grind', 'hearth', 'flight', 'note'] as const) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    for (const kind of kinds) expect(STEP_KINDS).toContain(kind);
  });

  it('has exactly one locked step and one group that its steps reference, contiguously', () => {
    expect(steps.filter((s) => s.locked)).toHaveLength(1);
    const groupKeys = Object.keys(project.route.groups);
    expect(groupKeys).toHaveLength(1);
    const members = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.groupId !== null);
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(new Set(members.map(({ s }) => s.groupId))).toEqual(new Set(groupKeys));
    const indices = members.map(({ i }) => i);
    expect(indices).toEqual(indices.map((_, k) => (indices[0] ?? 0) + k));
  });

  it('refers only to quests in the placeholder dataset', () => {
    const referenced = steps.flatMap(stepQuestIds);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(dataset.quest(id), String(id)).toBeDefined();
  });

  it('is labelled as placeholder content', () => {
    expect(project.route.name).toBe(PLACEHOLDER_ROUTE_NAME);
    expect(project.route.description).toMatch(/Placeholder/);
    expect(project.dataRevision).toBe(dataset.identity.dataRevision);
    for (const s of steps) if (s.kind === 'note') expect(s.text).toMatch(/placeholder/i);
  });

  it('uses the factories: manual origin, unique ids, stamped with the given time', () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) expect(s.origin).toEqual({ source: 'manual', ref: null });
    expect(project.createdAt).toBe(NOW);
    expect(project.updatedAt).toBe(NOW);
  });

  it('passes the project schema and round-trips through serialisation', () => {
    const parsed = parseProject(JSON.parse(serializeProject(project)) as unknown);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    if (parsed.ok) expect(serializeProject(parsed.project)).toBe(serializeProject(project));
  });

  it('is deterministic', () => {
    expect(createPlaceholderProject({ nowIso: NOW })).toEqual(project);
  });
});
