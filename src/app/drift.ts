import type { DatasetView, ProjectV1, QuestId, QuestRecord } from '../domain';
import type { DataPrints, QuestPrint } from '../infra/persistence';

/**
 * The dataset drift check (docs/ARCHITECTURE.md §5.5). A stored project records the manifest
 * `dataRevision` it was last saved with and, beside it in storage, fingerprints of the objective
 * lists and prerequisites of the quests it uses (`DataPrints`). When the project opens on another
 * revision, the check lists the quests it uses that the data no longer has and the quests whose
 * objectives or prerequisites changed. Without fingerprints (an imported file) only missing quests
 * can be found; the rest is unknown and the report says so.
 */

export interface DriftReport {
  /** The revision the project was last saved with. */
  readonly storedRevision: string;
  /** The revision now loaded. */
  readonly loadedRevision: string;
  /** How many distinct quests the project uses. */
  readonly questCount: number;
  /** Quests the project uses that the loaded data (with the project's custom quests) lacks, ascending. */
  readonly missingQuestIds: readonly QuestId[];
  /** Quests whose objective list changed, ascending; null when there was nothing to compare with. */
  readonly changedObjectives: readonly QuestId[] | null;
  /** Quests whose prerequisites changed, ascending; null when there was nothing to compare with. */
  readonly changedPrerequisites: readonly QuestId[] | null;
}

/**
 * Every quest the project refers to: in its steps (accept, turn-in and their alternatives,
 * complete targets, abandon) and in the character's prior history. Ascending, distinct.
 */
export function projectQuestIds(project: Pick<ProjectV1, 'route' | 'character'>): QuestId[] {
  const ids = new Set<QuestId>();
  for (const step of project.route.steps) {
    switch (step.kind) {
      case 'accept':
      case 'turnin':
        ids.add(step.questId);
        for (const id of step.anyOf ?? []) ids.add(id);
        break;
      case 'complete':
        for (const target of step.targets) ids.add(target.questId);
        break;
      case 'abandon':
        ids.add(step.questId);
        break;
      case 'travel':
      case 'grind':
      case 'hearth':
      case 'flight':
      case 'train':
      case 'vendor':
      case 'note':
        break;
    }
  }
  for (const id of project.character.priorCompletedQuests) ids.add(id);
  for (const id of project.character.priorQuestLog) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

/** JSON with object keys sorted, so a fingerprint never depends on the order records were built in. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

const HEX_WIDTH = 8;

/**
 * A 64-bit-ish fingerprint of a string: two polynomial hashes modulo primes below 2^32, in
 * ordinary arithmetic (no bitwise operators, D-012). Change detection only, not security: a
 * collision would hide one change, with odds far below anything that matters here.
 */
export function fingerprint(text: string): string {
  let a = 0;
  let b = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = (a * 131 + code + 1) % 2147483647;
    b = (b * 257 + code + 7) % 4294967291;
  }
  return a.toString(16).padStart(HEX_WIDTH, '0') + b.toString(16).padStart(HEX_WIDTH, '0');
}

const printCache = new WeakMap<QuestRecord, QuestPrint>();

/** The fingerprints of one quest record (cached per record object: records never change). */
export function questPrint(quest: QuestRecord): QuestPrint {
  let print = printCache.get(quest);
  if (print === undefined) {
    print = { objectives: fingerprint(canonical(quest.objectives)), prerequisites: fingerprint(canonical(quest.prerequisites)) };
    printCache.set(quest, print);
  }
  return print;
}

/**
 * Fingerprints of the dataset quests the project uses, against `view` (the loaded data seen
 * through the project). Custom quests are the user's own and are left out; so are quests the data
 * does not have.
 */
export function dataPrintsOf(project: Pick<ProjectV1, 'route' | 'character'>, view: DatasetView): DataPrints {
  const quests: Record<string, QuestPrint> = {};
  for (const id of projectQuestIds(project)) {
    const quest = view.quest(id);
    if (quest === undefined || quest.provenance.source === 'custom') continue;
    quests[String(id)] = questPrint(quest);
  }
  return { dataRevision: view.identity.dataRevision, quests };
}

export interface DriftInput {
  readonly project: Pick<ProjectV1, 'route' | 'character'>;
  /** The revision the stored project records. */
  readonly storedRevision: string;
  /** The loaded data seen through the project. */
  readonly view: DatasetView;
  /** The prints saved with the project, or null when there are none. */
  readonly prints: DataPrints | null;
}

/** The drift report, or null when the project was saved with the revision now loaded. */
export function checkDrift({ project, storedRevision, view, prints }: DriftInput): DriftReport | null {
  const loadedRevision = view.identity.dataRevision;
  if (storedRevision === loadedRevision) return null;
  const ids = projectQuestIds(project);
  const missing: QuestId[] = [];
  const objectives: QuestId[] = [];
  const prerequisites: QuestId[] = [];
  // Prints taken against another revision than the one the project records say nothing reliable.
  const comparable = prints !== null && prints.dataRevision === storedRevision ? prints.quests : null;
  for (const id of ids) {
    const quest = view.quest(id);
    if (quest === undefined) {
      missing.push(id);
      continue;
    }
    const key = String(id);
    const before = comparable !== null && Object.hasOwn(comparable, key) ? comparable[key] : undefined;
    if (before === undefined || quest.provenance.source === 'custom') continue;
    const now = questPrint(quest);
    if (now.objectives !== before.objectives) objectives.push(id);
    if (now.prerequisites !== before.prerequisites) prerequisites.push(id);
  }
  return {
    storedRevision,
    loadedRevision,
    questCount: ids.length,
    missingQuestIds: missing,
    changedObjectives: comparable === null ? null : objectives,
    changedPrerequisites: comparable === null ? null : prerequisites,
  };
}
