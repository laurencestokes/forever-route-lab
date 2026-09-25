import { compact } from './json';

/**
 * Pin-to-pin dataset diff (DATA_PROVENANCE §9.4 item 1; D-026): added, removed and changed records
 * by id and top-level field, `upstreamDiff` and `corrected` changes, count deltas, and changes to
 * spawns, zones and overlays. The three-way Forever classifier (fork base, current Era, current
 * Forever) is a documented stub that returns `unknown` for every record until upstream holds
 * Forever content (§9.4 item 3).
 */

type Row = Readonly<Record<string, unknown>> & { readonly id: number };

export interface DatasetSnapshot {
  readonly label: string;
  /** null when only a manifest was given. */
  readonly records: {
    readonly quests: readonly Row[];
    readonly npcs: readonly Row[];
    readonly objects: readonly Row[];
    readonly items: readonly Row[];
  } | null;
  readonly spawns: { readonly npc: Readonly<Record<string, unknown>>; readonly object: Readonly<Record<string, unknown>> } | null;
  readonly zones: Readonly<Record<string, unknown>> | null;
  readonly overlays: Readonly<Record<string, unknown>> | null;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface RecordTypeDiff {
  readonly added: readonly number[];
  readonly removed: readonly number[];
  /** id → changed top-level fields (provenance counted separately). */
  readonly changed: Readonly<Record<string, readonly string[]>>;
  readonly upstreamDiffChanged: readonly { readonly id: number; readonly from: string; readonly to: string }[];
  readonly correctedChanged: readonly number[];
}

export interface DatasetDiff {
  readonly from: string;
  readonly to: string;
  readonly dataRevision: { readonly from: unknown; readonly to: unknown };
  readonly upstreamCommit: { readonly from: unknown; readonly to: unknown };
  readonly outputs: readonly { readonly path: string; readonly from: unknown; readonly to: unknown }[];
  readonly counts: Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>;
  readonly records: Readonly<Record<'quests' | 'npcs' | 'objects' | 'items', RecordTypeDiff>> | null;
  readonly spawns: { readonly npc: readonly number[]; readonly object: readonly number[] } | null;
  readonly zones: Readonly<Record<string, readonly string[]>> | null;
  /**
   * Changed patch keys per layer and type (`faction.Alliance.quests`, `class.Horde.SHAMAN.quests`,
   * ...), `_generated` ignored (review finding data-F11); empty when every patch is identical.
   */
  readonly overlays: Readonly<Record<string, readonly string[]>> | null;
  readonly threeWayClassifier: 'stub';
}

/** The three-way classifier (§9.4 item 3): a stub, as recorded in the manifest. */
export function classifyThreeWay(_record: { readonly id: number }): 'unknown' {
  return 'unknown';
}

const provenanceOf = (row: Row): { readonly upstreamDiff?: unknown; readonly corrected?: unknown } => {
  const value = row.provenance;
  return typeof value === 'object' && value !== null ? value : {};
};

export function diffRecords(before: readonly Row[], after: readonly Row[]): RecordTypeDiff {
  const a = new Map(before.map((row) => [row.id, row]));
  const b = new Map(after.map((row) => [row.id, row]));
  const added = [...b.keys()].filter((id) => !a.has(id)).sort((x, y) => x - y);
  const removed = [...a.keys()].filter((id) => !b.has(id)).sort((x, y) => x - y);
  const changed: Record<string, readonly string[]> = {};
  const upstreamDiffChanged: { id: number; from: string; to: string }[] = [];
  const correctedChanged: number[] = [];
  for (const [id, old] of [...a].sort((x, y) => x[0] - y[0])) {
    const next = b.get(id);
    if (next === undefined) continue;
    const fields = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter((key) => key !== 'provenance' && compact(old[key] ?? null) !== compact(next[key] ?? null));
    if (fields.length > 0) changed[String(id)] = fields;
    const po = provenanceOf(old);
    const pn = provenanceOf(next);
    if (po.upstreamDiff !== pn.upstreamDiff) upstreamDiffChanged.push({ id, from: String(po.upstreamDiff), to: String(pn.upstreamDiff) });
    if (po.corrected !== pn.corrected) correctedChanged.push(id);
  }
  return { added, removed, changed, upstreamDiffChanged, correctedChanged };
}

function mapDiff(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): readonly string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => compact(before[key] ?? null) !== compact(after[key] ?? null)).sort((x, y) => Number(x) - Number(y) || (x < y ? -1 : x > y ? 1 : 0));
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The patch maps of an overlays.json: `faction.<F>.<type>` and `class.<F>.<TOKEN>.<type>`, each an
 * id → patch map. `_generated` (which names the pin, so it changes at every bump) is not a layer.
 */
export function overlayPatchMaps(overlays: Readonly<Record<string, unknown>>): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const out = new Map<string, Readonly<Record<string, unknown>>>();
  const faction = isObject(overlays.faction) ? overlays.faction : {};
  for (const [name, layer] of Object.entries(faction)) {
    if (!isObject(layer)) continue;
    for (const [type, patches] of Object.entries(layer)) if (isObject(patches)) out.set(`faction.${name}.${type}`, patches);
  }
  const byClass = isObject(overlays.class) ? overlays.class : {};
  for (const [name, tokens] of Object.entries(byClass)) {
    if (!isObject(tokens)) continue;
    for (const [token, layer] of Object.entries(tokens)) {
      if (!isObject(layer)) continue;
      for (const [type, patches] of Object.entries(layer)) if (isObject(patches)) out.set(`class.${name}.${token}.${type}`, patches);
    }
  }
  return out;
}

export function diffOverlays(from: Readonly<Record<string, unknown>>, to: Readonly<Record<string, unknown>>): Readonly<Record<string, readonly string[]>> {
  const a = overlayPatchMaps(from);
  const b = overlayPatchMaps(to);
  const out: Record<string, readonly string[]> = {};
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const changed = mapDiff(a.get(key) ?? {}, b.get(key) ?? {});
    if (changed.length > 0) out[key] = changed;
  }
  return out;
}

export function diffDatasets(from: DatasetSnapshot, to: DatasetSnapshot): DatasetDiff {
  const outputsOf = (snapshot: DatasetSnapshot): Map<string, unknown> =>
    new Map(((snapshot.manifest.outputs ?? []) as readonly { readonly path: string; readonly sha256: string }[]).map((output) => [output.path, output.sha256]));
  const oa = outputsOf(from);
  const ob = outputsOf(to);
  const outputs = [...new Set([...oa.keys(), ...ob.keys()])]
    .sort()
    .filter((path) => oa.get(path) !== ob.get(path))
    .map((path) => ({ path, from: oa.get(path) ?? null, to: ob.get(path) ?? null }));
  const countsA = (from.manifest.counts ?? {}) as Readonly<Record<string, unknown>>;
  const countsB = (to.manifest.counts ?? {}) as Readonly<Record<string, unknown>>;
  const counts: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [...new Set([...Object.keys(countsA), ...Object.keys(countsB)])].sort()) {
    if (compact(countsA[key] ?? null) !== compact(countsB[key] ?? null)) counts[key] = { from: countsA[key] ?? null, to: countsB[key] ?? null };
  }
  const records =
    from.records === null || to.records === null
      ? null
      : {
          quests: diffRecords(from.records.quests, to.records.quests),
          npcs: diffRecords(from.records.npcs, to.records.npcs),
          objects: diffRecords(from.records.objects, to.records.objects),
          items: diffRecords(from.records.items, to.records.items),
        };
  const spawns =
    from.spawns === null || to.spawns === null
      ? null
      : { npc: mapDiff(from.spawns.npc, to.spawns.npc).map(Number), object: mapDiff(from.spawns.object, to.spawns.object).map(Number) };
  let zones: Record<string, readonly string[]> | null = null;
  if (from.zones !== null && to.zones !== null) {
    zones = {};
    for (const key of ['areas', 'uiMaps', 'dungeons', 'instanceAreas']) {
      const changedKeys = mapDiff((from.zones[key] ?? {}) as Readonly<Record<string, unknown>>, (to.zones[key] ?? {}) as Readonly<Record<string, unknown>>);
      if (changedKeys.length > 0) zones[key] = changedKeys;
    }
  }
  const upstream = (snapshot: DatasetSnapshot): unknown => (snapshot.manifest.upstream as { readonly commit?: unknown } | undefined)?.commit ?? null;
  return {
    from: from.label,
    to: to.label,
    dataRevision: { from: from.manifest.dataRevision ?? null, to: to.manifest.dataRevision ?? null },
    upstreamCommit: { from: upstream(from), to: upstream(to) },
    outputs,
    counts,
    records,
    spawns,
    zones,
    overlays: from.overlays === null || to.overlays === null ? null : diffOverlays(from.overlays, to.overlays),
    threeWayClassifier: 'stub',
  };
}

/** A short text summary, for the pin-bump commit message (DATA_PROVENANCE §12). */
export function summarise(diff: DatasetDiff): string {
  const lines = [
    `dataset diff ${diff.from} → ${diff.to}`,
    `  upstream ${String(diff.upstreamCommit.from)} → ${String(diff.upstreamCommit.to)}`,
    `  dataRevision ${String(diff.dataRevision.from)} → ${String(diff.dataRevision.to)}`,
  ];
  if (diff.outputs.length === 0) lines.push('  outputs: identical');
  else lines.push(`  outputs changed: ${diff.outputs.map((output) => output.path).join(', ')}`);
  if (diff.records !== null) {
    for (const [type, d] of Object.entries(diff.records)) {
      const changedIds = Object.keys(d.changed);
      const fieldCounts = new Map<string, number>();
      for (const fields of Object.values(d.changed)) for (const field of fields) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      const fieldText = [...fieldCounts].sort((a, b) => b[1] - a[1]).map(([field, n]) => `${field} ${String(n)}`).join(', ');
      lines.push(
        `  ${type}: +${String(d.added.length)} -${String(d.removed.length)} ~${String(changedIds.length)}${fieldText === '' ? '' : ` (${fieldText})`}; upstreamDiff changed ${String(d.upstreamDiffChanged.length)}, corrected changed ${String(d.correctedChanged.length)}`,
      );
    }
  } else {
    lines.push('  records: not compared (manifest only)');
  }
  if (diff.spawns !== null) lines.push(`  spawns changed: ${String(diff.spawns.npc.length)} npcs, ${String(diff.spawns.object.length)} objects`);
  if (diff.zones !== null) lines.push(`  zones changed: ${Object.keys(diff.zones).length === 0 ? 'none' : Object.entries(diff.zones).map(([key, ids]) => `${key} ${String(ids.length)}`).join(', ')}`);
  if (diff.overlays !== null) {
    const changed = Object.entries(diff.overlays);
    lines.push(changed.length === 0 ? '  overlays: identical' : `  overlays changed: ${changed.map(([key, ids]) => `${key} ${String(ids.length)}`).join(', ')}`);
  }
  for (const [key, change] of Object.entries(diff.counts)) lines.push(`  counts.${key}: ${compact(change.from)} → ${compact(change.to)}`);
  lines.push(`  three-way classifier: ${diff.threeWayClassifier} (every record unknown)`);
  return lines.join('\n');
}
