// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fixture01 from '../../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture03 from '../../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import { fixturePrepared, fixtureView } from '../../../tests/support/fixture-dataset';
import { createEditorStore, deleteSelected, fixedClock } from '../../app';
import { preparedDatasetSource } from '../../app/dataset-source';
import type { DownloadFile } from '../../app/persistence';
import { createTestSession, settle, type TestSession } from '../../app/persistence-test-helpers';
import * as rxpTools from '../../app/rxp-tools';
import { createSampleProject, SAMPLE_ROUTE_NOTICE } from '../../app/sample-route';
import { sequentialIdSource } from '../../app/shell-support';
import { notesProject } from '../../app/test-helpers';
import type { ProjectV1 } from '../../domain/project';
import { App } from '../App';
import { loadDetailsPanel } from './lazy';
import { ProjectSessionProvider, useProjectSessionState } from './ProjectMenuContext';
import { RxpExportDialog } from './RxpExportDialog';

// The dialogs are lazy parts (ui-refresh.md §10.3) that production builds preload when idle; so do these tests.
beforeAll(async () => {
  await loadDetailsPanel();
});

afterEach(() => {
  cleanup();
});

const T0 = '2026-09-26T00:00:00.000Z';
const data = preparedDatasetSource(fixturePrepared());
const VIEW = fixtureView();
const loadTools = () => Promise.resolve(rxpTools);
const TITLE = 'Export RXP custom guide';
const GUIDE_01 = '1-4 Valley of Trials (fixture)';

function importedProject(input: string, fileName: string | null = null): ProjectV1 {
  const ctx = rxpTools.createRxpContext(VIEW, null);
  const built = rxpTools.rxpImportProject({ input, fileName, frame: 'forever' }, { guides: 'all', unknownQuests: 'warn' }, ctx, {
    identity: VIEW.identity,
    ids: sequentialIdSource(1),
    nowIso: T0,
  });
  if (built === null) throw new Error('nothing imported');
  return built.project;
}

async function setup(project: ProjectV1, opts: { readonly copyText?: (text: string) => Promise<void>; readonly copiedStatusMs?: number } = {}) {
  const store = createEditorStore({ project, ids: sequentialIdSource(9000), clock: fixedClock(T0) });
  const announce = vi.fn<(message: string) => void>();
  const download = vi.fn<(file: DownloadFile) => void>();
  const copyText = vi.fn(opts.copyText ?? (() => Promise.resolve()));
  const utils = render(
    <RxpExportDialog
      open
      onClose={vi.fn()}
      store={store}
      dataset={VIEW}
      projectName="Project"
      announce={announce}
      download={download}
      copyText={copyText}
      loadTools={loadTools}
      copiedStatusMs={opts.copiedStatusMs}
    />,
  );
  await act(async () => {
    await settle();
  });
  const dialog = screen.getByRole('dialog', { name: TITLE });
  return { store, announce, download, copyText, dialog, utils };
}

const preview = (dialog: HTMLElement) => within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: /^Preview of / });

describe('Export RXP custom guide', () => {
  it('says an unedited import comes back byte for byte, previews it and downloads it as .txt or .lua', async () => {
    const s = await setup(importedProject(fixture01));
    expect(s.dialog.textContent).toContain(`Byte-identical to the imported guide “${GUIDE_01}”`);
    expect(preview(s.dialog).value).toBe(fixture01);
    const download = within(s.dialog).getByRole('button', { name: `Download ${GUIDE_01}.txt` });
    fireEvent.click(download);
    expect(s.download).toHaveBeenCalledWith({ fileName: `${GUIDE_01}.txt`, text: fixture01, mimeType: 'text/plain' });
    expect(s.announce).toHaveBeenLastCalledWith(`Exported “${GUIDE_01}.txt”.`);

    fireEvent.click(within(s.dialog).getByRole('radio', { name: 'Custom-guide addon file (.lua)' }));
    expect(preview(s.dialog).value.startsWith('RXPGuides.RegisterGuide([[\n')).toBe(true);
    expect(s.dialog.textContent).toContain('The file wraps it in RXPGuides.RegisterGuide(…).');
    fireEvent.click(within(s.dialog).getByRole('button', { name: `Download ${GUIDE_01}.lua` }));
    expect(s.download.mock.calls[1]?.[0].fileName).toBe(`${GUIDE_01}.lua`);
  });

  it('copies the previewed text, says so visibly for a moment, and selects it when the browser refuses', async () => {
    const s = await setup(importedProject(fixture01), { copiedStatusMs: 30 });
    await act(async () => {
      fireEvent.click(within(s.dialog).getByRole('button', { name: 'Copy' }));
      await settle();
    });
    expect(s.copyText).toHaveBeenCalledWith(fixture01);
    expect(s.announce).toHaveBeenLastCalledWith('Copied the guide text to the clipboard.');
    // A visible, transient status beside Copy (UI-F2); the announcement is what is heard.
    const status = s.dialog.querySelector('.frl-rxp__copied');
    expect(status?.textContent).toBe('Copied');
    expect(status?.getAttribute('aria-hidden')).toBe('true');
    await waitFor(() => {
      expect(s.dialog.querySelector('.frl-rxp__copied')).toBeNull();
    });
    cleanup();

    const refused = await setup(importedProject(fixture01), { copyText: () => Promise.reject(new Error("Failed to execute 'writeText' on 'Clipboard': Write permission denied.")) });
    await act(async () => {
      fireEvent.click(within(refused.dialog).getByRole('button', { name: 'Copy' }));
      await settle();
    });
    // The browser's own error text is not shown (UI-F20).
    expect(refused.announce).toHaveBeenLastCalledWith('The browser did not allow copying. The preview is selected: press Ctrl+C to copy it.');
    expect(refused.dialog.textContent).not.toContain('writeText');
    expect(refused.dialog.querySelector('.frl-rxp__copied')).toBeNull();
    expect(document.activeElement).toBe(preview(refused.dialog));
  });

  it('says the text is rewritten once the route changed, and lists what the export cannot keep', async () => {
    const project = importedProject(fixture01);
    const first = project.route.steps[0];
    if (first === undefined) throw new Error('no steps');
    const store = createEditorStore({ project, ids: sequentialIdSource(9000), clock: fixedClock(T0) });
    store.dispatch(deleteSelected(new Set([first.id])));
    const s = await setup(store.getState().project);
    expect(s.dialog.textContent).toContain('Not byte-identical to an imported guide');
    expect(s.dialog.textContent).toContain('RXP steps left unedited keep their original lines; edited, split and new steps are written in canonical form.');
    expect(preview(s.dialog).value).not.toBe(fixture01);
    const notes = within(s.dialog).getByRole('heading', { name: 'What the export cannot keep' }).closest('section') as HTMLElement;
    expect(notes.textContent).toMatch(/RXP04\d-|Nothing: every step/);
  });

  it('shows an export diagnostic’s line in the imported guide', async () => {
    // Deleting the step of a line with a trailing comment drops the comment (RXP045, on that line).
    const project = importedProject(fixture01);
    const step = project.route.steps.find((candidate) => candidate.kind === 'complete' && candidate.targets.some((target) => target.questId === 788));
    if (step === undefined) throw new Error('no complete step for 788');
    const s = await setup({ ...project, route: { ...project.route, steps: project.route.steps.filter((candidate) => candidate !== step) } });
    const notes = within(s.dialog).getByRole('heading', { name: 'What the export cannot keep' }).closest('section') as HTMLElement;
    const item = within(notes).getByRole('button', { name: /RXP045-comment-dropped/ });
    const line = step.rxp?.line?.firstLine ?? 0;
    expect(item.textContent).toContain(`Line ${String(line)}, column 1`);
    fireEvent.click(item);
    const excerpt = document.getElementById(item.getAttribute('aria-controls') ?? '');
    expect(excerpt?.getAttribute('aria-label')).toBe(`Line ${String(line)}, column 1 of the imported guide “${GUIDE_01}”`);
    expect(excerpt?.querySelector('.frl-rxpsource__line.is-target')?.textContent).toContain('.complete 788,1 --objective 1 of quest 788');
  });

  it('keeps the first guide’s header when a route holds several guides, and says so', async () => {
    const s = await setup(importedProject(fixture03, 'Fixture.lua'));
    expect(s.dialog.textContent).toContain('Not byte-identical to an imported guide: the route changed since its 4 guides were imported');
    const notes = within(s.dialog).getByRole('heading', { name: 'What the export cannot keep' }).closest('section') as HTMLElement;
    expect(notes.textContent).toContain('RXP043-header');
  });

  it('names what cannot be exported and offers nothing to download then', async () => {
    // A route of the app's own with no name: no "#name" header can be written.
    const notes = notesProject('ab');
    const s = await setup({ ...notes, route: { ...notes.route, name: '' } });
    await waitFor(() => {
      expect(s.dialog.textContent).toContain('This route cannot be exported as an RXP guide:');
    });
    expect(s.dialog.textContent).toMatch(/The route: the route has no name/);
    const download = within(s.dialog).getByRole('button', { name: 'Download' });
    expect(download.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(download);
    expect(s.download).not.toHaveBeenCalled();
    expect(within(s.dialog).queryByRole('textbox', { name: /^Preview of / })).toBeNull();
  });
});

function Harness({ t }: { readonly t: TestSession }) {
  const state = useProjectSessionState(t.session);
  return (
    <ProjectSessionProvider session={t.session}>
      <App
        store={t.store}
        data={data}
        projectName={state?.current.name ?? ''}
        routeNotice={state?.current.sample === true ? SAMPLE_ROUTE_NOTICE : null}
        version="0.0.0-test"
        sourceCommit={null}
      />
    </ProjectSessionProvider>
  );
}

describe('the top bar', () => {
  it('opens the RXP export from the Export dialog, replacing it', async () => {
    const t = await createTestSession({ data, createSample: (nowIso) => createSampleProject({ dataset: fixtureView(), nowIso }) });
    render(<Harness t={t} />);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Project actions' })).getByRole('button', { name: 'Export' }));
    const exportDialog = screen.getByRole('dialog', { name: 'Export' });
    fireEvent.click(within(within(exportDialog).getByRole('region', { name: 'RXP custom guide' })).getByRole('button', { name: TITLE }));
    expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull();
    // The dialog loads on first use (CR-19): "Loading…" under its title first.
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy();
    // The RXP code loads on demand (a dynamic import); the sample route came from no guide.
    await waitFor(
      () => {
        expect(within(screen.getByRole('dialog', { name: TITLE })).getByRole('heading', { name: 'What is exported' })).toBeTruthy();
      },
      { timeout: 10_000 },
    );
  }, 15_000);
});
