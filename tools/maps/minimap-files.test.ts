/**
 * The minimap folder in the repository (docs/research/map-atlas.md §23.3, §24.4; D-049 O14): the
 * tiles are never tracked by git, and the committed index, manifest, NOTICE and pointer pass the
 * offline checks M1-M11 (M6, M8 and M11 need the tiles and are skipped, saying so, in a clone
 * without the pack). No client is needed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../build/lib/fs';
import { isGitCheckout } from '../questiedb/lib/git';
import { minimapChecks } from './lib/minimap-checks';
import { readCommittedMinimapInputs } from './lib/minimap-inputs';
import { MINIMAP_DIR } from './lib/minimap-params';

const dir = join(REPO_ROOT, MINIMAP_DIR);
const present = existsSync(join(dir, 'manifest.json'));

describe.skipIf(!present)('public/maps/minimap', () => {
  it.skipIf(!isGitCheckout(REPO_ROOT))('tracks no tile: t/ is ignored and nothing under it is in the index', () => {
    const tracked = execFileSync('git', ['ls-files', '--', `${MINIMAP_DIR}/t`], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(tracked.trim()).toBe('');
    const ignored = execFileSync('git', ['check-ignore', '--no-index', '-v', `${MINIMAP_DIR}/t/0/0/0.webp`], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(ignored).toMatch(/public\/maps\/minimap\/t\//);
    // the four committed files are not ignored
    for (const f of ['index.json', 'manifest.json', 'NOTICE.md', 'pack.json']) {
      let ignoredFile: boolean;
      try {
        execFileSync('git', ['check-ignore', '--no-index', '-q', `${MINIMAP_DIR}/${f}`], { cwd: REPO_ROOT });
        ignoredFile = true;
      } catch {
        ignoredFile = false; // exit 1: not ignored
      }
      expect(ignoredFile, f).toBe(false);
    }
  });

  it('passes the offline checks M1-M11', async () => {
    const committed = await readCommittedMinimapInputs(REPO_ROOT);
    const painted = join(REPO_ROOT, 'public/maps/atlas/index.json');
    const report = await minimapChecks({
      dir,
      layout: committed.layout,
      geometry: committed.geometry,
      paintedIndex: existsSync(painted) ? (JSON.parse(readFileSync(painted, 'utf8')) as unknown) : null,
      reliefs: committed.reliefs,
      packFile: null,
    });
    for (const c of report.checks) expect([c.id, c.problems]).toEqual([c.id, []]);
    if (report.tilesPresent === 0) for (const id of ['M6', 'M8', 'M11']) expect(report.checks.find((c) => c.id === id)?.skipped).not.toBeNull();
  }, 300_000);
});
