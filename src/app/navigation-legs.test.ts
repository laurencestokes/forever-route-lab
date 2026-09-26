import { describe, expect, it } from 'vitest';
import { hasNavLegFlag, navLegEntryOf, navLegFlags, navLegKey, navLegRequest, NavigationLegTable, NavigationPathCache, navPointOf, worldPathOf } from './navigation-legs';
import { endpoint, otherComponent, TEST_NAV_REVISION, unsnapped, walkable } from './navigation-test-helpers';

describe('navigation leg keys (terrain-navigation.md §9.2)', () => {
  it('keys a leg by revision, map and the 1-yd points with their hints', () => {
    const r = navLegRequest(TEST_NAV_REVISION, endpoint(1, 100.4, -200.6, 14), endpoint(1, 99.5, 0.49, 0));
    expect(r.key).toBe(`${TEST_NAV_REVISION}|1|100,-201,14|100,0,0`);
    expect(r.query).toEqual({ mapId: 1, from: { x: 100, y: -201, hint: 14 }, to: { x: 100, y: 0, hint: 0 } });
  });

  it('gives points within the same yard one key, never −0, and separates hints and directions', () => {
    const a = navLegRequest(TEST_NAV_REVISION, endpoint(1, 10.2, -0.3), endpoint(1, 50, 50));
    const b = navLegRequest(TEST_NAV_REVISION, endpoint(1, 9.7, 0.2), endpoint(1, 50.4, 49.6));
    expect(a.key).toBe(b.key);
    expect(a.key).toContain('|10,0,0|');
    expect(navLegRequest(TEST_NAV_REVISION, endpoint(1, 10, 0, 14), endpoint(1, 50, 50)).key).not.toBe(a.key);
    expect(navLegRequest(TEST_NAV_REVISION, endpoint(1, 50, 50), endpoint(1, 10, 0)).key).not.toBe(a.key);
    expect(navLegKey('other', 1, navPointOf(endpoint(1, 10, 0)), navPointOf(endpoint(1, 50, 50)))).not.toBe(a.key);
  });

  it('treats a hint that is not a positive integer as none', () => {
    expect(navPointOf(endpoint(1, 0, 0, -3)).hint).toBe(0);
    expect(navPointOf(endpoint(1, 0, 0, 1.5)).hint).toBe(0);
  });
});

describe('navigation leg entries', () => {
  it('tests flags arithmetically', () => {
    const f = navLegFlags(['longSwim', 'unverifiedPassage', 'longSwim']);
    expect(f).toBe(36);
    expect(hasNavLegFlag(f, 'longSwim')).toBe(true);
    expect(hasNavLegFlag(f, 'unverifiedPassage')).toBe(true);
    expect(hasNavLegFlag(f, 'ambiguousFloor')).toBe(false);
    expect(hasNavLegFlag(f, 'crossComponent')).toBe(false);
  });

  it('turns worker results into entries', () => {
    expect(navLegEntryOf(walkable(1234, { swimTenths: 56, connectorTenthsSeconds: 300, longestSwimYd: 250.44, flags: ['long-swim', 'unverified-passage'], passages: ['undercity-west-tunnel'], to: { snapped: true, ambiguous: true } }))).toEqual({
      g: 1234,
      s: 56,
      c: 300,
      flags: navLegFlags(['ambiguousFloor', 'longSwim', 'unverifiedPassage']),
      passages: ['undercity-west-tunnel'],
      swimRun: 2504,
    });
    expect(navLegEntryOf(otherComponent()).flags).toBe(navLegFlags(['crossComponent']));
    expect(navLegEntryOf({ ...otherComponent(), reason: 'no-path' }).flags).toBe(navLegFlags(['crossComponent']));
    expect(navLegEntryOf(unsnapped(true, false)).flags).toBe(navLegFlags(['unsnappedFrom']));
    expect(navLegEntryOf(unsnapped(true, true)).flags).toBe(navLegFlags(['unsnappedFrom', 'unsnappedTo']));
  });
});

describe('NavigationLegTable', () => {
  it('records each missing leg once, wakes its listener, and forgets it once filled', () => {
    const table = new NavigationLegTable(TEST_NAV_REVISION);
    let woken = 0;
    table.onMissing(() => {
      woken += 1;
    });
    const r = navLegRequest(TEST_NAV_REVISION, endpoint(1, 0, 0), endpoint(1, 10, 0));
    table.recordMissing(r);
    table.recordMissing(r);
    expect([table.missingCount, woken]).toEqual([1, 1]);
    table.set(r.key, navLegEntryOf(walkable(100)));
    expect(table.missingCount).toBe(0);
    table.recordMissing(r);
    expect(table.missingCount).toBe(0);
  });

  it('hands out missing legs oldest first, in batches', () => {
    const table = new NavigationLegTable(TEST_NAV_REVISION);
    const rs = [1, 2, 3].map((x) => navLegRequest(TEST_NAV_REVISION, endpoint(1, x, 0), endpoint(1, 10, 0)));
    for (const r of rs) table.recordMissing(r);
    expect(table.takeMissing(2)).toEqual(rs.slice(0, 2));
    expect(table.takeMissing()).toEqual(rs.slice(2));
  });

  it('drops the missing legs of a map marked unavailable and records none after', () => {
    const table = new NavigationLegTable(TEST_NAV_REVISION);
    table.recordMissing(navLegRequest(TEST_NAV_REVISION, endpoint(1, 0, 0), endpoint(1, 10, 0)));
    table.recordMissing(navLegRequest(TEST_NAV_REVISION, endpoint(0, 0, 0), endpoint(0, 10, 0)));
    table.markUnavailable(1, { code: 'integrity', message: 'x' });
    expect(table.takeMissing().map((r) => r.query.mapId)).toEqual([0]);
    table.recordMissing(navLegRequest(TEST_NAV_REVISION, endpoint(1, 5, 0), endpoint(1, 10, 0)));
    expect(table.missingCount).toBe(0);
    expect(table.unavailable(1)?.code).toBe('integrity');
    expect(table.unavailable(0)).toBeNull();
    table.markUnavailable('all', { code: 'unsupported', message: 'y' });
    expect(table.unavailable(0)?.code).toBe('unsupported');
    table.clearUnavailable();
    expect(table.unavailable(1)).toBeNull();
  });
});

describe('NavigationPathCache', () => {
  it('keeps the most recently used paths up to its capacity', () => {
    const cache = new NavigationPathCache(2);
    cache.set('a', worldPathOf(1, [0, 0, 5, 1, 1, 6]));
    cache.set('b', null);
    expect(cache.get('a')).toEqual([
      { mapId: 1, x: 0, y: 0 },
      { mapId: 1, x: 1, y: 1 },
    ]);
    cache.set('c', []);
    expect(cache.get('b')).toBeUndefined(); // 'b' was the least recently used
    expect(cache.get('a')).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it('records missing paths once and keeps only the newest requests', () => {
    const cache = new NavigationPathCache(2);
    const rs = [1, 2, 3].map((x) => navLegRequest(TEST_NAV_REVISION, endpoint(1, x, 0), endpoint(1, 10, 0)));
    for (const r of rs) cache.recordMissing(r);
    for (const r of rs.slice(1)) cache.recordMissing(r);
    expect(cache.takeMissing()).toEqual(rs.slice(1));
  });
});
