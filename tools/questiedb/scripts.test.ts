import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './lib/upstream';

/** The data gates in package.json (DATA_PROVENANCE §5; review findings data-F3, code-F1). */

const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { readonly scripts: Readonly<Record<string, string>> }).scripts;
const steps = (script: string | undefined): readonly string[] => (script ?? '').split('&&').map((step) => step.trim());

describe('package.json data scripts', () => {
  it('runs each tool through tsx', () => {
    expect(scripts['data:fetch']).toBe('tsx tools/questiedb/fetch.ts');
    expect(scripts['data:extract']).toBe('tsx tools/questiedb/extract.ts');
    expect(scripts['data:validate']).toBe('tsx tools/questiedb/validate.ts');
    expect(scripts['data:diff']).toBe('tsx tools/questiedb/diff.ts');
  });

  it('data:check is the reproducibility gate: fetch, extract --check, validate', () => {
    expect(steps(scripts['data:check'])).toEqual(['pnpm data:fetch', 'pnpm data:extract --check', 'pnpm data:validate']);
    expect(steps(scripts['data:all'])).toEqual(['pnpm data:fetch', 'pnpm data:extract', 'pnpm data:validate']);
  });

  it('check validates the committed data (no clone needed) before the build', () => {
    const check = steps(scripts['check']);
    expect(check).toContain('pnpm data:validate');
    expect(check.indexOf('pnpm data:validate')).toBeLessThan(check.indexOf('pnpm build'));
  });
});
