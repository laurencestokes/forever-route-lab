// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fixture01 from '../../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture03 from '../../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import fixture04 from '../../../tests/fixtures/rxp/04-edge-cases-crlf.txt?raw';
import fixture06 from '../../../tests/fixtures/rxp/06-lowering-and-export.txt?raw';
import { fixturePrepared, fixtureView } from '../../../tests/support/fixture-dataset';
import { preparedDatasetSource } from '../../app/dataset-source';
import { createTestSession, settle, type TestSession } from '../../app/persistence-test-helpers';
import * as rxpTools from '../../app/rxp-tools';
import { createSampleProject, SAMPLE_ROUTE_NOTICE } from '../../app/sample-route';
import { App } from '../App';
import { loadDetailsPanel } from './lazy';
import { ProjectSessionProvider, useProjectSessionState } from './ProjectMenuContext';
import { RxpImportDialog } from './RxpImportDialog';

// The dialogs are lazy parts (ui-refresh.md §10.3) that production builds preload when idle; so do these tests.
beforeAll(async () => {
  await loadDetailsPanel();
});

afterEach(() => {
  cleanup();
});

const data = preparedDatasetSource(fixturePrepared());
const createSample = (nowIso: string) => createSampleProject({ dataset: fixtureView(), nowIso });
const loadTools = () => Promise.resolve(rxpTools);
const TITLE = 'Import RXP custom guide';
const BOM = String.fromCharCode(0xfeff);
const GUIDE_01 = '1-4 Valley of Trials (fixture)';
/** A shape of RestedXP's protected strings (docs/RXP.md §3.3): a count, a hash and `:`; not a real one. */
const PROTECTED_SHAPED = '3|-1234567:AbCdEfGhIjKlMnOpQrStUvWx%';

interface Setup {
  readonly t: TestSession;
  readonly announce: ReturnType<typeof vi.fn<(message: string) => void>>;
  readonly onClose: ReturnType<typeof vi.fn<() => void>>;
  readonly dialog: () => HTMLElement;
}

async function setup(opts: { readonly session?: boolean } = {}): Promise<Setup> {
  const t = await createTestSession({ data, createSample });
  const announce = vi.fn<(message: string) => void>();
  const onClose = vi.fn<() => void>();
  render(
    <RxpImportDialog
      open
      onClose={onClose}
      store={t.store}
      session={opts.session === false ? null : t.session}
      dataset={fixtureView()}
      data={data}
      announce={announce}
      loadTools={loadTools}
    />,
  );
  return { t, announce, onClose, dialog: () => screen.getByRole('dialog', { name: TITLE }) };
}

const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

function paste(s: Setup, text: string) {
  fireEvent.change(within(s.dialog()).getByLabelText('Guide text or custom-guide .lua file'), { target: { value: text } });
}

async function check(s: Setup) {
  await act(async () => {
    fireEvent.click(within(s.dialog()).getByRole('button', { name: /^Check guide/ }));
    await settle();
  });
}

async function importNow(s: Setup) {
  await act(async () => {
    fireEvent.click(within(s.dialog()).getByRole('button', { name: 'Import' }));
    await settle(10);
  });
}

const result = (s: Setup) => within(s.dialog()).getByRole('region', { name: 'Check result' });

describe('Import RXP custom guide', () => {
  it('checks pasted text, lists its diagnostics with line and column, and shows the source line of one', async () => {
    const s = await setup();
    paste(s, fixture04);
    expect(within(s.dialog()).getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
    await check(s);
    const region = result(s);
    expect(document.activeElement).toBe(region);
    expect(region.textContent).toMatch(/One guide, “[^”]+”: \d+ RXP steps?, \d+ route steps?; /);
    const items = within(region).getAllByRole('button', { expanded: false }).filter((button) => button.classList.contains('frl-rxpdiag__body'));
    expect(items.length).toBeGreaterThan(5);
    const first = items[0] as HTMLElement;
    const where = /Line (\d+)(?:, column (\d+))?/.exec(first.textContent);
    expect(where).not.toBeNull();
    expect(first.textContent).toMatch(/RXP\d{3}-/);
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const excerpt = document.getElementById(first.getAttribute('aria-controls') ?? '');
    expect(excerpt?.getAttribute('aria-label')).toMatch(new RegExp(`^Line ${where?.[1] ?? ''}(, column \\d+)? of the pasted text$`));
    // The excerpt shows the line itself (CRLF endings split like RXP reads them).
    const line = fixture04.split(/\r\n|\r|\n/)[Number(where?.[1]) - 1] ?? '';
    expect(excerpt?.querySelector('.frl-rxpsource__line.is-target')?.textContent).toContain(line.trim().slice(0, 20));
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('false');
  });

  it('imports a guide as a new project and opens it', async () => {
    const s = await setup();
    paste(s, fixture01);
    await check(s);
    await importNow(s);
    expect(s.t.session.getState().current.name).toBe(GUIDE_01);
    const project = s.t.store.getState().project;
    expect(project.route.name).toBe(GUIDE_01);
    expect(project.imports.map((imp) => imp.text)).toEqual([fixture01]);
    expect(s.announce).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`^Imported “${GUIDE_01.replace(/[()]/g, '\\$&')}” as a new project and opened it\\. It has \\d+ steps\\.$`)));
    expect(s.onClose).toHaveBeenCalled();
  });

  it('adds a guide to the end of the route as one undo entry', async () => {
    const s = await setup();
    const before = s.t.store.getState().project.route.steps.length;
    fireEvent.click(within(s.dialog()).getByRole('radio', { name: 'The end of the current route' }));
    paste(s, fixture01);
    await check(s);
    await importNow(s);
    const state = s.t.store.getState();
    const added = state.project.route.steps.length - before;
    expect(added).toBeGreaterThan(18);
    expect(state.history.undoLabel).toBe('Import RXP guide');
    expect(state.project.imports).toHaveLength(1);
    expect(s.announce).toHaveBeenLastCalledWith(
      `Imported “${GUIDE_01}”: ${String(added)} steps added as steps ${String(before + 1)} to ${String(before + added)}. Undo with Ctrl+Z.`,
    );
    act(() => {
      s.t.store.undo();
    });
    expect(s.t.store.getState().project.route.steps).toHaveLength(before);
    expect(s.t.store.getState().project.imports).toEqual([]);
  });

  it('refuses a protected import string and explains why, keeping nothing', async () => {
    const s = await setup();
    paste(s, PROTECTED_SHAPED);
    await check(s);
    const region = result(s);
    expect(region.textContent).toContain('Refused: this is not guide text.');
    expect(region.textContent).toContain('This looks like a RestedXP protected import string.');
    expect(region.textContent).toContain('does not decode, decrypt or keep them');
    expect(region.textContent).not.toContain('AbCdEf');
    const button = within(s.dialog()).getByRole('button', { name: 'Import' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(button)).toBe('This input is refused.');
    await importNow(s);
    expect(s.t.store.getState().project.imports).toEqual([]);
    // Closing drops the pasted text.
    fireEvent.click(within(s.dialog()).getByRole('button', { name: 'Cancel' }));
    expect(s.onClose).toHaveBeenCalled();
  });

  it('lists the quests the data lacks, then adds placeholder custom quests or leaves them unknown', async () => {
    const s = await setup();
    fireEvent.click(within(s.dialog()).getByRole('radio', { name: 'The end of the current route' }));
    paste(s, fixture06);
    await check(s);
    const region = result(s);
    expect(region.textContent).toMatch(/\d+ quests? the guide uses (is|are) not in the data or the project’s custom quests:/);
    const item = within(region).getByText(/^Quest 900001, used by \d+ steps?$/).closest('li') as HTMLElement;
    const show = within(item).getByRole('button', { name: /^Show line \d+$/ });
    fireEvent.click(show);
    expect(show.getAttribute('aria-expanded')).toBe('true');
    expect(item.querySelector('.frl-rxpsource__line.is-target')?.textContent).toContain('900001');
    expect(within(region).getByRole<HTMLInputElement>('radio', { name: 'Add them as placeholder custom quests' }).checked).toBe(true);
    await importNow(s);
    const quests = s.t.store.getState().project.customQuests;
    expect(quests.map((quest) => quest.name)).toContain('Quest 900001 (placeholder from an RXP guide)');
    expect(s.announce).toHaveBeenLastCalledWith(expect.stringContaining('placeholder custom quest'));
  });

  it('leaves unknown quests unknown when asked', async () => {
    const s = await setup();
    fireEvent.click(within(s.dialog()).getByRole('radio', { name: 'The end of the current route' }));
    paste(s, fixture06);
    await check(s);
    fireEvent.click(within(result(s)).getByRole('radio', { name: 'Leave them unknown' }));
    await importNow(s);
    expect(s.t.store.getState().project.customQuests).toEqual([]);
    expect(s.announce).toHaveBeenLastCalledWith(expect.stringMatching(/not in the data stays? unknown \(.*900001/));
  });

  it('opens a Lua file, checks it at once, and imports only the chosen guides', async () => {
    const s = await setup();
    fireEvent.click(within(s.dialog()).getByRole('radio', { name: 'The end of the current route' }));
    await act(async () => {
      fireEvent.change(within(s.dialog()).getByLabelText('Or open a file'), { target: { files: [new File([fixture03], 'Fixture.lua')] } });
      await settle(10);
    });
    const region = result(s);
    expect(region.textContent).toContain('4 guides in “Fixture.lua”.');
    const boxes = within(region).getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    fireEvent.click(boxes[1] as HTMLElement);
    // The file's own diagnostics have lines of the file.
    expect(region.textContent).toContain('RXP020-lua-dynamic');
    await importNow(s);
    expect(s.t.store.getState().project.imports.map((imp) => imp.name)).toEqual(['6-8 Fixture Three', '8-9 Fixture Four', '9-10 Fixture Quoted']);
  });

  it('keeps a byte-order mark from a file, and refuses a file that is not UTF-8', async () => {
    const s = await setup();
    fireEvent.click(within(s.dialog()).getByRole('radio', { name: 'The end of the current route' }));
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(fixture01)]);
    await act(async () => {
      fireEvent.change(within(s.dialog()).getByLabelText('Or open a file'), { target: { files: [new File([withBom], 'bom.txt')] } });
      await settle(10);
    });
    await importNow(s);
    expect(s.t.store.getState().project.imports[0]?.text).toBe(`${BOM}${fixture01}`);
    cleanup();

    const s2 = await setup();
    await act(async () => {
      fireEvent.change(within(s2.dialog()).getByLabelText('Or open a file'), { target: { files: [new File([new Uint8Array([0x73, 0x74, 0xff, 0xfe])], 'latin.lua')] } });
      await settle(10);
    });
    expect(within(s2.dialog()).getByText('“latin.lua” is not UTF-8 text, so it cannot be imported unchanged.')).toBeTruthy();
  });

  it('asks for a new check when the text or an option changed since the last one', async () => {
    const s = await setup();
    paste(s, fixture01);
    await check(s);
    paste(s, `${fixture01}\n`);
    expect(result(s).textContent).toContain('The text or the options changed since this check.');
    const button = within(s.dialog()).getByRole('button', { name: 'Import' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(button)).toBe('The text or the options changed since the check: check it again.');
    // An option change checks the current text again by itself (the text was checked).
    await check(s);
    await act(async () => {
      fireEvent.click(within(s.dialog()).getByRole('radio', { name: 'Era maps' }));
      await settle();
    });
    expect(result(s).textContent).not.toContain('changed since this check');
  });

  it('offers only the end of the route without project storage, and asks for text first', async () => {
    const s = await setup({ session: false });
    const fresh = within(s.dialog()).getByRole<HTMLInputElement>('radio', { name: 'A new project' });
    expect(fresh.disabled).toBe(true);
    expect(within(s.dialog()).getByRole<HTMLInputElement>('radio', { name: 'The end of the current route' }).checked).toBe(true);
    await check(s);
    const problem = within(s.dialog()).getByText('Paste guide text or open a file first.');
    expect(document.activeElement).toBe(problem);
    // The same problem a second time takes focus again (UI-F12).
    const checkButton = within(s.dialog()).getByRole('button', { name: /^Check guide/ });
    checkButton.focus();
    await check(s);
    expect(document.activeElement).toBe(within(s.dialog()).getByText('Paste guide text or open a file first.'));
  });

  it('keeps the pasted text when a press lands on the backdrop (UI-F10)', async () => {
    const s = await setup();
    paste(s, fixture01);
    fireEvent.pointerDown(s.dialog());
    fireEvent.click(s.dialog());
    expect(s.onClose).not.toHaveBeenCalled();
    expect(within(s.dialog()).getByLabelText<HTMLTextAreaElement>('Guide text or custom-guide .lua file').value).toBe(fixture01);
  });
});

/** The shell as src/main.tsx composes it. */
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
  it('opens the RXP import from the Import dialog, replacing it', async () => {
    const t = await createTestSession({ data, createSample });
    render(<Harness t={t} />);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Project actions' })).getByRole('button', { name: 'Import' }));
    const importDialog = screen.getByRole('dialog', { name: 'Import' });
    const section = within(importDialog).getByRole('region', { name: 'RXP custom guide' });
    fireEvent.click(within(section).getByRole('button', { name: TITLE }));
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
    // The dialog loads on first use (CR-19): "Loading…" under its title, then the dialog.
    const field = await screen.findByLabelText('Guide text or custom-guide .lua file', undefined, { timeout: 10_000 });
    const dialog = screen.getByRole('dialog', { name: TITLE });
    expect(dialog.contains(field)).toBe(true);
    fireEvent.change(field, { target: { value: fixture01 } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Check guide/ }));
    // The RXP code loads on demand (a dynamic import).
    await waitFor(
      () => {
        expect(within(dialog).getByRole('region', { name: 'Check result' }).textContent).toContain(`One guide, “${GUIDE_01}”`);
      },
      { timeout: 10_000 },
    );
  }, 15_000);
});
