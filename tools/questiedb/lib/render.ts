import type { Dataset } from './dataset';
import { document, idMap } from './json';
import type { GeneratedMarker } from './shapes';

/**
 * Serialises a Dataset into the six generated JSON files of DATA_PROVENANCE §6.1. The layout is
 * one record (or map entry) per line; every file starts with `_generated`.
 */

export const JSON_OUTPUTS = ['quests.json', 'entities.json', 'items.json', 'spawns.json', 'zones.json', 'overlays.json'] as const;
export type JsonOutput = (typeof JSON_OUTPUTS)[number];

export function generatedMarker(repositoryName: string, commit: string): GeneratedMarker {
  return {
    by: 'tools/questiedb',
    upstream: `${repositoryName}@${commit}`,
    notice: 'NOTICE.md',
    manifest: 'manifest.json',
    edit: 'do not edit; regenerate with pnpm data:extract',
  };
}

export interface RenderedFile {
  readonly path: JsonOutput;
  readonly content: string;
  readonly records: number;
}

export function renderDataset(dataset: Dataset, marker: GeneratedMarker): readonly RenderedFile[] {
  const head = ['_generated', marker, 'inline'] as const;
  const factionPatchCount = Object.values(dataset.overlays.faction).reduce(
    (sum, layer) => sum + Object.keys(layer.quests).length + Object.keys(layer.npcs).length + Object.keys(layer.objects).length + Object.keys(layer.items).length + Object.keys(layer.dungeons).length,
    0,
  );
  const classPatchCount = Object.values(dataset.overlays.class).reduce(
    (sum, byClass) => sum + Object.values(byClass).reduce((inner, layer) => inner + Object.keys(layer.quests).length, 0),
    0,
  );
  return [
    { path: 'quests.json', content: document([head, ['rows', dataset.quests, 'lines']]), records: dataset.quests.length },
    {
      path: 'entities.json',
      content: document([head, ['npcs', dataset.npcs, 'lines'], ['objects', dataset.objects, 'lines']]),
      records: dataset.npcs.length + dataset.objects.length,
    },
    { path: 'items.json', content: document([head, ['rows', dataset.items, 'lines']]), records: dataset.items.length },
    {
      path: 'spawns.json',
      content: document([head, ['npc', idMap(dataset.spawns.npc), 'lines'], ['object', idMap(dataset.spawns.object), 'lines']]),
      records: dataset.spawns.npc.size + dataset.spawns.object.size,
    },
    {
      path: 'zones.json',
      content: document([
        head,
        ['areas', idMap(dataset.zones.areas), 'lines'],
        ['uiMaps', idMap(dataset.zones.uiMaps), 'lines'],
        ['dungeons', idMap(dataset.zones.dungeons), 'lines'],
        ['instanceAreas', idMap(dataset.zones.instanceAreas), 'lines'],
      ]),
      records: dataset.zones.areas.size + dataset.zones.uiMaps.size + dataset.zones.dungeons.size + dataset.zones.instanceAreas.size,
    },
    {
      path: 'overlays.json',
      content: document([head, ['faction', dataset.overlays.faction, 'lines'], ['class', dataset.overlays.class, 'lines']]),
      records: factionPatchCount + classPatchCount,
    },
  ];
}
