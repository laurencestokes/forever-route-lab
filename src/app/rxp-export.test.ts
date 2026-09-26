import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture03 from '../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import fixture04 from '../../tests/fixtures/rxp/04-edge-cases-crlf.txt?raw';
import { fixtureView, placeholderGeometry } from '../../tests/support/fixture-dataset';
import { createEmptyProject, makeNoteStep, type ProjectV1, questId, sequentialIdSource } from '../domain';
import { exportRxp, wrapLua } from '../rxp';
import { fixedClock } from './clock';
import { deleteSelected, insertNote } from './commands';
import { addQuestSteps } from './quest-steps';
import { createRxpContext } from './rxp-context';
import { previewRxpExport, routeImports, rxpFileName } from './rxp-export';
import { rxpImportProject } from './rxp-import';
import { createEditorStore } from './store';

const T0 = '2026-09-26T00:00:00.000Z';
const VIEW = fixtureView();
const CTX = createRxpContext(VIEW, placeholderGeometry());

function imported(input: string, fileName: string | null = null): ProjectV1 {
  const built = rxpImportProject({ input, fileName, frame: 'forever' }, { guides: 'all', unknownQuests: 'warn' }, CTX, {
    identity: VIEW.identity,
    ids: sequentialIdSource(1),
    nowIso: T0,
  });
  if (built === null) throw new Error('nothing imported');
  return built.project;
}

describe('previewRxpExport', () => {
  it('gives an unedited import back byte for byte, and says so', () => {
    const project = imported(fixture01);
    const preview = previewRxpExport(project, CTX, 'Project');
    expect(preview.mode).toBe('identical');
    expect(preview.identicalTo?.id).toBe(project.imports[0]?.id);
    expect(preview.txt.text).toBe(fixture01);
    expect(preview.txt.file).toEqual({ fileName: '1-4 Valley of Trials (fixture).txt', text: fixture01, mimeType: 'text/plain' });
    expect(preview.lua.text?.startsWith('RXPGuides.RegisterGuide([[\n')).toBe(true);
    expect(preview.lua.text).toContain(fixture01);
    expect(preview.lua.file?.fileName).toBe('1-4 Valley of Trials (fixture).lua');
    expect(preview.txt.problems).toEqual([]);
  });

  it('keeps CRLF line endings and the missing final newline of an unedited guide (fixture 04)', () => {
    const preview = previewRxpExport(imported(fixture04), CTX, 'Project');
    expect(preview.mode).toBe('identical');
    expect(preview.txt.text).toBe(fixture04);
    expect(preview.txt.text?.includes('\r\n')).toBe(true);
  });

  it('says the text was rewritten after an edit, and lists what the export cannot keep', () => {
    const project = imported(fixture01);
    const store = createEditorStore({ project, ids: sequentialIdSource(9000), clock: fixedClock(T0) });
    const first = project.route.steps[0];
    if (first === undefined) throw new Error('no steps');
    store.dispatch(deleteSelected(new Set([first.id])));
    store.dispatch(insertNote({ text: 'A note made here' }, 3));
    const preview = previewRxpExport(store.getState().project, CTX, 'Project');
    expect(preview.mode).toBe('rewritten');
    expect(preview.identicalTo).toBeNull();
    expect(preview.sources.map((imp) => imp.id)).toEqual([project.imports[0]?.id]);
    expect(preview.txt.text).not.toBe(fixture01);
    expect(preview.txt.text).toContain('A note made here');
    expect(preview.txt.diagnostics.every((d) => d.code.startsWith('RXP04'))).toBe(true);
  });

  it('writes a route that holds no imported step in canonical form', () => {
    const empty = createEmptyProject({ ids: sequentialIdSource(1), nowIso: T0, name: 'Own route' });
    const project: ProjectV1 = { ...empty, route: { ...empty.route, steps: [makeNoteStep(sequentialIdSource(50), { text: 'Start here' })] } };
    const preview = previewRxpExport(project, CTX, 'Project');
    expect(preview.mode).toBe('canonical');
    expect(preview.txt.text).toContain('#name Own route');
    expect(preview.txt.diagnostics.map((d) => d.code)).toContain('RXP043-header');
    expect(preview.txt.file?.fileName).toBe('Own route.txt');
  });

  it('names the step that cannot be exported, and exports nothing then', () => {
    const empty = createEmptyProject({ ids: sequentialIdSource(1), nowIso: T0, name: '' });
    const project: ProjectV1 = { ...empty, route: { ...empty.route, steps: [makeNoteStep(sequentialIdSource(50), { text: 'x' })] } };
    const preview = previewRxpExport(project, CTX, 'Project name');
    expect(preview.txt.text).toBeNull();
    expect(preview.txt.file).toBeNull();
    expect(preview.txt.problems.length).toBeGreaterThan(0);
    expect(preview.txt.problems[0]?.message).toMatch(/no name/);
  });

  it('exports a quest added in the editor: "all objectives" becomes one .complete per objective, or a note when the count is unknown', () => {
    const empty = createEmptyProject({ ids: sequentialIdSource(1), nowIso: T0, name: 'Editor route' });
    const store = createEditorStore({ project: empty, ids: sequentialIdSource(9000), clock: fixedClock(T0) });
    const options = { dataset: VIEW, geometry: placeholderGeometry() };
    // Encroachment (837) has four objectives in the fixture data; Your Place In The World (4641) has none.
    store.dispatch(addQuestSteps(questId(837), ['accept', 'complete', 'turnin'], options));
    store.dispatch(addQuestSteps(questId(4641), ['complete'], options));
    const project = store.getState().project;
    expect(project.route.steps.filter((s) => s.kind === 'complete').map((s) => (s.kind === 'complete' ? s.targets : []))).toEqual([
      [{ questId: 837, objective: null }],
      [{ questId: 4641, objective: null }],
    ]);
    const preview = previewRxpExport(project, CTX, 'Project');
    expect(preview.mode).toBe('canonical');
    expect(preview.txt.problems).toEqual([]);
    const text = preview.txt.text ?? '';
    expect(text).toContain('    .complete 837,1\n    .complete 837,2\n    .complete 837,3\n    .complete 837,4\n');
    expect(text).toContain('    >> (not representable in RXP) complete: a target means all objectives of a quest whose objective count is not known\n');
    expect(preview.txt.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['RXP042-unrepresentable-step', 'RXP041-app-fields-not-exported']));
    expect(preview.txt.diagnostics.find((d) => d.code === 'RXP041-app-fields-not-exported')?.message).toContain('"all objectives" target written as one .complete per objective × 1');
    expect(preview.lua.problems).toEqual([]);
  });

  it('builds the .lua form by wrapping the .txt text of one export (docs/RXP.md §13.4 rule 14)', () => {
    for (const project of [imported(fixture01), imported(fixture03, 'Fixture.lua')]) {
      const preview = previewRxpExport(project, CTX, 'Project');
      const sources = routeImports(project);
      expect(preview.lua.text).toBe(wrapLua(preview.txt.text ?? '', sources[0]?.options.lua ?? null));
      expect(preview.lua.diagnostics).toEqual(preview.txt.diagnostics.filter((d) => d.code !== 'RXP046-wrapper-args'));
      const direct = exportRxp(project.route, project.imports, { ...CTX.export, quest: CTX.questFacts }, { wrapper: 'lua' });
      expect(direct.ok ? direct.text : null).toBe(preview.lua.text);
    }
  });

  it('lists the imports a route holds, in route order, each once', () => {
    const project = imported(fixture03, 'Fixture.lua');
    expect(routeImports(project).map((imp) => imp.name)).toEqual(project.imports.map((imp) => imp.name));
    expect(previewRxpExport(project, CTX, 'Fixture').mode).toBe('rewritten');
  });
});

describe('rxpFileName', () => {
  it('replaces characters file systems refuse and adds the extension', () => {
    expect(rxpFileName('1-4: Valley / Trials?', 'txt')).toBe('1-4 - Valley - Trials.txt');
    expect(rxpFileName('   ', 'lua')).toBe('project.lua');
  });
});
