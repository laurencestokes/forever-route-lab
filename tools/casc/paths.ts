import { join } from 'node:path';
import { CascError } from './errors';

/**
 * The only paths into a World of Warcraft install that any tool builds (TN-16, D-028):
 *
 * - `<install>/.build.info`;
 * - `<install>/Data/config/<k[0..2]>/<k[2..4]>/<key>` (build and CDN configs);
 * - `<install>/Data/data/<bucket><version>.idx` and `<install>/Data/data/data.NNN`.
 *
 * Every other folder of the install (the account settings, logs, add-ons and the client's own
 * caches) is never read, never listed and never written. Files are opened read-only. The helpers
 * below validate their arguments so a caller cannot smuggle `..` or a separator into a path.
 */

/** The Battle.net default, used when `WOW_INSTALL` is unset. */
export const DEFAULT_WOW_INSTALL = 'C:\\Program Files (x86)\\World of Warcraft';

/** The install root: `WOW_INSTALL`, else the Battle.net default. */
export function resolveInstall(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env['WOW_INSTALL'];
  return value === undefined || value.trim() === '' ? DEFAULT_WOW_INSTALL : value;
}

export function buildInfoPath(install: string): string {
  return join(install, '.build.info');
}

/** `Data/config/ab/cd/abcd…` for a 32-hex config key. */
export function configPath(install: string, key: string): string {
  if (!/^[0-9a-f]{32}$/.test(key)) throw new CascError('path', `config key must be 32 lowercase hex characters, got "${key}"`);
  return join(install, 'Data', 'config', key.slice(0, 2), key.slice(2, 4), key);
}

/** The local data folder, `Data/data`, which holds the `.idx` indices and the `data.NNN` archives. */
export function dataDirectory(install: string): string {
  return join(install, 'Data', 'data');
}

export const INDEX_FILE_NAME = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/;

/** `Data/data/<name>` for an index file name such as `0a0000002f.idx`. */
export function indexPath(install: string, name: string): string {
  if (!INDEX_FILE_NAME.test(name)) throw new CascError('path', `not a local index file name: "${name}"`);
  return join(dataDirectory(install), name);
}

/** `Data/data/data.NNN` for archive number `archive` (0-999). */
export function archivePath(install: string, archive: number): string {
  if (!Number.isInteger(archive) || archive < 0 || archive > 999) throw new CascError('path', `archive number out of range: ${String(archive)}`);
  return join(dataDirectory(install), `data.${String(archive).padStart(3, '0')}`);
}
