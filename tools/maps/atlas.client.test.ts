/**
 * Step ATL.6 against the local Forever client (docs/research/map-atlas.md §7.3, §7.4): the whole
 * atlas is rebuilt in memory from the client's lossless rasters and compared byte for byte with the
 * committed `public/maps/atlas/`, which an earlier, separate run of `tools/maps/atlas.ts` wrote: a
 * double build that must be byte-identical (tiles, index, manifest, NOTICE). It needs the pinned build
 * at WOW_INSTALL and skips with a banner otherwise; it takes about two minutes. Read-only; nothing is
 * written.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../build/lib/fs';
import { LocalCasc } from '../casc/casc';
import { announceSkip, FOREVER_TEST_PIN, pinnedClientStatus } from '../casc/test-support';
import { buildAtlas, type AtlasBuild } from './lib/atlas-build';
import { listAtlasTree } from './lib/atlas-checks';
import { readAtlasClient, readAtlasInputs } from './lib/atlas-inputs';
import { ATLAS_DIR, ATLAS_MANIFEST_FILE, parseAtlasManifest } from './lib/atlas-manifest';
import { ATLAS_TOOL_DIRS } from './lib/atlas-params';
import { DEFAULT_WEBP, encoderIdentity } from './lib/encode';
import { toolTrees } from './lib/tool-tree';

const status = pinnedClientStatus();
const committed = existsSync(join(REPO_ROOT, ATLAS_DIR, ATLAS_MANIFEST_FILE));

it('finds the pinned client and the committed atlas, or says loudly why the atlas client test is skipped', () => {
  if (!status.available) announceSkip('tools/maps atlas double build on the client (atlas.client.test.ts)', status.reason);
  else if (!committed) announceSkip('tools/maps atlas double build on the client (atlas.client.test.ts)', `${ATLAS_DIR} has not been built`);
  expect(status.available || status.reason.length > 0).toBe(true);
});

describe.skipIf(!status.available || !committed)('the atlas on the pinned Forever client', () => {
  it('rebuilds public/maps/atlas byte for byte from the client (a second, independent build)', async () => {
    if (!status.available) return;
    const inputs = readAtlasInputs(REPO_ROOT);
    const casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
    let build: AtlasBuild | undefined;
    try {
      const client = readAtlasClient(casc, inputs);
      build = await buildAtlas(
        { ...inputs, ...client },
        { client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey }, toolTrees: toolTrees(REPO_ROOT, ATLAS_TOOL_DIRS), encoder: encoderIdentity(), webp: DEFAULT_WEBP, encodeJobs: 8 },
      );
    } finally {
      casc.close();
    }
    if (build === undefined) throw new Error('no build');
    const dir = join(REPO_ROOT, ATLAS_DIR);
    const recorded = parseAtlasManifest(JSON.parse(readFileSync(join(dir, ATLAS_MANIFEST_FILE), 'utf8')) as unknown).manifest;
    expect(recorded).not.toBeNull();
    // every tile, as the committed manifest records it
    const want = new Map((recorded?.files ?? []).map((f) => [f.path, f.sha256]));
    const got = new Map([['index.json', ''], ...build.tiles.map((t) => [t.path, ''] as const)]);
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    const differs = build.tiles.filter((t) => !readFileSync(join(dir, t.path)).equals(t.bytes)).map((t) => t.path);
    expect(differs).toEqual([]);
    expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(build.indexText);
    // The manifest byte for byte, except the tool tree ids: any later edit under tools/maps or
    // tools/casc changes those without changing a pixel (`atlas.ts --check` compares them too).
    const withoutTrees = (text: string): unknown => {
      const value = JSON.parse(text) as { tool: { toolTreeHash?: unknown; treeMethod?: unknown } };
      delete value.tool.toolTreeHash;
      delete value.tool.treeMethod;
      return value;
    };
    expect(withoutTrees(readFileSync(join(dir, ATLAS_MANIFEST_FILE), 'utf8'))).toEqual(withoutTrees(build.manifestText));
    expect(readFileSync(join(dir, 'NOTICE.md'), 'utf8')).toBe(build.noticeText);
    expect(listAtlasTree(dir).length).toBe(build.tiles.length + 3);
    // the lettering census of the reviewed list: nothing cut at any level
    expect(build.lettering.counts.cut).toBe(0);
    expect(build.lettering.fineCounts.cut).toBe(0);
  }, 900_000);
});
