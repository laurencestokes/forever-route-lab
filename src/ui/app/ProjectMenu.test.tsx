// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixturePrepared, fixtureView } from '../../../tests/support/fixture-dataset';
import { insertNote } from '../../app/commands';
import { preparedDatasetSource } from '../../app/dataset-source';
import type { DownloadFile, SaveStatus } from '../../app/persistence';
import { createMemoryProjectStorage, createTestSession, settle, testTabs, type TestSession, type TestSessionOptions } from '../../app/persistence-test-helpers';
import { createSampleProject, SAMPLE_PROJECT_NAME, SAMPLE_ROUTE_NOTICE } from '../../app/sample-route';
import { App } from '../App';
import { downloadFile, ExportDialog, ImportDialog } from './ImportExport';
import { describeSave, failureAnnouncementKey, formatSavedTime } from './ProjectMenu';
import { ProjectSessionProvider, useProjectSessionState } from './ProjectMenuContext';

afterEach(() => {
  cleanup();
});

const data = preparedDatasetSource(fixturePrepared());
const createSample = (nowIso: string) => createSampleProject({ dataset: fixtureView(), nowIso });
const SAVED_AT = '2026-09-25T12:00:00.000Z';

/** The shell as src/main.tsx composes it: the project name and sample notice follow the session. */
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

async function setup(extra: Partial<TestSessionOptions> = {}): Promise<TestSession> {
  const t = await createTestSession({ data, createSample, ...extra });
  render(<Harness t={t} />);
  return t;
}

const bar = () => screen.getByRole('region', { name: 'Project storage' });
const projectsButton = () => within(bar()).getByRole('button', { name: 'Projects' });
const describedBy = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
/** The live region that is heard now: the top-most open dialog's, else the shell's (UI review F2). */
const liveRegion = (): Element | null => [...document.querySelectorAll('dialog[open] .frl-dialog-live')].at(-1) ?? document.querySelector('.frl-app-live');
const announced = () => liveRegion()?.textContent.replace(/\u00a0$/, '') ?? '';
const menu = () => screen.getByRole('dialog', { name: 'Projects' });
const topBarText = () => document.querySelector('.frl-topbar')?.textContent ?? '';

async function autosave(t: TestSession) {
  await act(async () => {
    t.host.advance(100);
    t.host.idle();
    await settle();
  });
}

describe('describeSave', () => {
  it('words every status honestly', () => {
    const now = new Date(SAVED_AT);
    const at = formatSavedTime(SAVED_AT, now);
    expect(at).toMatch(/^\d{2}:\d{2}$/);
    expect(describeSave({ kind: 'saved', at: SAVED_AT }, now)).toEqual({ short: `Saved ${at}`, long: `All changes are saved in this browser (last saved ${at}).`, problem: false });
    expect(describeSave({ kind: 'pending' }).short).toBe('Unsaved changes');
    expect(describeSave({ kind: 'saving' }).short).toBe('Saving…');
    const failed: SaveStatus = { kind: 'failed', reason: 'quota', message: 'Browser storage for this site is full', lastSavedAt: null };
    expect(describeSave(failed)).toEqual({ short: 'Not saved: storage full', long: 'Not saved: Browser storage for this site is full It has not been saved yet.', problem: true });
    expect(describeSave({ kind: 'unavailable', reason: 'This browser offers no IndexedDB here' })).toEqual({
      short: 'Not saved: storage unavailable',
      long: 'This browser offers no IndexedDB here. Projects are kept in this tab only and are lost when it closes. Export a project to keep it.',
      problem: true,
    });
  });

  it('adds the date to a save from another day', () => {
    expect(formatSavedTime('2026-09-20T12:00:00.000Z', new Date('2026-09-25T12:00:00.000Z'))).toMatch(/^2026-09-2\d \d{2}:\d{2}$/);
  });
});

describe('the project bar', () => {
  it('shows the save status in words and follows edits through autosave', async () => {
    const t = await setup();
    expect(projectsButton()).toBeTruthy();
    expect(bar().textContent).toContain(describeSave({ kind: 'saved', at: SAVED_AT }).short);
    expect(describedBy(projectsButton())).toBe(describeSave({ kind: 'saved', at: SAVED_AT }).long);
    act(() => {
      t.store.dispatch(insertNote({ text: 'edit' }));
    });
    expect(bar().textContent).toContain('Unsaved changes');
    await autosave(t);
    // The test clock's day may not be today: then the date comes first.
    expect(bar().textContent).toMatch(/Saved (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}/);
  });

  it('says plainly when browser storage is unavailable', async () => {
    await setup({ unavailable: 'The browser does not allow storage here (InvalidStateError: private window)' });
    expect(bar().textContent).toContain('Not saved: storage unavailable');
    expect(describedBy(projectsButton())).toContain('Projects are kept in this tab only and are lost when it closes');
    fireEvent.click(projectsButton());
    expect(menu().textContent).toContain('The browser does not allow storage here (InvalidStateError: private window). Projects are kept in this tab only');
    expect(within(menu()).getByRole('heading', { name: 'Other projects in this tab (not saved)' })).toBeTruthy();
  });

  it('announces a failed save once', async () => {
    const t = await setup();
    // Make the storage refuse writes from now on.
    const storage = t.storage as { writeProject: (...args: unknown[]) => Promise<unknown> };
    storage.writeProject = () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    act(() => {
      t.store.dispatch(insertNote({ text: 'too much' }));
    });
    await autosave(t);
    expect(bar().textContent).toContain('Not saved: storage full');
    expect(announced()).toMatch(/^Not saved: Browser storage for this site is full \(The quota has been exceeded\.\)\. Delete projects or backups/);
  });
});

describe('the Projects menu', () => {
  it('creates a project and opens it, and the top bar follows', async () => {
    const t = await setup();
    expect(topBarText()).toContain(SAMPLE_PROJECT_NAME);
    fireEvent.click(projectsButton());
    fireEvent.click(within(menu()).getByRole('button', { name: 'New project' }));
    const field = within(menu()).getByRole('textbox', { name: 'Name of the new project' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'Durotar run' } });
    await act(async () => {
      fireEvent.click(within(menu()).getByRole('button', { name: 'Create' }));
      await settle();
    });
    expect(screen.queryByRole('dialog', { name: 'Projects' })).toBeNull();
    expect(announced()).toBe('New project “Durotar run” is open.');
    expect(topBarText()).toContain('Durotar run');
    // No longer the sample: no "Sample" label and no sample notice.
    expect(document.querySelector('.frl-topbar')?.textContent).not.toContain('Sample project');
    expect(t.store.getState().project.route.steps).toEqual([]);
  });

  it('opens, renames and deletes projects, with a confirmation, and restores from Recently deleted', async () => {
    const t = await setup();
    await act(async () => {
      await t.session.newProject('Second');
      await settle();
    });
    fireEvent.click(projectsButton());
    await act(() => settle());
    const others = () => within(menu()).getByRole('region', { name: /Other projects/ });
    expect(within(others()).getByText(SAMPLE_PROJECT_NAME)).toBeTruthy();

    // Rename the other project.
    fireEvent.click(within(others()).getByRole('button', { name: `Rename “${SAMPLE_PROJECT_NAME}”` }));
    const field = within(menu()).getByRole('textbox', { name: `New name for “${SAMPLE_PROJECT_NAME}”` });
    fireEvent.change(field, { target: { value: 'Old sample' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
      await settle();
    });
    expect(announced()).toBe('Renamed to “Old sample”.');
    expect(within(others()).getByText('Old sample')).toBeTruthy();

    // Delete asks first; Cancel keeps it.
    fireEvent.click(within(others()).getByRole('button', { name: 'Delete “Old sample”' }));
    const confirm = within(menu()).getByRole('group', { name: 'Delete “Old sample”?' });
    expect(confirm.textContent).toContain('It moves to Recently deleted and is kept there for 30 days.');
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(within(others()).getByText('Old sample')).toBeTruthy();

    fireEvent.click(within(others()).getByRole('button', { name: 'Delete “Old sample”' }));
    await act(async () => {
      fireEvent.click(within(within(menu()).getByRole('group', { name: 'Delete “Old sample”?' })).getByRole('button', { name: 'Delete' }));
      await settle();
    });
    expect(announced()).toBe('Deleted “Old sample”. It is kept in Recently deleted until 2026-10-25.');
    expect(within(others()).getByText('No other projects.')).toBeTruthy();
    const deleted = within(menu()).getByRole('region', { name: 'Recently deleted' });
    expect(deleted.textContent).toContain('Old sample');
    expect(deleted.textContent).toContain('kept until 2026-10-25');

    await act(async () => {
      fireEvent.click(within(deleted).getByRole('button', { name: 'Restore “Old sample”' }));
      await settle();
    });
    expect(announced()).toBe('Restored “Old sample”. Open it from the project list.');
    await act(async () => {
      fireEvent.click(within(others()).getByRole('button', { name: 'Open “Old sample”' }));
      await settle();
    });
    expect(announced()).toBe('Opened “Old sample”.');
    expect(topBarText()).toContain('Old sample');
    expect(t.session.getState().current.name).toBe('Old sample');
  });

  it('closes an inline step with Escape before the dialog', async () => {
    await setup();
    fireEvent.click(projectsButton());
    fireEvent.click(within(menu()).getByRole('button', { name: `Rename “${SAMPLE_PROJECT_NAME}”` }));
    expect(within(menu()).queryByRole('textbox')).not.toBeNull();
    fireEvent(menu(), new Event('cancel', { cancelable: true }));
    expect(within(menu()).queryByRole('textbox')).toBeNull();
    fireEvent(menu(), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Projects' })).toBeNull();
  });

  it('keeps Ctrl+Z inside the dialog from undoing the route behind it', async () => {
    const t = await setup();
    act(() => {
      t.store.dispatch(insertNote({ text: 'keep me' }));
    });
    const steps = t.store.getState().project.route.steps.length;
    fireEvent.click(projectsButton());
    fireEvent.keyDown(within(menu()).getByRole('button', { name: 'New project' }), { key: 'z', ctrlKey: true });
    expect(t.store.getState().project.route.steps.length).toBe(steps);
  });

  it('shows why a stored project cannot be opened', async () => {
    const storage = createMemoryProjectStorage();
    await storage.writeProject(
      { id: 'broken', project: { schemaVersion: 1, id: 'broken' }, dataPrints: null },
      { id: 'broken', name: 'Broken', createdAt: SAVED_AT, updatedAt: '2020-01-01T00:00:00.000Z', savedAt: SAVED_AT, stepCount: 0, dataRevision: 'r', schemaVersion: 1, sample: false },
      null,
    );
    await setup({ storage });
    // The start opened a new project, and says why.
    expect(within(bar()).getByRole('button', { name: /notices/ })).toBeTruthy();
    fireEvent.click(projectsButton());
    const text = menu().textContent;
    expect(text).toContain('“Broken” could not be opened: The stored project is not a valid project file for this version of the app. It is kept in storage unchanged.');
    expect(text).toContain('Cannot be opened: The stored project is not a valid project file for this version of the app. It is kept unchanged; export it to keep a copy.');
    const others = within(menu()).getByRole('region', { name: /Other projects/ });
    expect(within(others).queryByRole('button', { name: 'Open “Broken”' })).toBeNull();
    expect(within(others).getByRole('button', { name: 'Export “Broken”' })).toBeTruthy();
  });
});

describe('import and export in the top bar', () => {
  it('makes Import and Export available once project storage is connected, and Import unavailable while locked', async () => {
    const t = await setup();
    const actions = within(screen.getByRole('toolbar', { name: 'Project actions' }));
    expect(actions.getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBeNull();
    expect(actions.getByRole('button', { name: 'Export' }).getAttribute('aria-disabled')).toBeNull();
    act(() => {
      t.store.acquireLock('proposal');
    });
    const importButton = actions.getByRole('button', { name: 'Import' });
    expect(importButton.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(importButton)).toBe('Unavailable while the optimiser runs or a proposal is open');
    expect(actions.getByRole('button', { name: 'Export' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('imports a project file as a new project, and lists every problem of a bad one by path', async () => {
    const t = await setup();
    const good = t.session.exportCurrent().text;
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Project actions' })).getByRole('button', { name: 'Import' }));
    const dialog = screen.getByRole('dialog', { name: 'Import' });
    const input = within(dialog).getByLabelText('Choose a project file');
    const user = userEvent.setup();

    const bad = JSON.parse(good) as Record<string, unknown>;
    bad['rulesetId'] = 'retail';
    delete bad['character'];
    await act(async () => {
      await user.upload(input, new File([JSON.stringify(bad)], 'bad.frl.json', { type: 'application/json' }));
      await settle();
    });
    const failure = within(dialog).getByText('“bad.frl.json” is not a project file this app can open.', { selector: '.frl-projects__failure-title' }).closest('.frl-projects__failure');
    expect(document.activeElement).toBe(failure);
    expect(failure?.textContent).toContain('2 problems, by where they are in the file:');
    expect(failure?.textContent).toContain('character: ');
    expect(failure?.textContent).toContain('rulesetId: ');
    expect(t.session.getState().projects).toHaveLength(1);

    await act(async () => {
      await user.upload(input, new File([good], 'Copy of sample.frl.json', { type: 'application/json' }));
      await settle();
    });
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
    expect(announced()).toBe('Imported “Copy of sample” as a new project and opened it.');
    expect(topBarText()).toContain('Copy of sample');
    expect(t.session.getState().projects).toHaveLength(2);
  });

  it('imports a dropped file', async () => {
    const t = await setup();
    const good = t.session.exportCurrent().text;
    render(<ImportDialog open onClose={vi.fn()} session={t.session} />);
    const dialogs = screen.getAllByRole('dialog', { name: 'Import' });
    const section = within(dialogs[dialogs.length - 1] as HTMLElement).getByRole('region', { name: 'Project file (.frl.json)' });
    await act(async () => {
      fireEvent.drop(section, { dataTransfer: { files: [new File([good], 'Dropped.frl.json')], types: ['Files'] } });
      await settle();
    });
    expect(t.session.getState().current.name).toBe('Dropped');
  });

  it('exports the open project as a deterministic file', async () => {
    const t = await setup();
    const download = vi.fn<(file: DownloadFile) => void>();
    const onClose = vi.fn();
    render(<ExportDialog open onClose={onClose} session={t.session} download={download} />);
    const dialogs = screen.getAllByRole('dialog', { name: 'Export' });
    const dialog = dialogs[dialogs.length - 1] as HTMLElement;
    // Without an RXP entry (the app always gives one), the section says so.
    expect(dialog.textContent).toContain('RestedXP custom guides are not available here.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download project file' }));
    expect(download).toHaveBeenCalledWith(t.session.exportCurrent());
    expect(download.mock.calls[0]?.[0].fileName).toBe('Sample project.frl.json');
    expect(onClose).toHaveBeenCalled();
  });

  it('hands the file to the browser through an object URL', () => {
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      downloadFile({ fileName: 'x.frl.json', text: '{}\n', mimeType: 'application/json' });
      expect(create).toHaveBeenCalledTimes(1);
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toBe('x.frl.json');
      expect(link.href).toBe('blob:test');
      expect(link.isConnected).toBe(false);
      vi.advanceTimersByTime(10_000);
      expect(revoke).toHaveBeenCalledWith('blob:test');
    } finally {
      vi.useRealTimers();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe('the drift report', () => {
  it('shows what changed and records the new revision when dismissed', async () => {
    const storage = createMemoryProjectStorage();
    const first = await createTestSession({ data, createSample, storage });
    const text = first.session.exportCurrent().text.replace(`"dataRevision": "${data.identity.dataRevision}"`, '"dataRevision": "rev-file"');
    await first.session.importProjectText(text, 'Old file.frl.json');
    first.session.dispose();

    const t = await setup({ storage });
    const button = within(bar()).getByRole('button', { name: /^Data changed/ });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'The data changed since this project was saved' });
    expect(dialog.textContent).toContain('“Old file” was last saved with data revision rev-file');
    expect(dialog.textContent).toContain('Missing from the loaded data: none.');
    expect(dialog.textContent).toContain('Objectives changed: unknown. There is no record of the data this project was made with (it came from a file).');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss the report' }));
    expect(screen.queryByRole('dialog', { name: 'The data changed since this project was saved' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: /^Data changed/ })).toBeNull();
    // The opener is gone, so focus goes to the Projects button rather than the page (UI review F11).
    expect(document.activeElement).toBe(projectsButton());
    expect(announced()).toBe('Report dismissed: the new data revision is recorded with the next save.');
    await autosave(t);
    expect((await storage.readProject(t.session.getState().current.id))?.index.dataRevision).toBe(data.identity.dataRevision);
  });
});

describe('focus in the Projects dialog (UI review F3)', () => {
  it('returns focus to the button that opened an inline step, after Cancel and after Escape', async () => {
    await setup();
    fireEvent.click(projectsButton());
    const rename = () => within(menu()).getByRole('button', { name: `Rename “${SAMPLE_PROJECT_NAME}”` });
    rename().focus();
    fireEvent.click(rename());
    expect(document.activeElement).toBe(within(menu()).getByRole('textbox', { name: `New name for “${SAMPLE_PROJECT_NAME}”` }));
    fireEvent.click(within(menu()).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(rename());

    fireEvent.click(rename());
    fireEvent(menu(), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeTruthy();
    expect(document.activeElement).toBe(rename());

    const remove = () => within(menu()).getByRole('button', { name: `Delete “${SAMPLE_PROJECT_NAME}”` });
    fireEvent.click(remove());
    fireEvent.click(within(within(menu()).getByRole('group', { name: `Delete “${SAMPLE_PROJECT_NAME}”?` })).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(remove());
  });

  it('returns focus to the renamed project’s button after a rename, although its name changed', async () => {
    await setup();
    fireEvent.click(projectsButton());
    fireEvent.click(within(menu()).getByRole('button', { name: `Rename “${SAMPLE_PROJECT_NAME}”` }));
    fireEvent.change(within(menu()).getByRole('textbox'), { target: { value: 'My route' } });
    await act(async () => {
      fireEvent.click(within(menu()).getByRole('button', { name: 'Rename' }));
      await settle();
    });
    expect(document.activeElement).toBe(within(menu()).getByRole('button', { name: 'Rename “My route”' }));
  });

  it('keeps a refused rename open with what was typed, and moves focus to the reason', async () => {
    await setup();
    fireEvent.click(projectsButton());
    fireEvent.click(within(menu()).getByRole('button', { name: `Rename “${SAMPLE_PROJECT_NAME}”` }));
    const field = within(menu()).getByRole('textbox', { name: `New name for “${SAMPLE_PROJECT_NAME}”` });
    fireEvent.change(field, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
      await settle();
    });
    const failure = within(menu()).getByText('A project needs a name.', { selector: '.frl-projects__failure-title' }).closest('.frl-projects__failure');
    expect(document.activeElement).toBe(failure);
    expect(announced()).toBe('A project needs a name.');
    expect(within(menu()).getByRole('textbox', { name: `New name for “${SAMPLE_PROJECT_NAME}”` })).toHaveProperty('value', '   ');
  });
});

describe('destructive confirmations (UI review F9, CR-03)', () => {
  it('says what deleting the open project opens instead, and draws destructive choices apart from the primary ones', async () => {
    const t = await setup();
    await act(async () => {
      await t.session.newProject('Second');
      await settle();
    });
    fireEvent.click(projectsButton());
    await act(() => settle());
    fireEvent.click(within(menu()).getByRole('button', { name: 'Delete “Second”' }));
    const confirm = within(menu()).getByRole('group', { name: 'Delete “Second”?' });
    expect(confirm.textContent).toContain('It moves to Recently deleted and is kept there for 30 days.');
    expect(confirm.textContent).toContain(`This closes it and opens “${SAMPLE_PROJECT_NAME}”.`);
    for (const name of ['Delete', 'Delete permanently']) {
      const button = within(confirm).getByRole('button', { name });
      expect(button.className).toContain('frl-projects__destructive');
      expect(button.className).not.toContain('frl-button--primary');
    }
  });

  it('says Recently deleted lasts only until the tab closes when browser storage is unavailable', async () => {
    await setup({ unavailable: 'The browser does not allow storage here (InvalidStateError: private window)' });
    fireEvent.click(projectsButton());
    fireEvent.click(within(menu()).getByRole('button', { name: `Delete “${SAMPLE_PROJECT_NAME}”` }));
    const confirm = within(menu()).getByRole('group', { name: `Delete “${SAMPLE_PROJECT_NAME}”?` });
    expect(confirm.textContent).toContain('It moves to Recently deleted, which is kept only until this tab closes.');
    expect(confirm.textContent).toContain('This closes it and opens the sample project.');
    expect(within(menu()).getByRole('region', { name: 'Recently deleted' }).textContent).toContain('Deleted projects are kept only until this tab closes');
  });

  it('deletes a project permanently, and a backup permanently after asking', async () => {
    const t = await setup();
    await act(async () => {
      await t.session.newProject('Second');
      await t.session.newProject('Third');
      await settle();
    });
    fireEvent.click(projectsButton());
    await act(() => settle());
    fireEvent.click(within(menu()).getByRole('button', { name: 'Delete “Second”' }));
    await act(async () => {
      fireEvent.click(within(within(menu()).getByRole('group', { name: 'Delete “Second”?' })).getByRole('button', { name: 'Delete permanently' }));
      await settle();
    });
    expect(announced()).toBe('Deleted “Second” permanently.');
    expect(t.session.getState().backups).toEqual([]);

    await act(async () => {
      await t.session.deleteProject(t.session.getState().current.id);
      await settle();
    });
    const deleted = within(menu()).getByRole('region', { name: 'Recently deleted' });
    const deleteBackup = () => within(deleted).getByRole('button', { name: 'Delete permanently “Third”' });
    fireEvent.click(deleteBackup());
    const confirm = within(deleted).getByRole('group', { name: 'Delete “Third” permanently?' });
    expect(confirm.textContent).toContain('It is removed from Recently deleted now and cannot be restored.');
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(deleteBackup());
    fireEvent.click(deleteBackup());
    await act(async () => {
      fireEvent.click(within(within(deleted).getByRole('group', { name: 'Delete “Third” permanently?' })).getByRole('button', { name: 'Delete permanently' }));
      await settle();
    });
    expect(announced()).toBe('Deleted “Third” from Recently deleted permanently.');
    expect(within(deleted).getByText('Nothing here.')).toBeTruthy();
  });

  it('asks before overwriting another tab’s version, and names that version', async () => {
    const storage = createMemoryProjectStorage();
    const t = await setup({ storage });
    const other = await createTestSession({ data, createSample, storage });
    await act(async () => {
      other.store.dispatch(insertNote({ text: 'from the other tab' }));
      await other.session.flush();
    });
    act(() => {
      t.store.dispatch(insertNote({ text: 'from this tab' }));
    });
    await autosave(t);
    expect(bar().textContent).toContain('Not saved: changed elsewhere');
    fireEvent.click(projectsButton());
    fireEvent.click(within(menu()).getByRole('button', { name: 'Keep this version (overwrite)' }));
    const confirm = within(menu()).getByRole('group', { name: 'Keep this version?' });
    const steps = other.store.getState().project.route.steps.length;
    expect(confirm.textContent).toContain(`The version saved in another tab or window (“${SAMPLE_PROJECT_NAME}”, saved `);
    expect(confirm.textContent).toContain(`, ${String(steps)} steps) is replaced by this page's version, and cannot be restored.`);
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Overwrite' }));
      await settle();
    });
    expect(announced()).toBe(`Saved this version of “${SAMPLE_PROJECT_NAME}” over the other one.`);
    expect(bar().textContent).toMatch(/Saved/);
  });
});

describe('a project open in another tab (CR-02)', () => {
  it('offers to open it anyway or open a copy, and saves once asked', async () => {
    const storage = createMemoryProjectStorage();
    const tabs = testTabs();
    await createTestSession({ data, createSample, storage, tabs: tabs.tab() });
    const t = await setup({ storage, tabs: tabs.tab() });
    expect(bar().textContent).toContain('Not saved: open in another tab');
    fireEvent.click(projectsButton());
    const choice = within(menu()).getByRole('group', { name: 'This project is open in another tab' });
    expect(within(choice).getByRole('button', { name: 'Open a copy' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(choice).getByRole('button', { name: 'Open anyway' }));
      await settle();
    });
    expect(announced()).toMatch(/is open here too, and this tab saves it\./);
    act(() => {
      t.store.dispatch(insertNote({ text: 'saved from here' }));
    });
    await autosave(t);
    expect(t.session.getState().save.kind).toBe('saved');
  });
});

describe('failed saves and reads', () => {
  it('announces a failure once, however often the save is tried again (CR-09)', async () => {
    const t = await setup();
    const storage = t.storage as { writeProject: (...args: unknown[]) => Promise<unknown> };
    storage.writeProject = () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    act(() => {
      t.store.dispatch(insertNote({ text: 'too much' }));
    });
    await autosave(t);
    const first = document.querySelector('.frl-app-live')?.textContent ?? '';
    expect(first).toMatch(/^Not saved: Browser storage for this site is full/);
    for (const text of ['again', 'and again']) {
      act(() => {
        t.store.dispatch(insertNote({ text }));
      });
      await autosave(t);
      expect(bar().textContent).toContain('Not saved: storage full');
    }
    // The same text, with no repeat marker: nothing new was announced.
    expect(document.querySelector('.frl-app-live')?.textContent).toBe(first);
    expect(failureAnnouncementKey({ save: { kind: 'saving' }, current: t.session.getState().current })).toBeNull();
  });

  it('offers to open again a project that could not be read', async () => {
    const storage = createMemoryProjectStorage();
    const first = await createTestSession({ data, createSample, storage });
    await first.session.newProject('Flaky');
    const flakyId = first.session.getState().current.id;
    first.session.dispose();
    let hiccups = 1;
    const flaky = {
      ...storage,
      readProject: (id: string) => {
        if (id === flakyId && hiccups > 0) {
          hiccups -= 1;
          return Promise.reject(new Error('disk hiccup'));
        }
        return storage.readProject(id);
      },
    };
    await setup({ storage: flaky });
    fireEvent.click(projectsButton());
    await act(() => settle());
    const others = within(menu()).getByRole('region', { name: /Other projects/ });
    expect(others.textContent).toContain('Not opened: The stored project could not be read (disk hiccup). It is kept unchanged; try opening it again.');
    await act(async () => {
      fireEvent.click(within(others).getByRole('button', { name: 'Try opening again “Flaky”' }));
      await settle();
    });
    expect(announced()).toBe('Opened “Flaky”.');
  });

  it('refuses a file that is not valid UTF-8, without repairing it (CR-16)', async () => {
    const t = await setup();
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Project actions' })).getByRole('button', { name: 'Import' }));
    const dialog = screen.getByRole('dialog', { name: 'Import' });
    const user = userEvent.setup();
    const good = new TextEncoder().encode(t.session.exportCurrent().text);
    // A lone continuation byte inside the route's name.
    const at = new TextDecoder().decode(good).indexOf(SAMPLE_PROJECT_NAME.slice(0, 3));
    const bad = new Uint8Array([...good.slice(0, Math.max(at, 0)), 0x80, ...good.slice(Math.max(at, 0))]);
    await act(async () => {
      await user.upload(within(dialog).getByLabelText('Choose a project file'), new File([bad], 'bytes.frl.json', { type: 'application/json' }));
      await settle();
    });
    const failure = within(dialog).getByText('“bytes.frl.json” is not valid UTF-8 text, so it is not a project file this app can open. Nothing was changed.', { selector: '.frl-projects__failure-title' }).closest('.frl-projects__failure');
    expect(document.activeElement).toBe(failure);
    expect(t.session.getState().projects).toHaveLength(1);
  });
});
