/**
 * `src/nav/worker`: the navigation worker (terrain-navigation.md §9.6). The main thread imports
 * this barrel: the client and the protocol types. The worker's own side (`core.ts`, `host.ts`,
 * `nav.worker.ts`) is loaded by `client.ts` as a module worker, so it stays out of the app chunk.
 */
export * from './client';
export * from './protocol';
