import type { UiMapId } from '../domain/ids';
import type { ZoneKeyLookup } from './points';

export type { ZoneKeyLookup } from './points';

/**
 * Builds the English zone-key lookup (docs/RXP.md §10.3) from validated UiMap names, for example
 * `DatasetView.zones()` (names from QuestieDB `uiMapIdToAreaId.lua` via `zones.json`). A name
 * that two UiMaps share is ambiguous and resolves to nothing rather than to a guess. Pseudo-zone
 * keys are handled by the parser itself.
 */
export function zoneKeyLookup(zones: Iterable<{ readonly uiMapId: UiMapId; readonly name: string | null }>): ZoneKeyLookup {
  const table = new Map<string, UiMapId | null>();
  for (const zone of zones) {
    if (zone.name === null || zone.name === '') continue;
    const existing = table.get(zone.name);
    table.set(zone.name, existing === undefined || existing === zone.uiMapId ? zone.uiMapId : null);
  }
  return (name) => table.get(name) ?? null;
}
