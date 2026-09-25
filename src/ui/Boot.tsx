import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { describeLoadFailure, type WorkspaceProgress } from '../app/workspace';
import { LoadErrorScreen, LoadingScreen } from './kit';

/**
 * Startup: the loading screen while the dataset and the geometry load, then the app, or the error
 * screen with a retry. Each attempt calls `load` exactly once, also under StrictMode's double
 * effects in development (the attempt's promise is kept in a ref, which survives them).
 */

export interface BootProps<T> {
  /** Starts one load; progress goes to `onProgress`. Keep it stable (the same function every render). */
  readonly load: (onProgress: (progress: WorkspaceProgress) => void) => Promise<T>;
  /** Renders the app once the load has succeeded. */
  readonly children: (value: T) => ReactNode;
}

type BootState<T> =
  | { readonly kind: 'loading'; readonly progress: WorkspaceProgress | null }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown };

interface Run<T> {
  readonly promise: Promise<T>;
  /** The mounted Boot's progress handler; null while unmounted (StrictMode's simulated unmount). */
  listener: ((progress: WorkspaceProgress) => void) | null;
}

/** Starts a load whose progress goes to the run's current listener (it may report synchronously). */
function startRun<T>(load: BootProps<T>['load']): Run<T> {
  const holder: { listener: Run<T>['listener'] } = { listener: null };
  const promise = load((progress) => {
    holder.listener?.(progress);
  });
  return Object.assign(holder, { promise });
}

export function Boot<T>({ load, children }: BootProps<T>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BootState<T>>({ kind: 'loading', progress: null });
  const runs = useRef(new Map<number, Run<T>>());

  useEffect(() => {
    let run = runs.current.get(attempt);
    if (run === undefined) {
      run = startRun(load);
      runs.current.set(attempt, run);
    }
    let live = true;
    run.listener = (progress) => {
      setState({ kind: 'loading', progress });
    };
    run.promise.then(
      (value) => {
        if (live) setState({ kind: 'ready', value });
      },
      (error: unknown) => {
        if (live) setState({ kind: 'failed', error });
      },
    );
    const current = run;
    return () => {
      live = false;
      current.listener = null;
    };
  }, [attempt, load]);

  const retry = useCallback(() => {
    setState({ kind: 'loading', progress: null });
    setAttempt((n) => n + 1);
  }, []);

  switch (state.kind) {
    case 'loading':
      return <LoadingScreen progress={state.progress} />;
    case 'failed': {
      const failure = describeLoadFailure(state.error);
      return <LoadErrorScreen title={failure.title} message={failure.message} details={failure.details} remedy={failure.remedy} onRetry={retry} />;
    }
    case 'ready':
      return <>{children(state.value)}</>;
  }
}
