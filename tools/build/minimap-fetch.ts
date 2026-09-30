/**
 * `pnpm maps:minimap:fetch` (docs/research/map-atlas.md Part II §23.3; D-049 O14, A17; step MM.6):
 * puts the minimap style's tiles in `public/maps/minimap/t/` from the release-asset tile pack that
 * the committed `pack.json` names and pins by SHA-256. `pnpm build:deploy` (the Pages deploy build)
 * runs it first.
 *
 * 1. Reads the committed `pack.json`, `manifest.json` and `NOTICE.md`, and checks that the tree hash
 *    over the manifest's tiles is the pointer's (a folder without either file has nothing to fetch:
 *    the style was never built, or was removed on request).
 * 2. Obtains the pack: from `--from` (or `MINIMAP_PACK_SOURCE`) when given; otherwise from the local
 *    cache (`.cache/minimap-pack/<asset>`, where `tools/maps/minimap.ts --pack` and
 *    `pnpm maps:minimap:pack` also put it) when that copy has the pinned SHA-256; otherwise from the
 *    release (`https://github.com/<repo>/releases/download/<tag>/<asset>`).
 * 3. Verifies it: its size and SHA-256 against the pointer; `NOTICE.md` first and `manifest.json`
 *    second, each equal to the committed file; then exactly the manifest's tiles, in path order,
 *    each with the manifest's size and SHA-256. Nothing is written unless every check passes.
 * 4. Keeps the verified pack in the cache and installs the tiles (unchanged tiles kept, unlisted
 *    files under `t/` removed).
 *
 * It downloads; it never uploads or publishes (publishing the release is the owner's step, OD-13).
 *
 * Usage: tsx tools/build/minimap-fetch.ts [--from <path | file: URL | https: or http: URL | gh>] [--repo <owner/name>]
 *          [--dir <folder>] [--cache <folder>]
 *   --from   where the pack is: a path, a file:, https: or http: URL, or `gh` (`gh release download`, with
 *            the GitHub CLI's own sign-in, for a private repository or a workflow's GH_TOKEN: the
 *            default release address is fetched without a token, so it serves a public release only); the
 *            environment variable MINIMAP_PACK_SOURCE does the same, so `pnpm build:deploy` can be
 *            pointed at a local pack
 *   --repo   the repository whose release holds the pack (default the project's)
 *   --dir    the minimap folder (default public/maps/minimap)
 *   --cache  the pack cache (default .cache/minimap-pack)
 */
import { relative, resolve } from 'node:path';
import { parseArgs } from '../maps/lib/args';
import { MINIMAP_DIR, MINIMAP_POINTER_FILE, MINIMAP_TILES_DIR } from '../maps/lib/minimap-params';
import { formatBytes, REPO_ROOT } from './lib/fs';
import {
  cachePack,
  installTiles,
  MINIMAP_PACK_CACHE,
  MINIMAP_RELEASE_REPOSITORY,
  PackError,
  parsePackSource,
  readCachedPack,
  readCommittedPack,
  readPackSource,
  releaseUrl,
  verifyPack,
} from './lib/pack';

const toPosix = (path: string): string => path.split('\\').join('/');
const shown = (path: string): string => toPosix(relative(REPO_ROOT, path)) || '.';

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { values: ['--from', '--repo', '--dir', '--cache'], flags: [] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const dir = resolve(REPO_ROOT, args.values.get('--dir') ?? MINIMAP_DIR);
  const cacheDir = resolve(REPO_ROOT, args.values.get('--cache') ?? MINIMAP_PACK_CACHE);
  const repository = args.values.get('--repo') ?? MINIMAP_RELEASE_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error(`--repo must be <owner>/<name>, not ${repository}`);
  const env = process.env['MINIMAP_PACK_SOURCE'];
  const given = args.values.get('--from') ?? (env === undefined || env === '' ? null : env);

  const committed = readCommittedPack(dir);
  if (committed === null) {
    console.log(`minimap fetch: ${shown(dir)}/ has no manifest.json or ${MINIMAP_POINTER_FILE} (the style is not built, or was removed on request): nothing to fetch`);
    return 0;
  }
  const { pointer } = committed;
  let tar: Buffer;
  let from: string;
  const cached = given === null ? readCachedPack(cacheDir, pointer) : null;
  if (cached !== null) {
    tar = cached;
    from = `the cache ${shown(cacheDir)}/${pointer.asset}`;
  } else {
    const source = parsePackSource(given ?? releaseUrl(repository, pointer), process.cwd());
    from = source.kind === 'gh' ? `gh release download ${pointer.tag} (${repository})` : source.kind === 'url' ? source.url : toPosix(source.path);
    console.log(`minimap fetch: ${pointer.asset} (${formatBytes(pointer.bytes)}) from ${from}`);
    tar = await readPackSource(source, repository, pointer);
  }
  const verified = verifyPack(tar, committed);
  const cachedAt = cachePack(cacheDir, pointer, tar);
  const installed = installTiles(dir, verified.tiles);
  console.log(
    `minimap fetch: ${pointer.asset} from ${from}: ${formatBytes(tar.length)}, SHA-256 ${pointer.sha256} as ${MINIMAP_POINTER_FILE} pins; ` +
      `NOTICE.md and manifest.json equal the committed ones; ${String(verified.tiles.length)} tiles match the manifest's sizes and SHA-256`,
  );
  console.log(
    `minimap fetch: ${shown(dir)}/${MINIMAP_TILES_DIR}/: ${String(installed.written)} tiles written, ${String(installed.kept)} already there, ${String(installed.removed)} unlisted files removed; pack kept at ${shown(cachedAt)}`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof PackError) console.error(`minimap fetch: FAILED, nothing was installed: ${error.message}`);
    else console.error(`minimap fetch: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
