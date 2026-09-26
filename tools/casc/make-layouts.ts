/**
 * `pnpm tsx tools/casc/make-layouts.ts [--check] [--dbd-dir <dir>]…`
 *
 * Regenerates `tools/casc/layouts.ts` from the research copies of WoWDBDefs (layout-source.ts), or
 * with `--check` fails when the committed file differs. It never downloads anything.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DBD_DIRS, readLayoutSources, renderLayoutsModule } from './layout-source';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = 'tools/casc/layouts.ts';

function main(argv: readonly string[]): number {
  const dirs: string[] = [];
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') check = true;
    else if (arg === '--dbd-dir' && argv[i + 1] !== undefined) {
      dirs.push(argv[i + 1] ?? '');
      i += 1;
    } else throw new Error(`unknown argument "${arg ?? ''}"`);
  }
  const text = renderLayoutsModule(readLayoutSources(REPO_ROOT, dirs.length > 0 ? dirs : DEFAULT_DBD_DIRS));
  const out = join(REPO_ROOT, OUT);
  if (check) {
    const same = existsSync(out) && readFileSync(out, 'utf8').replace(/\r\n/g, '\n') === text;
    console.log(same ? `make-layouts: ${OUT} is up to date` : `make-layouts: ${OUT} differs from the WoWDBDefs copies`);
    return same ? 0 : 1;
  }
  writeFileSync(out, text);
  console.log(`make-layouts: wrote ${OUT} (${String(Buffer.byteLength(text))} bytes)`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`make-layouts: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
