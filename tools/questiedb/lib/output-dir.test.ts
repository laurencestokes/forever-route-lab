import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readerFor, snapshot } from './diff-source';
import { isGitCheckout } from './git';
import { compareDirectory, staleFiles } from './output-dir';
import { REPO_ROOT } from './upstream';

const temps: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'questiedb-out-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('extract --check (code-F11)', () => {
  const rendered = new Map([
    ['a.json', '{}\n'],
    ['NOTICE.md', '# n\n'],
  ]);

  it('passes when the directory holds exactly the rendered files', () => {
    const dir = tempDir();
    for (const [name, content] of rendered) writeFileSync(join(dir, name), content, 'utf8');
    expect(compareDirectory(dir, rendered, dir)).toEqual([]);
  });

  it('reports a missing file, a changed file and a stray file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.json'), '{"edited":true}\n', 'utf8');
    writeFileSync(join(dir, 'old.json'), '{}\n', 'utf8');
    expect(staleFiles(dir, rendered)).toEqual(['old.json']);
    expect(compareDirectory(dir, rendered, dir)).toEqual([
      'a.json: differs from a fresh extraction',
      'NOTICE.md: missing',
      'old.json: not a file the extractor writes (remove it)',
    ]);
  });
});

describe('pnpm data:diff sources (code-F13)', () => {
  it.skipIf(!isGitCheckout(REPO_ROOT))('tells a revision that does not exist from a file that is absent at a revision', () => {
    expect(() => readerFor('git:no-such-revision-0123', REPO_ROOT)).toThrow(/revision "no-such-revision-0123" is not a commit of this repository/);
    // An existing revision without the file reads as absent (null), not as an error.
    expect(readerFor('git:HEAD', REPO_ROOT).read('no-such-file.json')).toBeNull();
  });

  it('reads a manifest-only source and refuses a directory without a manifest', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'manifest.json'), '{"dataRevision":"x"}\n', 'utf8');
    const manifestOnly = snapshot(readerFor(join(dir, 'manifest.json'), REPO_ROOT));
    expect(manifestOnly.records).toBeNull();
    expect(manifestOnly.manifest).toEqual({ dataRevision: 'x' });
    expect(() => snapshot(readerFor(tempDir(), REPO_ROOT))).toThrow(/no manifest\.json there/);
    expect(() => readerFor(join(dir, 'missing-dir'), REPO_ROOT)).toThrow(/no such directory/);
  });
});
