/**
 * The committed navigation data passes the offline gates (terrain-navigation.md §14.2, §16): the
 * manifest and file hashes, decoding, sizes (D-030), seams and link symmetry, the stored
 * components, the census against the build and the reviewed file, the water splits, the fixtures
 * and the connector file. No client needed. The tool tree comparison and stale stage-2 inputs are
 * `pnpm nav:validate`'s job (CI): here they are not failures, so that editing a tool or an input
 * reports "rebuild" there instead of breaking every test run.
 */
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './lib/settings';
import { formatChecks, NAV_BLOCK_CAP_BYTES, NAV_CAP_BYTES, validateOffline } from './lib/validate-lib';

describe('public/nav', () => {
  const result = validateOffline({ repoRoot: REPO_ROOT, skipToolTree: true, staleInputsWarn: true });

  it('passes every offline gate', () => {
    const failed = result.checks.filter((c) => c.status === 'fail');
    expect(formatChecks(failed)).toBe('');
    expect(result.checks.filter((c) => c.status === 'pass').length).toBeGreaterThan(40);
  });

  it('holds both continents within the D-030 cap, every block under 300 kB', () => {
    expect(result.manifest.maps.map((m) => m.mapId)).toEqual([0, 1]);
    expect(result.totals.gzip6).toBeLessThanOrEqual(NAV_CAP_BYTES);
    expect(result.totals.maxBlockGzip6).toBeLessThanOrEqual(NAV_BLOCK_CAP_BYTES);
  });

  it('keeps Teldrassil off Darkshore and the Thunder Bluff rises together (G8, G7b)', () => {
    const byGate = (gate: string): string[] => result.fixtures.filter((f) => f.gate === gate).map((f) => `${f.name}: ${f.pass ? 'pass' : 'fail'}`);
    expect(byGate('G8')).toEqual(['Thunder Bluff rises not connected to Mulgore without an elevator: pass', 'Teldrassil not connected to Darkshore: pass']);
    expect(byGate('G7b')).toEqual(['Thunder Bluff rises and Pools of Vision in one component: pass']);
  });
});
