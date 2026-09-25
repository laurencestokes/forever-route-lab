/**
 * Writes dist/third-party-notices.txt (every shipped package: name, version, declared licence,
 * repository and the full licence and NOTICE texts it ships) and copies LICENSE to
 * dist/LICENSE.txt (docs/ARCHITECTURE.md §16). Runs after `vite build`; the output is sorted and
 * contains no dates or install paths.
 *
 * Usage: tsx tools/build/third-party-notices.ts   (part of `pnpm build`)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/fs';
import { collectNoticeEntries, writeDistNotices } from './lib/notices';
import { loadShippedPackages } from './lib/packages';

function main(): number {
  const packages = loadShippedPackages(REPO_ROOT, join(REPO_ROOT, 'tools', 'build', 'bundled-dev-dependencies.json'));
  const entries = collectNoticeEntries(packages);
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { readonly name?: unknown };
  const projectName = typeof manifest.name === 'string' ? manifest.name : 'forever-route-lab';
  writeDistNotices({
    distDir: join(REPO_ROOT, 'dist'),
    licencePath: join(REPO_ROOT, 'LICENSE'),
    projectName,
    entries,
  });
  for (const entry of entries) {
    if (entry.licenceFiles.length === 0) {
      console.warn(`third-party-notices: warning: ${entry.name}@${entry.version} ships no licence file`);
    }
  }
  console.log(`third-party-notices: wrote dist/third-party-notices.txt (${String(entries.length)} packages) and dist/LICENSE.txt`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`third-party-notices: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
