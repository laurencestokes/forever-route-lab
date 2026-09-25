/**
 * Licence gate (docs/ARCHITECTURE.md §16, D-025): every package whose code ships in dist/
 * (production dependencies, transitively, plus bundled-dev-dependencies.json) must declare a
 * licence on the SPDX allowlist, or match a reviewed entry in licence-exceptions.json that cites a
 * DECISIONS.md entry. Exits non-zero with a report otherwise.
 *
 * Usage: pnpm licence:check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/fs';
import { decisionIds, evaluateLicenceGate, formatLicenceReport, parseLicenceExceptions } from './lib/licences';
import { loadShippedPackages } from './lib/packages';

function main(): number {
  const here = join(REPO_ROOT, 'tools', 'build');
  const packages = loadShippedPackages(REPO_ROOT, join(here, 'bundled-dev-dependencies.json'));
  const known = decisionIds(readFileSync(join(REPO_ROOT, 'docs', 'DECISIONS.md'), 'utf8'));
  const exceptions = parseLicenceExceptions(
    JSON.parse(readFileSync(join(here, 'licence-exceptions.json'), 'utf8')) as unknown,
    known,
  );
  const result = evaluateLicenceGate(packages, exceptions);
  const report = formatLicenceReport(result);
  if (result.passed) console.log(report);
  else console.error(report);
  return result.passed ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`licence-gate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
