import { describe, expect, it } from 'vitest';
import {
  type ProjectV1,
  createEmptyProject,
  groupId,
  makeAcceptStep,
  makeCompleteStep,
  makeGrindStep,
  makeNoteStep,
  makeTravelStep,
  questId,
  sequentialIdSource,
  uiMapId,
  zoneSourcedPoint,
} from '../domain';
import { parseProject, parseProjectText, serializeProject } from './io';
import { formatPath } from './issues';
import { RESERVED_ID_KEYS } from './schema';

const NOW = '2026-09-25T12:00:00.000Z';

function sampleProject(): ProjectV1 {
  const ids = sequentialIdSource(1);
  const base = createEmptyProject({ ids, nowIso: NOW, name: 'Placeholder route' });
  const g = groupId('group-1');
  const location = { source: zoneSourcedPoint(uiMapId(1411), 50, 50), label: 'Placeholder location', radius: 5 };
  return {
    ...base,
    assumptions: { groupSize: 2, objectiveConcurrency: 0.25 },
    questOverrides: { '-1': { xp: { questLevel: 5, baseXp: 400, basis: 'user' }, objectiveCounts: [3], foreverStatus: null } },
    ext: { placeholder: { list: [1, 'a', null, false] } },
    route: {
      ...base.route,
      groups: { [g]: { id: g, rxp: null } },
      steps: [
        makeAcceptStep(ids, { questId: questId(-1), location, groupId: g }),
        makeCompleteStep(ids, { targets: [{ questId: questId(-1), objective: 0 }], groupId: g }),
        makeTravelStep(ids, { location, mode: 'walk' }),
        makeGrindStep(ids, { until: { kind: 'level', level: 3, offset: { kind: 'fraction', fraction: 0.5 } } }),
        makeNoteStep(ids, { text: 'Placeholder "quoted" text \\ with unicode é and a\nnewline', ext: { k: 1 } }),
      ],
    },
  };
}

/** The same value with every object's keys inserted in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  }
  return value;
}

function sortedClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedClone);
  if (value !== null && typeof value === 'object') {
    const lead = ['schemaVersion', 'id', 'kind'];
    const keys = Object.keys(value).sort((a, b) => {
      const ia = lead.indexOf(a);
      const ib = lead.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return Object.fromEntries(keys.map((k) => [k, sortedClone((value as Record<string, unknown>)[k])]));
  }
  return value;
}

function expectOk(result: ReturnType<typeof parseProject>): ProjectV1 {
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.errors)}`);
  return result.project;
}

function errorsOf(result: ReturnType<typeof parseProject>): { path: string; message: string }[] {
  if (result.ok) throw new Error('expected errors');
  return result.errors;
}

describe('serializeProject', () => {
  it('round-trips: parse(serialize(p)) equals p', () => {
    for (const project of [createEmptyProject({ ids: sequentialIdSource(), nowIso: NOW, name: 'x' }), sampleProject()]) {
      const text = serializeProject(project);
      expect(expectOk(parseProjectText(text))).toEqual(project);
    }
  });

  it('is deterministic whatever order the objects were built in', () => {
    const project = sampleProject();
    const reversed = reverseKeys(project) as ProjectV1;
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(project));
    expect(serializeProject(reversed)).toBe(serializeProject(project));
  });

  it('is idempotent through parse', () => {
    const text = serializeProject(sampleProject());
    expect(serializeProject(expectOk(parseProjectText(text)))).toBe(text);
  });

  it('writes 2-space JSON, leading keys first, LF and a trailing newline', () => {
    const project = sampleProject();
    const text = serializeProject(project);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text.startsWith('{\n  "schemaVersion": 1,\n  "id": "project-1",\n  "assumptions": {\n')).toBe(true);
    expect(text).toBe(`${JSON.stringify(sortedClone(project), null, 2)}\n`);
    expect(text).toContain('"steps": [\n      {\n        "id": "step-3",\n        "kind": "accept",');
  });

  it('keeps negative zero exact', () => {
    const base = createEmptyProject({ ids: sequentialIdSource(), nowIso: NOW, name: 'x' });
    const text = serializeProject({ ...base, ext: { z: -0 } });
    expect(text).toContain('"z": -0');
    const parsed = expectOk(parseProjectText(text));
    expect(Object.is(parsed.ext['z'], -0)).toBe(true);
  });

  it('writes empty arrays and objects compactly', () => {
    const text = serializeProject(createEmptyProject({ ids: sequentialIdSource(), nowIso: NOW, name: 'x' }));
    expect(text).toContain('"steps": []');
    expect(text).toContain('"groups": {}');
    expect(text).toContain('"assumptions": {}');
  });

  it('omits absent optional keys and refuses values JSON cannot hold exactly', () => {
    const base = createEmptyProject({ ids: sequentialIdSource(), nowIso: NOW, name: 'x' });
    const withUndefined = { ...base, ext: { gone: undefined, kept: 1 } } as unknown as ProjectV1;
    expect(serializeProject(withUndefined)).toContain('"ext": {\n    "kept": 1\n  }');
    expect(() => serializeProject({ ...base, ext: { n: Number.NaN } })).toThrow(/Cannot serialise NaN at "ext.n"/);
    expect(() => serializeProject({ ...base, ext: { n: Infinity } })).toThrow(TypeError);
    expect(() => serializeProject({ ...base, ext: { a: [1, undefined] } })).toThrow(/undefined at "ext.a\[1\]"/);
    expect(() => serializeProject({ ...base, ext: { d: new Date(0) } })).toThrow(/non-plain object/);
    expect(() => serializeProject({ ...base, ext: { b: 1n } })).toThrow(/bigint/);
    const loop: Record<string, unknown> = {};
    loop['again'] = loop;
    expect(() => serializeProject({ ...base, ext: { loop } })).toThrow(/cyclic reference at "ext.loop.again"/);
    const shared = { x: 1 };
    expect(serializeProject({ ...base, ext: { a: shared, b: [shared] } })).toContain('"b": [\n');
  });
});

describe('parseProject', () => {
  it('returns frozen values that do not alias the input', () => {
    const input = JSON.parse(serializeProject(sampleProject())) as Record<string, unknown>;
    const project = expectOk(parseProject(input));
    expect(Object.isFrozen(project)).toBe(true);
    expect(Object.isFrozen(project.route.steps)).toBe(true);
    expect(Object.isFrozen(project.route.steps[0])).toBe(true);
    (input['route'] as Record<string, unknown>)['name'] = 'changed';
    expect(project.route.name).toBe('Placeholder route');
  });

  it('accepts a step whose group is missing (validation reports it, not import)', () => {
    const project = sampleProject();
    const dangling = { ...project, route: { ...project.route, groups: {} } };
    expect(parseProject(JSON.parse(serializeProject(dangling))).ok).toBe(true);
  });

  it('accepts only canonical decimal keys for numeric-id records', () => {
    const project = sampleProject();
    const override = { xp: null, objectiveCounts: null, foreverStatus: null };
    for (const key of ['0', '-7', '123']) {
      expect(parseProject({ ...project, questOverrides: { [key]: override } }).ok).toBe(true);
    }
    for (const key of ['-0', '01', '1.5', '', ' 1', 'x']) {
      const errors = errorsOf(parseProject({ ...project, questOverrides: { [key]: override } }));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/^Invalid key .*Expected a decimal integer key$/);
    }
  });

  it('rejects an explicit undefined for an optional assumption', () => {
    const project = sampleProject();
    const input = { ...project, assumptions: { groupSize: undefined } };
    expect(errorsOf(parseProject(input))).toEqual([
      { path: 'assumptions.groupSize', message: 'Invalid input: expected number, received undefined' },
    ]);
  });

  it('rejects values that are not JSON in extension bags', () => {
    const project = sampleProject();
    const errors = errorsOf(parseProject({ ...project, ext: { f: () => 1, n: Number.NaN, ok: [1] } }));
    expect(errors).toEqual([
      { path: 'ext.f', message: 'Expected a JSON value' },
      { path: 'ext.n', message: 'Expected a JSON value' },
    ]);
  });

  it('rejects group ids and group keys that name Object.prototype members', () => {
    // The M1 review's reproduction: a step whose groupId is "toString", with no such group,
    // parsed; copy and paste then restored Object.prototype.toString as a group and every later
    // save threw. Such ids are now refused at import.
    const project = sampleProject();
    const [first, ...rest] = project.route.steps;
    if (first === undefined) throw new Error('sample has steps');
    const reserved = groupId('toString');
    const dangling = { ...project, route: { ...project.route, groups: {}, steps: [{ ...first, groupId: reserved }, ...rest] } };
    expect(errorsOf(parseProjectText(serializeProject(dangling)))).toEqual([
      { path: 'route.steps[0].groupId', message: 'Reserved id: the name of an Object.prototype member' },
    ]);
    const key = groupId('constructor');
    const keyed = { ...project, route: { ...project.route, groups: { [key]: { id: key, rxp: null } } } };
    expect(errorsOf(parseProjectText(serializeProject(keyed)))).toEqual([
      { path: 'route.groups.constructor', message: 'Invalid key "constructor": Reserved id: the name of an Object.prototype member' },
    ]);
  });

  it('lists every Object.prototype member name as reserved', () => {
    for (const name of Object.getOwnPropertyNames(Object.prototype)) expect(RESERVED_ID_KEYS.has(name), name).toBe(true);
    expect(RESERVED_ID_KEYS.has('group-1')).toBe(false);
  });

  it('rejects __proto__ keys instead of dropping them', () => {
    const text = serializeProject(sampleProject()).replace('"placeholder": {', '"__proto__": {');
    expect(errorsOf(parseProjectText(text))).toEqual([{ path: 'ext.__proto__', message: 'Reserved key "__proto__"' }]);
    const groups = serializeProject(sampleProject()).replace('"group-1": {', '"__proto__": {');
    expect(errorsOf(parseProjectText(groups))).toEqual([
      { path: 'route.groups.__proto__', message: 'Reserved key "__proto__"' },
    ]);
  });

  it('reports a cyclic value instead of recursing forever', () => {
    const project = sampleProject();
    const loop: Record<string, unknown> = { a: 1 };
    loop['self'] = loop;
    const shared = { x: 1 };
    const errors = errorsOf(parseProject({ ...project, ext: { loop, one: shared, two: shared } }));
    expect(errors).toEqual([{ path: 'ext.loop.self', message: 'Cyclic reference' }]);
  });

  it('reports range violations with their paths', () => {
    const project = sampleProject();
    const errors = errorsOf(
      parseProject({
        ...project,
        assumptions: { groupSize: 9, objectiveConcurrency: 2 },
        character: { ...project.character, startLevel: 0 },
      }),
    );
    expect(errors.map((e) => e.path)).toEqual([
      'character.startLevel',
      'assumptions.groupSize',
      'assumptions.objectiveConcurrency',
    ]);
  });

  it('points into the intended branch of the published-point union', () => {
    const project = sampleProject();
    const quest = (points: unknown[]): unknown => ({
      id: -1,
      name: 'Placeholder quest',
      level: null,
      minLevel: null,
      maxLevel: null,
      races: null,
      classes: null,
      zoneOrSort: null,
      dungeonQuest: false,
      starters: [],
      finishers: [],
      objectives: [{ kind: 'event', text: null, points }],
      objectiveHints: [],
      objectivesText: null,
      prerequisites: {
        preQuestSingle: [],
        preQuestGroup: [],
        exclusiveTo: [],
        nextQuestInChain: null,
        parentQuest: null,
        childQuests: [],
        inGroupWith: [],
        breadcrumbForQuestId: null,
        breadcrumbs: [],
        availableUntilCompleted: null,
        availableStartingWith: null,
        disabledByQuest: null,
      },
      requirements: {
        skill: null,
        minReputation: null,
        maxReputation: null,
        spell: null,
        specialization: null,
        sourceItemId: null,
        requiredSourceItems: [],
      },
      reputationReward: [],
      flags: { repeatable: false, needsEvent: false, questFlags: 0, specialFlags: 0 },
      xp: null,
      provenance: { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'custom' },
      starterLocation: null,
      finisherLocation: null,
    });
    const ok = parseProject({ ...project, customQuests: [quest([{ kind: 'instance', areaId: 1 }])] });
    expect(ok.ok).toBe(true);

    const badField = errorsOf(parseProject({ ...project, customQuests: [quest([{ kind: 'instance', areaId: 'x' }])] }));
    expect(badField).toEqual([
      {
        path: 'customQuests[0].objectives[0].points[0].areaId',
        message: 'Invalid input: expected number, received string',
      },
    ]);
    const badZone = errorsOf(parseProject({ ...project, customQuests: [quest([{ space: 'zone', uiMapId: 1 }])] }));
    expect(badZone.map((e) => e.path)).toEqual([
      'customQuests[0].objectives[0].points[0].x',
      'customQuests[0].objectives[0].points[0].y',
      'customQuests[0].objectives[0].points[0].frame',
      'customQuests[0].objectives[0].points[0].lexemes',
    ]);
    const neither = errorsOf(parseProject({ ...project, customQuests: [quest([{ shape: 'circle' }])] }));
    expect(neither).toEqual([
      {
        path: 'customQuests[0].objectives[0].points[0]',
        message: 'Expected a point with space "world" or "zone", or kind "instance" or "unmapped"',
      },
    ]);
  });

  it('rejects a wrong custom quest provenance source', () => {
    const project = sampleProject();
    const text = serializeProject(project);
    const withQuest = JSON.parse(text) as Record<string, unknown>;
    withQuest['customQuests'] = [{ provenance: { source: 'questiedb' } }];
    const errors = errorsOf(parseProject(withQuest));
    expect(errors.some((e) => e.path === 'customQuests[0].provenance.source')).toBe(true);
  });
});

describe('parseProjectText', () => {
  it('skips a byte-order mark', () => {
    const text = serializeProject(sampleProject());
    expect(parseProjectText(`${String.fromCharCode(0xfeff)}${text}`).ok).toBe(true);
  });

  it('reports JSON syntax errors at the document root', () => {
    for (const text of ['', '{', '{"schemaVersion": 1,}', 'not json']) {
      const errors = errorsOf(parseProjectText(text));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.path).toBe('');
      expect(errors[0]?.message).toMatch(/^Invalid JSON: /);
    }
  });

  it('accepts CRLF line endings (whitespace is insignificant in JSON)', () => {
    const text = serializeProject(sampleProject()).replace(/\n/g, '\r\n');
    expect(parseProjectText(text).ok).toBe(true);
  });
});

describe('formatPath', () => {
  it('formats keys, indices and awkward keys', () => {
    expect(formatPath([])).toBe('');
    expect(formatPath(['route', 'steps', 3, 'kind'])).toBe('route.steps[3].kind');
    expect(formatPath([0])).toBe('[0]');
    expect(formatPath(['route', 'groups', 'group-1', 'id'])).toBe('route.groups["group-1"].id');
    expect(formatPath(['questOverrides', '-5'])).toBe('questOverrides["-5"]');
    expect(formatPath(['a b', '$ok', '_x'])).toBe('["a b"].$ok._x');
  });
});
