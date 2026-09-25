import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './lib/fs';
import {
  decisionIds,
  evaluateLicenceGate,
  formatLicenceReport,
  parseLicenceExceptions,
  type LicenceException,
} from './lib/licences';
import {
  assertDirectDependenciesListed,
  parseBundledDevDependencies,
  parsePnpmLicences,
  selectShippedPackages,
  type ShippedPackage,
} from './lib/packages';
import { ALLOWED_LICENCES, evaluateSpdx, parseSpdxExpression } from './lib/spdx';

describe('SPDX expression evaluator', () => {
  it.each([
    ['MIT', true],
    ['mit', true],
    ['BlueOak-1.0.0', true],
    ['0BSD', true],
    ['(MIT OR Apache-2.0)', true],
    ['MIT OR GPL-3.0-only', true],
    ['GPL-3.0-only OR MIT', true],
    ['(GPL-3.0-only OR MPL-2.0)', false],
    ['MIT AND ISC', true],
    ['MIT AND GPL-3.0-only', false],
    ['(MIT AND (ISC OR GPL-3.0-only))', true],
    ['GPL-3.0-only AND (MIT OR ISC)', false],
    ['Apache-2.0+', true],
    ['GPL-2.0-or-later', false],
    ['GPL-2.0-only WITH Classpath-exception-2.0', false],
    ['MIT WITH Some-exception', false],
    ['UNLICENSED', false],
    ['Hippocratic-2.1', false],
    ['CC-BY-4.0', false],
    ['LicenseRef-Proprietary', false],
  ])('%s → allowed: %s', (expression, allowed) => {
    expect(evaluateSpdx(expression).allowed).toBe(allowed);
  });

  it('binds AND tighter than OR', () => {
    // (GPL AND MIT) OR ISC: passes through ISC.
    expect(evaluateSpdx('GPL-3.0-only AND MIT OR ISC').allowed).toBe(true);
    // GPL OR (MIT AND ISC): passes through MIT AND ISC.
    expect(evaluateSpdx('GPL-3.0-only OR MIT AND ISC')).toEqual({ allowed: true, reason: 'MIT AND ISC' });
    // (MIT AND GPL) OR MPL: fails.
    expect(evaluateSpdx('MIT AND GPL-3.0-only OR MPL-2.0').allowed).toBe(false);
    const parsed = parseSpdxExpression('A OR B AND C');
    expect(parsed).toEqual({
      ok: true,
      node: {
        kind: 'or',
        left: { kind: 'licence', id: 'A', orLater: false, exception: null },
        right: {
          kind: 'and',
          left: { kind: 'licence', id: 'B', orLater: false, exception: null },
          right: { kind: 'licence', id: 'C', orLater: false, exception: null },
        },
      },
    });
  });

  it('explains the chosen alternative and the blocker', () => {
    expect(evaluateSpdx('(GPL-3.0-only OR Apache-2.0)')).toEqual({ allowed: true, reason: 'Apache-2.0' });
    expect(evaluateSpdx('MIT AND GPL-3.0-only').reason).toBe('GPL-3.0-only is not on the allowlist');
    expect(evaluateSpdx('(GPL-3.0-only OR MPL-2.0)').reason).toBe('no alternative of (GPL-3.0-only OR MPL-2.0) is on the allowlist');
  });

  it('accepts a WITH expression only when the allowlist names it exactly', () => {
    const allowlist = [...ALLOWED_LICENCES, 'GPL-2.0-only WITH Classpath-exception-2.0'];
    expect(evaluateSpdx('GPL-2.0-only WITH Classpath-exception-2.0', allowlist).allowed).toBe(true);
    expect(evaluateSpdx('GPL-2.0-only', allowlist).allowed).toBe(false);
  });

  it.each(['', '   ', 'MIT or Apache-2.0', 'SEE LICENSE IN LICENSE.md', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'MIT AND AND ISC', 'MIT WITH', '()'])(
    'fails closed on the unparseable %j',
    (expression) => {
      const verdict = evaluateSpdx(expression);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/unparseable|empty/);
    },
  );
});

describe('pnpm licence listing', () => {
  // The shape `pnpm licenses list --prod --json` prints with pnpm 10.33.0 (paths shortened).
  const sample = {
    MIT: [
      { name: 'zod', versions: ['4.6.5'], paths: ['/nm/zod'], license: 'MIT', homepage: 'https://zod.dev' },
      { name: 'react', versions: ['19.3.0', '18.3.1'], paths: ['/nm/react19', '/nm/react18'], license: 'MIT' },
    ],
    ISC: [{ name: 'idb', versions: ['8.0.3'], paths: ['/nm/idb'], license: 'ISC' }],
    'Custom-Group': [{ name: 'no-licence-field', versions: ['1.0.0'], paths: ['/nm/x'] }],
  };

  it('flattens groups into one sorted entry per name and version', () => {
    expect(parsePnpmLicences(sample)).toEqual([
      { name: 'idb', version: '8.0.3', licence: 'ISC', directory: '/nm/idb' },
      { name: 'no-licence-field', version: '1.0.0', licence: 'Custom-Group', directory: '/nm/x' },
      { name: 'react', version: '18.3.1', licence: 'MIT', directory: '/nm/react18' },
      { name: 'react', version: '19.3.0', licence: 'MIT', directory: '/nm/react19' },
      { name: 'zod', version: '4.6.5', licence: 'MIT', directory: '/nm/zod' },
    ]);
  });

  it('rejects any other shape instead of passing silently', () => {
    expect(() => parsePnpmLicences([])).toThrow(/JSON object/);
    expect(() => parsePnpmLicences({ MIT: {} })).toThrow(/not an array/);
    expect(() => parsePnpmLicences({ MIT: [{ name: 'x', versions: '1.0.0', paths: [] }] })).toThrow(/malformed/);
    expect(() => parsePnpmLicences({ MIT: [{ name: 'x', versions: ['1', '2'], paths: ['/a'] }] })).toThrow(/2 versions but 1 paths/);
  });

  it('adds listed bundled development dependencies and refuses stale entries', () => {
    const production = parsePnpmLicences({ MIT: [{ name: 'react', versions: ['19.3.0'], paths: ['/r'], license: 'MIT' }] });
    const all = parsePnpmLicences({
      MIT: [
        { name: 'react', versions: ['19.3.0'], paths: ['/r'], license: 'MIT' },
        { name: 'vite', versions: ['8.3.1'], paths: ['/v'], license: 'MIT' },
        { name: 'vitest', versions: ['5.0.2'], paths: ['/t'], license: 'MIT' },
      ],
    });
    const bundled = parseBundledDevDependencies({ packages: [{ name: 'vite', reason: 'preload helper' }] });
    expect(selectShippedPackages(production, all, bundled).map((pkg) => [pkg.name, pkg.inclusion, pkg.reason])).toEqual([
      ['react', 'production', null],
      ['vite', 'bundled-dev', 'preload helper'],
    ]);
    const stale = parseBundledDevDependencies({ packages: [{ name: 'webpack', reason: 'gone' }] });
    expect(() => selectShippedPackages(production, all, stale)).toThrow(/webpack, which is not installed/);
    expect(() => parseBundledDevDependencies({ packages: [{ name: 'vite' }] })).toThrow(/non-empty "reason"/);
  });

  it('refuses a listing that misses a direct dependency (for example before pnpm install)', () => {
    const production = parsePnpmLicences({ MIT: [{ name: 'react', versions: ['19.3.0'], paths: ['/r'], license: 'MIT' }] });
    expect(() => assertDirectDependenciesListed(production, { dependencies: { react: '19.3.0' } })).not.toThrow();
    expect(() => assertDirectDependenciesListed([], { dependencies: { react: '19.3.0', zod: '^4' } })).toThrow(
      /did not report react, zod; run pnpm install first/,
    );
  });
});

describe('licence exceptions', () => {
  const known = decisionIds('# Decisions\n\n## D-001: One\n\ntext D-099\n\n## D-027: Accept MPL for x\n');

  it('reads decision IDs from DECISIONS.md headings only', () => {
    expect([...known]).toEqual(['D-001', 'D-027']);
  });

  it('requires every field and an existing decision', () => {
    const parsed = parseLicenceExceptions(
      {
        exceptions: [
          { package: 'x', version: '1.0.0', licence: 'MPL-2.0', reason: 'used unmodified', decision: 'D-027' },
          { package: 'y', version: '1.0.0', licence: 'MPL-2.0', decision: 'D-027' },
          { package: 'z', version: '1.0.0', licence: 'MPL-2.0', reason: 'r', decision: 'D-099' },
          { package: 'w', version: '1.0.0', licence: 'MPL-2.0', reason: 'r', decision: 'decision 27' },
          'not an object',
        ],
      },
      known,
    );
    expect(parsed.exceptions.map((exception) => exception.package)).toEqual(['x']);
    expect(parsed.errors).toEqual([
      'licence-exceptions.json exceptions[1]: missing "reason"',
      'licence-exceptions.json exceptions[2]: "decision" D-099 is not an entry in docs/DECISIONS.md',
      'licence-exceptions.json exceptions[3]: "decision" must look like D-nnn, got "decision 27"',
      'licence-exceptions.json exceptions[4]: not an object',
    ]);
    expect(parseLicenceExceptions({}, known).errors).toEqual(['licence-exceptions.json: expected { "exceptions": [...] }']);
  });

  it('the committed configuration files are valid', () => {
    const decisions = decisionIds(readFileSync(join(REPO_ROOT, 'docs', 'DECISIONS.md'), 'utf8'));
    expect(decisions.has('D-025')).toBe(true);
    const exceptions = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'licence-exceptions.json'), 'utf8')) as unknown;
    expect(parseLicenceExceptions(exceptions, decisions).errors).toEqual([]);
    const bundled = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'bundled-dev-dependencies.json'), 'utf8')) as unknown;
    expect(parseBundledDevDependencies(bundled).length).toBeGreaterThan(0);
  });
});

describe('licence gate', () => {
  const pkg = (name: string, licence: string, version = '1.0.0'): ShippedPackage => ({
    name,
    version,
    licence,
    directory: `/nm/${name}`,
    inclusion: 'production',
    reason: null,
    licenceTextUntil: null,
  });
  const exception = (overrides: Partial<LicenceException> = {}): LicenceException => ({
    package: 'mpl-lib',
    version: '1.0.0',
    licence: 'MPL-2.0',
    reason: 'file-level copyleft, used unmodified',
    decision: 'D-027',
    ...overrides,
  });

  it('passes allowed licences and reviewed exceptions', () => {
    const result = evaluateLicenceGate([pkg('a', 'MIT'), pkg('b', '(MIT OR Apache-2.0)'), pkg('mpl-lib', 'MPL-2.0')], {
      exceptions: [exception()],
      errors: [],
    });
    expect(result.passed).toBe(true);
    expect(result.findings.map((finding) => finding.status)).toEqual(['allowed', 'allowed', 'excepted']);
    expect(result.unusedExceptions).toEqual([]);
    expect(formatLicenceReport(result)).toMatch(/Licence gate passed\.$/);
  });

  it('rejects licences outside the allowlist with a clear report', () => {
    const result = evaluateLicenceGate([pkg('a', 'MIT'), pkg('copyleft', 'GPL-3.0-only')], { exceptions: [], errors: [] });
    expect(result.passed).toBe(false);
    const report = formatLicenceReport(result);
    expect(report).toContain('rejected copyleft@1.0.0');
    expect(report).toContain('GPL-3.0-only is not on the allowlist');
    expect(report).toMatch(/REJECTED: 1 package\(s\)/);
    expect(report).toMatch(/Licence gate FAILED\.$/);
  });

  it('stops applying an exception when the version or declared licence changes', () => {
    const licenceChanged = evaluateLicenceGate([pkg('mpl-lib', 'SSPL-1.0')], { exceptions: [exception()], errors: [] });
    expect(licenceChanged.passed).toBe(false);
    expect(licenceChanged.findings[0]?.detail).toMatch(/no longer matches/);
    expect(licenceChanged.unusedExceptions).toHaveLength(1);
    const versionChanged = evaluateLicenceGate([pkg('mpl-lib', 'MPL-2.0', '2.0.0')], { exceptions: [exception()], errors: [] });
    expect(versionChanged.passed).toBe(false);
    const anyVersion = evaluateLicenceGate([pkg('mpl-lib', 'MPL-2.0', '2.0.0')], { exceptions: [exception({ version: '*' })], errors: [] });
    expect(anyVersion.passed).toBe(true);
  });

  it('fails when the exceptions file itself is invalid', () => {
    const result = evaluateLicenceGate([pkg('a', 'MIT')], { exceptions: [], errors: ['bad entry'] });
    expect(result.passed).toBe(false);
    expect(formatLicenceReport(result)).toContain('Invalid exceptions:\n  - bad entry');
  });
});
