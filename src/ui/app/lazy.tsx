import { useCallback, useEffect, useState } from 'react';
import { Button } from '../primitives/Button';
import { ModalDialog } from './ModalDialog';

/**
 * Parts of the shell that load on first use, each a dynamic `import()` in its own chunk, so the
 * entry chunk holds only what the first screen needs (ARCHITECTURE §12.1 lazy boundaries, §14
 * entry budget; M4 review CR-19): the Settings dialog, the custom quest editor, the two RXP
 * dialogs, the validation panel (with the issue-code registry), the Details panel (ui-refresh.md
 * §10.3, step UR.1a), the Projects dialog and the drift report (the ledger's reserve, UR.4) and the
 * Quest log tab (UR.6). Each loader keeps its module
 * once loaded; a failed load is forgotten, so "Try again" imports it afresh (as `loadRxpTools`
 * does). Production builds fetch them when the page is idle after the start (`preloadLazyParts`),
 * so the first use is usually immediate.
 */

/**
 * A loader of a lazy part. `peek` gives the module once it has loaded (by the idle preload or an
 * earlier use), so the first render that wants it can draw it at once instead of a "Loading…" frame.
 */
export interface PartLoader<T> {
  (): Promise<T>;
  readonly peek?: (() => { readonly value: T } | null) | undefined;
}

/** A loader that keeps its module, and forgets a failure. */
function cached<T>(load: () => Promise<T>): PartLoader<T> & { readonly peek: () => { readonly value: T } | null } {
  let pending: Promise<T> | null = null;
  let done: { readonly value: T } | null = null;
  const loader = () => {
    pending ??= load().then(
      (value) => {
        done = { value };
        return value;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  return Object.assign(loader, { peek: () => done });
}

/** All the parts are one chunk (`lazy-parts.ts`), so the modules they share stay in the entry chunk. */
const loadParts = cached(() => import('./lazy-parts'));

export const loadSettingsDialog = loadParts;
export const loadCustomQuestEditor = loadParts;
export const loadRxpImportDialog = loadParts;
export const loadRxpExportDialog = loadParts;
export const loadValidationPanel = loadParts;
export const loadDetailsPanel = loadParts;
export const loadProjectDialogs = loadParts;
export const loadQuestLogPanel = loadParts;
export const loadAboutDialog = loadParts;
export const loadImportExport = loadParts;
export const loadRowView = loadParts;
export const loadMapLayersPanel = loadParts;
export const loadMapPopover = loadParts;

/** Fetches the lazy parts once the page is idle (production builds only; a failure waits for first use). */
export function preloadLazyParts(): () => void {
  if (!import.meta.env.PROD || typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return () => undefined;
  const handle = window.requestIdleCallback(
    () => {
      loadParts().catch(() => undefined);
    },
    { timeout: 5000 },
  );
  return () => {
    window.cancelIdleCallback(handle);
  };
}

export type Lazy<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string; readonly retry: () => void }
  | { readonly kind: 'ready'; readonly value: T };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The module `load` gives, loaded the first time `wanted` is true and kept after that (so a
 * dialog stays mounted, and its native focus return works, however often it opens). When the
 * loader already holds the module (`peek`: preloaded when idle), the first wanted render has it.
 */
export function useLazy<T>(load: PartLoader<T>, wanted: boolean): Lazy<T> {
  const [loaded, setLoaded] = useState<{ readonly value: T } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ readonly message: string; readonly attempt: number } | null>(null);
  useEffect(() => {
    if (!wanted || loaded !== null) return undefined;
    let live = true;
    load().then(
      (value) => {
        if (live) setLoaded({ value });
      },
      (error: unknown) => {
        if (live) setFailure({ message: errorText(error), attempt });
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, loaded, load, attempt]);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  if (loaded !== null) return { kind: 'ready', value: loaded.value };
  if (!wanted) return { kind: 'idle' };
  const held = load.peek?.() ?? null;
  if (held !== null) return { kind: 'ready', value: held.value };
  if (failure !== null && failure.attempt === attempt) return { kind: 'failed', message: failure.message, retry };
  return { kind: 'loading' };
}

/**
 * `useLazy` for a part that opens and closes (a dialog): once wanted it stays wanted, so the part
 * stays mounted after it closes, even when it closes before its own load has settled. Render its
 * stand-in (`LazyDialogFallback`) only while it is open.
 */
export function useLazyKept<T>(load: PartLoader<T>, wanted: boolean): Lazy<T> {
  const [kept, setKept] = useState(false);
  if (wanted && !kept) setKept(true);
  return useLazy(load, wanted || kept);
}

export interface LazyDialogFallbackProps {
  readonly title: string;
  readonly state: Lazy<unknown>;
  readonly onClose: () => void;
}

/**
 * What stands in for a dialog while its code loads, or when it could not be loaded: the same
 * modal, titled as the dialog, saying so (with "Try again").
 */
export function LazyDialogFallback({ title, state, onClose }: LazyDialogFallbackProps) {
  if (state.kind !== 'loading' && state.kind !== 'failed') return null;
  return (
    <ModalDialog open onClose={onClose} title={title}>
      {state.kind === 'loading' ? (
        <p>Loading…</p>
      ) : (
        <>
          <p>{`${title} could not be loaded (${state.message}). Check the connection and try again.`}</p>
          <div>
            <Button onClick={state.retry}>Try again</Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
