import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId } from '../domain/ids';
import type { MapRef } from '../map/adapter';
import type { MapPopoverTarget } from './map-controller';
import { buildMapPopover, type PopoverContext } from './map-popover';
import { stubDataset } from './map-test-helpers';

/*
 * A ride line's popover (review TR-05): a line between two transport stops carries its client path
 * and no stop, so it is named by the path's seed, never "service unknown … never used for a route"
 * for a known service, and it offers no dock (a transport starts at one of its stops).
 */

const KALIMDOR = worldMapId(1);
const ctx: PopoverContext = {
  dataset: stubDataset({ quests: [], npcs: [], zones: [] }),
  questState: null,
  places: null,
  after: 'after step 12',
  locked: null,
  zoneName: () => null,
  stepNumber: () => null,
};

const target = (refs: readonly MapRef[]): MapPopoverTarget => ({
  key: 1,
  layer: 'transports',
  refs,
  labels: refs.map(() => null),
  point: { space: 'world', mapId: KALIMDOR, x: 7000, y: 600, uiMapId: uiMapId(1439), lexemes: null },
  at: null,
  from: null,
});

describe('a ride line’s popover (review TR-05)', () => {
  it('names a known service from its client path and points to its stops', () => {
    const model = buildMapPopover(target([{ kind: 'transport', path: 293, stop: null }]), ctx);
    expect(model.title).toBe("Transport route: Rut'theran – Auberdine boat");
    const [section] = model.sections;
    expect(section?.heading).toBe("Rut'theran – Auberdine boat");
    expect(section?.lines).toContain("Between Rut'theran Village and Auberdine");
    expect(section?.actions[0]?.unavailable).toBe('Choose one of its stops to add it: a transport starts at a stop');
    expect(JSON.stringify(model)).not.toMatch(/service unknown|never used for a route/);
  });

  it('keeps "service unknown" for a path no seed names, and the stop’s own popover as it was', () => {
    const unknown = buildMapPopover(target([{ kind: 'transport', path: 1, stop: null }]), ctx);
    expect(unknown.title).toBe('Transport route (service unknown)');
    expect(unknown.sections[0]?.actions[0]?.unavailable).toBe('This route’s service is not known: it is never used for a route');
    const stop = buildMapPopover(target([{ kind: 'transport', path: 293, stop: 0 }]), ctx);
    expect(stop.title).toBe("Transport stop: Rut'theran Village");
  });
});
