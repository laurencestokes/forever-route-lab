import { compareStrings } from './fs';
import type { ShippedPackage } from './packages';
import { ALLOWED_LICENCES, evaluateSpdx } from './spdx';

/**
 * One reviewed exception to the SPDX allowlist (tools/build/licence-exceptions.json). It applies
 * only while the package still declares exactly `licence`, so a licence change re-opens review.
 */
export interface LicenceException {
  readonly package: string;
  /** An exact version, or `*` for every version. */
  readonly version: string;
  readonly licence: string;
  readonly reason: string;
  /** The DECISIONS.md entry that accepted it, e.g. `D-027`. */
  readonly decision: string;
}

export interface ParsedExceptions {
  readonly exceptions: readonly LicenceException[];
  readonly errors: readonly string[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The decision IDs defined as `## D-nnn:` headings in docs/DECISIONS.md. */
export function decisionIds(decisionsMarkdown: string): ReadonlySet<string> {
  return new Set([...decisionsMarkdown.matchAll(/^## (D-\d{3}):/gm)].map((match) => match[1] ?? ''));
}

/**
 * Validates licence-exceptions.json (`{ "exceptions": [...] }`). Every entry needs a package,
 * version, licence, non-empty reason and a decision that exists in docs/DECISIONS.md; invalid
 * entries are reported as errors and never applied.
 */
export function parseLicenceExceptions(value: unknown, knownDecisions: ReadonlySet<string>): ParsedExceptions {
  if (!isRecord(value) || !Array.isArray(value.exceptions)) {
    return { exceptions: [], errors: ['licence-exceptions.json: expected { "exceptions": [...] }'] };
  }
  const exceptions: LicenceException[] = [];
  const errors: string[] = [];
  (value.exceptions as readonly unknown[]).forEach((entry, index) => {
    const where = `licence-exceptions.json exceptions[${String(index)}]`;
    if (!isRecord(entry)) {
      errors.push(`${where}: not an object`);
      return;
    }
    const field = (key: string): string | null => {
      const raw = entry[key];
      return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
    };
    const pkg = field('package');
    const version = field('version');
    const licence = field('licence');
    const reason = field('reason');
    const decision = field('decision');
    const problems: string[] = [];
    if (pkg === null) problems.push('missing "package"');
    if (version === null) problems.push('missing "version" (an exact version or "*")');
    if (licence === null) problems.push('missing "licence" (the declared licence, verbatim)');
    if (reason === null) problems.push('missing "reason"');
    if (decision === null) problems.push('missing "decision" (a DECISIONS.md reference such as "D-027")');
    else if (!/^D-\d{3}$/.test(decision)) problems.push(`"decision" must look like D-nnn, got "${decision}"`);
    else if (!knownDecisions.has(decision)) problems.push(`"decision" ${decision} is not an entry in docs/DECISIONS.md`);
    if (problems.length > 0 || pkg === null || version === null || licence === null || reason === null || decision === null) {
      errors.push(`${where}: ${problems.join('; ')}`);
      return;
    }
    exceptions.push({ package: pkg, version, licence, reason, decision });
  });
  return { exceptions, errors };
}

export type LicenceStatus = 'allowed' | 'excepted' | 'rejected';

export interface LicenceFinding {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly inclusion: ShippedPackage['inclusion'];
  readonly status: LicenceStatus;
  readonly detail: string;
}

export interface LicenceGateResult {
  readonly findings: readonly LicenceFinding[];
  readonly unusedExceptions: readonly LicenceException[];
  readonly errors: readonly string[];
  readonly passed: boolean;
}

const exceptionMatches = (exception: LicenceException, pkg: ShippedPackage): boolean =>
  exception.package === pkg.name &&
  (exception.version === '*' || exception.version === pkg.version) &&
  exception.licence === pkg.licence;

/** Checks every shipped package against the allowlist, then against the reviewed exceptions. */
export function evaluateLicenceGate(
  packages: readonly ShippedPackage[],
  parsed: ParsedExceptions,
  allowlist: readonly string[] = ALLOWED_LICENCES,
): LicenceGateResult {
  const used = new Set<LicenceException>();
  const findings = packages.map((pkg): LicenceFinding => {
    const base = { name: pkg.name, version: pkg.version, licence: pkg.licence, inclusion: pkg.inclusion };
    const verdict = evaluateSpdx(pkg.licence, allowlist);
    if (verdict.allowed) return { ...base, status: 'allowed', detail: verdict.reason };
    const exception = parsed.exceptions.find((candidate) => exceptionMatches(candidate, pkg));
    if (exception !== undefined) {
      used.add(exception);
      return { ...base, status: 'excepted', detail: `${exception.decision}: ${exception.reason}` };
    }
    const stale = parsed.exceptions.find((candidate) => candidate.package === pkg.name);
    const hint =
      stale === undefined
        ? ''
        : ` (an exception exists for ${stale.package}@${stale.version} "${stale.licence}", which no longer matches)`;
    return { ...base, status: 'rejected', detail: `${verdict.reason}${hint}` };
  });
  const unusedExceptions = parsed.exceptions.filter((exception) => !used.has(exception));
  const passed = parsed.errors.length === 0 && findings.every((finding) => finding.status !== 'rejected');
  return { findings, unusedExceptions, errors: parsed.errors, passed };
}

/** A plain-text report: one line per package, then problems and a verdict. */
export function formatLicenceReport(result: LicenceGateResult, allowlist: readonly string[] = ALLOWED_LICENCES): string {
  const rows = [...result.findings].sort(
    (a, b) => compareStrings(a.status, b.status) || compareStrings(a.name, b.name) || compareStrings(a.version, b.version),
  );
  const width = Math.max(7, ...rows.map((row) => `${row.name}@${row.version}`.length));
  const lines = [
    `Licence gate: ${String(result.findings.length)} shipped package(s); allowlist ${allowlist.join(', ')}`,
    '',
    ...rows.map(
      (row) =>
        `  ${row.status.padEnd(8)} ${`${row.name}@${row.version}`.padEnd(width)}  ${row.licence}${
          row.inclusion === 'bundled-dev' ? '  [dev dependency bundled into dist/]' : ''
        }${row.status === 'allowed' ? '' : `  (${row.detail})`}`,
    ),
  ];
  const rejected = rows.filter((row) => row.status === 'rejected');
  if (result.errors.length > 0) lines.push('', 'Invalid exceptions:', ...result.errors.map((error) => `  - ${error}`));
  if (result.unusedExceptions.length > 0) {
    lines.push(
      '',
      'Unused exceptions (no shipped package matches them; remove them):',
      ...result.unusedExceptions.map((e) => `  - ${e.package}@${e.version} "${e.licence}" (${e.decision})`),
    );
  }
  if (rejected.length > 0) {
    lines.push(
      '',
      `REJECTED: ${String(rejected.length)} package(s) declare a licence outside the allowlist.`,
      'Replace the dependency, or record a decision in docs/DECISIONS.md and add an entry with',
      '"package", "version", "licence", "reason" and "decision" to tools/build/licence-exceptions.json.',
    );
  }
  lines.push('', result.passed ? 'Licence gate passed.' : 'Licence gate FAILED.');
  return lines.join('\n');
}
