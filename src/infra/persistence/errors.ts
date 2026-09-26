/**
 * Storage failures, classified so the app can say what happened (docs/ARCHITECTURE.md §12.3):
 *
 * - `quota`: the browser's storage for this site is full (`QuotaExceededError`);
 * - `unavailable`: the browser refuses storage here (a private window in some browsers, site data
 *   blocked, no IndexedDB at all, or an open that never answers);
 * - `closed`: the connection is gone (another tab upgraded the database, or the browser closed it);
 * - `failed`: anything else, with the browser's message.
 */

export type StorageErrorCode = 'quota' | 'unavailable' | 'closed' | 'failed';

export class StorageError extends Error {
  override readonly name = 'StorageError';
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** DOMException names (and Firefox's legacy one) that mean the quota is exhausted. */
const QUOTA_NAMES: ReadonlySet<string> = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

function errorName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name: unknown = (error as { readonly name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const message: unknown = (error as { readonly message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/**
 * The StorageError for `error`. `whileOpening`: the error came from opening the database, where
 * `InvalidStateError`, `SecurityError` and `NotAllowedError` mean the browser refuses storage here
 * (Firefox before version 115 in a private window, blocked site data).
 */
export function toStorageError(error: unknown, whileOpening = false): StorageError {
  if (error instanceof StorageError) return error;
  const name = errorName(error);
  const message = errorMessage(error);
  if (name !== null && QUOTA_NAMES.has(name)) {
    return new StorageError('quota', `Browser storage for this site is full (${message})`, { cause: error });
  }
  if (whileOpening && (name === 'InvalidStateError' || name === 'SecurityError' || name === 'NotAllowedError' || name === 'UnknownError')) {
    return new StorageError('unavailable', `The browser does not allow storage here (${name}: ${message})`, { cause: error });
  }
  if (name === 'InvalidStateError') {
    return new StorageError('closed', `The storage connection is closed (${message})`, { cause: error });
  }
  return new StorageError('failed', message === '' ? (name ?? 'Unknown storage error') : message, { cause: error });
}
