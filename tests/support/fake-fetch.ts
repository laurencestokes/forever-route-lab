import { webcrypto } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRevisionInput } from '../../src/infra/data/manifest';
import { sha256Hex, type Sha256Digest } from '../../src/infra/hash';
import type { FetchInit, FetchLike } from '../../src/infra/http';

/**
 * A fake `fetch` over in-memory files, for the loader tests and the loader benchmark. src/ tests
 * may not import Node builtins (tests/architecture.test.ts), so reading fixtures from disk happens
 * here. Every response is a real `Response`, so `ok`, `status` and `arrayBuffer()` behave as in a
 * browser.
 */

/** From the module's own path (a string: happy-dom replaces the global URL in component tests). */
/** File contents as the fake server holds them (a plain ArrayBuffer, as a Response body needs). */
export type Bytes = Uint8Array<ArrayBuffer>;

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Node's WebCrypto digest (the browser's `crypto.subtle` in the app). */
export const nodeSha256: Sha256Digest = webcrypto.subtle;

/** Every file directly in `dir` (relative to the repository root), keyed `<prefix><name>`. */
export function readDirectory(dir: string, prefix: string): Map<string, Bytes> {
  const root = join(REPO_ROOT, dir);
  const out = new Map<string, Bytes>();
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    if (statSync(path).isFile()) out.set(`${prefix}${name}`, new Uint8Array(readFileSync(path)));
  }
  return out;
}

/** The fixture slice under `data/` and the committed placeholder geometry under `maps/placeholder/`. */
export function fixtureSite(): Map<string, Bytes> {
  return new Map([...readDirectory('tests/fixtures/data', 'data/'), ...readDirectory('public/maps/placeholder', 'maps/placeholder/')]);
}

/** The full committed dataset and geometry (as deployed). */
export function publicSite(): Map<string, Bytes> {
  return new Map([...readDirectory('public/data', 'data/'), ...readDirectory('public/maps/placeholder', 'maps/placeholder/')]);
}

export interface FakeRequest {
  readonly url: string;
  readonly cache: RequestCache | undefined;
}

/** A route's answer: a response, an error to reject with, a pending response (a slow server), or undefined to fall through. */
export type FakeRoute = (url: string, init: FetchInit | undefined, attempt: number) => Response | Error | Promise<Response> | undefined;

export interface FakeServer {
  readonly fetch: FetchLike;
  readonly requests: FakeRequest[];
  /** Replaces, adds (bytes or text) or removes (null: 404) a file. */
  set(path: string, body: Bytes | string | null): void;
  /** A route consulted before the files; return undefined to fall through. */
  route(handler: FakeRoute): void;
}

const encoder = new TextEncoder();

/**
 * A server over `files` (paths relative to the base URL). Unknown paths answer 404, like a static
 * host; `route` handlers can answer anything else (errors, HTML fallbacks, tampered bytes).
 */
export function fakeServer(files: ReadonlyMap<string, Bytes>, base = './'): FakeServer {
  const store = new Map(files);
  const routes: FakeRoute[] = [];
  const attempts = new Map<string, number>();
  const requests: FakeRequest[] = [];
  const fetch: FetchLike = (url, init) => {
    requests.push({ url, cache: init?.cache });
    // As in browsers, a request on an aborted signal rejects with the signal's reason.
    if (init?.signal?.aborted === true) return Promise.reject(init.signal.reason as Error);
    const path = url.startsWith(base) ? url.slice(base.length) : url;
    const attempt = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, attempt);
    for (const route of routes) {
      const answer = route(path, init, attempt);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer instanceof Promise) return answer;
      if (answer !== undefined) return Promise.resolve(answer);
    }
    const body = store.get(path);
    // A copy, so a caller that keeps the buffer never sees a later `set`.
    return Promise.resolve(body === undefined ? new Response('Not found', { status: 404 }) : new Response(body.slice()));
  };
  return {
    fetch,
    requests,
    set(path, body) {
      if (body === null) store.delete(path);
      else store.set(path, typeof body === 'string' ? encoder.encode(body) : body);
    },
    route(handler) {
      routes.push(handler);
    },
  };
}

export const text = (bytes: Bytes | undefined): string => new TextDecoder().decode(bytes);

/**
 * A request that is still in flight: it never answers, and rejects with the signal's reason when
 * the signal aborts, as a browser's fetch does.
 */
export function inFlight(init: FetchInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/** A 200 response whose body fails part-way through, like a connection dropped mid-download. */
export function droppedBody(message = 'network error'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"partial":'));
      controller.error(new TypeError(message));
    },
  });
  return new Response(stream);
}

/**
 * `site` with `path` replaced by `body` and `data/manifest.json` re-signed to match (the output's
 * size and SHA-256, and the dataRevision): a consistent deploy of an edited file, which only the
 * checks after the hashes can tell apart.
 */
export async function withSignedFile(site: ReadonlyMap<string, Bytes>, path: string, body: string): Promise<Map<string, Bytes>> {
  const out = new Map(site);
  const bytes = encoder.encode(body);
  out.set(path, bytes);
  const manifest = JSON.parse(text(site.get('data/manifest.json'))) as { dataRevision: string; outputs: { path: string; sha256: string; bytes: number }[] };
  const name = path.replace(/^data\//, '');
  const entry = manifest.outputs.find((o) => o.path === name);
  if (entry === undefined) throw new Error(`the manifest lists no ${name}`);
  entry.sha256 = await sha256Hex(nodeSha256, bytes);
  entry.bytes = bytes.byteLength;
  manifest.dataRevision = await sha256Hex(nodeSha256, dataRevisionInput(manifest.outputs));
  out.set('data/manifest.json', encoder.encode(JSON.stringify(manifest)));
  return out;
}

/** Parses one of the site's JSON files. */
export function jsonOf(site: ReadonlyMap<string, Bytes>, path: string): unknown {
  return JSON.parse(text(site.get(path))) as unknown;
}
