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
 * Two modes for a map folder whose files come from a release-asset pack (the minimap tiles,
 * docs/research/map-atlas.md §23.4, §24.3; D-049 O14, A18):
 * - plain (`pnpm build`, so `pnpm check`): without any of the pack's files the audit passes, checks
 *   the folder's budget from the manifest's records, and prints a loud warning last, on stderr;
 *   every file present is checked as usual; a partial set fails;
 * - deploy (`--deploy`, run by `pnpm build:deploy`, the Pages deploy build): every file the
 *   manifest lists must be present with its SHA-256.
 * The painted `atlas` and `art` folders have no pack and are checked the same way in both modes.
 *
 * Usage: tsx tools/build/audit-dist.ts [--strip-manifest] [--deploy] [distDir]
 *        (`pnpm build` runs it with --strip-manifest on dist/; `pnpm build:deploy` adds --deploy)
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditDist, formatAuditReport, formatAuditWarnings, parseDistRequirements, removeBuildManifest } from './lib/audit';
import { REPO_ROOT } from './lib/fs';

const STRIP_MANIFEST = '--strip-manifest';
const DEPLOY = '--deploy';

function main(argv: readonly string[]): number {
  const unknown = argv.filter((arg) => arg.startsWith('--') && arg !== STRIP_MANIFEST && arg !== DEPLOY);
  if (unknown.length > 0) throw new Error(`unknown option ${unknown.join(', ')}`);
  const stripManifest = argv.includes(STRIP_MANIFEST);
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const distDir = positional[0] === undefined ? join(REPO_ROOT, 'dist') : resolve(positional[0]);
  const requirements = parseDistRequirements(
    JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'dist-requirements.json'), 'utf8')) as unknown,
  );
  const result = auditDist({ distDir, repoRoot: REPO_ROOT, requirements, deploy: argv.includes(DEPLOY) });
  const report = formatAuditReport(result);
  if (result.violations.length > 0) {
    console.error(report);
    return 1;
  }
  console.log(report);
  if (stripManifest && removeBuildManifest(distDir)) console.log('audit-dist: removed dist/.vite (build manifest, not deployed)');
  const warnings = formatAuditWarnings(result);
  if (warnings !== '') console.warn(warnings);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`audit-dist: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
