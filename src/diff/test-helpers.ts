import { groupId, type IdSource, questId, sequentialIdSource, worldMapId } from '../domain/ids';
import { type Location, worldSourcedPoint } from '../domain/points';
import type { RouteGroup, RouteStep } from '../domain/route';
import { makeAcceptStep, makeCompleteStep, makeNoteStep, makeTravelStep, makeTurnInStep } from '../domain/step-factory';

/**
 * Synthetic routes and seeded edits for the diff's tests and benchmark (tests/bench/diff.bench.ts).
 * The quest ids and coordinates are made up; nothing here is game data, and no application code
 * imports this file.
 */

/** Park-Miller "minimal standard" generator in ordinary arithmetic (no bitwise operators, D-012): values in [0, 1). */
export function seeded(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state === 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** An integer in [0, bound). */
export const pick = (next: () => number, bound: number): number => Math.min(bound - 1, Math.floor(next() * bound));

/** A seeded Fisher-Yates shuffle (a new array). */
export function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pick(next, i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

const at = (x: number, y: number): Location => ({ source: worldSourcedPoint(worldMapId(1), x, y), label: null, radius: null });

export interface SyntheticRoute {
  readonly steps: RouteStep[];
  readonly groups: Record<string, RouteGroup>;
}

/**
 * A guide-like route of `count` steps: per quest a travel and the accept, a travel and the
 * complete, a travel and the turn-in, with a note every tenth quest. With `groups`, each quest's
 * accept and the next quest's accept share a group (an RXP step with two accepts), so groups
 * interleave with the host binding. Ids are `<prefix>1`, `<prefix>2`, ...; quests start at
 * `firstQuest`.
 */
export function syntheticRoute(count: number, options: { readonly prefix?: string; readonly firstQuest?: number; readonly groups?: boolean } = {}): SyntheticRoute {
  let counter = 0;
  const prefix = options.prefix ?? 's';
  const ids: IdSource = {
    next: () => {
      counter += 1;
      return `${prefix}${String(counter)}`;
    },
  };
  const steps: RouteStep[] = [];
  const groups: Record<string, RouteGroup> = {};
  const first = options.firstQuest ?? 1000;
  for (let k = 0; steps.length < count; k += 1) {
    const quest = questId(first + k);
    const x = (k % 50) * 40;
    const y = Math.floor(k / 50) * 40;
    let group = null;
    if (options.groups === true && k % 2 === 0) {
      group = groupId(`g${String(k / 2)}`);
      groups[group] = { id: group, rxp: null };
    } else if (options.groups === true) {
      group = groupId(`g${String((k - 1) / 2)}`);
    }
    if (k % 10 === 9) steps.push(makeNoteStep(ids, { text: `note ${String(k)}` }));
    steps.push(makeTravelStep(ids, { location: at(x, y) }));
    steps.push(makeAcceptStep(ids, { questId: quest, location: at(x, y), groupId: group }));
    steps.push(makeTravelStep(ids, { location: at(x + 10, y + 10) }));
    steps.push(makeCompleteStep(ids, { targets: [{ questId: quest, objective: null }], location: at(x + 10, y + 10) }));
    steps.push(makeTravelStep(ids, { location: at(x, y) }));
    steps.push(makeTurnInStep(ids, { questId: quest, location: at(x, y) }));
  }
  return { steps: steps.slice(0, count), groups };
}

export interface EditCounts {
  readonly moves?: number;
  readonly removes?: number;
  readonly inserts?: number;
  readonly modifies?: number;
}

/**
 * `steps` with seeded edits: `moves` steps moved to random places, `removes` removed, `inserts` new
 * steps (notes, travels, and accepts of new quests) at random places with ids from `ids`, and
 * `modifies` replaced by an edited copy (a new note). The result's ids are unique.
 */
export function editSteps(steps: readonly RouteStep[], next: () => number, counts: EditCounts, ids: IdSource = sequentialIdSource(9_000_000)): RouteStep[] {
  const out = [...steps];
  for (let k = 0; k < (counts.modifies ?? 0) && out.length > 0; k += 1) {
    const i = pick(next, out.length);
    const step = out[i];
    if (step !== undefined) out[i] = { ...step, note: `edited ${String(k)}` };
  }
  for (let k = 0; k < (counts.removes ?? 0) && out.length > 0; k += 1) out.splice(pick(next, out.length), 1);
  for (let k = 0; k < (counts.moves ?? 0) && out.length > 1; k += 1) {
    const [step] = out.splice(pick(next, out.length), 1);
    if (step !== undefined) out.splice(pick(next, out.length + 1), 0, step);
  }
  for (let k = 0; k < (counts.inserts ?? 0); k += 1) {
    const kind = pick(next, 3);
    const step =
      kind === 0
        ? makeNoteStep(ids, { text: `inserted ${String(k)}` })
        : kind === 1
          ? makeTravelStep(ids, { location: at(pick(next, 2000), pick(next, 2000)) })
          : makeAcceptStep(ids, { questId: questId(900_000 + k) });
    out.splice(pick(next, out.length + 1), 0, step);
  }
  return out;
}

// =============================================================================================
// Named steps for small cases

/** An IdSource that returns `id` once (the named builders below). */
const named = (id: string): IdSource => ({ next: () => id });

type Extra = Parameters<typeof makeNoteStep>[1];
type Common = Omit<Extra, 'text' | 'preserved'>;

export const accept = (id: string, quest: number, fields: Common & { readonly anyOf?: readonly number[] } = {}): RouteStep =>
  makeAcceptStep(named(id), { ...fields, questId: questId(quest), anyOf: fields.anyOf === undefined ? null : fields.anyOf.map(questId) });
export const turnIn = (id: string, quest: number, fields: Common = {}): RouteStep => makeTurnInStep(named(id), { ...fields, questId: questId(quest) });
export const complete = (id: string, quests: readonly number[], fields: Common = {}): RouteStep =>
  makeCompleteStep(named(id), { ...fields, targets: quests.map((q) => ({ questId: questId(q), objective: null })) });
export const travel = (id: string, fields: Common = {}): RouteStep => makeTravelStep(named(id), fields);
export const note = (id: string, fields: Common = {}): RouteStep => makeNoteStep(named(id), { ...fields, text: id });
export const place = at;
