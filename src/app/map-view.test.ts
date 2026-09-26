import { describe, expect, it, vi } from 'vitest';
import { questId, uiMapId } from '../domain';
import { fixedClock } from './clock';
import {
  closeOpenedQuests,
  DEFAULT_MAP_LAYERS,
  DEFAULT_MAP_UI,
  normaliseQuestIds,
  openQuestsInDetails,
  patchMapUi,
  setMapLayerVisible,
  setMapUi,
  shownOpenedQuests,
  withLayerVisible,
} from './map-view';
import { EMPTY_SELECTION } from './selection';
import { createEditorStore } from './store';
import { sequentialIdSource } from './shell-support';
import { notesProject, sid, T0 } from './test-helpers';

describe('patchMapUi', () => {
  it('keeps the current object when a patch changes nothing', () => {
    expect(patchMapUi(DEFAULT_MAP_UI, {})).toBe(DEFAULT_MAP_UI);
    expect(patchMapUi(DEFAULT_MAP_UI, { surface: null, zone: null, layers: { ...DEFAULT_MAP_LAYERS } })).toBe(DEFAULT_MAP_UI);
    const zoned = patchMapUi(DEFAULT_MAP_UI, { zone: uiMapId(1411) });
    expect(patchMapUi(zoned, { zone: uiMapId(1411) })).toBe(zoned);
  });

  it('holds no hover: what the pointer is over stays with the map controller (PERF-14)', () => {
    expect(Object.keys(DEFAULT_MAP_UI).sort()).toEqual(['layers', 'surface', 'zone', 'zoomBand']);
  });

  it('returns a new object for a change, keeping unchanged nested values', () => {
    const next = patchMapUi(DEFAULT_MAP_UI, { surface: 'world:1', zoomBand: 'zone', zone: uiMapId(1411) });
    expect(next).toEqual({ ...DEFAULT_MAP_UI, surface: 'world:1', zoomBand: 'zone', zone: 1411 });
    expect(next.layers).toBe(DEFAULT_MAP_UI.layers);
  });

  it('shows and hides one layer', () => {
    const hidden = withLayerVisible(DEFAULT_MAP_UI, 'available-quests', false);
    expect(hidden.layers['available-quests']).toBe(false);
    expect(hidden.layers['route-line']).toBe(true);
    expect(withLayerVisible(hidden, 'available-quests', false)).toBe(hidden);
    expect(Object.values(DEFAULT_MAP_LAYERS).every(Boolean)).toBe(true);
  });
});

describe('opened quests', () => {
  it('are shown only while the selection they were opened under lasts', () => {
    const selection = { stepIds: new Set([sid('a')]), anchor: sid('a'), focus: sid('a') };
    const opened = { questIds: [questId(2)], selection };
    expect(shownOpenedQuests(opened, selection)).toEqual([2]);
    expect(shownOpenedQuests(opened, EMPTY_SELECTION)).toBeNull();
    expect(shownOpenedQuests({ questIds: [], selection }, selection)).toBeNull();
    expect(shownOpenedQuests(null, selection)).toBeNull();
    expect(normaliseQuestIds([questId(3), questId(1), questId(3)])).toEqual([1, 3]);
  });
});

describe('store helpers', () => {
  const makeStore = () => createEditorStore({ project: notesProject('ab'), ids: sequentialIdSource(), clock: fixedClock(T0) });

  it('open quests in Details under the current selection, then close them', () => {
    const store = makeStore();
    store.select({ kind: 'single', id: sid('a') });
    openQuestsInDetails(store, [questId(5), questId(4)]);
    const state = store.getState();
    expect(state.view.rightTab).toBe('details');
    expect(shownOpenedQuests(state.view.openedQuests, state.selection)).toEqual([4, 5]);
    store.select({ kind: 'single', id: sid('b') });
    expect(shownOpenedQuests(store.getState().view.openedQuests, store.getState().selection)).toBeNull();
    closeOpenedQuests(store);
    expect(store.getState().view.openedQuests).toBeNull();
    openQuestsInDetails(store, []);
    expect(store.getState().view.openedQuests).toBeNull();
  });

  it('write map state and layer visibility without notifying for no-ops', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    setMapUi(store, { surface: null });
    setMapLayerVisible(store, 'zone-frames', true);
    expect(listener).not.toHaveBeenCalled();
    setMapLayerVisible(store, 'zone-frames', false);
    setMapUi(store, { zoomBand: 'continent' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getState().view.map).toMatchObject({ zoomBand: 'continent', layers: { 'zone-frames': false } });
    expect(store.getState().revision).toBe(0);
  });
});
