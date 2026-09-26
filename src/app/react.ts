import { createContext, createElement, type ReactNode, useContext, useRef, useSyncExternalStore } from 'react';
import type { DerivedState, DerivedStore } from './derived';
import type { EditorState, EditorStore } from './store';

/**
 * React binding for the editor store and the derived-results store: the only app file that imports
 * React (tests/architecture.test.ts). No JSX here, so this stays a `.ts` module.
 */

/** What `useSlice` reads: the editor store and the derived store both have this shape. */
interface ExternalStore<S> {
  readonly getState: () => S;
  readonly subscribe: (listener: () => void) => () => void;
}

interface SliceCache<S, T> {
  readonly state: S;
  readonly selector: (state: S) => T;
  readonly value: T;
}

function useSlice<S, T>(store: ExternalStore<S>, selector: (state: S) => T, isEqual: (a: T, b: T) => boolean): T {
  // The last slice with the state and selector that produced it, kept across renders so an equal
  // slice keeps its identity and useSyncExternalStore sees an unchanged snapshot. A new selector
  // (an inline function, or one closing over new props) recomputes; it is a cache, not output.
  const cache = useRef<SliceCache<S, T> | null>(null);
  const getSnapshot = (): T => {
    const state = store.getState();
    const last = cache.current;
    if (last !== null && last.state === state && last.selector === selector) return last.value;
    const next = selector(state);
    const value = last !== null && isEqual(last.value, next) ? last.value : next;
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribes to a slice of the editor state. The component re-renders only when the slice
 * changes: by `Object.is` by default, or by `isEqual` for selectors that build a new object or
 * array on every call. The selector may be an inline function.
 */
export function useEditor<T>(
  store: EditorStore,
  selector: (state: EditorState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  return useSlice(store, selector, isEqual);
}

/**
 * Subscribes to a slice of the derived results (src/app/derived.ts), as `useEditor` does for the
 * editor state. Results lag the editor for a moment after an edit: compare
 * `state.results?.revision` with the editor's `revision` where it matters.
 */
export function useDerived<T>(
  store: DerivedStore,
  selector: (state: DerivedState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  return useSlice(store, selector, isEqual);
}

const EditorStoreContext = createContext<EditorStore | null>(null);

export function EditorStoreProvider(props: { readonly store: EditorStore; readonly children?: ReactNode }): ReactNode {
  return createElement(EditorStoreContext, { value: props.store }, props.children);
}

/** The store from the nearest EditorStoreProvider. Throws outside one. */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (store === null) throw new Error('useEditorStore must be used inside an EditorStoreProvider');
  return store;
}

/** `useEditor` on the store from context. */
export function useEditorSelector<T>(selector: (state: EditorState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useEditor(useEditorStore(), selector, isEqual);
}

const DerivedStoreContext = createContext<DerivedStore | null>(null);

/** Provides the derived-results store (the composition root wraps the app in it). */
export function DerivedStoreProvider(props: { readonly store: DerivedStore; readonly children?: ReactNode }): ReactNode {
  return createElement(DerivedStoreContext, { value: props.store }, props.children);
}

/** The derived store from the nearest DerivedStoreProvider, or null outside one (component tests without simulation). */
export function useDerivedStore(): DerivedStore | null {
  return useContext(DerivedStoreContext);
}

const NO_STORE: ExternalStore<null> = { getState: () => null, subscribe: () => () => undefined };

/**
 * `useDerived` on the store from context; the selector gets null outside a DerivedStoreProvider
 * (component tests), so callers render "not simulated" instead of throwing.
 */
export function useDerivedSelector<T>(selector: (state: DerivedState | null) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useDerivedStore();
  return useSlice<DerivedState | null, T>(store ?? NO_STORE, selector, isEqual);
}
