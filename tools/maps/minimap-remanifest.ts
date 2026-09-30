/**
 * tools/maps minimap-remanifest (review findings MD-01, MD-02, MD-05): re-derives
 * `public/maps/minimap/manifest.json`, `NOTICE.md` and `pack.json` (and, with `--pack`, the pack)
 * **without the client**, from the committed tiles and manifest, when only the code's part of them
 * changed (the tool tree hash, the NOTICE's and alterations' wording, the pack's name). See
 * `lib/minimap-remanifest.ts` for what it carries over and what it refuses.
 *
 * It is a stopgap, recorded in the manifest (`tool.remanifest`), not a build: `maps:validate` MT
 * fails while that record is there, and the §23.4 gate stays `pnpm tsx tools/maps/minimap.ts --pack`
 * and then `--check --pack` on the pinned client before a commit or a release.
 *
 * Usage: pnpm tsx tools/maps/minimap-remanifest.ts [--dir <folder>] [--pack [file]] [--why <text>] [--check]
 *   --dir    the minimap folder (default public/maps/minimap)
 *   --pack   also write the pack (default .cache/minimap-pack/<asset>)
 *   --why    the reason recorded in the manifest (default: the pinned client is not installed)
 *   --check  compare with the folder instead of writing
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { formatBytes, REPO_ROOT } from '../build/lib/fs';
import { toolTreeHash } from '../terrain/lib/tool-tree';
import { parseArgs } from './lib/args';
import { MINIMAP_DIR, MINIMAP_MANIFEST_FILE, MINIMAP_NOTICE_FILE, MINIMAP_POINTER_FILE, MINIMAP_TOOL_ENTRY } from './lib/minimap-params';
import { remanifestMinimap } from './lib/minimap-remanifest';
import { CLIENT_PIN } from './lib/shared';

const DEFAULT_PACK_DIR = '.cache/minimap-pack';
const DEFAULT_WHY = `the pinned client (${CLIENT_PIN.product} ${CLIENT_PIN.version}) is not installed, so minimap.ts cannot run; only the code's part of these files changed`;
const toPosix = (path: string): string => path.split('\\').join('/');

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, { values: ['--dir', '--why'], flags: ['--check'], optionalValues: ['--pack'] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const dir = resolve(REPO_ROOT, args.values.get('--dir') ?? MINIMAP_DIR);
  const tree = toolTreeHash(REPO_ROOT, [join(REPO_ROOT, MINIMAP_TOOL_ENTRY)]);
  const out = remanifestMinimap(dir, { hash: tree.hash, files: tree.files.length }, args.values.get('--why') ?? DEFAULT_WHY);
  const files = [
    [MINIMAP_MANIFEST_FILE, out.manifestText],
    [MINIMAP_NOTICE_FILE, out.noticeText],
    [MINIMAP_POINTER_FILE, out.pointerText],
  ] as const;
  const shown = toPosix(relative(REPO_ROOT, dir));
  if (args.flags.has('--check')) {
    const differs = files.filter(([name, text]) => !existsSync(join(dir, name)) || readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n') !== text).map(([name]) => name);
    for (const name of differs) console.error(`minimap remanifest: ${name}: differs`);
    if (differs.length === 0) console.log(`minimap remanifest: ${shown}/ is what the re-derivation writes (tool tree ${tree.hash.slice(0, 12)}…)`);
    return differs.length === 0 ? 0 : 1;
  }
  for (const [name, text] of files) writeFileSync(join(dir, name), text);
  console.log(`minimap remanifest: wrote ${shown}/${MINIMAP_MANIFEST_FILE}, ${MINIMAP_NOTICE_FILE} and ${MINIMAP_POINTER_FILE} without the client: ${String(out.tiles)} tiles carried over as the manifest lists them; tool tree ${tree.hash} (${String(tree.files.length)} files), re-derived from ${out.record.fromToolTreeHash.slice(0, 12)}…`);
  console.log(`minimap remanifest: pack ${out.pointer.asset}, ${formatBytes(out.pointer.bytes)} (${String(out.pointer.bytes)} B), SHA-256 ${out.pointer.sha256}; tag ${out.pointer.tag}`);
  if (args.flags.has('--pack') || args.values.has('--pack')) {
    const path = resolve(REPO_ROOT, args.values.get('--pack') ?? join(DEFAULT_PACK_DIR, out.pointer.asset));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, out.pack);
    renameSync(`${path}.part`, path);
    console.log(`minimap remanifest: pack written to ${toPosix(relative(REPO_ROOT, path))}`);
  }
  console.warn('minimap remanifest: not the §23.4 gate: maps:validate MT fails until tools/maps/minimap.ts --pack, then --check --pack, runs on the pinned client; do not publish this pack before then');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`minimap remanifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
