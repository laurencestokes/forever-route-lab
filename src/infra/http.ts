/**
 * The slice of `fetch` the loaders use, so tests can pass a fake over files on disk and the app
 * passes `window.fetch`. Every URL is relative to the app's base (`import.meta.env.BASE_URL`,
 * ARCHITECTURE §16), which the caller supplies: nothing here reads `import.meta.env`.
 */

export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FetchInit {
  readonly cache?: RequestCache;
  readonly signal?: AbortSignal;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<ResponseLike>;

/** `base` with exactly one trailing slash ('' stays '', meaning "relative to the page"). */
export function normaliseBase(base: string): string {
  if (base === '') return '';
  return base.endsWith('/') ? base : `${base}/`;
}

/** `base` + `path`, where `path` is relative (no leading slash). */
export function joinUrl(base: string, path: string): string {
  return `${normaliseBase(base)}${path}`;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Strict UTF-8 decoding: invalid bytes throw instead of turning into U+FFFD. */
export function decodeUtf8(bytes: ArrayBuffer): string {
  return decoder.decode(bytes);
}
