/**
 * `src/infra/persistence`: project storage in IndexedDB (docs/ARCHITECTURE.md §12.3), with an
 * in-memory fallback when the browser refuses storage, and the links between tabs that share it
 * (Web Locks, BroadcastChannel). The app interprets the records (src/app/project-library.ts); this
 * module only stores them.
 */
export { StorageError, type StorageErrorCode, toStorageError } from './errors';
export { createIdbProjectStorage, openProjectDb, PROJECT_DB_NAME, PROJECT_DB_VERSION, type ProjectDbSchema } from './idb-storage';
export { createMemoryProjectStorage, deepFreeze } from './memory-storage';
export { browserIndexedDb, browserStorageManager, openProjectStorage, type OpenedProjectStorage, type OpenProjectStorageOptions } from './open';
export {
  announcingChanges,
  broadcastChanges,
  type BroadcastChannelLike,
  browserProjectLocks,
  browserStorageChannel,
  type HeldLock,
  type LockManagerLike,
  projectLockName,
  type ProjectLocks,
  readStorageChange,
  STORAGE_CHANNEL_NAME,
  type StorageChange,
  type StorageChangeChannel,
  webLocks,
} from './tabs';
export type * from './types';
