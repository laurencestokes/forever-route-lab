import { SAMPLE_ORIGIN_REF } from '../../app/sample-route';
import type { DatasetView, EntityRef, ObjectiveDef, RecordProvenance, SpawnPoint } from '../../domain/dataset';
import type { StepOrigin } from '../../domain/route';
import { entityName, instanceWhere, isInstanceSpawn, publishedPointText, spawnText, zoneLabel } from '../app-model';
import { formatInteger, plural } from '../lib/format';

/*
 * The words only Details, the Quest log and the custom quest editor use (lazy parts): objectives,
 * where givers and objectives are, a record's upstream provenance and a step's origin. Apart from
 * app-model.ts, whose functions the entry chunk keeps (a module shared with a lazy part stays whole
 * in the entry), so these load with the parts that show them (docs/research/ui-refresh.md §10.3).
 */

export function objectiveText(dataset: DatasetView, objective: ObjectiveDef): string {
  const count = (n: number | null): string => (n === null ? ' (count unknown)' : ` × ${formatInteger(n)}`);
  switch (objective.kind) {
    case 'kill':
      return `Kill ${objective.label ?? entityName(dataset, { kind: 'npc', id: objective.npcId })}${count(objective.count)}`;
    case 'object':
      return `Use ${objective.label ?? entityName(dataset, { kind: 'object', id: objective.objectId })}${count(objective.count)}`;
    case 'item':
      return `Collect ${objective.label ?? entityName(dataset, { kind: 'item', id: objective.itemId })}${count(objective.count)}`;
    case 'reputation':
      return `Reach ${formatInteger(objective.value)} reputation with faction ${String(objective.factionId)}`;
    case 'killCredit':
      return `${objective.label ?? `Kill credit for ${entityName(dataset, { kind: 'npc', id: objective.rootNpcId })}`}${count(objective.count)}`;
    case 'spell':
      return objective.label ?? `Cast spell ${String(objective.spellId)}`;
    case 'event':
      return objective.text ?? 'Event objective';
  }
}


const KIND_WORD: Readonly<Record<EntityRef['kind'], string>> = { npc: 'NPC', object: 'object', item: 'item' };

/**
 * Where a quest giver or receiver is: `Gornek (NPC) · Durotar 42.06, 68.33`, with the number of
 * further spawns. Items have no spawns; an entity without a published point says so.
 */
export function entityWhereText(dataset: DatasetView, ref: EntityRef): string {
  const name = `${entityName(dataset, ref)} (${KIND_WORD[ref.kind]})`;
  if (ref.kind === 'item') return `${name} · an item, no map position`;
  const spawns = dataset.spawns(ref);
  const [first] = spawns;
  if (first === undefined) return `${name} · no published spawn`;
  const more = spawns.length > 1 ? ` (+${plural(spawns.length - 1, 'more spawn')})` : '';
  return `${name} · ${spawnText(dataset, first)}${more}`;
}

/** Where one spawn is, for the summary: its zone, `an instance (entrance in …)`, or `unmapped areas`. */
const spawnZone = (dataset: DatasetView, spawn: SpawnPoint): string => {
  if (isInstanceSpawn(spawn)) return instanceWhere(dataset, spawn);
  if (spawn.uiMapId !== null) return zoneLabel(dataset, spawn.uiMapId);
  return 'unmapped areas';
};

/**
 * The zones an entity spawns in, most spawns first: `45 spawns in Durotar`, `3 spawns in Durotar
 * and 1 in The Barrens`, `1 spawn in an instance (entrance in Westfall)`.
 */
export function spawnSummary(dataset: DatasetView, ref: EntityRef): string | null {
  const spawns = dataset.spawns(ref);
  if (spawns.length === 0) return null;
  const counts = new Map<string, number>();
  for (const spawn of spawns) {
    const where = spawnZone(dataset, spawn);
    counts.set(where, (counts.get(where) ?? 0) + 1);
  }
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([where, n], i) => (i === 0 ? `${plural(n, 'spawn')} in ${where}` : `${formatInteger(n)} in ${where}`));
  const shown = parts.slice(0, 3);
  const rest = parts.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${plural(rest, 'other zone')}`;
  return shown.length === 2 ? shown.join(' and ') : shown.join(', ');
}

/** Where an objective is done, from the dataset: its target's spawns, its item's drop sources, its event points. */
export function objectiveWhere(dataset: DatasetView, objective: ObjectiveDef): string | null {
  switch (objective.kind) {
    case 'kill':
      return spawnSummary(dataset, { kind: 'npc', id: objective.npcId });
    case 'killCredit':
      return spawnSummary(dataset, { kind: 'npc', id: objective.rootNpcId });
    case 'object':
      return spawnSummary(dataset, { kind: 'object', id: objective.objectId });
    case 'item': {
      const item = dataset.item(objective.itemId);
      if (item === undefined) return null;
      const sources = [
        ...item.dropNpcs.map((id) => entityName(dataset, { kind: 'npc', id })),
        ...item.dropObjects.map((id) => entityName(dataset, { kind: 'object', id })),
        ...item.dropItems.map((id) => entityName(dataset, { kind: 'item', id })),
      ];
      if (sources.length === 0) return 'No drop source in the dataset';
      const shown = sources.slice(0, 3).join(', ');
      return sources.length > 3 ? `From ${shown} and ${plural(sources.length - 3, 'other source')}` : `From ${shown}`;
    }
    case 'event': {
      const [first] = objective.points;
      if (first === undefined) return null;
      const more = objective.points.length > 1 ? ` (+${plural(objective.points.length - 1, 'more point')})` : '';
      return `${publishedPointText(dataset, first)}${more}`;
    }
    case 'reputation':
    case 'spell':
      return null;
  }
}

const UPSTREAM_DIFF_TEXT: Readonly<Record<RecordProvenance['upstreamDiff'], string>> = {
  era: 'Era baseline',
  'era-coords': 'Era baseline, coordinates re-projected for Forever',
  'forever-new': "New in QuestieDB's Forever data",
  'forever-changed': "Changed in QuestieDB's Forever data",
};

/** What QuestieDB says about a record (DATA_PROVENANCE §9.3), in words. A fact about the source, not about the game. */
export function upstreamProvenanceText(provenance: RecordProvenance): string {
  if (provenance.source === 'custom') return 'Custom: entered in this project';
  const correction = provenance.created ? '; created by a QuestieDB correction' : provenance.corrected ? '; changed by a QuestieDB correction' : '';
  return `${UPSTREAM_DIFF_TEXT[provenance.upstreamDiff]}${correction}`;
}

export function originText(origin: StepOrigin): string {
  const from = origin.ref === null ? '' : ` of ${origin.ref}`;
  switch (origin.source) {
    case 'manual':
      return origin.ref === SAMPLE_ORIGIN_REF ? 'Generated for the sample route' : 'Added by hand';
    case 'rxp':
      return origin.ref === null ? 'Imported from an RXP guide' : `Imported from an RXP guide (${origin.ref})`;
    case 'optimizer':
      return 'Proposed by the optimiser';
    case 'duplicate':
      return `Duplicate${from}`;
    case 'paste':
      return `Pasted copy${from}`;
  }
}
