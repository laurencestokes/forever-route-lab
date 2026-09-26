import { describe, expect, it } from 'vitest';
import { fixturePrepared, fixtureView } from '../../tests/support/fixture-dataset';
import { npcId } from '../domain';
import { flightMasterIdsOf, isFlightMaster, preparedDatasetSource, staticDatasetSource } from './dataset-source';
import { stubNpc } from './map-test-helpers';

describe('flight masters', () => {
  it('tests the FLIGHT_MASTER bit (8) arithmetically and refuses malformed flags', () => {
    expect(isFlightMaster({ npcFlags: 8 })).toBe(true);
    expect(isFlightMaster({ npcFlags: 8 + 2 + 128 })).toBe(true);
    expect(isFlightMaster({ npcFlags: 16 + 128 })).toBe(false);
    // A flag above 32 bits keeps its lower bits (no truncation, D-012).
    expect(isFlightMaster({ npcFlags: 2 ** 40 + 8 })).toBe(true);
    expect(isFlightMaster({ npcFlags: -8 })).toBe(false);
    expect(isFlightMaster({ npcFlags: 8.5 })).toBe(false);
  });

  it('lists every flagged NPC of the base and faction layers once, ascending', () => {
    const layer = (ids: number[]) => ({ npcs: new Map(ids.map((id) => [npcId(id), stubNpc({ id: npcId(id), name: `N${String(id)}`, npcFlags: id === 5 ? 0 : 8 })])) });
    const ids = flightMasterIdsOf({ base: layer([3, 1, 5]), factions: { Alliance: layer([2]), Horde: layer([1, 4]) } } as never);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it('come with the prepared source; a static source names none unless told', () => {
    const prepared = fixturePrepared();
    const source = preparedDatasetSource(prepared);
    const view = fixtureView();
    // The Durotar fixture slice ships no flight master (its region has none), so the list is empty,
    // and it is exactly what a scan of the prepared records finds.
    expect(source.flightMasterIds).toEqual(flightMasterIdsOf(prepared));
    expect(source.flightMasterIds).toEqual([]);
    expect(staticDatasetSource(view).flightMasterIds).toEqual([]);
    expect(staticDatasetSource(view, [npcId(9), npcId(2)]).flightMasterIds).toEqual([2, 9]);
  });
});
