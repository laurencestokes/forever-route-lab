import { memo, useCallback, useMemo, type RefObject } from 'react';
import type { EditorState, EditorStore } from '../../app';
import type { MapController } from '../../app/map-exports';
import { useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { UiMapId } from '../../domain/ids';
import { TopBar, type TopBarUnavailable } from '../shell/TopBar';
import type { Announce } from './LiveAnnouncer';
import { selectEditingLocked, selectRouteName, selectTheme } from './selectors';

/**
 * Why the unfinished top-bar actions cannot be used yet. They render aria-disabled with this text
 * as their description and tooltip (docs/UI.md §9 rule 6), instead of opening a notice.
 */
export const NOT_YET = {
  import: 'Arrives in Milestone 4 (project files) and Milestone 5 (RXP guides)',
  export: 'Arrives in Milestone 4 (project files) and Milestone 5 (RXP guides)',
  settings: 'Arrives with rules and simulation in Milestone 6',
} as const;

/** Why jump-to-zone is unavailable when the shell has no map (tests without geometry). */
export const NO_MAP_FOR_ZONES = 'No map is loaded';

export const LOCKED_REASON = 'Unavailable while the optimiser runs or a proposal is open';

export interface AppTopBarProps {
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  readonly projectName: string;
  readonly placeholder: boolean;
  /** The word of the project's placeholder label ("Sample" for the generated sample route). */
  readonly placeholderLabel?: string | undefined;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly onSearchSubmit: () => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly onAbout: () => void;
  /** Jump-to-zone fits the zone's frame on the map; null: there is no map, so it is unavailable. */
  readonly mapController?: MapController | null | undefined;
  readonly announce?: Announce | undefined;
}

const selectZone = (s: EditorState) => s.view.map.zone;

const noop = () => undefined;

export const AppTopBar = memo(function AppTopBar({
  store,
  dataset,
  projectName,
  placeholder,
  placeholderLabel,
  search,
  onSearchChange,
  onSearchSubmit,
  searchRef,
  onAbout,
  mapController = null,
  announce,
}: AppTopBarProps) {
  const routeName = useEditor(store, selectRouteName);
  const theme = useEditor(store, selectTheme);
  const editingLocked = useEditor(store, selectEditingLocked);
  const zone = useEditor(store, selectZone);
  // With a map: the zones it can fit, grouped by world map. Without one, the dataset's zones
  // (the chooser is unavailable then, and says why).
  const zoneOptions = useMemo(
    () =>
      mapController === null
        ? dataset.zones().map((z) => ({ value: String(z.uiMapId), label: z.name ?? `UiMap ${String(z.uiMapId)}` }))
        : mapController.zoneGroups.map((group) => ({
            group: group.label,
            options: group.zones.map((option) => ({ value: String(option.uiMapId), label: option.label })),
          })),
    [dataset, mapController],
  );
  const zoneLabel = useMemo(
    () => new Map((mapController?.zoneGroups ?? []).flatMap((group) => group.zones.map((option) => [String(option.uiMapId), option.label] as const))),
    [mapController],
  );
  const onJump = useCallback(
    (value: string) => {
      if (mapController === null || !/^[1-9]\d*$/.test(value)) return;
      // The option values are the controller's own UiMap ids, written as decimal integers.
      const shown = mapController.jumpToZone(Number(value) as UiMapId);
      if (shown) announce?.(`Map shows ${zoneLabel.get(value) ?? 'the zone'}.`);
    },
    [mapController, announce, zoneLabel],
  );
  const unavailable: TopBarUnavailable = {
    // Import replaces the project, which the store refuses while a lock is held.
    import: editingLocked ? `${LOCKED_REASON}. ${NOT_YET.import}` : NOT_YET.import,
    export: NOT_YET.export,
    settings: NOT_YET.settings,
  };
  return (
    <TopBar
      projectName={projectName}
      routeName={routeName}
      placeholder={placeholder}
      placeholderLabel={placeholderLabel}
      search={{
        value: search,
        onChange: onSearchChange,
        onSubmit: onSearchSubmit,
        inputRef: searchRef,
        keyShortcuts: 'Control+K',
      }}
      zones={{
        value: zone === null ? '' : String(zone),
        options: zoneOptions,
        onJump,
        unavailableReason: mapController === null ? NO_MAP_FOR_ZONES : null,
      }}
      onImport={noop}
      onExport={noop}
      onSettings={noop}
      onAbout={onAbout}
      theme={theme}
      onThemeChange={(next) => {
        store.setView({ theme: next });
      }}
      unavailable={unavailable}
    />
  );
});
