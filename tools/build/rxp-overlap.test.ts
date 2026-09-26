import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from './lib/fs';
import {
  ALLOWLIST_FILE,
  MIN_LINE_LENGTH,
  RXPGUIDES_PIN,
  RXP_TEXT_ROOTS,
  SCANNED_ROOTS,
  canonicalLines,
  comparableLine,
  findOverlaps,
  formatReport,
  parseAllowlist,
  readTextFiles,
  referenceLineSet,
} from './rxp-overlap';

/**
 * The comparison is tested on synthetic trees only: no network, and no RXPGuides content (D-019).
 * `pnpm rxp:overlap` runs it against the real guides at the pinned commit.
 */

const LONG = 'a line that is long enough to compare';

describe('rxp-overlap comparison', () => {
  it('compares trimmed lines of at least 24 code points', () => {
    expect(MIN_LINE_LENGTH).toBe(24);
    expect(comparableLine(`   ${'x'.repeat(24)}\t\r`)).toBe('x'.repeat(24));
    expect(comparableLine('x'.repeat(23))).toBeNull();
    expect(comparableLine('🐗'.repeat(12))).toBeNull();
    expect(comparableLine('🐗'.repeat(24))).toBe('🐗'.repeat(24));
  });

  it('finds our lines that equal a reference line, whatever the indentation and line endings', () => {
    const reference = referenceLineSet([{ path: 'Guides/a.lua', text: `step\r\n    ${LONG}\r\n    short\r\n` }]);
    expect([...reference]).toEqual([LONG]);
    const report = findOverlaps(
      [
        { path: 'tests/b.txt', text: `x\n\t${LONG}  \nshort\n` },
        { path: 'src/a.ts', text: `${LONG}\r${LONG}` },
        { path: 'src/c.ts', text: `${LONG} but different` },
      ],
      reference,
      [],
    );
    expect(report.overlaps).toEqual([
      { file: 'src/a.ts', line: 1, text: LONG, form: 'line' },
      { file: 'src/a.ts', line: 2, text: LONG, form: 'line' },
      { file: 'tests/b.txt', line: 2, text: LONG, form: 'line' },
    ]);
    expect(report.scannedFiles).toBe(3);
  });

  it('compares RXP fixture lines in canonical form too, so spacing cannot hide an overlap (docs/RXP.md §19.2)', () => {
    // Synthetic text only: the reference writes ">> text", our fixture ">>text", or the other way round.
    const spaced = '.vendor >> Sell everything you do not need here';
    const tight = '.vendor >>Sell everything you do not need here';
    const reference = referenceLineSet([{ path: 'Guides/a.lua', text: `step\n    ${spaced}\n` }]);
    const report = findOverlaps(
      [
        { path: 'tests/fixtures/rxp/x.txt', text: `step\n    ${tight}\n` },
        { path: 'docs/research/rxp-samples/y.txt', text: 'step\n    .vendor   >>   Sell everything you do not need here << Orc\n' },
        { path: 'src/z.ts', text: `${tight}\n` },
      ],
      reference,
      [],
    );
    expect(report.overlaps).toEqual([{ file: 'tests/fixtures/rxp/x.txt', line: 2, text: tight, form: 'canonical' }]);
    expect(formatReport(report, reference.size)).toContain('tests/fixtures/rxp/x.txt:2: equals an RXPGuides guide line in canonical form');
    // The reference side is canonicalised as well.
    const reverse = referenceLineSet([{ path: 'Guides/b.lua', text: `step\n${tight}\n` }]);
    expect(findOverlaps([{ path: 'tests/fixtures/rxp/x.txt', text: `    ${spaced}` }], reverse, []).overlaps.map((hit) => hit.form)).toEqual(['line']);
    expect(RXP_TEXT_ROOTS).toEqual(['docs/research/rxp-samples', 'tests/fixtures/rxp']);
  });

  it('gives the canonical form of each line, null for blank lines and short or refused ones', () => {
    expect(canonicalLines('#name  A\nstep\n\n\t.goto  Durotar , 42.06 , 68.33 >>Walk to the placeholder point\n\t>>a\ttab in text\n')).toEqual([
      null,
      null,
      null,
      '.goto Durotar,42.06,68.33 >> Walk to the placeholder point',
      null,
    ]);
  });

  it('accepts allowlisted lines only in the named file, and reports stale entries', () => {
    const reference = new Set([LONG]);
    const entries = [
      { file: 'tests/b.txt', text: LONG, reason: 'reviewed' },
      { file: 'tests/gone.txt', text: LONG, reason: 'reviewed' },
    ];
    const report = findOverlaps(
      [
        { path: 'tests/b.txt', text: LONG },
        { path: 'tests/c.txt', text: LONG },
      ],
      reference,
      entries,
    );
    expect(report.allowed).toEqual([{ file: 'tests/b.txt', line: 1, text: LONG, form: 'line' }]);
    expect(report.overlaps).toEqual([{ file: 'tests/c.txt', line: 1, text: LONG, form: 'line' }]);
    expect(report.staleEntries).toEqual([entries[1]]);
    expect(formatReport(report, 1)).toContain('tests/c.txt:1: equals an RXPGuides guide line');
  });

  describe('reading trees', () => {
    const root = mkdtempSync(join(tmpdir(), 'rxp-overlap-test-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('reads text files below the given directories and skips binary files and other directories', () => {
      mkdirSync(join(root, 'Guides', 'Forever'), { recursive: true });
      mkdirSync(join(root, 'Other'), { recursive: true });
      writeFileSync(join(root, 'Guides', 'Forever', 'a.lua'), `${LONG}\n`);
      writeFileSync(join(root, 'Guides', 'b.bin'), Buffer.from([0, 1, 2, 3, 0]));
      writeFileSync(join(root, 'Other', 'c.lua'), `${LONG}\n`);
      expect(readTextFiles(root, ['Guides', 'Missing']).map((file) => file.path)).toEqual(['Guides/Forever/a.lua']);
    });
  });
});

describe('committed configuration', () => {
  it('has a reviewed allowlist for the pinned commit whose entries all occur in their files', () => {
    const allowlist = parseAllowlist(JSON.parse(readFileSync(join(REPO_ROOT, ALLOWLIST_FILE), 'utf8')) as unknown);
    expect(allowlist.commit).toBe(RXPGUIDES_PIN.commit);
    expect(allowlist.entries.map((entry) => [entry.file, entry.text])).toEqual([
      ['docs/research/rxp-samples/03-lua-wrapped.txt', 'RXPGuides.RegisterGuide([['],
      ['tests/fixtures/rxp/03-lua-wrapped.txt', 'RXPGuides.RegisterGuide([['],
    ]);
    for (const entry of allowlist.entries) {
      const lines = readFileSync(join(REPO_ROOT, entry.file), 'utf8').split(/\r\n|\r|\n/).map((line) => line.trim());
      expect(lines, entry.file).toContain(entry.text);
    }
  });

  it('refuses malformed allowlists', () => {
    const base = { commit: RXPGUIDES_PIN.commit, minLength: 24, entries: [] as unknown[] };
    expect(() => parseAllowlist({ ...base, commit: 'abc' })).toThrow(/40-character/);
    expect(() => parseAllowlist({ ...base, minLength: 10 })).toThrow(/minLength/);
    expect(() => parseAllowlist({ ...base, entries: [{ file: 'elsewhere/x', text: LONG, reason: 'r' }] })).toThrow(/scanned root/);
    expect(() => parseAllowlist({ ...base, entries: [{ file: 'src/x', text: 'short', reason: 'r' }] })).toThrow(/at least 24/);
    expect(() => parseAllowlist({ ...base, entries: [{ file: 'src/x', text: LONG, reason: ' ' }] })).toThrow(/reason/);
  });

  it('scans the directories ARCHITECTURE §17 names, and is an opt-in script outside pnpm check', () => {
    expect(SCANNED_ROOTS).toEqual(['src', 'public', 'tests', 'docs/research/rxp-samples']);
    const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { readonly scripts: Readonly<Record<string, string>> }).scripts;
    expect(scripts['rxp:overlap']).toBe('tsx tools/build/rxp-overlap.ts');
    expect(scripts['check']).not.toContain('rxp:overlap');
  });
});
