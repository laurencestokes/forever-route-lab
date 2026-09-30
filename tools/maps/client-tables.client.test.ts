/**
 * Step MP.5a against the local Forever client (map-presentation.md §16; D-039): `--check` rebuilds
 * `public/maps/client/` from the pinned client and finds it byte-identical. Needs the pinned build
 * at WOW_INSTALL and skips with a banner otherwise. Read-only; nothing is written.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../build/lib/fs';
import { announceSkip, pinnedClientStatus } from '../casc/test-support';
import { CLIENT_TABLES_DIR } from './lib/client-data/constants';
import type { ClientTablesBuild } from './lib/client-data/output';
import { buildFromClient, checkFolder } from './lib/client-data/run';

const status = pinnedClientStatus();

it('finds the pinned client, or says loudly why the client-table checks are skipped', () => {
  if (!status.available) announceSkip('tools/maps client tables on the client (client-tables.client.test.ts)', status.reason);
  expect(status.available || status.reason.length > 0).toBe(true);
});

describe.skipIf(!status.available)('client tables on the pinned Forever client', () => {
  let build: ClientTablesBuild;

  beforeAll(() => {
    if (status.available) build = buildFromClient(status.install);
  });

  it('rebuilds public/maps/client byte for byte', () => {
    expect(checkFolder(join(REPO_ROOT, CLIENT_TABLES_DIR), build)).toEqual([]);
    expect(build.taxi.counts).toMatchObject({ nodes: 65, pairs: 143, flights: 286, transports: 14 });
    expect(build.dungeons.counts.lfgRows).toBe(30);
  });

  it('passes --check from the command line', () => {
    const output = execFileSync(process.execPath, [join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'tools/maps/client-tables.ts', '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, WOW_INSTALL: status.available ? status.install : '' },
    });
    expect(output).toContain('public/maps/client is up to date');
  }, 60_000);
});
