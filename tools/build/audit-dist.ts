/**
 * Audits dist/ after a build (docs/ARCHITECTURE.md §14, §16; docs/MAPS.md §5.7; D-018, D-025):
 * no local map sets or local-only data, no images outside the app-asset allowlist, no user paths
 * or `.cache` references, no Lua, BLP or source maps, every required notice present, and the
 * entry chunk plus its static imports within the gzip budget. Prints a size report (with the
 * lazily loaded chunks, reported but not gated); exits non-zero on any violation.
 *
 * With --strip-manifest, a passing audit then deletes dist/.vite: the Vite build manifest the
 * entry-chunk gate reads has no runtime use and must not deploy. A failing audit keeps it for
 * diagnosis (the build has failed anyway).
 *
 * Usage: tsx tools/build/audit-dist.ts [--strip-manifest] [distDir]
 *        (`pnpm build` runs it with --strip-manifest on dist/)
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditDist, formatAuditReport, parseDistRequirements, removeBuildManifest } from './lib/audit';
import { REPO_ROOT } from './lib/fs';

const STRIP_MANIFEST = '--strip-manifest';

function main(argv: readonly string[]): number {
  const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== STRIP_MANIFEST);
  if (unknown.length > 0) throw new Error(`unknown option ${unknown.join(', ')}`);
  const stripManifest = argv.includes(STRIP_MANIFEST);
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const distDir = positional[0] === undefined ? join(REPO_ROOT, 'dist') : resolve(positional[0]);
  const requirements = parseDistRequirements(
    JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'dist-requirements.json'), 'utf8')) as unknown,
  );
  const result = auditDist({ distDir, repoRoot: REPO_ROOT, requirements });
  const report = formatAuditReport(result);
  if (result.violations.length > 0) {
    console.error(report);
    return 1;
  }
  console.log(report);
  if (stripManifest && removeBuildManifest(distDir)) console.log('audit-dist: removed dist/.vite (build manifest, not deployed)');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`audit-dist: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
