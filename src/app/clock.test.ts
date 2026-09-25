import { describe, expect, it } from 'vitest';
import { fixedClock, manualClock, parseIsoMs, systemClock } from './clock';

describe('clocks', () => {
  it('systemClock returns an ISO timestamp', () => {
    expect(parseIsoMs(systemClock.nowIso())).not.toBeNull();
    expect(systemClock.nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('fixedClock always reads the same time', () => {
    const clock = fixedClock('2026-03-04T05:06:07.000Z');
    expect([clock.nowIso(), clock.nowIso()]).toEqual(['2026-03-04T05:06:07.000Z', '2026-03-04T05:06:07.000Z']);
  });

  it('manualClock moves only when told to', () => {
    const clock = manualClock('2026-01-01T00:00:00.000Z');
    expect(clock.nowIso()).toBe('2026-01-01T00:00:00.000Z');
    clock.advance(1500);
    expect(clock.nowIso()).toBe('2026-01-01T00:00:01.500Z');
    clock.set('2027-02-03T04:05:06.007Z');
    expect(clock.nowIso()).toBe('2027-02-03T04:05:06.007Z');
    expect(() => clock.set('not a date')).toThrow(RangeError);
    expect(() => manualClock('nope')).toThrow(RangeError);
  });

  it('parseIsoMs returns null for unparsable text', () => {
    expect(parseIsoMs('2026-01-01T00:00:00.000Z')).toBe(Date.UTC(2026, 0, 1));
    expect(parseIsoMs('garbage')).toBeNull();
  });
});
