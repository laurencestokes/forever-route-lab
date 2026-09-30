import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './lib/fs';

/**
 * The gates in package.json's scripts (docs/ARCHITECTURE.md §16, D-025). A deploy job that runs
 * only `pnpm build` must still run every build gate, in order.
 */

const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { readonly scripts: Readonly<Record<string, string>> })
  .scripts;

const steps = (script: string | undefined): readonly string[] => (script ?? '').split('&&').map((step) => step.trim());

describe('package.json scripts', () => {
  it('build runs vite, then the licence gate, the notices and the dist audit, which strips the manifest', () => {
    expect(steps(scripts['build'])).toEqual([
      'vite build',
      'tsx tools/build/licence-gate.ts',
      'tsx tools/build/third-party-notices.ts',
      'tsx tools/build/audit-dist.ts --strip-manifest',
    ]);
  });

  it('build:deploy (the Pages deploy build) fetches and verifies the minimap pack, then runs every gate of build with the deploy audit (D-049 O14)', () => {
    const deploy = steps(scripts['build:deploy']);
    expect(deploy[0]).toBe('tsx tools/build/minimap-fetch.ts');
    // The deploy build is built in mode `deploy`: the map's messages then name no developer command (review MD-03).
    expect(deploy.slice(1)).toEqual(
      steps(scripts['build']).map((step) => (step.startsWith('tsx tools/build/audit-dist.ts') ? `${step} --deploy` : step === 'vite build' ? 'vite build --mode deploy' : step)),
    );
    expect(deploy.at(-1)).toBe('tsx tools/build/audit-dist.ts --strip-manifest --deploy');
    // the plain build never needs the tiles (pnpm check passes without them, docs/research/map-atlas.md §23.4)
    expect(scripts['build']).not.toMatch(/minimap-fetch|--deploy/);
    expect(scripts['maps:minimap:fetch']).toBe('tsx tools/build/minimap-fetch.ts');
    expect(scripts['maps:minimap:pack']).toBe('tsx tools/build/minimap-pack.ts');
  });

  it('typecheck compiles the pure, app and node projects', () => {
    expect(steps(scripts['typecheck'])).toEqual([
      'tsc --noEmit -p tsconfig.pure.json',
      'tsc --noEmit -p tsconfig.app.json',
      'tsc --noEmit -p tsconfig.node.json',
    ]);
  });

  it('check runs every gate, the committed-data validation before the build, the build last', () => {
    expect(steps(scripts['check'])).toEqual(['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm data:validate', 'pnpm build']);
    expect(scripts['licence:check']).toBe('tsx tools/build/licence-gate.ts');
  });
});
