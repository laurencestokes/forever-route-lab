import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture03 from '../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import fixture06 from '../../tests/fixtures/rxp/06-lowering-and-export.txt?raw';
import { fixturePrepared, fixtureView, placeholderGeometry } from '../../tests/support/fixture-dataset';
import { createEmptyProject, defaultCharacter, type ProjectV1, questId, sequentialIdSource } from '../domain';
import { parseProjectText, serializeProject } from '../project';
import { exportRxp } from '../rxp';
import { fixedClock } from './clock';
import { preparedDatasetSource } from './dataset-source';
import { buildCustomQuest } from './project-commands';
import { createRxpContext } from './rxp-context';
import {
  applyRxpImport,
  guideNameFromFileName,
  newProjectViewInput,
  placeholderCustomQuest,
  previewRxpImport,
  questIdsOfStep,
  type RxpImportRequest,
  rxpImportCommand,
  rxpImportContext,
  rxpImportProject,
} from './rxp-import';
import { createEditorStore } from './store';

const T0 = '2026-09-26T00:00:00.000Z';
const GEOMETRY = placeholderGeometry();
const VIEW = fixtureView();
const CTX = createRxpContext(VIEW, GEOMETRY);
const request = (input: string, fileName: string | null = null): RxpImportRequest => ({ input, fileName, frame: 'forever' });
const emptyProject = (): ProjectV1 => createEmptyProject({ ids: sequentialIdSource(500), nowIso: T0, name: 'My route' });

/** A shape of RestedXP's protected strings (docs/RXP.md §3.3): a count, a hash and `:`; not a real one. */
const PROTECTED_SHAPED = '3|-1234567:AbCdEfGhIjKlMnOpQrStUvWx%';

function viaJson(project: ProjectV1): ProjectV1 {
  const parsed = parseProjectText(serializeProject(project));
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  return parsed.project;
}

describe('previewRxpImport', () => {
  it('checks raw text: one guide, its sizes and diagnostics, and no unknown quest (fixture 01 on the Durotar slice)', () => {
    const preview = previewRxpImport(request(fixture01), CTX);
    if (preview.status !== 'ok') throw new Error('refused');
    expect(preview.source).toBe('raw');
    expect(preview.guides).toHaveLength(1);
    const [guide] = preview.guides;
    expect(guide?.name).toBe('1-4 Valley of Trials (fixture)');
    expect(guide?.rxpSteps).toBe(18);
    expect(guide?.steps).toBeGreaterThan(18);
    expect(guide?.diagnostics.every((d) => d.importId === guide.importId && d.line >= 0)).toBe(true);
    expect(preview.unknownQuests).toEqual([]);
  });

  it('lists the quests the data lacks with the line of their first use (fixture 06: the synthetic quest 900001)', () => {
    const preview = previewRxpImport(request(fixture06), CTX);
    if (preview.status !== 'ok') throw new Error('refused');
    const unknown = preview.unknownQuests.find((quest) => quest.questId === questId(900001));
    expect(unknown).toBeDefined();
    expect(unknown?.guides).toEqual([0]);
    const lines = fixture06.split(/\r\n|\r|\n/);
    const line = lines[(unknown?.line ?? 0) - 1] ?? '';
    expect(line).toContain('900001');
    // Every other quest the fixture names is in the slice or reported too; none is both.
    for (const quest of preview.unknownQuests) expect(VIEW.quest(quest.questId)).toBeUndefined();
  });

  it('reads several guides from a Lua file, with lines of the file (fixture 03)', () => {
    const preview = previewRxpImport(request(fixture03, 'Fixture.lua'), CTX);
    if (preview.status !== 'ok') throw new Error('refused');
    expect(preview.source).toBe('lua');
    expect(preview.guides.map((guide) => guide.name)).toEqual(['6-8 Fixture Three', '6-8 Fixture Three (Alt)', '8-9 Fixture Four', '9-10 Fixture Quoted']);
    expect(preview.diagnostics.map((d) => d.code)).toContain('RXP020-lua-dynamic');
    const fileLines = fixture03.split(/\r\n|\r|\n/);
    for (const quest of preview.unknownQuests) {
      if (quest.line === 0) continue;
      expect(fileLines[quest.line - 1]).toContain(String(quest.questId));
    }
  });

  it('refuses a protected import string without repeating it', () => {
    const preview = previewRxpImport(request(PROTECTED_SHAPED), CTX);
    expect(preview.status).toBe('refused');
    if (preview.status !== 'refused') return;
    expect(preview.diagnostics.map((d) => d.code)).toEqual(['RXP019-protected-format']);
    expect(preview.message).toContain('protected import string');
    expect(preview.message).not.toContain('AbCdEf');
  });
});

describe('rxpImportCommand', () => {
  it('adds the guide at the end of the route as one undo entry, keeping the text in imports', () => {
    const base = emptyProject();
    const store = createEditorStore({ project: base, ids: sequentialIdSource(1), clock: fixedClock(T0) });
    const before = store.getState().project.route.steps.length;
    store.dispatch(rxpImportCommand(request(fixture01), { guides: 'all', unknownQuests: 'placeholder' }, CTX));
    const after = store.getState();
    expect(after.revision).toBe(1);
    expect(after.history.undoLabel).toBe('Import RXP guide');
    expect(after.history.undoDepth).toBe(1);
    expect(after.project.imports).toHaveLength(1);
    expect(after.project.imports[0]?.text).toBe(fixture01);
    const added = after.project.route.steps.slice(before);
    expect(added.length).toBeGreaterThan(18);
    expect(added.every((step) => step.origin.source === 'rxp' && step.groupId !== null)).toBe(true);
    // The new steps are selected (the store selects inserted steps).
    expect(after.selection.stepIds.size).toBe(added.length);
    store.undo();
    expect(store.getState().project.route.steps).toHaveLength(before);
    expect(store.getState().project.imports).toEqual([]);
  });

  it('appends after the steps already there, with ids that collide with none of them', () => {
    const first = applyRxpImport(emptyProject(), request(fixture01), { guides: 'all', unknownQuests: 'warn' }, CTX, sequentialIdSource(1));
    if (first === null) throw new Error('nothing imported');
    const store = createEditorStore({ project: first.project, ids: sequentialIdSource(1), clock: fixedClock(T0) });
    store.dispatch(rxpImportCommand(request(fixture01), { guides: 'all', unknownQuests: 'warn' }, CTX));
    const { project } = store.getState();
    expect(project.route.steps).toHaveLength(first.project.route.steps.length * 2);
    expect(new Set(project.route.steps.map((step) => step.id)).size).toBe(project.route.steps.length);
    expect(project.imports.map((imp) => imp.id)).toHaveLength(2);
    expect(new Set(project.imports.map((imp) => imp.id)).size).toBe(2);
    expect(project.route.steps.slice(0, first.stepIds.length).map((s) => s.id)).toEqual(first.stepIds);
  });

  it('adds nothing for a refused input, so the store records no change', () => {
    const store = createEditorStore({ project: emptyProject(), ids: sequentialIdSource(1), clock: fixedClock(T0) });
    store.dispatch(rxpImportCommand(request(PROTECTED_SHAPED), { guides: 'all', unknownQuests: 'placeholder' }, CTX));
    expect(store.getState().revision).toBe(0);
  });
});

describe('applyRxpImport', () => {
  it('adds a placeholder custom quest for each quest the data lacks, or leaves them unknown', () => {
    const withPlaceholders = applyRxpImport(emptyProject(), request(fixture06), { guides: 'all', unknownQuests: 'placeholder' }, CTX, sequentialIdSource(1));
    const warned = applyRxpImport(emptyProject(), request(fixture06), { guides: 'all', unknownQuests: 'warn' }, CTX, sequentialIdSource(1));
    if (withPlaceholders === null || warned === null) throw new Error('nothing imported');
    expect(withPlaceholders.placeholders).toContain(questId(900001));
    expect(withPlaceholders.unknown).toEqual([]);
    expect(withPlaceholders.project.customQuests.map((quest) => quest.id)).toEqual(withPlaceholders.placeholders);
    expect(warned.placeholders).toEqual([]);
    expect(warned.unknown).toEqual(withPlaceholders.placeholders);
    expect(warned.project.customQuests).toEqual([]);
    // Placeholders are ascending and unique.
    expect([...withPlaceholders.placeholders].sort((a, b) => a - b)).toEqual(withPlaceholders.placeholders);
  });

  it('makes no placeholder for a quest the project already has as a custom quest', () => {
    const custom = buildCustomQuest(
      { id: questId(900001), name: 'My quest', level: 5, minLevel: null, baseXp: null, foreverStatus: 'unknown', starterLocation: null, finisherLocation: null },
      null,
    );
    const project = { ...emptyProject(), customQuests: [custom] };
    const applied = applyRxpImport(project, request(fixture06), { guides: 'all', unknownQuests: 'placeholder' }, CTX, sequentialIdSource(1));
    expect(applied?.placeholders).not.toContain(questId(900001));
    expect(applied?.project.customQuests.filter((quest) => quest.id === questId(900001))).toEqual([custom]);
  });

  it('imports only the chosen guides of a Lua file', () => {
    const applied = applyRxpImport(emptyProject(), request(fixture03, 'Fixture.lua'), { guides: [1, 3], unknownQuests: 'warn' }, CTX, sequentialIdSource(1));
    expect(applied?.guides.map((guide) => guide.import.name)).toEqual(['6-8 Fixture Three (Alt)', '9-10 Fixture Quoted']);
    expect(applied?.project.imports.map((imp) => imp.name)).toEqual(['6-8 Fixture Three (Alt)', '9-10 Fixture Quoted']);
    expect(applyRxpImport(emptyProject(), request(fixture03), { guides: [], unknownQuests: 'warn' }, CTX, sequentialIdSource(1))).toBeNull();
  });

  it('is deterministic: the same input and ids give the same project', () => {
    const a = applyRxpImport(emptyProject(), request(fixture06), { guides: 'all', unknownQuests: 'placeholder' }, CTX, sequentialIdSource(7));
    const b = applyRxpImport(emptyProject(), request(fixture06), { guides: 'all', unknownQuests: 'placeholder' }, CTX, sequentialIdSource(7));
    expect(a?.project).toEqual(b?.project);
  });

  it('honours the frame option (Era-framed percent points on the four changed maps)', () => {
    const forever = applyRxpImport(emptyProject(), request(fixture06), { guides: 'all', unknownQuests: 'warn' }, CTX, sequentialIdSource(1));
    const era = applyRxpImport(emptyProject(), { ...request(fixture06), frame: 'era' }, { guides: 'all', unknownQuests: 'warn' }, CTX, sequentialIdSource(1));
    expect(forever?.project.imports[0]?.options.changedZoneFrame).toBe('forever');
    expect(era?.project.imports[0]?.options.changedZoneFrame).toBe('era');
    const frames = (project: ProjectV1 | undefined) =>
      (project?.route.steps ?? []).flatMap((step) => (step.location?.source.space === 'zone' ? [step.location.source.frame] : []));
    expect(frames(era?.project)).toContain('era');
    expect(frames(forever?.project)).not.toContain('era');
  });
});

describe('rxpImportProject', () => {
  it('builds a new project named after the guide on the loaded data, which passes the schema and exports byte-identical', () => {
    const built = rxpImportProject(request(fixture01), { guides: 'all', unknownQuests: 'placeholder' }, CTX, {
      identity: VIEW.identity,
      ids: sequentialIdSource(1),
      nowIso: T0,
    });
    if (built === null) throw new Error('nothing imported');
    expect(built.name).toBe('1-4 Valley of Trials (fixture)');
    expect(built.project.route.name).toBe(built.name);
    expect(built.project.dataRevision).toBe(VIEW.identity.dataRevision);
    expect(built.project.gameBuild).toBe(VIEW.identity.frameBuild);
    expect(built.project.character).toEqual(defaultCharacter());
    const project = viaJson(built.project);
    const exported = exportRxp(project.route, project.imports, CTX.export);
    if (!exported.ok) throw new Error(exported.errors.map((e) => e.message).join('; '));
    expect(exported.unedited).toBe(true);
    expect(exported.text).toBe(fixture01);
  });

  it('names a project of several guides after the file', () => {
    const built = rxpImportProject(request(fixture03, 'Horde-guides.lua'), { guides: 'all', unknownQuests: 'warn' }, CTX, { identity: VIEW.identity, nowIso: T0 });
    expect(built?.name).toBe('Horde-guides');
    expect(built?.project.imports).toHaveLength(4);
    const one = rxpImportProject(request(fixture03, 'Horde-guides.lua'), { guides: [2], unknownQuests: 'warn' }, CTX, { identity: VIEW.identity, nowIso: T0 });
    expect(one?.name).toBe('8-9 Fixture Four');
  });
});

describe('placeholders and helpers', () => {
  it('a placeholder quest knows its id and nothing else', () => {
    const quest = placeholderCustomQuest(questId(76156));
    expect(quest.id).toBe(76156);
    expect(quest.name).toBe('Quest 76156 (placeholder from an RXP guide)');
    expect([quest.level, quest.minLevel, quest.xp, quest.starterLocation, quest.finisherLocation]).toEqual([null, null, null, null, null]);
    expect([quest.starters, quest.finishers, quest.objectives]).toEqual([[], [], []]);
    expect(quest.provenance).toMatchObject({ source: 'custom', foreverStatus: 'unknown' });
  });

  it('names a guide after its file', () => {
    expect(guideNameFromFileName('C:\\guides\\Horde-01_Durotar.lua')).toBe('Horde-01_Durotar');
    expect(guideNameFromFileName('notes.TXT')).toBe('notes');
    expect(guideNameFromFileName('.lua')).toBeNull();
    expect(guideNameFromFileName(null)).toBeNull();
  });

  it('knows which quests a step is about', () => {
    const applied = applyRxpImport(emptyProject(), request(fixture01), { guides: 'all', unknownQuests: 'warn' }, CTX, sequentialIdSource(1));
    const ids = new Set((applied?.project.route.steps ?? []).flatMap((step) => questIdsOfStep(step)));
    expect([...ids].sort((a, b) => a - b)).toEqual([788, 789, 790, 792, 4402, 4641]);
  });
});

describe('rxpImportContext', () => {
  it('checks a new project against the data alone, and an append against the open project', () => {
    const data = preparedDatasetSource(fixturePrepared());
    const custom = buildCustomQuest(
      { id: questId(900001), name: 'Mine', level: null, minLevel: null, baseXp: null, foreverStatus: 'unknown', starterLocation: null, finisherLocation: null },
      null,
    );
    const open = data.view({ ...newProjectViewInput(), customQuests: [custom] });
    const append = rxpImportContext('append', { dataset: open, data, geometry: null });
    const fresh = rxpImportContext('new-project', { dataset: open, data, geometry: null });
    expect(append.questFacts(questId(900001))).toEqual({ objectiveCount: 0, custom: true });
    expect(fresh.questFacts(questId(900001))).toBeNull();
    // Without the loaded dataset the open project's view stands in.
    expect(rxpImportContext('new-project', { dataset: open, data: null, geometry: null }).questFacts(questId(900001))).not.toBeNull();
  });
});
