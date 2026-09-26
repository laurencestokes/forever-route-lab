import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../build/lib/fs';
import { hasPinnedCheckout } from './lib/test-support';

const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { readonly scripts: Readonly<Record<string, string>> }).scripts;

describe('package.json map scripts', () => {
  it('maps:placeholder runs the importer and maps:validate the checks', () => {
    expect(scripts['maps:placeholder']).toBe('tsx tools/maps/import.ts --placeholder');
    expect(scripts['maps:validate']).toBe('tsx tools/maps/validate.ts');
  });
});

const tsx = (args: readonly string[]): { readonly status: number; readonly output: string } => {
  try {
    const output = execFileSync(process.execPath, [join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...args], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
};

describe('command line', () => {
  it('import refuses unknown options, another build and a --build output under public/ (before touching the client)', () => {
    expect(tsx(['tools/maps/import.ts', '--placeholder', '--bogus'])).toMatchObject({ status: 1, output: expect.stringContaining('unknown option --bogus') as unknown });
    expect(tsx(['tools/maps/import.ts', '--build', '1.60.1.69999'])).toMatchObject({ status: 1, output: expect.stringContaining('pinned to wow_classic_beta 1.60.1.70009') as unknown });
    expect(tsx(['tools/maps/import.ts', '--build', '1.60.1.70009', '--out', 'public/maps/local'])).toMatchObject({ status: 1, output: expect.stringContaining('never writes under public/') as unknown });
    expect(tsx(['tools/maps/import.ts', '--build', '1.60.1.70009', '--placeholder'])).toMatchObject({ status: 1, output: expect.stringContaining('separate runs') as unknown });
    expect(tsx(['tools/maps/convert.ts', '--bogus'])).toMatchObject({ status: 1, output: expect.stringContaining('unknown option --bogus') as unknown });
  }, 60_000);

  it.skipIf(!hasPinnedCheckout())('import --check and validate --skip-tracking pass on the committed files (needs the QuestieDB checkout)', () => {
    const check = tsx(['tools/maps/import.ts', '--placeholder', '--check']);
    expect(check.output).toContain('placeholder up to date');
    expect(check.status).toBe(0);
    const validate = tsx(['tools/maps/validate.ts', '--skip-tracking']);
    expect(validate.output).not.toContain('FAIL');
    expect(validate.status).toBe(0);
  }, 60_000);
});
