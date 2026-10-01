import { describe, expect, it } from 'vitest';
import type { SpawnPoint } from '../domain/dataset';
import { npcId, questId, uiMapId, worldMapId } from '../domain/ids';
import { fixtureGeometry } from '../geo/test-fixtures';
import type { MarkerDescriptor, MarkerMark, PointGroupInput, SpawnLayerInput } from '../map/adapter';
import { buildSpawnLayer, categoryOfMarkState, CLUSTER_LEVELS, clusterLevelAt, createLod, createMapLayers, layerContextOf } from '../map/layers';
import { clusterLabel, createClusterIndex, createMapClusterer } from './map-clusters';

/*
 * The quest givers' and turn-ins' clusters (map-presentation.md §25.2.5; step MP.4a), built outside
 * the entry chunk since D-050 item 6 (app/map-clusters.ts, handed to the layer builder by the derived
 * pipeline's places model). Moved from map/layers.test.ts with the code.
 */

describe('clusters below the zone band (map-presentation.md §25.2.5)', () => {
  /*
   * Clusters below the zone band (docs/research/map-presentation.md §25.2.5; D-047; step MP.4a): quest
   * givers and turn-ins fold into the cells of a nested yard grid (512, 1,024, 2,048, 4,096 yd), each
   * cluster anchored at a member, counting quests, places and points, coloured by the group rule; the
   * cap applies to clusters and never trims one.
   */

  const geometry = fixtureGeometry();
  const ctx = layerContextOf(geometry);
  const KALIMDOR = worldMapId(1);
  const DUROTAR = uiMapId(1411);

  const spawnAt = (x: number, y: number): SpawnPoint => ({
    source: { space: 'world', mapId: KALIMDOR, x, y, uiMapId: DUROTAR, lexemes: null },
    world: { mapId: KALIMDOR, x, y },
    uiMapId: DUROTAR,
  });

  const mark = (state: MarkerMark['state'], difficulty: MarkerMark['difficulty'] = 'standard'): MarkerMark => ({ state, difficulty, dungeonQuest: false, progress: null });

  /** A giver at (x, y) with its quests and their states. */
  function giver(id: number, x: number, y: number, quests: readonly (readonly [number, MarkerMark | null])[]): PointGroupInput {
    const best = quests[0]?.[1] ?? null;
    return {
      subject: { kind: 'npc', id: npcId(id) },
      label: `Giver ${String(id)}`,
      questIds: quests.map(([q]) => questId(q)),
      spawns: [spawnAt(x, y)],
      quests: quests.map(([q, m]) => ({ questId: questId(q), mark: m })),
      ...(best === null ? {} : { mark: best }),
    };
  }

  /** A continent-band view at the zoom where a level is used, centred on the points. */
  const at = (zoom: number) => ({ mapId: KALIMDOR, zoom, center: { x: 1000, y: -4000 }, band: 'continent' as const });

  /** The pipeline's clusterer, as the places model hands it to the layer builder. */
  const of = createMapClusterer().of;

  const clusters = (items: readonly unknown[]): MarkerDescriptor[] => items.filter((item): item is MarkerDescriptor => (item as MarkerDescriptor).cluster !== undefined);

  describe('cluster levels (§25.2.5)', () => {
    it('uses the power of two at or above 1.25 D in yards: 1,024 over most of the continent band, 512 at its top, 2,048 or more in the world band', () => {
      expect(CLUSTER_LEVELS).toEqual([512, 1024, 2048, 4096]);
      expect(clusterLevelAt(Math.log2(0.022))).toBe(1024);
      expect(clusterLevelAt(Math.log2(0.0325))).toBe(1024);
      expect(clusterLevelAt(Math.log2(0.06))).toBe(512);
      expect(clusterLevelAt(Math.log2(0.087))).toBe(512);
      expect(clusterLevelAt(Math.log2(0.01))).toBe(2048);
      expect(clusterLevelAt(Math.log2(0.004))).toBe(4096);
      expect(clusterLevelAt(-12)).toBe(4096);
    });
  });

  describe('clusters of quest givers and turn-ins (§25.2.5)', () => {
    // Three givers within one 1,024 yd cell (x 0 to 1,024, y −4,096 to −3,072), one far away.
    const input: SpawnLayerInput = {
      groups: [
        giver(1, 100, -3500, [
          [11, mark('available', 'standard')],
          [12, mark('uncertain', 'standard')],
        ]),
        giver(2, 200, -3600, [[21, mark('available', 'standard')]]),
        giver(3, 320, -3400, [[11, mark('available', 'standard')]]),
        giver(4, 9000, -3500, [[41, mark('available', 'difficult')]]),
      ],
    };
    const zoom = Math.log2(0.03);

    it('folds a cell’s points into one cluster anchored at the member nearest their centroid, counting quests, places and points', () => {
      const content = buildSpawnLayer(ctx, 'available-quests', input, at(zoom), [], null, of);
      const [cluster] = clusters(content.items);
      if (cluster?.cluster === undefined) throw new Error('no cluster');
      // Quests 11, 12 and 21: quest 11 has two givers here, and counts once.
      expect(cluster.cluster.members.map((member) => member.questId)).toEqual([11, 21, 12]);
      expect(cluster.cluster).toMatchObject({ places: 3, points: 3, cellYards: 1024 });
      expect(cluster.cluster.members[0]?.subjects).toEqual(['npc:1', 'npc:3']);
      // The anchor is a real giver's point: the one nearest the centroid (206.7, −3,500).
      expect(cluster.point).toMatchObject({ x: 200, y: -3600 });
      expect(cluster.ref).toMatchObject({ kind: 'cluster', layer: 'available-quests', quests: 3, places: 3, bounds: { xMin: 100, xMax: 320, yMin: -3600, yMax: -3400 } });
      expect(cluster.refs).toEqual([cluster.ref]);
      // Best state first: the pin's glyph and badge are the first member's, its category too.
      expect(cluster.mark?.state).toBe('available');
      expect(cluster.category).toBe('available');
      // The lone far giver is its own pin, not a cluster of one.
      expect(content.items.find((item) => item.id === 'spawn:npc:4:0')).toMatchObject({ type: 'marker', mark: { state: 'available' } });
      expect(content.stats).toMatchObject({ clustered: 3, aggregated: 0, drawn: 2 });
    });

    it('words its hover with its quests’ states and difficulties, and its turn-ins as places', () => {
      const content = buildSpawnLayer(ctx, 'available-quests', input, at(zoom), [], null, of);
      expect(clusters(content.items)[0]?.label).toBe('3 quests at 3 givers near here: 2 available, 1 may be available; 3 standard. Zoom in to separate them.');
      const members = [
        { questId: questId(1), mark: mark('ready', 'standard'), category: 'turn-ins' as const, subjects: ['npc:1'] },
        { questId: questId(2), mark: mark('in-progress', null), category: 'turn-ins' as const, subjects: ['npc:2'] },
      ];
      expect(clusterLabel('turn-ins', members, 2)).toBe('2 quests to turn in at 2 places near here: 1 ready, 1 in progress; 1 standard, 1 of unknown difficulty. Zoom in to separate them.');
      // Without route state: no state words.
      expect(clusterLabel('available-quests', [{ questId: questId(1), mark: null, category: 'available', subjects: ['npc:1'] }], 2)).toBe('1 quest at 2 givers near here. Zoom in to separate them.');
    });

    it('nests: every level’s clusters split only where a cell halves, never on a pan', () => {
      const many: SpawnLayerInput = {
        groups: Array.from({ length: 40 }, (_, i) => giver(100 + i, 900 + (i % 8) * 190, -4500 + Math.floor(i / 8) * 210, [[1000 + i, mark('available', 'standard')]])),
      };
      const memberSets = (level: number): Set<string>[] => {
        const zoomFor = { 512: Math.log2(0.07), 1024: Math.log2(0.03), 2048: Math.log2(0.01), 4096: Math.log2(0.004) }[level] ?? 0;
        expect(clusterLevelAt(zoomFor)).toBe(level);
        const content = buildSpawnLayer(ctx, 'available-quests', many, { ...at(zoomFor), band: zoomFor < Math.log2(0.022) ? 'world' : 'continent' }, [], null, of);
        return content.items.map((item) => new Set((item as MarkerDescriptor).cluster?.members.map((member) => String(member.questId)) ?? (item as MarkerDescriptor).refs.flatMap((ref) => (ref.kind === 'spawn' ? ref.questIds.map(String) : []))));
      };
      for (const [fine, coarse] of [
        [512, 1024],
        [1024, 2048],
        [2048, 4096],
      ] as const) {
        const coarser = memberSets(coarse);
        for (const set of memberSets(fine)) expect(coarser.some((big) => [...set].every((id) => big.has(id))), `${String(fine)} in ${String(coarse)}`).toBe(true);
      }
      // A pan changes no cluster: the grid is fixed in yards.
      const a = buildSpawnLayer(ctx, 'available-quests', many, at(Math.log2(0.03)), [], null, of);
      const b = buildSpawnLayer(ctx, 'available-quests', many, { ...at(Math.log2(0.03)), center: { x: 5000, y: 3000 } }, [], null, of);
      expect([...a.items].map((item) => item.id).sort()).toEqual([...b.items].map((item) => item.id).sort());
    });

    it('applies the cap to clusters, never trimming one: every drawn cluster’s count is whole, and the note counts the rest', () => {
      const spread: SpawnLayerInput = {
        groups: Array.from({ length: 12 }, (_, i) => [giver(200 + 2 * i, i * 3000, -4000, [[2000 + 2 * i, mark('available')]]), giver(201 + 2 * i, i * 3000 + 50, -4000, [[2001 + 2 * i, mark('available')]])]).flat(),
      };
      const small = layerContextOf(geometry, createLod({ budgets: { 'available-quests': 5 } }));
      const content = buildSpawnLayer(small, 'available-quests', spread, at(Math.log2(0.03)), [], null, of);
      expect(content.items).toHaveLength(5);
      expect(content.stats.notDrawn).toBe(7);
      for (const item of clusters(content.items)) expect(item.cluster?.members).toHaveLength(2);
    });

    it('makes every level once per input, so a zoom across levels is a lookup (review UR-06)', () => {
      let reads = 0;
      const groups = input.groups;
      const counted: SpawnLayerInput = {
        get groups() {
          reads += 1;
          return groups;
        },
      };
      const layers = createMapLayers({ geometry });
      const call = { layer: 'available-quests' as const, input: counted, focusQuests: [], rawZone: null, clusters: createMapClusterer().of };
      layers.part(call, at(Math.log2(0.03))).finish();
      const after = reads;
      for (const z of [Math.log2(0.07), Math.log2(0.01), Math.log2(0.004), Math.log2(0.03)]) layers.part(call, { ...at(z), band: z < Math.log2(0.022) ? 'world' : 'continent' }).finish();
      expect(reads).toBe(after);
      // Each level's content is its own: at 512 yd the three givers fall into two cells.
      expect(clusters(layers.part(call, at(Math.log2(0.07))).finish().items).map((item) => item.cluster?.cellYards)).toEqual([512]);
      expect(clusters(layers.part(call, at(Math.log2(0.03))).finish().items).map((item) => item.cluster?.cellYards)).toEqual([1024]);
    });

    it('keeps the focused quests’ points raw and strong, outside the clusters', () => {
      const content = buildSpawnLayer(ctx, 'available-quests', input, at(zoom), [questId(21)], null, of);
      expect(content.items.find((item) => item.id === 'spawn:npc:2:0')).toMatchObject({ emphasis: 'strong' });
      expect(clusters(content.items)[0]?.cluster?.members.map((member) => member.questId)).toEqual([11, 12]);
    });

    it('files each item under its drawer row (§25.3.2): quest givers by their state', () => {
      // The builder's table matches the adapter's (map-categories.test.ts compares them, as map/layers may not import map/adapter).
      expect(categoryOfMarkState('locked')).toBe('needs-prerequisite');
      expect(categoryOfMarkState(null)).toBe('available');
      const content = buildSpawnLayer(ctx, 'available-quests', { groups: [giver(9, 0, 0, [[9, mark('locked')]])] }, { mapId: KALIMDOR, zoom: -2, center: null });
      expect(content.items[0]).toMatchObject({ category: 'needs-prerequisite' });
      expect(buildSpawnLayer(ctx, 'turn-ins', { groups: [giver(9, 0, 0, [[9, mark('ready')]])] }, { mapId: KALIMDOR, zoom: -2, center: null }).items[0]).toMatchObject({ category: 'turn-ins' });
      expect(buildSpawnLayer(ctx, 'flight-masters', { groups: [giver(9, 0, 0, [])] }, { mapId: KALIMDOR, zoom: -2, center: null }).items[0]).toMatchObject({ category: 'flight-points' });
    });
    it('counts the points per zone instead while the pipeline has handed no clusters (its chunk still loading)', () => {
      const content = buildSpawnLayer(ctx, 'available-quests', input, at(zoom));
      expect(clusters(content.items)).toEqual([]);
      expect(content.items.map((item) => item.type)).toEqual(['aggregate']);
      expect(content.stats).toMatchObject({ aggregated: 4, drawn: 1 });
    });

    it('remakes only the cells a focus touches: every other cell keeps its pin object (D-050 item 5)', () => {
      const spread: SpawnLayerInput = {
        groups: [giver(1, 100, -3500, [[11, mark('available')]]), giver(2, 200, -3600, [[21, mark('available')]]), giver(3, 320, -3400, [[31, mark('available')]]), giver(4, 5000, -3500, [[41, mark('available')]]), giver(5, 5100, -3600, [[51, mark('available')]])],
      };
      const clusterer = createMapClusterer();
      const pinsOf = (focus: readonly number[]) => clusters(buildSpawnLayer(ctx, 'available-quests', spread, at(zoom), focus.map((id) => questId(id)), null, clusterer.of).items);
      const [nearBefore, farBefore] = pinsOf([]);
      const [nearAfter, farAfter] = pinsOf([21]);
      // The far cell's pin is the same object; the near cell's is remade without giver 2.
      expect(farAfter).toBe(farBefore);
      expect(nearAfter).not.toBe(nearBefore);
      expect(nearAfter?.cluster?.members.map((member) => member.questId)).toEqual([11, 31]);
      // Back to no focus: the whole cell's pin again, made once.
      expect(pinsOf([])[0]).toBe(nearBefore);
    });

    it('makes every level of every map when warmed (the derived publish), so the map only looks them up', () => {
      let reads = 0;
      const groups = input.groups;
      const counted: SpawnLayerInput = {
        get groups() {
          reads += 1;
          return groups;
        },
      };
      const index = createClusterIndex('available-quests', counted);
      index.warm();
      const warmed = reads;
      for (const level of CLUSTER_LEVELS) expect(index.cells(KALIMDOR, level).length).toBeGreaterThan(0);
      const [cell] = index.cells(KALIMDOR, 1024);
      if (cell === undefined) throw new Error('no cell');
      expect(index.cluster(cell, 1024, KALIMDOR, null)).toBe(index.cluster(cell, 1024, KALIMDOR, null));
      expect(reads).toBe(warmed);
      expect(() => createClusterIndex('objectives', input)).toThrow(/not clustered/);
    });
  });
});
