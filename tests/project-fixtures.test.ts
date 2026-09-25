import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ProjectV1, STEP_KINDS } from '../src/domain';
import { parseProjectText, serializeProject } from '../src/project';

/**
 * Project fixtures (docs/ARCHITECTURE.md §15). Every value in them is a labelled placeholder with
 * invented (negative) ids; none of it is game data. The valid fixtures are stored in canonical
 * form, so re-serialising them must reproduce the file byte for byte.
 */
const DIR = join(import.meta.dirname, 'fixtures', 'projects');

const read = (name: string): string => readFileSync(join(DIR, name), 'utf8').replace(/\r\n/g, '\n');

function parseOk(name: string): ProjectV1 {
  const result = parseProjectText(read(name));
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors, null, 2)}`);
  return result.project;
}

function parseErrors(name: string): { path: string; message: string }[] {
  const result = parseProjectText(read(name));
  if (result.ok) throw new Error(`${name} parsed, but it is malformed`);
  return result.errors;
}

describe('valid project fixtures', () => {
  it.each(['valid-minimal.json', 'valid-rich.json'])('%s parses and re-serialises byte for byte', (name) => {
    const text = read(name);
    const project = parseOk(name);
    expect(serializeProject(project)).toBe(text);
    // Serialise → parse gives an equal project.
    const again = parseProjectText(serializeProject(project));
    expect(again).toEqual({ ok: true, project });
  });

  it('valid-rich covers every step kind and every sidecar', () => {
    const project = parseOk('valid-rich.json');
    const kinds = new Set(project.route.steps.map((s) => s.kind));
    expect([...kinds].sort()).toEqual([...STEP_KINDS].sort());

    const groups = Object.values(project.route.groups);
    const rxp = groups.find((g) => g.rxp !== null)?.rxp;
    expect(rxp?.tags.length).toBeGreaterThan(0);
    expect(rxp?.waypoints.map((w) => w.role).sort()).toEqual(['closest', 'leg', 'pin']);
    expect(rxp?.annotations.length).toBeGreaterThan(0);
    expect(rxp?.condition?.skipIf.map((p) => p.kind).sort()).toEqual(['levelAtLeast', 'opaque', 'questState']);
    expect(groups.some((g) => g.rxp === null)).toBe(true);

    const filterKinds = new Set<string>();
    const walk = (f: unknown): void => {
      if (f === null || typeof f !== 'object') return;
      const node = f as { kind?: string; expr?: unknown; exprs?: unknown[] };
      if (typeof node.kind === 'string') filterKinds.add(node.kind);
      walk(node.expr);
      node.exprs?.forEach(walk);
    };
    for (const s of project.route.steps) walk(s.condition?.filter ?? null);
    expect([...filterKinds].sort()).toEqual(['and', 'minLevel', 'not', 'or', 'word']);

    const objectiveKinds = new Set(project.customQuests.flatMap((q) => q.objectives.map((o) => o.kind)));
    expect([...objectiveKinds].sort()).toEqual(['event', 'item', 'kill', 'killCredit', 'object', 'reputation', 'spell']);
    expect(Object.keys(project.assumptions).length).toBe(19);
    expect(Object.keys(project.questOverrides).length).toBeGreaterThan(0);
    expect(project.imports.some((i) => i.options.lua !== null)).toBe(true);
    expect(Object.keys(project.ext).length).toBeGreaterThan(0);
  });

  it('labels every name as a placeholder', () => {
    const project = parseOk('valid-rich.json');
    for (const quest of project.customQuests) {
      expect(quest.name).toMatch(/^Placeholder/);
      expect(quest.id).toBeLessThan(0);
    }
    expect(project.route.name).toMatch(/^Placeholder/);
    expect(project.route.description).toMatch(/Not real quest data/);
  });

  it('keeps Skyborne-sized race masks exact', () => {
    const project = parseOk('valid-rich.json');
    expect(project.customQuests[0]?.races).toBe(4294967373);
  });
});

describe('malformed project fixtures', () => {
  it('every malformed fixture is rejected', () => {
    const names = readdirSync(DIR).filter((n) => n.startsWith('malformed-'));
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) expect(parseErrors(name).length).toBeGreaterThan(0);
  });

  it('newer schema version', () => {
    expect(parseErrors('malformed-schema-version-newer.json')).toEqual([
      { path: 'schemaVersion', message: 'Project schemaVersion 2 is newer than this app supports (1)' },
    ]);
  });

  it('schema version of the wrong type', () => {
    expect(parseErrors('malformed-schema-version-string.json')).toEqual([
      { path: 'schemaVersion', message: 'Expected schemaVersion to be a positive integer, received "1"' },
    ]);
  });

  it('missing schema version', () => {
    expect(parseErrors('malformed-schema-version-missing.json')).toEqual([
      { path: 'schemaVersion', message: 'Missing schemaVersion' },
    ]);
  });

  it('not an object', () => {
    expect(parseErrors('malformed-not-an-object.json')).toEqual([
      { path: '', message: 'Expected a project object, received array' },
    ]);
  });

  it('missing fields', () => {
    const errors = parseErrors('malformed-missing-field.json');
    expect(errors.map((e) => e.path)).toEqual(['route.name', 'character']);
    for (const e of errors) expect(e.message).toMatch(/received undefined/);
  });

  it('bad step kind', () => {
    const errors = parseErrors('malformed-bad-step-kind.json');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('route.steps[4].kind');
    expect(errors[0]?.message).toMatch(/'accept' \| 'complete'/);
  });

  it('wrong types, each at its own path', () => {
    expect(parseErrors('malformed-wrong-types.json').map((e) => e.path)).toEqual([
      'createdAt',
      'route.steps[0].locked',
      'route.steps[0].questId',
      'route.steps[1].targets',
      'character.startLevel',
      'character.riding',
      'customQuests',
      'questOverrides.abc',
    ]);
  });

  it('unknown keys are errors, not dropped', () => {
    expect(parseErrors('malformed-unknown-key.json')).toEqual([
      { path: 'route.steps[0].colour', message: 'Unrecognized key' },
      { path: 'notes', message: 'Unrecognized key' },
    ]);
  });

  it('duplicate step ids and mismatched group keys', () => {
    expect(parseErrors('malformed-integrity.json')).toEqual([
      { path: 'route.steps[2].id', message: 'Duplicate step id "step-100"' },
      { path: 'route.groups["group-2"].id', message: 'Group id "group-other" does not match its key "group-2"' },
    ]);
  });
});
