// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sequentialIdSource } from '../domain';
import { fixedClock } from './clock';
import { insertNote, renameRoute } from './commands';
import { createDerivedStore, IDLE_PATHS } from './derived';
import { DerivedStoreProvider, EditorStoreProvider, useDerived, useDerivedSelector, useEditor, useEditorSelector, useEditorStore } from './react';
import { createEditorStore, type EditorState, type EditorStore } from './store';
import { notesProject, sid } from './test-helpers';

afterEach(cleanup);

function makeStore(): EditorStore {
  return createEditorStore({ project: notesProject('abc'), ids: sequentialIdSource(), clock: fixedClock('2026-01-02T00:00:00.000Z') });
}

const shallowEqual = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

function Probe<T>(props: { store: EditorStore; selector: (s: EditorState) => T; isEqual?: (a: T, b: T) => boolean; onRender: (v: T) => void }) {
  const value = useEditor(props.store, props.selector, props.isEqual);
  props.onRender(value);
  return <output>{JSON.stringify(value)}</output>;
}

describe('useEditor', () => {
  it('re-renders only when the selected slice changes', () => {
    const store = makeStore();
    const onRender = vi.fn();
    render(<Probe store={store} selector={(s) => s.project.route.name} onRender={onRender} />);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('"Placeholder route"');

    act(() => store.select({ kind: 'single', id: sid('a') }));
    act(() => store.setView({ theme: 'dark' }));
    act(() => store.dispatch(insertNote({ text: 'Placeholder x' })));
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => store.dispatch(renameRoute('Placeholder renamed')));
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe('"Placeholder renamed"');

    act(() => store.undo());
    expect(onRender).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('status').textContent).toBe('"Placeholder route"');
  });

  it('with isEqual, a selector that builds a new array re-renders only on a real change', () => {
    const store = makeStore();
    const onRender = vi.fn();
    render(
      <Probe
        store={store}
        selector={(s) => s.project.route.steps.map((step) => step.id)}
        isEqual={shallowEqual}
        onRender={onRender}
      />,
    );
    act(() => store.setView({ rightTab: 'details' }));
    act(() => store.dispatch(renameRoute('Placeholder renamed')));
    expect(onRender).toHaveBeenCalledTimes(1);
    act(() => store.dispatch(insertNote({ text: 'Placeholder x' })));
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe('["s-a","s-b","s-c","step-1"]');
  });

  it('keeps the slice identity across renders when isEqual says it is unchanged', () => {
    const store = makeStore();
    const seen: unknown[] = [];
    const { rerender } = render(
      <Probe store={store} selector={(s) => [s.view.theme]} isEqual={shallowEqual} onRender={(v) => seen.push(v)} />,
    );
    rerender(<Probe store={store} selector={(s) => [s.view.theme]} isEqual={shallowEqual} onRender={(v) => seen.push(v)} />);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it('a selector closing over new props recomputes without a store change', () => {
    const store = makeStore();
    const text = (id: string) => (s: EditorState) => {
      const step = s.project.route.steps.find((x) => x.id === sid(id));
      return step?.kind === 'note' ? step.text : null;
    };
    const { rerender } = render(<Probe store={store} selector={text('a')} onRender={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('"Placeholder a"');
    rerender(<Probe store={store} selector={text('b')} onRender={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('"Placeholder b"');
  });

  it('an inline selector returning a new object does not loop', () => {
    const store = makeStore();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRender = vi.fn();
    render(<Probe store={store} selector={(s) => ({ revision: s.revision })} onRender={onRender} />);
    act(() => store.dispatch(renameRoute('x')));
    expect(screen.getByRole('status').textContent).toBe('{"revision":1}');
    expect(onRender.mock.calls.length).toBeLessThanOrEqual(3);
    expect(errors).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const store = makeStore();
    const unsubscribed = vi.fn();
    const counting: EditorStore = {
      ...store,
      subscribe: (listener) => {
        const off = store.subscribe(listener);
        return () => {
          unsubscribed();
          off();
        };
      },
    };
    const { unmount } = render(<Probe store={counting} selector={(s) => s.revision} onRender={() => undefined} />);
    unmount();
    expect(unsubscribed).toHaveBeenCalled();
    act(() => store.dispatch(renameRoute('x'))); // no listener left to update an unmounted component
  });
});

describe('EditorStoreProvider', () => {
  function RouteName() {
    const name = useEditorSelector((s) => s.project.route.name);
    const store = useEditorStore();
    return (
      <button type="button" onClick={() => store.dispatch(renameRoute(`${name}!`))}>
        {name}
      </button>
    );
  }

  it('provides the store to useEditorStore and useEditorSelector', () => {
    const store = makeStore();
    render(
      <EditorStoreProvider store={store}>
        <RouteName />
      </EditorStoreProvider>,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('Placeholder route');
    act(() => button.click());
    expect(button.textContent).toBe('Placeholder route!');
    expect(store.getState().project.route.name).toBe('Placeholder route!');
  });

  it('useEditorStore throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<RouteName />)).toThrow(/EditorStoreProvider/);
  });
});

describe('useDerived and DerivedStoreProvider', () => {
  function Status() {
    const status = useDerivedSelector((s) => s?.status ?? 'no simulation');
    return <output>{status}</output>;
  }

  function Paths(props: { readonly store: ReturnType<typeof createDerivedStore>['store']; readonly onRender: () => void }) {
    const state = useDerived(props.store, (s) => s.paths.state);
    props.onRender();
    return <output>{state}</output>;
  }

  it('re-renders only when the derived slice changes', () => {
    const handle = createDerivedStore();
    const onRender = vi.fn();
    render(<Paths store={handle.store} onRender={onRender} />);
    expect(screen.getByRole('status').textContent).toBe('idle');
    act(() => handle.publish({ status: 'ready' }));
    expect(onRender).toHaveBeenCalledTimes(1);
    act(() => handle.publish({ paths: { ...IDLE_PATHS, state: 'running' } }));
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe('running');
  });

  it('reads the provided store, and null outside a provider', () => {
    const handle = createDerivedStore();
    const { unmount } = render(
      <DerivedStoreProvider store={handle.store}>
        <Status />
      </DerivedStoreProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('loading');
    act(() => handle.publish({ status: 'ready' }));
    expect(screen.getByRole('status').textContent).toBe('ready');
    unmount();
    render(<Status />);
    expect(screen.getByRole('status').textContent).toBe('no simulation');
  });
});
