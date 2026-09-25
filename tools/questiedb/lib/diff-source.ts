import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatasetSnapshot } from './diff-lib';

/**
 * Where `pnpm data:diff` reads a dataset from (DATA_PROVENANCE §9.4): a data directory, a
 * `manifest.json` (hashes and counts only) or `git:<rev>` (this repository's `public/data` at that
 * revision). For `git:`, a revision that does not exist is an error of its own, distinct from a file
 * that is absent at an existing revision (review finding code-F13).
 */

export type Reader = (name: string) => string | null;

export interface DiffSource {
  readonly label: string;
  readonly read: Reader;
  readonly manifestOnly: boolean;
}

export function readerFor(source: string, repoRoot: string): DiffSource {
  if (source.startsWith('git:')) {
    const rev = source.slice('git:'.length);
    const run = (args: readonly string[]): Buffer =>
      execFileSync('git', [...args], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    try {
      run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    } catch {
      throw new Error(`${source}: revision ${JSON.stringify(rev)} is not a commit of this repository`);
    }
    return {
      label: source,
      manifestOnly: false,
      read: (name) => {
        const spec = `${rev}:public/data/${name}`;
        try {
          run(['cat-file', '-e', spec]);
        } catch {
          return null; // the file does not exist at that revision
        }
        return run(['show', spec]).toString('utf8');
      },
    };
  }
  const path = resolve(source);
  if (existsSync(path) && statSync(path).isFile()) {
    if (basename(path) !== 'manifest.json') throw new Error(`${source}: expected a directory, a manifest.json or git:<rev>`);
    const dir = dirname(path);
    return { label: source, manifestOnly: true, read: (name) => (name === 'manifest.json' ? readFileSync(join(dir, name), 'utf8') : null) };
  }
  if (!existsSync(path)) throw new Error(`${source}: no such directory`);
  return { label: source, manifestOnly: false, read: (name) => (existsSync(join(path, name)) ? readFileSync(join(path, name), 'utf8') : null) };
}

export function snapshot(source: DiffSource): DatasetSnapshot {
  const { label, read, manifestOnly } = source;
  const json = (name: string): Record<string, unknown> | null => {
    const text = read(name);
    return text === null ? null : (JSON.parse(text) as Record<string, unknown>);
  };
  const manifest = json('manifest.json');
  if (manifest === null) throw new Error(`${label}: no manifest.json there`);
  if (manifestOnly) return { label, records: null, spawns: null, zones: null, overlays: null, manifest };
  const quests = json('quests.json');
  const entities = json('entities.json');
  const items = json('items.json');
  const spawns = json('spawns.json');
  type Rows = DatasetSnapshot extends { readonly records: infer R } ? NonNullable<R> : never;
  const records =
    quests === null || entities === null || items === null
      ? null
      : ({ quests: quests.rows, npcs: entities.npcs, objects: entities.objects, items: items.rows } as unknown as Rows);
  return {
    label,
    records,
    spawns: spawns === null ? null : { npc: spawns.npc as Record<string, unknown>, object: spawns.object as Record<string, unknown> },
    zones: json('zones.json'),
    overlays: json('overlays.json'),
    manifest,
  };
}
