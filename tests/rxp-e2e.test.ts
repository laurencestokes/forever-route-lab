/**
 * The pure end-to-end RXP test (docs/ARCHITECTURE.md §15, docs/RXP.md §13.7): fixture file bytes
 * → import (unwrap, CST, lowering) against the committed dataset and placeholder geometry → a
 * project that passes the zod schema and survives JSON round trips → export, byte-identical when
 * unedited. The engine walk and validation join this test when `src/engine` and `src/validate`
 * exist (Milestone 6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatasetView } from '../src/domain/dataset';
import { sequentialIdSource } from '../src/domain/ids';
import { createEmptyProject } from '../src/domain/project-factory';
import type { ProjectV1 } from '../src/domain/project';
import { createDatasetView, identityOf, prepareDataset } from '../src/infra/data';
import { parseProjectText, serializeProject } from '../src/project';
import { exportRxp, importRxp, type ImportedGuide, type RxpLowerContext, zoneKeyLookup } from '../src/rxp';
import { REPO_ROOT, publicSite } from './support/fake-fetch';
import { HORDE_WARRIOR, placeholderGeometry, siteFiles, siteManifest } from './support/fixture-dataset';

const SITE = publicSite();
const GEOMETRY = placeholderGeometry(SITE);
const VIEW: DatasetView = createDatasetView(prepareDataset(siteFiles(SITE), identityOf(siteManifest(SITE)), GEOMETRY), HORDE_WARRIOR);

const CONTEXT: RxpLowerContext = {
  zoneKey: zoneKeyLookup(VIEW.zones()),
  quest: (id) => {
    const quest = VIEW.quest(id);
    return quest === undefined ? null : { objectiveCount: quest.objectives.length, custom: quest.provenance.source === 'custom' };
  },
  geometry: GEOMETRY,
};

const FIXTURES = [
  '01-basic-durotar.txt',
  '02-filters-and-step-tags.txt',
  '03-lua-wrapped.txt',
  '04-edge-cases-crlf.txt',
  '05-travel-and-conditions.txt',
  '06-lowering-and-export.txt',
] as const;

const bytesOf = (name: string): Buffer => readFileSync(join(REPO_ROOT, 'tests/fixtures/rxp', name));

function projectOf(guide: ImportedGuide): ProjectV1 {
  const empty = createEmptyProject({ ids: sequentialIdSource(9000), nowIso: '2026-09-26T00:00:00.000Z', name: guide.import.name });
  return { ...empty, route: { ...empty.route, steps: guide.steps, groups: guide.groups }, imports: [guide.import] };
}

function viaJson(project: ProjectV1): ProjectV1 {
  const parsed = parseProjectText(serializeProject(project));
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  return parsed.project;
}

describe('RXP end to end: fixture → import → project → export', () => {
  it('reads the fixtures byte for byte, as committed copies of docs/research/rxp-samples', () => {
    for (const name of FIXTURES) expect(bytesOf(name).equals(readFileSync(join(REPO_ROOT, 'docs/research/rxp-samples', name))), name).toBe(true);
    const crlf = bytesOf('04-edge-cases-crlf.txt').toString('latin1');
    expect(crlf.split('\r\n')).toHaveLength(113);
    expect(crlf.endsWith('\n')).toBe(false);
  });

  it.each(FIXTURES)('%s: unedited import exports byte-identical after a project JSON round trip', (name) => {
    const bytes = bytesOf(name);
    const result = importRxp(bytes.toString('utf8'), sequentialIdSource(), CONTEXT);
    if (result.status !== 'ok') throw new Error('refused');
    expect(result.guides.length).toBe(name.startsWith('03') ? 4 : 1);
    for (const guide of result.guides) {
      const project = viaJson(projectOf(guide));
      expect(project.route.steps).toEqual(guide.steps);
      const exported = exportRxp(project.route, project.imports, { zoneKey: CONTEXT.zoneKey, geometry: GEOMETRY });
      if (!exported.ok) throw new Error(exported.errors.map((e) => e.message).join('; '));
      if (result.source === 'raw') expect(Buffer.from(exported.text, 'utf8').equals(bytes)).toBe(true);
      else expect(exported.text).toBe(guide.import.text);
      expect(exported.unedited).toBe(true);
    }
  });

  it('reports the dataset and geometry diagnostics of fixture 06 against the committed data', () => {
    const result = importRxp(bytesOf('06-lowering-and-export.txt').toString('utf8'), sequentialIdSource(), CONTEXT);
    if (result.status !== 'ok') throw new Error('refused');
    expect(result.guides[0]?.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual([
      '23 RXP030-frame-ambiguous',
      '24 RXP030-frame-ambiguous',
      '25 RXP030-frame-ambiguous',
      '29 RXP036-pseudo-zone-unconverted',
      '37 RXP034-not-simulated',
      '40 RXP031-objective-out-of-range',
      '47 RXP032-objective-unchecked',
      '85 RXP034-not-simulated',
    ]);
  });

  it('resolves every imported location of fixtures 01 and 06 in the committed geometry', () => {
    for (const name of ['01-basic-durotar.txt', '06-lowering-and-export.txt']) {
      const result = importRxp(bytesOf(name).toString('utf8'), sequentialIdSource(), CONTEXT);
      if (result.status !== 'ok') throw new Error('refused');
      for (const step of result.guides[0]?.steps ?? []) {
        if (step.location === null) continue;
        const { uiMapId } = step.location.source;
        expect(uiMapId === null || GEOMETRY.maps.has(uiMapId), `${name} ${step.id}`).toBe(true);
      }
    }
  });

  it('exports an edited project and re-imports it to the same steps', () => {
    const result = importRxp(bytesOf('01-basic-durotar.txt').toString('utf8'), sequentialIdSource(), CONTEXT);
    if (result.status !== 'ok') throw new Error('refused');
    const [guide] = result.guides;
    if (guide === undefined) throw new Error('no guide');
    const project = viaJson(projectOf(guide));
    const edited = project.route.steps.filter((step) => !(step.kind === 'accept' && step.questId === 4402));
    const exported = exportRxp({ ...project.route, steps: edited }, project.imports, { zoneKey: CONTEXT.zoneKey, geometry: GEOMETRY });
    if (!exported.ok) throw new Error('export failed');
    expect(exported.unedited).toBe(false);
    const again = importRxp(exported.text, sequentialIdSource(), CONTEXT);
    if (again.status !== 'ok') throw new Error('refused');
    const kinds = (steps: readonly { readonly kind: string }[]): string[] => steps.map((step) => step.kind);
    expect(kinds(again.guides[0]?.steps ?? [])).toEqual(kinds(edited));
    expect(again.guides[0]?.steps.map((step) => ('questId' in step ? step.questId : null))).toEqual(edited.map((step) => ('questId' in step ? step.questId : null)));
  });
});
