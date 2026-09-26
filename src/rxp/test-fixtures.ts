import { type QuestId, routeId, uiMapId } from '../domain/ids';
import type { Route, RouteGroup, RouteStep } from '../domain/route';
import { fixtureGeometry } from '../geo/test-fixtures';
import type { MapGeometry } from '../geo/types';
import type { RxpLowerContext, RxpQuestFacts } from './lower';
import { zoneKeyLookup } from './zone-keys';

/**
 * Test-only context for `src/rxp` tests (like `src/geo/test-fixtures.ts`); not imported by
 * application code.
 *
 * - Zone keys: English UiMap names as `public/data/zones.json` ships them (QuestieDB
 *   `support/Forever/Zones/uiMapIdToAreaId.lua` at b6f5b07, DATA_PROVENANCE §6.6).
 * - Quest facts: objective counts of the fixture quests in the committed dataset
 *   (`public/data/quests.json`, QuestieDB `data/Forever` at b6f5b07): 4641 has none, the others
 *   one each; 900001 is the synthetic quest of fixture 06 and is unknown.
 */

export const TEST_ZONES = [
  { uiMapId: uiMapId(1411), name: 'Durotar' },
  { uiMapId: uiMapId(1412), name: 'Mulgore' },
  { uiMapId: uiMapId(1413), name: 'The Barrens' },
  { uiMapId: uiMapId(1423), name: 'Eastern Plaguelands' },
  { uiMapId: uiMapId(1429), name: 'Elwynn Forest' },
  { uiMapId: uiMapId(1453), name: 'Stormwind City' },
  { uiMapId: uiMapId(1454), name: 'Orgrimmar' },
] as const;

export const testZoneKey = zoneKeyLookup(TEST_ZONES);

const FIXTURE_QUESTS: ReadonlyMap<number, RxpQuestFacts> = new Map([
  [4641, { objectiveCount: 0, custom: false }],
  ...[788, 789, 790, 792, 4402].map((id) => [id, { objectiveCount: 1, custom: false }] as const),
]);

export const testQuest = (id: QuestId): RxpQuestFacts | null => FIXTURE_QUESTS.get(id) ?? null;

export const testGeometry: MapGeometry = fixtureGeometry();

/** Zone keys only: no dataset or geometry diagnostics. */
export const ZONES_ONLY: RxpLowerContext = { zoneKey: testZoneKey };

/** Zone keys, fixture quest facts and the fixture geometry. */
export const FULL_CONTEXT: RxpLowerContext = { zoneKey: testZoneKey, quest: testQuest, geometry: testGeometry };

export function testRoute(steps: readonly RouteStep[], groups: Readonly<Record<string, RouteGroup>>, name = 'Test route'): Route {
  return { id: routeId('route-test'), name, description: '', steps, groups };
}

/** Splits text on every line ending (CRLF, CR, LF). */
export const splitAnyEol = (text: string): string[] => text.split(/\r\n|\r|\n/);
