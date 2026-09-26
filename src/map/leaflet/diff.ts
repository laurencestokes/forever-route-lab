/**
 * Descriptor diffing for `LeafletMapAdapter.setLayer` (docs/MAPS.md §7.3). No Leaflet import, so it
 * runs in the node test environment.
 *
 * The adapter first skips a layer whose `items` array is the one it already drew (by reference).
 * Otherwise it diffs the new items against the drawn ones by id: new ids are created, missing ids
 * removed, and ids whose descriptor object changed are updated in place; a descriptor that is the
 * same object is left alone. `map/layers` keeps the identity of unchanged descriptors, so a route
 * edit touches only the few paths it changed.
 */

export interface Identified {
  readonly id: string;
}

export interface DescriptorDiff<D extends Identified> {
  /** In `next` order. */
  readonly added: readonly D[];
  /** Ids no longer present, in the previous map's iteration order. */
  readonly removed: readonly string[];
  /** Same id, different object, in `next` order. */
  readonly changed: readonly { readonly previous: D; readonly next: D }[];
  /** Same id and the same object. */
  readonly unchanged: number;
  /** Ids that appeared again after their first occurrence in `next`; the later items are ignored. */
  readonly duplicates: readonly string[];
  /** The kept items in `next` order (first occurrence of each id). */
  readonly order: readonly D[];
}

export function diffById<D extends Identified>(previous: ReadonlyMap<string, D>, next: readonly D[]): DescriptorDiff<D> {
  const added: D[] = [];
  const changed: { readonly previous: D; readonly next: D }[] = [];
  const duplicates: string[] = [];
  const order: D[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const item of next) {
    if (seen.has(item.id)) {
      duplicates.push(item.id);
      continue;
    }
    seen.add(item.id);
    order.push(item);
    const old = previous.get(item.id);
    if (old === undefined) added.push(item);
    else if (old === item) unchanged += 1;
    else changed.push({ previous: old, next: item });
  }
  const removed: string[] = [];
  for (const id of previous.keys()) if (!seen.has(id)) removed.push(id);
  return { added, removed, changed, unchanged, duplicates, order };
}

/** True when the diff changes nothing (the adapter then leaves the canvas alone). */
export const isEmptyDiff = (diff: DescriptorDiff<Identified>): boolean =>
  diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;

/**
 * The adapter's own hard cap: at most `capacity` items, dropping from the start of the draw order
 * (the bottom), because `map/layers` puts focused items last. Normally a no-op: the layer budgets
 * already sum to at most the cap.
 */
export function capItems<D>(items: readonly D[], capacity: number): { readonly kept: readonly D[]; readonly dropped: number } {
  const limit = Math.max(0, Math.floor(capacity));
  if (items.length <= limit) return { kept: items, dropped: 0 };
  return { kept: items.slice(items.length - limit), dropped: items.length - limit };
}

/**
 * Structural equality of plain data (objects, arrays, primitives), as descriptors, glyph specs and
 * path styles are. `plainEqual` in map/layers is the same rule; map/leaflet may not import it.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) if (!Object.hasOwn(right, key) || !sameData(left[key], right[key])) return false;
  return true;
}
