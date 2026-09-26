import type { BroadcastChannelLike, LockManagerLike } from './tabs';

/**
 * Test doubles of the browser APIs that link tabs (./tabs.ts): a Web Locks lock manager and
 * BroadcastChannels shared by the "tabs" of one test. Only tests import this file (it is not
 * exported from the module index).
 */

/**
 * A Web Locks lock manager shared by the "tabs" of a test (exclusive locks, `ifAvailable` and
 * `signal`, as `navigator.locks.request` has them). Each lock goes to the waiting requests in order.
 */
export function fakeLockManager(): LockManagerLike & { held(name: string): boolean } {
  const holders = new Set<string>();
  const queues = new Map<string, (() => void)[]>();
  const grant = (name: string, callback: (lock: unknown) => unknown): Promise<unknown> => {
    holders.add(name);
    return Promise.resolve(callback({ name, mode: 'exclusive' })).finally(() => {
      holders.delete(name);
      const next = queues.get(name)?.shift();
      next?.();
    });
  };
  return {
    request(name, options, callback) {
      if (!holders.has(name)) return grant(name, callback);
      if (options.ifAvailable === true) return Promise.resolve(callback(null));
      return new Promise<unknown>((resolve, reject) => {
        const queue = queues.get(name) ?? [];
        queues.set(name, queue);
        const start = () => {
          grant(name, callback).then(resolve, reject);
        };
        queue.push(start);
        options.signal?.addEventListener('abort', () => {
          const at = queue.indexOf(start);
          if (at >= 0) queue.splice(at, 1);
          reject(new DOMException('The request was aborted', 'AbortError'));
        });
      });
    },
    held: (name) => holders.has(name),
  };
}

/**
 * BroadcastChannels between the "tabs" of a test: a message posted on one reaches every other one,
 * in a later task (as in a browser), never its sender.
 */
export function fakeChannelHub(): { connect(): BroadcastChannelLike } {
  const members = new Set<{ deliver(data: unknown): void }>();
  return {
    connect() {
      const listeners = new Set<(event: { readonly data: unknown }) => void>();
      const member = {
        deliver(data: unknown) {
          for (const listener of [...listeners]) listener({ data });
        },
      };
      members.add(member);
      return {
        postMessage(message) {
          const data = structuredClone(message);
          for (const other of [...members]) {
            if (other !== member) {
              setTimeout(() => {
                other.deliver(data);
              }, 0);
            }
          }
        },
        addEventListener(_type, listener) {
          listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          listeners.delete(listener);
        },
        close() {
          members.delete(member);
          listeners.clear();
        },
      };
    },
  };
}
