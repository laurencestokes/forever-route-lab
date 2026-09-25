import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localObjects } from '../../questiedb/lib/git';
import { blobAvailableOffline, gitEnv, headCommit, isTracked, readGitBlob, resolveCommit } from './git';
import { tempDir, writeFile } from './test-support';

let dir = '';
let dispose = (): void => undefined;
beforeEach(() => {
  ({ dir, dispose } = tempDir('frl-maps-git-'));
});
afterEach(() => dispose());

/** A throwaway repository with one commit; the file is committed as CRLF-free text with autocrlf off. */
function commitFile(path: string, content: string): string {
  const run = (args: readonly string[]): string =>
    execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=false', '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  run(['init', '-q']);
  writeFile(dir, path, content);
  run(['add', '--', path]);
  run(['commit', '-q', '--no-gpg-sign', '-m', 'fixture']);
  return run(['rev-parse', 'HEAD']);
}

describe('tools/maps git access', () => {
  it('runs every git call with GIT_NO_LAZY_FETCH=1, keeping the rest of the environment', () => {
    const env = gitEnv();
    expect(env['GIT_NO_LAZY_FETCH']).toBe('1');
    expect(env['PATH'] ?? env['Path']).toBe(process.env['PATH'] ?? process.env['Path']);
  });

  it('reads a blob exactly as stored, resolves commits, and reports tracking and HEAD', () => {
    const commit = commitFile('data/conversion.json', '{\n  "a": 1\n}\n');
    expect(resolveCommit(dir, 'HEAD')).toBe(commit);
    expect(readGitBlob(dir, commit, 'data/conversion.json').toString('utf8')).toBe('{\n  "a": 1\n}\n');
    expect(isTracked(dir, 'data/conversion.json')).toBe(true);
    expect(isTracked(dir, 'data/other.json')).toBe(false);
    expect(headCommit(dir)).toBe(commit);
  }, 30_000);

  it('fails with a clear message for an absent commit or path', () => {
    const commit = commitFile('a.txt', 'a\n');
    expect(() => resolveCommit(dir, 'f'.repeat(40))).toThrow(/is not available in/);
    expect(() => readGitBlob(dir, commit, 'missing.json')).toThrow(/cannot read missing.json/);
  }, 30_000);

  it('refuses a blob a partial clone lacks instead of fetching it, whatever the git version (data-F4, code-F10)', () => {
    const origin = join(dir, 'origin');
    const clone = join(dir, 'clone');
    mkdirSync(origin);
    const run = (cwd: string, args: readonly string[]): string =>
      execFileSync('git', ['-C', cwd, '-c', 'core.autocrlf=false', '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }).trim();
    run(origin, ['init', '-q']);
    writeFile(origin, 'data/conversion.json', '{}\n');
    run(origin, ['add', '--', 'data/conversion.json']);
    run(origin, ['commit', '-q', '--no-gpg-sign', '-m', 'fixture']);
    run(origin, ['config', 'uploadpack.allowFilter', 'true']);
    const commit = run(origin, ['rev-parse', 'HEAD']);
    const blob = run(origin, ['rev-parse', `${commit}:data/conversion.json`]);
    run(dir, ['clone', '-q', '--no-local', '--no-checkout', '--filter=blob:none', `file://${origin.replace(/\\/g, '/')}`, clone]);

    expect(blobAvailableOffline(origin, commit, 'data/conversion.json')).toBe(true);
    expect(blobAvailableOffline(clone, commit, 'data/conversion.json')).toBe(false);
    expect(() => readGitBlob(clone, commit, 'data/conversion.json')).toThrow(/not in the local object store of the partial clone .* never fetches/);
    // Nothing was fetched: the blob is still missing locally.
    expect(localObjects(clone).has(blob)).toBe(false);
  }, 60_000);
});
