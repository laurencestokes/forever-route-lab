/**
 * `pnpm maps:minimap:pack` (docs/research/map-atlas.md Part II §23.3; D-049 O14, A17; step MM.6):
 * assembles the release-asset tile pack from the built tiles, without the client. It reads
 * `public/maps/minimap/NOTICE.md`, `manifest.json` and every tile under `t/`, checks each tile
 * against the manifest (size and SHA-256; none missing, nothing unlisted), writes the deterministic
 * tar of `NOTICE.md`, `manifest.json` and `t/`, in that order (`tools/maps/lib/minimap-pack.ts`), and
 * refuses unless the result is byte for byte the pack the committed `pack.json` pins.
 *
 * It publishes nothing. Publishing the release is the owner's step (OD-13, D-049 O14); the command it
 * prints for that is for the owner to run, with the NOTICE as the release text.
 *
 * Usage: tsx tools/build/minimap-pack.ts [--dir <folder>] [--out <file>] [--repo <owner/name>]
 *   --dir   the minimap folder (default public/maps/minimap)
 *   --out   where to write the pack (default .cache/minimap-pack/<asset>)
 *   --repo  the repository named in the printed release command (default the project's)
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from '../maps/lib/args';
import { MINIMAP_DIR, MINIMAP_NOTICE_FILE, MINIMAP_POINTER_FILE } from '../maps/lib/minimap-params';
import { formatBytes, REPO_ROOT } from './lib/fs';
import { assemblePack, MINIMAP_PACK_CACHE, MINIMAP_RELEASE_REPOSITORY, PackError, readCommittedPack } from './lib/pack';

const toPosix = (path: string): string => path.split('\\').join('/');
const shown = (path: string): string => toPosix(relative(REPO_ROOT, path)) || '.';

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, { values: ['--dir', '--out', '--repo'], flags: [] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const dir = resolve(REPO_ROOT, args.values.get('--dir') ?? MINIMAP_DIR);
  const repository = args.values.get('--repo') ?? MINIMAP_RELEASE_REPOSITORY;
  const committed = readCommittedPack(dir);
  if (committed === null) throw new PackError([`${shown(dir)}/ has no manifest.json or ${MINIMAP_POINTER_FILE}: build the style with tools/maps/minimap.ts first`]);
  const { pointer } = committed;
  const tar = assemblePack(committed);
  const out = resolve(REPO_ROOT, args.values.get('--out') ?? join(MINIMAP_PACK_CACHE, pointer.asset));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.part`, tar);
  renameSync(`${out}.part`, out);
  console.log(`minimap pack: ${shown(out)}: ${String(committed.tiles.length)} tiles checked against the manifest; ${formatBytes(tar.length)} (${String(tar.length)} B), SHA-256 ${pointer.sha256}, as ${MINIMAP_POINTER_FILE} pins`);
  console.log('minimap pack: contents in order: NOTICE.md, manifest.json, t/');
  console.log(`minimap pack: nothing is published. Once the owner allows it (OD-13), the owner publishes it with:\n  gh release create ${pointer.tag} ${toPosix(relative(process.cwd(), out)) || toPosix(out)} --repo ${repository} --title ${pointer.tag} --notes-file ${toPosix(relative(process.cwd(), join(dir, MINIMAP_NOTICE_FILE)))}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`minimap pack: ${error instanceof PackError ? 'FAILED: ' : ''}${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
