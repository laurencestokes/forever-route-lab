import type { Truth } from '../../domain/conditions';
import type { EntityRef, ItemRecord, NpcRecord, SpawnPoint } from '../../domain/dataset';
import { itemId, npcId, type QuestId } from '../../domain/ids';
import type { VisitKey } from '../../engine/state';
import { ridingSpellTier } from '../../rules/riding';
import { interactionTime } from '../../sim/interaction';
import { cumulativeXp, stateAtTotal, xpCurveOf } from '../../sim/xp';
import { createTransitions, runSequence } from './evaluate';
import { collectGeometry, type Geometry, type TableEntry } from './geometry';
import { entityKey, locationOf, pointKey } from './locations';
import { buildMatrix, matrixKey, NOT_REQUESTED, pairSignature } from './matrix';
import { buildEdges, REQUIRE, suffixGuard } from './relations';
import { type AcceptInputs, type AnalysisInternal, buildStructure, type DestDraft, type PredicateDraft, type StepInfo, type Structure } from './section';
import type {
  AnyOfCheck,
  AvailabilityCheck,
  CompiledProblem,
  CompileFailure,
  ConditionCheck,
  DecodeTable,
  GrindSpec,
  MatrixCache,
  Op,
  OpDest,
  OpTravel,
  PredicateCheck,
  QuestXpSpec,
  SearchProblem,
  SectionAnalysis,
  SectionWalk,
  StepProbe,
  TrainSpec,
  WorkBlock,
} from './types';

/**
 * `compileProblem` (docs/research/optimizer-m7.md §5): after "computing paths", the section is
 * analysed again on the baseline walk, checked against the analysis, and compiled into the search
 * problem: per-tier matrices from the complete leg table, the flight and transport tables, the
 * pricing slice, the checks, the start state and the closing rules. The incumbent is then priced
 * with the search's own transitions as a self-check against the engine (§5.6).
 */

const fail = (reason: string): CompileFailure => ({ ok: false, status: 'failed', reason });

/** Codes whose truth the search evaluates from its state (§4.2); the rest are the static part. */
export function isDynamicCode(code: string): boolean {
  return code.startsWith('VAL004-') || code.startsWith('VAL005-') || code.startsWith('VAL020-') || code === 'VAL013-breadcrumb-target-unavailable';
}

function sameStructure(a: Structure, b: Structure, ga: Geometry, gb: Geometry): string | null {
  if (a.units.length !== b.units.length) return 'the number of units';
  for (let u = 0; u < a.units.length; u += 1) {
    const x = a.units[u];
    const y = b.units[u];
    if (x === undefined || y === undefined || x.anchor !== y.anchor || x.steps.join(',') !== y.steps.join(',')) return `unit ${String(u)}`;
  }
  for (const [i, info] of a.steps) {
    const other = b.steps.get(i);
    if (other === undefined || other.active !== info.active || other.event !== info.event || other.quest !== info.quest) return `step ${String(i)}`;
  }
  if ([...a.obligatory].join(',') !== [...b.obligatory].join(',')) return 'the obligatory quests';
  if (a.chain.join(',') !== b.chain.join(',')) return 'the exit chain';
  if (ga.locations.table.count !== gb.locations.table.count) return 'the locations';
  for (let k = 0; k < ga.locations.table.count; k += 1) {
    const x = ga.locations.endpoints[k];
    const y = gb.locations.endpoints[k];
    if (x === undefined || y === undefined || x.point.mapId !== y.point.mapId || x.point.x !== y.point.x || x.point.y !== y.point.y || x.zoneHint !== y.zoneHint) return 'the locations';
  }
  if (ga.matrixPairs.join(',') !== gb.matrixPairs.join(',')) return 'the legs';
  return null;
}

const msOf = (seconds: number | null): number => (seconds === null ? 0 : Math.round(seconds * 1000));

export function compileProblem(
  analysis: SectionAnalysis,
  baseline: SectionWalk,
  options: { readonly cache?: MatrixCache; readonly cacheKey?: string } = {},
): CompiledProblem | CompileFailure {
  const internal = analysis.internal as AnalysisInternal;
  const input = { ...internal.structure.input, walk: baseline };
  const structure = buildStructure(input, baseline);
  if (!('input' in structure)) return structure;
  const geometry = collectGeometry(structure);
  if (!('pairs' in geometry)) return geometry;
  const difference = sameStructure(internal.structure, structure, internal.geometry, geometry);
  if (difference !== null) return fail(`the section's structure changed after computing paths (${difference}); try again`);
  const { context } = input;
  const rules = context.rules;
  const curve = xpCurveOf(rules);
  const n = geometry.locations.table.count;
  const tierCount = geometry.tiers.length;

  // ---- Matrices (§5.3), through the cache when the app keeps one.
  let matrix: Int32Array;
  const cache = options.cache;
  if (cache === undefined) matrix = buildMatrix(geometry, context.travel, rules);
  else {
    const key = matrixKey(context.travel, rules, context.graph, geometry, options.cacheKey ?? '');
    const signature = pairSignature(geometry);
    const hit = cache.lookup(key, signature);
    if (hit !== null && hit.length === tierCount * n * n) matrix = hit.slice();
    else {
      matrix = buildMatrix(geometry, context.travel, rules);
      cache.store(key, signature, matrix);
    }
  }

  // ---- Visit keys (§3.3): point ids, then entities.
  const pointCount = geometry.locations.table.pointCount;
  const entityKeys = new Map<string, number>();
  const entityVisit = (ref: EntityRef): number => {
    const key = entityKey(ref);
    let k = entityKeys.get(key);
    if (k === undefined) {
      k = pointCount + entityKeys.size;
      entityKeys.set(key, k);
    }
    return k;
  };

  // ---- Checks (§4.2) from the baseline probe.
  const probe = baseline.probe;
  const accepts: AvailabilityCheck[] = [];
  const conditions: ConditionCheck[] = [];
  const anyOfChecks: AnyOfCheck[] = [];
  const probeEntry = (i: number, questId: QuestId): { readonly truth: Truth; readonly codes: readonly string[] } | null => {
    const step: StepProbe | undefined = probe?.steps.get(i);
    return step?.availability?.find((entry) => entry.questId === questId) ?? null;
  };
  const availabilityCheck = (i: number, inputs: AcceptInputs): number | null => {
    const entry = probeEntry(i, inputs.questId);
    if (entry === null) return null;
    const record = context.dataset.quest(inputs.questId);
    const target = inputs.target;
    const targetRecord = target === null ? undefined : context.dataset.quest(target.questId);
    accepts.push({
      quest: structure.questIndex.get(inputs.questId) ?? -1,
      questId: inputs.questId,
      inLog: inputs.inLog,
      original: entry.truth,
      static: input.availability.truth(entry.codes.filter((code) => !isDynamicCode(code))),
      minLevel: record?.minLevel ?? null,
      maxLevel: record?.maxLevel ?? null,
      levelLifted: inputs.parentActive,
      target:
        target === null || target.takenOrDone
          ? null
          : { quest: structure.questIndex.get(target.questId) ?? -1, minLevel: targetRecord?.minLevel ?? null, maxLevel: targetRecord?.maxLevel ?? null, levelLifted: target.parentActive, inLog: false },
    });
    return accepts.length - 1;
  };
  const predicateCheck = (i: number, draft: PredicateDraft): PredicateCheck => {
    switch (draft.kind) {
      case 'fixed':
        return { kind: 'fixed', original: draft.original };
      case 'level':
        return { kind: 'level', level: draft.level, xp: draft.xp, negate: draft.negate, original: draft.original };
      case 'available': {
        const checks: number[] = [];
        for (const inputs of draft.inputs) {
          const k = availabilityCheck(i, inputs);
          // Without the probe's findings the predicate is held by its order edges only.
          if (k === null) return { kind: 'fixed', original: draft.original };
          checks.push(k);
        }
        return { kind: 'available', checks, match: draft.match, negate: draft.negate, original: draft.original };
      }
    }
  };
  const conditionOf = (info: StepInfo): number => {
    if (info.groupPredicates === null && info.stepPredicates.length === 0) return -1;
    conditions.push({
      group: info.groupPredicates === null ? null : info.groupPredicates.map((draft) => predicateCheck(info.index, draft)),
      step: info.stepPredicates.map((draft) => predicateCheck(info.index, draft)),
    });
    return conditions.length - 1;
  };

  // ---- The pricing slice (§5.5).
  const blocks: WorkBlock[] = [];
  const trains: TrainSpec[] = [];
  const grinds: GrindSpec[] = [];
  const npcIds = new Set<number>();
  const itemIds = new Set<number>();
  const spawnNpcs = new Set<number>();
  const addBlock = (block: WorkBlock | null): number => {
    if (block === null) return -1;
    for (const work of block.works) {
      const def = work.objective;
      if (def.kind === 'kill') npcIds.add(def.npcId);
      else if (def.kind === 'killCredit') npcIds.add(def.rootNpcId);
      else if (def.kind === 'item') {
        itemIds.add(def.itemId);
        for (const npc of context.dataset.item(def.itemId)?.dropNpcs ?? []) {
          npcIds.add(npc);
          if (work.at !== null) spawnNpcs.add(npc);
        }
      }
    }
    blocks.push(block);
    return blocks.length - 1;
  };
  const questXp: QuestXpSpec[] = structure.quests.map((quest) => ({
    questId: quest.id,
    xp: quest.record?.xp ?? null,
    requiredLevel: quest.record?.minLevel ?? null,
    dungeonQuest: quest.record?.dungeonQuest ?? false,
  }));

  // ---- Ops (§6): the units' steps in order, then the exit chain.
  const interaction = (kind: Parameters<typeof interactionTime>[0]): number => msOf(interactionTime(kind, rules).part.seconds.value);
  const overrideOf = (value: number | null): number => (value !== null && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : -1);
  const loc = (end: Parameters<typeof locationOf>[1]): number => locationOf(geometry.locations, end);
  const destOf = (dest: DestDraft): OpDest => {
    switch (dest.kind) {
      case 'none':
      case 'hearth':
      case 'table':
        return { kind: 'none' };
      case 'lost':
        return { kind: 'lost' };
      case 'loc':
        return { kind: 'loc', loc: loc(dest.end), radius: dest.radius };
      case 'spawn':
        return { kind: 'spawn', table: geometry.spawnTableOf.get(entityKey(dest.entity)) ?? -1 };
    }
  };
  const travelOf = (info: StepInfo): OpTravel => ({
    walk: info.walk,
    group: info.chain === null ? -1 : (structure.chainIndex.get(info.chain) ?? -1),
    dest: destOf(info.dest),
  });
  const quest = (q: QuestId | null): number => (q === null ? -1 : (structure.questIndex.get(q) ?? -1));
  const tableIndex = new Map<number, number>();
  const opOf = (info: StepInfo): Op | CompileFailure => {
    const step = info.step;
    const cond = conditionOf(info);
    const overrideMs = overrideOf(step.durationOverride);
    const common = { step: info.index, cond, overrideMs };
    if (!info.active) {
      const missing = step.kind === 'turnin' && info.record.delta.skipped === 'skip-if-missing' ? quest(step.questId) : -1;
      return { ...common, kind: 'skip', missing };
    }
    switch (step.kind) {
      case 'accept': {
        let entityKeyValue = -1;
        if (step.location === null) {
          const d = info.dest;
          if (d.kind === 'spawn') entityKeyValue = entityVisit(d.entity);
          else if (d.kind === 'none') {
            // An item target (`nearestSpawn` none): the key is the entity; no target at all: none.
            const chosen = info.quest ?? step.questId;
            const refs = step.via ?? (context.dataset.quest(chosen)?.starters.length === 1 ? (context.dataset.quest(chosen)?.starters[0] ?? null) : null);
            entityKeyValue = refs === null ? -2 : entityVisit(refs);
          }
        }
        const inputs = info.accept ?? [];
        let availability = -1;
        let anyOf = -1;
        if (info.candidates === null) {
          const first = inputs[0];
          if (first !== undefined) {
            const k = availabilityCheck(info.index, first);
            if (k === null) return fail(`the baseline probe has no availability for step ${String(info.index)}`);
            availability = k;
          }
        } else {
          const candidates: number[] = [];
          for (const one of inputs) {
            const k = availabilityCheck(info.index, one);
            if (k === null) return fail(`the baseline probe has no availability for step ${String(info.index)}`);
            candidates.push(k);
          }
          const chosen = info.candidates.indexOf(info.quest ?? step.questId);
          anyOfChecks.push({ candidates, chosen: Math.max(0, chosen) });
          anyOf = anyOfChecks.length - 1;
          availability = candidates[Math.max(0, chosen)] ?? -1;
        }
        return {
          ...common,
          kind: 'accept',
          travel: travelOf(info),
          entityKey: entityKeyValue,
          quest: quest(info.quest),
          availability,
          anyOf,
          firstMs: interaction({ kind: 'accept', firstInVisit: true }),
          furtherMs: interaction({ kind: 'accept', firstInVisit: false }),
        };
      }
      case 'complete':
        return {
          ...common,
          kind: 'complete',
          travel: travelOf(info),
          quests: [...new Set(step.targets.map((target) => target.questId))].map((q) => quest(q)),
          partial: step.progress === 'partial',
          partialMs: Math.round((step.durationOverride ?? 0) * 1000),
          block: addBlock(info.block),
        };
      case 'turnin':
        return {
          ...common,
          kind: 'turnin',
          travel: travelOf(info),
          quest: quest(info.quest),
          interactionMs: interaction({ kind: 'turnin', rewardChoice: step.rewardIndex !== null }),
          carry: addBlock(info.carry),
          turnsIn: info.turnsIn,
          requirePresent: step.skipIfMissing,
        };
      case 'abandon':
        return { ...common, kind: 'abandon', travel: travelOf(info), quest: quest(info.quest) };
      case 'grind':
        grinds.push({ until: step.until, mobLevel: step.mobLevel, xpPerHour: step.xpPerHour, place: info.place });
        return { ...common, kind: 'grind', travel: travelOf(info), grind: grinds.length - 1 };
      case 'hearth':
        if (step.mode === 'use') return { ...common, kind: 'hearth-use', bindLoc: info.dest.kind === 'hearth' ? loc(info.dest.end) : -1 };
        return {
          ...common,
          kind: 'hearth-bind',
          travel: travelOf(info),
          interactionMs: interaction({ kind: 'bind' }),
          checkPoint: step.location !== null ? -2 : info.bindBefore === null ? -1 : (geometry.locations.table.pointId[loc(info.bindBefore)] ?? -1),
        };
      case 'flight':
        return { ...common, kind: 'table', table: tableIndex.get(info.index) ?? -1 };
      case 'travel':
        if (step.mode === 'transport') return { ...common, kind: 'table', table: tableIndex.get(info.index) ?? -1 };
        return { ...common, kind: 'plain', travel: travelOf(info), interactionMs: 0, train: -1 };
      case 'train': {
        let train = -1;
        const recognised = step.skill === 'riding' || ridingSpellTier(rules.values.ridingSpells.value, step.spellId) !== null;
        if (recognised) {
          trains.push({ step: { skill: step.skill, spellId: step.spellId, rank: step.rank }, original: info.riding.after });
          train = trains.length - 1;
        }
        return { ...common, kind: 'plain', travel: travelOf(info), interactionMs: interaction({ kind: 'train' }), train };
      }
      case 'vendor':
        return { ...common, kind: 'plain', travel: travelOf(info), interactionMs: interaction({ kind: 'vendor' }), train: -1 };
      case 'note':
        return { ...common, kind: 'plain', travel: travelOf(info), interactionMs: interaction({ kind: 'note' }), train: -1 };
    }
  };

  // Anchor tables (§5.4): one per flight or transport step, indexed by tier and from-location.
  const tableSteps = [...geometry.tables.keys()].sort((a, b) => a - b);
  tableSteps.forEach((i, k) => tableIndex.set(i, k));
  const tableSize = tierCount * (n + 1);
  const anchorMs = new Int32Array(tableSteps.length * tableSize).fill(NOT_REQUESTED);
  const anchorExit = new Int32Array(tableSteps.length * tableSize).fill(NOT_REQUESTED);
  const anchorUnknown = new Uint8Array(tableSteps.length * tableSize);
  const anchorArrival = new Int32Array(tableSteps.length * tableSize).fill(-1);
  tableSteps.forEach((i, k) => {
    const entries: readonly (TableEntry | null)[] = geometry.tables.get(i) ?? [];
    entries.forEach((entry, j) => {
      if (entry === null) return;
      anchorMs[k * tableSize + j] = entry.ms;
      anchorExit[k * tableSize + j] = entry.exitMs;
      anchorUnknown[k * tableSize + j] = entry.unknown;
      anchorArrival[k * tableSize + j] = loc(entry.arrival);
    });
  });

  const ops: Op[] = [];
  const opStart = new Int32Array(structure.units.length + 1);
  const stepInfo = (i: number): StepInfo => {
    const found = structure.steps.get(i);
    if (found === undefined) throw new Error(`No step info for ${String(i)}`);
    return found;
  };
  for (let u = 0; u < structure.units.length; u += 1) {
    opStart[u] = ops.length;
    for (const i of structure.units[u]?.steps ?? []) {
      const op = opOf(stepInfo(i));
      if ('ok' in op) return op;
      ops.push(op);
    }
  }
  opStart[structure.units.length] = ops.length;
  const exitOps: number[] = [];
  for (const i of structure.chain) {
    const op = opOf(stepInfo(i));
    if ('ok' in op) return op;
    exitOps.push(ops.length);
    ops.push(op);
  }

  // ---- Units, quests, edges, groups (§3, §7).
  const unitCount = structure.units.length;
  const anchor = new Uint8Array(unitCount);
  const obligatoryUnits = new Uint8Array(unitCount);
  const questStart = new Int32Array(unitCount + 1);
  const unitQuestList: number[] = [];
  const firstDestKind = new Uint8Array(unitCount);
  const firstDest = new Int32Array(unitCount).fill(-1);
  const grantsXp = new Uint8Array(unitCount);
  structure.units.forEach((unit, u) => {
    anchor[u] = unit.anchor ? 1 : 0;
    obligatoryUnits[u] = unit.anchor || unit.quests.some((q) => structure.obligatory.has(q)) ? 1 : 0;
    questStart[u] = unitQuestList.length;
    for (const q of unit.quests) unitQuestList.push(quest(q));
    for (let k = opStart[u] ?? 0; k < (opStart[u + 1] ?? 0); k += 1) {
      const op = ops[k];
      if (op === undefined || op.kind === 'skip' || op.kind === 'table' || op.kind === 'hearth-use') continue;
      const dest = op.travel.dest;
      if (dest.kind === 'loc' && dest.loc >= 0) {
        firstDestKind[u] = 1;
        firstDest[u] = dest.loc;
        break;
      }
      if (dest.kind === 'spawn') {
        firstDestKind[u] = 2;
        firstDest[u] = dest.table;
        break;
      }
    }
    grantsXp[u] = unit.steps.some((i) => {
      const info = stepInfo(i);
      return info.active && (info.step.kind === 'grind' || info.record.estimate.xpGained.value !== 0);
    })
      ? 1
      : 0;
  });
  questStart[unitCount] = unitQuestList.length;

  const questCount = structure.quests.length;
  const questUnitStart = new Int32Array(questCount + 1);
  const questUnits: number[] = [];
  structure.quests.forEach((q, k) => {
    questUnitStart[k] = questUnits.length;
    questUnits.push(...q.units);
  });
  questUnitStart[questCount] = questUnits.length;

  const edges = buildEdges(structure);
  const predStart = new Int32Array(unitCount + 1);
  const pred: number[] = [];
  const kinds: number[] = [];
  const succLists: number[][] = Array.from({ length: unitCount }, () => []);
  for (let u = 0, e = 0; u < unitCount; u += 1) {
    predStart[u] = pred.length;
    while (e < edges.length && edges[e]?.to === u) {
      const edge = edges[e];
      if (edge !== undefined) {
        pred.push(edge.from);
        kinds.push(edge.kind);
        if (edge.kind === REQUIRE) succLists[edge.from]?.push(u);
      }
      e += 1;
    }
  }
  predStart[unitCount] = pred.length;
  const succStart = new Int32Array(unitCount + 1);
  const succ: number[] = [];
  succLists.forEach((list, u) => {
    succStart[u] = succ.length;
    succ.push(...list);
  });
  succStart[unitCount] = succ.length;

  const chainStart = new Int32Array(structure.chains.length + 1);
  const chainLoc: number[] = [];
  const chainRadius: number[] = [];
  structure.chains.forEach((chain, g) => {
    chainStart[g] = chainLoc.length;
    chain.ends.forEach((end, k) => {
      chainLoc.push(loc(end));
      chainRadius.push(chain.radius[k] ?? 0);
    });
  });
  chainStart[structure.chains.length] = chainLoc.length;
  const groupUnitStart = new Int32Array(structure.chains.length + 1);
  const groupUnits: number[] = [];
  structure.chains.forEach((chain, g) => {
    groupUnitStart[g] = groupUnits.length;
    structure.units.forEach((unit, u) => {
      if (unit.steps.some((i) => stepInfo(i).chain === chain.id)) groupUnits.push(u);
    });
  });
  groupUnitStart[structure.chains.length] = groupUnits.length;

  // ---- The start state (§5.1, §7.1).
  const start = baseline.start;
  const startLoc = start.location === null ? -1 : loc({ point: start.location, zoneHint: start.locationHint });
  const visitKeyOf = (key: VisitKey | null): number => {
    if (key === null) return -1;
    if ('mapId' in key) {
      const match = geometry.locations.endpoints.findIndex((end) => pointKey(end.point) === pointKey(key));
      return match < 0 ? -1 : (geometry.locations.table.pointId[match] ?? -1);
    }
    const k = entityKeys.get(entityKey(key));
    return k === undefined ? -1 : k;
  };
  const startTotal = cumulativeXp(curve, Math.max(1, Math.min(start.level, curve.cumulative.length))) + start.xp;
  let externalActive = 0;
  for (const q of start.questLog.keys()) if (!structure.questIndex.has(q)) externalActive += 1;
  const targetXp = structure.summary.targetXp;
  const targetTotal = startTotal + targetXp;
  const capTotal = cumulativeXp(curve, curve.maxLevel);
  const guard = suffixGuard(structure);
  // The fill reaches the target, or the suffix interval's floor when that is higher (review PAR-06):
  // a lower target may leave a reorder short of a suffix threshold the original crossed.
  const fillTotal = Number.isFinite(guard.deltaLo) ? Math.max(targetTotal, guard.originalEndTotal + guard.deltaLo) : targetTotal;
  let fillUntil: SearchProblem['fill']['until'] = null;
  if (fillTotal <= capTotal) {
    const at = stateAtTotal(curve, fillTotal);
    fillUntil = { kind: 'level', level: at.level, offset: at.xp > 0 ? { kind: 'xpInto', xp: at.xp } : null };
  }

  // ---- Lookup data of the pricing slice.
  const npcs: NpcRecord[] = [];
  for (const id of [...npcIds].sort((a, b) => a - b)) {
    const npc = context.dataset.npc(npcId(id));
    if (npc !== undefined) npcs.push(npc);
  }
  const items: ItemRecord[] = [];
  for (const id of [...itemIds].sort((a, b) => a - b)) {
    const item = context.dataset.item(itemId(id));
    if (item !== undefined) items.push(item);
  }
  const spawns: { readonly key: string; readonly spawns: readonly SpawnPoint[] }[] = [];
  for (const id of [...spawnNpcs].sort((a, b) => a - b)) {
    const ref: EntityRef = { kind: 'npc', id: npcId(id) };
    spawns.push({ key: entityKey(ref), spawns: context.dataset.spawns(ref) });
  }

  const draft = {
    rules,
    locations: geometry.locations.table,
    tierIndex: geometry.tierIndex,
    tierCount,
    matrix,
    unknownPairs: new Int32Array(0),
    neighbourStart: new Int32Array(0),
    neighbours: new Int32Array(0),
    units: { count: unitCount, opStart, anchor, obligatory: obligatoryUnits, questStart, quests: Int32Array.from(unitQuestList), firstDestKind, firstDest, grantsXp },
    ops,
    quests: {
      count: questCount,
      ids: Float64Array.from(structure.quests.map((q) => q.id)),
      obligatory: Uint8Array.from(structure.quests.map((q) => (structure.obligatory.has(q.id) ? 1 : 0))),
      startStatus: Uint8Array.from(structure.quests.map((q) => q.startStatus)),
      unitStart: questUnitStart,
      units: Int32Array.from(questUnits),
      xp: Int32Array.from(structure.quests.map((_, k) => k)),
    },
    edges: { predStart, pred: Int32Array.from(pred), kind: Uint8Array.from(kinds), succStart, succ: Int32Array.from(succ) },
    groups: {
      count: structure.chains.length,
      chainStart,
      chainLoc: Int32Array.from(chainLoc),
      chainRadius: Float64Array.from(chainRadius),
      prefixDone: Uint8Array.from(structure.chains.map((chain) => (chain.prefixDone ? 1 : 0))),
      unitStart: groupUnitStart,
      units: Int32Array.from(groupUnits),
    },
    spawnTables: geometry.spawnTables,
    anchorTables: { count: tableSteps.length, ms: anchorMs, exitMs: anchorExit, unknown: anchorUnknown, arrival: anchorArrival },
    pricing: { blocks, questXp, trains, grinds, npcs, items, spawns },
    checks: {
      accepts,
      conditions,
      anyOf: anyOfChecks,
      capacity: rules.values.questLogCapacity.value,
      xpStepSkipping: input.project.routeProfile.xpStepSkipping,
      unknownHistory: structure.unknownHistory,
    },
    start: {
      loc: startLoc,
      tier: start.riding.trained,
      unknownXp: start.unknownXpEvents,
      sinceCastUnknown: start.sinceCastBasis === 'unknown' ? 1 : 0,
      level: start.level,
      xpInto: start.xp,
      knownTotal: startTotal,
      readyAtMs: Math.round((start.hearthReadyAt - start.timeSec) * 1000),
      lastVisit: visitKeyOf(baseline.memo.visitKey),
      externalActive,
    },
    closing: { deltaLo: guard.deltaLo, deltaHi: guard.deltaHi, originalEndTotal: guard.originalEndTotal, logRule: guard.logRule, originalLogCount: guard.originalLogCount },
    exitOps: Int32Array.from(exitOps),
    fill: { replaceQuests: input.goal.grindFill === 'replace-quests', total: fillTotal, until: fillUntil },
    targetXp,
    visitKeyCount: pointCount + entityKeys.size,
    incumbent: { ms: 0, gain: 0, readyAtMs: Number.POSITIVE_INFINITY, unknownParts: Number.POSITIVE_INFINITY, tier: 0 },
    incumbentWaits: new Float64Array(ops.length),
  } satisfies SearchProblem;
  const neighbours = neighbourLists(draft, geometry);

  // ---- The incumbent and the self-check (§5.6).
  const incumbentUnits = Int32Array.from({ length: unitCount }, (_, u) => u);
  const probeProblem: SearchProblem = { ...draft, ...neighbours };
  const transitions = createTransitions(probeProblem);
  const unknownPairs = new Set<number>();
  transitions.recordUnknown = unknownPairs;
  const incumbentWaits = new Float64Array(ops.length);
  transitions.recordWaits = incumbentWaits;
  const priced = runSequence(transitions, incumbentUnits, true);
  if ('infeasible' in priced) {
    if (transitions.targetOutOfReach) {
      return { ok: false, status: 'infeasible', reason: `the target of ${String(targetXp)} known XP is out of reach: ${transitions.failure}` };
    }
    return fail(`the optimiser's model disagrees with the engine on this section: the original order is infeasible (${priced.infeasible})`);
  }
  // The original has no grind fill: compare the section and its exit chain only.
  const engineMs = structure.summary.original.sectionPlusExitMs;
  const modelMs = priced.closed.estimatedMs - priced.closed.fillMs;
  const tolerance = Math.max(0.01 * engineMs, transitions.pricedParts);
  if (Math.abs(modelMs - engineMs) > tolerance) {
    return fail(`the optimiser's model disagrees with the engine on this section: ${disagreement(structure, probeProblem)} (${String(modelMs)} ms against ${engineMs.toFixed(1)} ms)`);
  }
  const problem: SearchProblem = {
    ...probeProblem,
    unknownPairs: Int32Array.from([...unknownPairs].sort((a, b) => a - b)),
    incumbent: {
      ms: priced.closed.estimatedMs,
      gain: priced.closed.knownGain + priced.closed.fillXp,
      readyAtMs: priced.closed.readyAtMs,
      unknownParts: priced.closed.unknownParts - priced.closed.uncertainWaits,
      tier: priced.closed.tier,
    },
    incumbentWaits,
  };
  // The incumbent must pass every closing rule, not only be priced (review COR-03): with a fill,
  // the target can take the section end across a suffix threshold the original stays on one side of.
  // The probe's limits from the incumbent are open, and the incumbent meets its own.
  if (transitions.close(priced.state, false) === null) {
    const why = transitions.failure;
    if (priced.closed.fillXp > 0) return { ok: false, status: 'infeasible', reason: `the target of ${String(targetXp)} known XP cannot be met without changing the rest of the route: ${why}` };
    return fail(`the optimiser's model disagrees with the engine on this section: the original order breaks its own closing rules (${why})`);
  }

  // ---- The decode table (§5.6) and the transfer list.
  const sectionSteps = input.project.route.steps.slice(structure.first, structure.last + 1);
  const unitStepStart = new Int32Array(unitCount + 1);
  const unitSteps: number[] = [];
  structure.units.forEach((unit, u) => {
    unitStepStart[u] = unitSteps.length;
    for (const i of unit.steps) unitSteps.push(i - structure.first);
  });
  unitStepStart[unitCount] = unitSteps.length;
  const fixed = new Uint8Array(sectionSteps.length);
  structure.units.forEach((unit) => {
    if (!unit.anchor) return;
    for (const i of unit.steps) fixed[i - structure.first] = 1;
  });
  const decode: DecodeTable = { first: structure.first, last: structure.last, steps: sectionSteps, unitStart: unitStepStart, unitSteps: Int32Array.from(unitSteps), fixed, fillUntil };
  const blocksCount = structure.units.filter((unit) => unit.block).length;
  return {
    ok: true,
    problem,
    transfer: transferList(problem),
    decode,
    summary: structure.summary,
    stats: {
      units: unitCount,
      anchors: structure.units.filter((unit) => unit.anchor).length,
      blocks: blocksCount,
      locations: n,
      pairs: geometry.pairs.length,
      tiers: tierCount,
      incumbentMs: problem.incumbent.ms,
    },
  };
}


/** Neighbour lists (§7.4): each location's requested targets by (tier-0 ms, index), at most 48. */
export const NEIGHBOURS = 48;

function neighbourLists(problem: Pick<SearchProblem, 'matrix'>, geometry: Geometry): { readonly neighbourStart: Int32Array; readonly neighbours: Int32Array } {
  const n = geometry.locations.table.count;
  const counts = new Int32Array(n + 1);
  for (const code of geometry.matrixPairs) counts[Math.floor(code / n) + 1] = (counts[Math.floor(code / n) + 1] ?? 0) + 1;
  for (let k = 1; k <= n; k += 1) counts[k] = (counts[k] ?? 0) + (counts[k - 1] ?? 0);
  // matrixPairs are ascending, so each location's targets are contiguous.
  const start = new Int32Array(n + 1);
  const out: number[] = [];
  const matrix = problem.matrix;
  for (let from = 0; from < n; from += 1) {
    start[from] = out.length;
    const lo = counts[from] ?? 0;
    const hi = counts[from + 1] ?? 0;
    const keys = new Float64Array(hi - lo);
    for (let k = lo; k < hi; k += 1) {
      const a = (geometry.matrixPairs[k] ?? 0) % n;
      keys[k - lo] = (matrix[from * n + a] ?? 0) * n + a;
    }
    keys.sort();
    const take = Math.min(NEIGHBOURS, keys.length);
    for (let k = 0; k < take; k += 1) {
      const key = keys[k] ?? 0;
      out.push(((key % n) + n) % n);
    }
  }
  start[n] = out.length;
  return { neighbourStart: start, neighbours: Int32Array.from(out) };
}

/** Which unit's price first departs from the engine's, for the self-check's reason. */
function disagreement(structure: Structure, problem: SearchProblem): string {
  const transitions = createTransitions(problem);
  const state = transitions.createState();
  const records = structure.walk.records;
  for (let u = 0; u < structure.units.length; u += 1) {
    const unit = structure.units[u];
    if (unit === undefined) continue;
    const before = state.elapsed;
    const parts = transitions.pricedParts;
    if (!transitions.apply(state, u)) return `unit ${String(u)} is infeasible (${transitions.failure})`;
    const firstStep = unit.steps[0] ?? 0;
    const lastStep = unit.steps.at(-1) ?? 0;
    const engine = ((records[lastStep]?.estimate.endSec ?? 0) - (records[firstStep]?.estimate.startSec ?? 0)) * 1000;
    const mine = state.elapsed - before;
    if (Math.abs(mine - engine) > Math.max(1, transitions.pricedParts - parts)) return `unit ${String(u)} (steps ${String(firstStep)}-${String(lastStep)}): ${String(mine)} ms against ${engine.toFixed(1)} ms`;
  }
  return 'the exit chain';
}

/** Every typed-array buffer of the problem (copies, safe to transfer). */
export function transferList(problem: SearchProblem): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [
    problem.locations.mapId,
    problem.locations.x,
    problem.locations.y,
    problem.locations.pointId,
    problem.tierIndex,
    problem.matrix,
    problem.unknownPairs,
    problem.neighbourStart,
    problem.neighbours,
    problem.units.opStart,
    problem.units.anchor,
    problem.units.obligatory,
    problem.units.questStart,
    problem.units.quests,
    problem.units.firstDestKind,
    problem.units.firstDest,
    problem.units.grantsXp,
    problem.quests.ids,
    problem.quests.obligatory,
    problem.quests.startStatus,
    problem.quests.unitStart,
    problem.quests.units,
    problem.quests.xp,
    problem.edges.predStart,
    problem.edges.pred,
    problem.edges.kind,
    problem.edges.succStart,
    problem.edges.succ,
    problem.groups.chainStart,
    problem.groups.chainLoc,
    problem.groups.chainRadius,
    problem.groups.prefixDone,
    problem.groups.unitStart,
    problem.groups.units,
    problem.spawnTables.data,
    problem.anchorTables.ms,
    problem.anchorTables.exitMs,
    problem.anchorTables.unknown,
    problem.anchorTables.arrival,
    problem.exitOps,
    problem.incumbentWaits,
  ];
  const seen = new Set<ArrayBuffer>();
  const out: ArrayBuffer[] = [];
  for (const view of arrays) {
    const buffer = view.buffer;
    if (!(buffer instanceof ArrayBuffer) || seen.has(buffer) || buffer.byteLength === 0) continue;
    seen.add(buffer);
    out.push(buffer);
  }
  return out;
}
