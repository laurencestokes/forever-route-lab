import { useCallback, useEffect, useState } from 'react';
import { Button } from '../primitives/Button';
import { ModalDialog } from './ModalDialog';

/**
 * Parts of the shell that load on first use, each a dynamic `import()` in its own chunk, so the
 * entry chunk holds only what the first screen needs (ARCHITECTURE §12.1 lazy boundaries, §14
 * entry budget; M4 review CR-19): the Settings dialog, the custom quest editor, the two RXP
 * dialogs and the validation panel (with the issue-code registry). Each loader keeps its module
 * once loaded; a failed load is forgotten, so "Try again" imports it afresh (as `loadRxpTools`
 * does). Production builds fetch them when the page is idle after the start (`preloadLazyParts`),
 * so the first use is usually immediate.
 */

/** A loader that keeps its module, and forgets a failure. */
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/** All five parts are one chunk (`lazy-parts.ts`), so the modules they share stay in the entry chunk. */
const loadParts = cached(() => import('./lazy-parts'));

export const loadSettingsDialog = loadParts;
export const loadCustomQuestEditor = loadParts;
export const loadRxpImportDialog = loadParts;
export const loadRxpExportDialog = loadParts;
export const loadValidationPanel = loadParts;

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
 * dialog stays mounted, and its native focus return works, however often it opens).
 */
export function useLazy<T>(load: () => Promise<T>, wanted: boolean): Lazy<T> {
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
  if (failure !== null && failure.attempt === attempt) return { kind: 'failed', message: failure.message, retry };
  return { kind: 'loading' };
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
