import { createContext, createElement, type ReactNode, useContext, useRef, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './store';

/**
 * React binding for the editor store: the only app file that imports React
 * (tests/architecture.test.ts). No JSX here, so this stays a `.ts` module.
 */

interface SliceCache<T> {
  readonly state: EditorState;
  readonly selector: (state: EditorState) => T;
  readonly value: T;
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
  // The last slice with the state and selector that produced it, kept across renders so an equal
  // slice keeps its identity and useSyncExternalStore sees an unchanged snapshot. A new selector
  // (an inline function, or one closing over new props) recomputes; it is a cache, not output.
  const cache = useRef<SliceCache<T> | null>(null);
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
