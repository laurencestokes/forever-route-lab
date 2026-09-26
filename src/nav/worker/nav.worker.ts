import type { NavDigest } from './core';
import { createNavWorkerHost } from './host';
import type { NavRequest, NavResponse } from './protocol';

/**
 * The navigation worker's entry (terrain-navigation.md §9.6), loaded by client.ts as a module
 * worker. Everything happens in host.ts and core.ts; this file only binds them to the worker
 * scope: `fetch`, `crypto.subtle`, and a yield through a `MessageChannel` (a zero-delay timer
 * is clamped to 4 ms once nested, which would slow every search slice).
 */

interface WorkerScope {
  postMessage(message: NavResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<NavRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;
const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;

const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => {
  waiting.shift()?.();
};

const host = createNavWorkerHost({
  post: (message) => {
    scope.postMessage(message);
  },
  fetch: (url, init) => fetch(url, init),
  digest: subtle === undefined ? null : (subtle satisfies NavDigest),
  yieldToEventLoop: () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(null);
    }),
});

scope.addEventListener('message', (event) => {
  host.handle(event.data);
});
