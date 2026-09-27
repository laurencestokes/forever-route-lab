import { createOptimizerWorkerHost } from './host';
import type { FromWorker, ToWorker } from './protocol';

/**
 * The optimiser worker's entry (docs/research/optimizer-m7.md §8), loaded by client.ts as a module
 * worker in its own chunk. Everything happens in host.ts and the core; this file only binds them to
 * the worker scope: `performance.now` for the slice clock, and a yield through a `MessageChannel`
 * (a nested zero-delay timer is clamped to 4 ms, which would slow every slice).
 */

interface WorkerScope {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
}

const scope = self as unknown as WorkerScope;

const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => {
  waiting.shift()?.();
};

const host = createOptimizerWorkerHost({
  post: (message) => {
    scope.postMessage(message);
  },
  now: () => performance.now(),
  yieldToEventLoop: () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(null);
    }),
});

scope.addEventListener('message', (event) => {
  host.handle(event.data);
});
