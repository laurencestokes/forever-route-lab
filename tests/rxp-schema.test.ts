/**
 * Whatever a guide says, lowering produces a project the strict v1 schema accepts (docs/RXP.md §9.4,
 * §10.4, §12.3; RXP review F6, F7): numbers the model cannot hold exactly (huge UiMapIDs, instances,
 * levels, offsets, IDs) are kept as preserved notes or opaque conditions with `RXP004`, never
 * stored as values that `parseProject` would refuse when the project is reopened.
 */
import { describe, expect, it } from 'vitest';
import { sequentialIdSource } from '../src/domain/ids';
import type { ProjectV1 } from '../src/domain/project';
import { createEmptyProject } from '../src/domain/project-factory';
import { parseProjectText, serializeProject } from '../src/project';
import { importRxp } from '../src/rxp';
import { FULL_CONTEXT } from '../src/rxp/test-fixtures';

const EDGES = [
  '#forever',
  '#name Schema edges',
  '#group Forever Route Lab Fixtures',
  'step',
  '    .goto 99999999999999999999/1,1,2',
  '    .goto 1411/99999999999999999999,1,2',
  '    .goto 0/1,1,2',
  '    .goto 1411,99999999999999999999,1',
  '    .goto Durotar,1e300,-1e300,1e300',
  'step',
  '    .xp 99999999999999999999',
  '    .xp 5+99999999999999999999',
  '    .xp 10.99999999999999999999',
  '    .xp <99999999999999999999,1',
  '    .xp 10,abc',
  '    .accept -5',
  '    .acceptmultiple 0,1',
  '    .turninmultiple 2,-3',
  '    .isOnQuest -5',
  '    .turnin 99999999999999999999',
  '    .complete 788,99999999999999999999',
  '    .maxlevel 99999999999999999999',
  '    .train 99999999999999999999',
  'step << 99999999999999999999',
  '    .accept 1 << Orc/',
  'step << /',
  '    #level 99999999999999999999',
  '    .collect 4862,10,789,1152921504606846976',
  '    .accept 2 << Orc(Warrior)',
  '',
].join('\n');

function viaJson(project: ProjectV1): ProjectV1 {
  const parsed = parseProjectText(serializeProject(project));
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  return parsed.project;
}

describe('RXP lowering and the project schema', () => {
  it('lowers edge-case numbers and quest IDs to a project that the v1 schema accepts', () => {
    const result = importRxp(EDGES, sequentialIdSource(), FULL_CONTEXT);
    if (result.status !== 'ok') throw new Error('refused');
    const [guide] = result.guides;
    if (guide === undefined) throw new Error('no guide');
    const empty = createEmptyProject({ ids: sequentialIdSource(9000), nowIso: '2026-09-26T00:00:00.000Z', name: guide.import.name });
    const project: ProjectV1 = { ...empty, route: { ...empty.route, steps: guide.steps, groups: guide.groups }, imports: [guide.import] };
    const again = viaJson(project);
    expect(again.route.steps).toEqual(guide.steps);
    expect(again.route.groups).toEqual(guide.groups);
    // The unsafe values became notes and diagnostics, not model values.
    const malformed = guide.diagnostics.filter((d) => d.code === 'RXP004-malformed-number').map((d) => d.line);
    expect(malformed).toEqual([5, 6, 7, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 28]);
    const locations = guide.steps.map((step) => step.location).filter((location) => location !== null);
    expect(locations.every((location) => location.source.uiMapId === null || Number.isSafeInteger(location.source.uiMapId))).toBe(true);
  });
});
