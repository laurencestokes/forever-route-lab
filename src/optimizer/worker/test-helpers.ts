import { createSearch } from '../core';
import type { Stepper } from '../types';
import { createOptimizerWorkerHost, type OptimizerWorkerHost, type OptimizerWorkerHostDeps } from './host';
import type { FromWorker, OptimizerTimers, OptimizerWorkerPort, ToWorker } from './protocol';

/**
 * Test support for the optimiser worker (not imported by application code): the host and a client
 * wired in-process, with every message structured-cloned (and `start`'s buffers transferred) and
 * delivered in a later task, as between threads; and manual timers for the cancel grace period.
 */

export interface InProcessOptimizerWorker {
  readonly port: OptimizerWorkerPort;
  readonly host: OptimizerWorkerHost;
  /** What the client sent, as `{ type, runId }` (a transferred problem is detached after the post). */
  readonly sent: readonly { readonly type: ToWorker['type']; readonly runId: number }[];
  /** What the host posted, in order. */
  readonly received: readonly FromWorker[];
  terminated(): boolean;
  /** Fires the port's error listener, as a worker that stopped on an uncaught error does. */
  crash(message: string): void;
}

export interface InProcessOptions extends Partial<Omit<OptimizerWorkerHostDeps, 'post'>> {
  /** Drops `cancel` messages: a worker stuck in a slice (the client must terminate it). */
  readonly ignoreCancel?: boolean;
  /** Wraps the stepper the host creates (tests slow it down or count its calls). */
  readonly wrapStepper?: (stepper: Stepper) => Stepper;
}

const later = (action: () => void): void => {
  setTimeout(action, 0);
};

export function inProcessOptimizerWorker(options: InProcessOptions = {}): InProcessOptimizerWorker {
  let onMessage: ((message: FromWorker) => void) | null = null;
  let onError: ((message: string) => void) | null = null;
  let terminated = false;
  const sent: { type: ToWorker['type']; runId: number }[] = [];
  const received: FromWorker[] = [];
  const { ignoreCancel, wrapStepper, ...deps } = options;
  const host = createOptimizerWorkerHost({
    now: () => performance.now(),
    yieldToEventLoop: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ...deps,
    ...(wrapStepper === undefined
      ? {}
      : {
          createSearch: (problem, searchOptions) => {
            const make = deps.createSearch ?? createSearch;
            return wrapStepper(make(problem, searchOptions));
          },
        }),
    post: (message) => {
      if (terminated) return;
      received.push(message);
      const copy = structuredClone(message);
      later(() => {
        if (!terminated) onMessage?.(copy);
      });
    },
  });
  const port: OptimizerWorkerPort = {
    postMessage(message, transfer) {
      if (terminated) throw new Error('the worker was terminated');
      sent.push({ type: message.type, runId: message.runId });
      const copy = structuredClone(message, { transfer: [...transfer] });
      if (ignoreCancel === true && copy.type === 'cancel') return;
      later(() => {
        if (!terminated) host.handle(copy);
      });
    },
    listen(message, error) {
      onMessage = message;
      onError = error;
    },
    terminate() {
      terminated = true;
    },
  };
  return { port, host, sent, received, terminated: () => terminated, crash: (m) => onError?.(m) };
}

/** Timers that run only when the test fires them. */
export class ManualOptimizerTimers implements OptimizerTimers {
  private nextId = 1;
  private readonly queue = new Map<number, { readonly ms: number; readonly callback: () => void }>();

  set(callback: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.queue.set(id, { ms, callback });
    return id;
  }

  clear(handle: unknown): void {
    this.queue.delete(handle as number);
  }

  get pending(): readonly number[] {
    return [...this.queue.values()].map((t) => t.ms);
  }

  /** Runs every pending timer now. */
  fireAll(): void {
    const due = [...this.queue.entries()];
    this.queue.clear();
    for (const [, timer] of due) timer.callback();
  }
}

/** Resolves once `predicate` holds, polling each macrotask (in-process messages arrive a task later). */
export async function until(predicate: () => boolean, limitMs = 5_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > limitMs) throw new Error('timed out waiting for the optimiser worker');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
