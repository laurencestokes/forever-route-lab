import { describe, expect, it } from 'vitest';
import { worldMapId } from '../domain/ids';
import { effectiveRules } from '../rules/precedence';
import { FOREVER_BETA } from '../rules/ruleset';
import type { CommittedTaxi } from '../rules/travel-graph';
import { stepDuration } from './estimate';
import { flightTime, nearestLocalTaxiNode, taxiLegDataOf } from './taxi';

const KALIMDOR = worldMapId(1);
const forever = effectiveRules(FOREVER_BETA);

// A synthetic committed file (invented ids, names, positions and lengths; never client values).
const TAXI: CommittedTaxi = {
  build: 'test-build',
  nodes: [
    { id: 1, name: 'One', point: { mapId: KALIMDOR, x: 0, y: 0 }, alliance: false, horde: true },
    { id: 2, name: 'Two', point: { mapId: KALIMDOR, x: 1000, y: 0 }, alliance: false, horde: true },
    { id: 3, name: 'Three', point: { mapId: KALIMDOR, x: 2000, y: 0 }, alliance: false, horde: true },
  ],
  flights: [
    { pathId: 10, from: 1, to: 2, l3dYards: 1100 },
    { pathId: 11, from: 2, to: 3, l3dYards: 1300 },
    { pathId: 12, from: 3, to: 2, l3dYards: 1250 },
  ],
  transports: [{ pathId: 99, maps: [KALIMDOR], stops: [{ point: { mapId: KALIMDOR, x: 5, y: 5 }, delaySeconds: 60 }] }],
};

describe('TIME-6 from the committed taxi file (D-039 B, OD-6)', () => {
  const data = taxiLegDataOf(TAXI);

  it("takes each flight's client length and each node's position, and no transport path", () => {
    expect(data).toEqual({
      build: 'test-build',
      legs: [
        { from: 1, to: 2, l3dYards: 1100 },
        { from: 2, to: 3, l3dYards: 1300 },
        { from: 3, to: 2, l3dYards: 1250 },
      ],
      nodes: [
        { id: 1, point: { mapId: KALIMDOR, x: 0, y: 0 } },
        { id: 2, point: { mapId: KALIMDOR, x: 1000, y: 0 } },
        { id: 3, point: { mapId: KALIMDOR, x: 2000, y: 0 } },
      ],
    });
    expect(nearestLocalTaxiNode(data, { mapId: KALIMDOR, x: 1030, y: 20 })).toBe(2);
    expect(nearestLocalTaxiNode(data, { mapId: KALIMDOR, x: 1100, y: 0 })).toBeNull();
  });

  it('times a covered journey by its path lengths at the effective taxi speed, plus the flight master', () => {
    const from = { mapId: KALIMDOR, x: 0, y: 0 };
    const to = { mapId: KALIMDOR, x: 2000, y: 0 };
    const flight = flightTime({ from, to, fromTaxiNodeId: 1, toTaxiNodeId: 3 }, forever, { data, usable: () => true });
    expect(flight.model).toBe('taxi-path');
    expect(flight.nodes).toEqual([1, 2, 3]);
    // 3 s at the flight master (assumption) + 2,400 yd / 32 yd/s (era-assumed in forever-beta).
    expect(stepDuration(flight.parts).duration).toEqual({ value: 3 + 2400 / 32, basis: 'assumption', eraFallback: true });
    expect(flight.used).not.toContain('taxiDetourFactor');
  });

  it('applies the speed bonus to the path lengths', () => {
    const bonus = { ...forever, values: { ...forever.values, taxiSpeedBonusPct: { ...forever.values.taxiSpeedBonusPct, value: 20 } } };
    const flight = flightTime({ from: { mapId: KALIMDOR, x: 0, y: 0 }, to: { mapId: KALIMDOR, x: 1000, y: 0 }, fromTaxiNodeId: 1, toTaxiNodeId: 2 }, bonus, { data, usable: () => true });
    expect(stepDuration(flight.parts).duration.value).toBeCloseTo(3 + 1100 / (32 * 1.2), 9);
  });

  it('falls back to TIME-5 where the file does not cover the journey (no flight back from node 2 to node 1)', () => {
    const flight = flightTime({ from: { mapId: KALIMDOR, x: 1000, y: 0 }, to: { mapId: KALIMDOR, x: 0, y: 0 }, fromTaxiNodeId: 2, toTaxiNodeId: 1 }, forever, { data, usable: () => true, open: () => true });
    expect(flight.model).toBe('straight-line');
    expect(flight.used).toContain('taxiDetourFactor');
    expect(stepDuration(flight.parts).duration.value).toBeCloseTo(3 + (1000 * 1.4) / 32, 9);
    // Not covered at all: the ordinary fallback, with no warning.
    expect(flight.facts).toEqual([]);
  });

  it('records the SIM-7 variant when the file covers the journey only through a node the character does not know (TR-09)', () => {
    const from = { mapId: KALIMDOR, x: 0, y: 0 };
    const to = { mapId: KALIMDOR, x: 2000, y: 0 };
    // Node 2 is open to the faction but not known: the only journey, 1 → 2 → 3, cannot be flown as known.
    const unknownMiddle = flightTime({ from, to, fromTaxiNodeId: 1, toTaxiNodeId: 3 }, forever, { data, usable: (id) => id !== 2, open: () => true });
    expect(unknownMiddle.model).toBe('straight-line');
    expect(unknownMiddle.facts).toEqual([{ kind: 'flight-no-known-journey' }]);
    expect(stepDuration(unknownMiddle.parts).duration.value).toBeCloseTo(3 + (2000 * 1.4) / 32, 9);
    // Node 2 closed to the faction too: no journey the character could ever fly, so no warning.
    expect(flightTime({ from, to, fromTaxiNodeId: 1, toTaxiNodeId: 3 }, forever, { data, usable: (id) => id !== 2, open: (id) => id !== 2 }).facts).toEqual([]);
    // Without the check (`open` absent) nothing is recorded.
    expect(flightTime({ from, to, fromTaxiNodeId: 1, toTaxiNodeId: 3 }, forever, { data, usable: (id) => id !== 2 }).facts).toEqual([]);
  });
});
