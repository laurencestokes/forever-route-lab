import { memo, useCallback, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import type { EditorState, EditorStore } from '../../app';
import type { DatasetSource } from '../../app/dataset-source';
import { selectZoneSpans } from '../../app/derived';
import type { MapController } from '../../app/map-exports';
import type { DownloadFile } from '../../app/persistence';
import { useDerivedSelector, useEditor } from '../../app/react';
import type { ZoneSpans } from '../../app/zone-levels';
import { RXP_EXPORT_LABEL, RXP_IMPORT_LABEL } from '../../app/rxp-options';
import type { DatasetView } from '../../domain/dataset';
import type { QuestId, UiMapId } from '../../domain/ids';
import type { MapGeometry } from '../../geo/types';
import { characterName } from '../app-model';
import type { SelectOption, SelectOptionGroup } from '../primitives/Select';
import { TopBar, type TopBarUnavailable } from '../shell/TopBar';
import { LazyDialogFallback, loadImportExport, loadRxpExportDialog, loadRxpImportDialog, useLazy, useLazyKept } from './lazy';
import type { Announce } from './LiveAnnouncer';
import { ProjectBar, type ProjectsDialogMode } from './ProjectMenu';
import { useProjectSession } from './ProjectMenuContext';
import { RxpExportEntry, RxpImportEntry } from './RxpEntries';
import { selectCharacter, selectEditingLocked, selectTheme } from './selectors';

/**
 * Why top-bar actions cannot be used. They render aria-disabled with this text as their
 * description and tooltip (docs/UI.md §9 rule 6), instead of opening a notice. Import and export
 * need the project session (src/main.tsx provides it; a shell without one, as in component tests,
 * has no project storage).
 */
export const NOT_YET = {
  import: 'No project storage is connected here, so nothing can be imported',
  export: 'No project storage is connected here, so nothing can be exported',
  settings: 'Arrives with rules and simulation in Milestone 6',
} as const;

/** Why jump-to-zone is unavailable when the shell has no map (tests without geometry). */
export const NO_MAP_FOR_ZONES = 'No map is loaded';

export const LOCKED_REASON = 'Unavailable while the optimiser runs or a proposal is open';

export interface AppTopBarProps {
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  /** The open project's name, for the RXP export's file name. */
  readonly projectName: string;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly onSearchSubmit: () => void;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly onAbout: () => void;
  /** Jump-to-zone fits the zone's frame on the map; null: there is no map, so it is unavailable. */
  readonly mapController?: MapController | null | undefined;
  readonly announce?: Announce | undefined;
  /** Replaces the browser download of exported files (tests). */
  readonly download?: ((file: DownloadFile) => void) | undefined;
  /** Opens the Settings dialog (the editor's, src/ui/app/SettingsDialog.tsx); omitted: Settings stays unavailable. */
  readonly onOpenSettings?: (() => void) | undefined;
  /** Opens the Projects dialog (the project bar's notices); omitted: the notices say nothing. */
  readonly onOpenProjects?: ((mode: ProjectsDialogMode) => void) | undefined;
  /**
   * The map geometry, for the RXP custom-guide import (`RXP035`) and export (points made in the
   * app); null or omitted: without it (docs/UI.md §15).
   */
  readonly geometry?: MapGeometry | null | undefined;
  /**
   * The loaded dataset, so an RXP guide imported as a new project is checked against the data
   * alone (without the open project's custom quests); null or omitted: the open project's view.
   */
  readonly data?: DatasetSource | null | undefined;
}

type FileDialog = 'import' | 'export' | 'rxp-import' | 'rxp-export';

const selectZone = (s: EditorState) => s.view.map.zone;

/**
 * A zone's option text with its level span for the character (map-presentation.md §14.4; step
 * MP.3): "The Barrens · quests 13–25 (93), Era data"; the name alone while the spans are not built.
 * The span's basis is in the words, as a select's option cannot carry the boxed E.
 */
export function zoneOptionLabel(label: string, uiMapId: number, spans: ZoneSpans | null, minimap = false): string {
  const span = spans?.get(uiMapId as UiMapId);
  if (span === undefined) return label;
  // In the minimap style an underground city says so (D-049 O19; review PR-17).
  const name = minimap && span.undergroundName !== null ? span.undergroundName : label;
  return `${name} · ${span.text}${span.low === null ? '' : ', Era data'}`;
}

const noop = () => undefined;
const noSubscribe = () => noop;

/** The views' values in "Go to zone or view…": a surface (`view:<id>`) or an atlas preset (its own `preset:` id). */
const VIEW_PREFIX = 'view:';
const PRESET_PREFIX = 'preset:';

/**
 * "Go to zone or view…" (ui-refresh.md §8): the atlas's views first ("Both continents" and its
 * presets, which the map's surface select offered), then the zones grouped by world map, each with
 * its level span.
 */
export function goToOptions(controller: MapController, spans: ZoneSpans | null, minimap = false): readonly (SelectOption | SelectOptionGroup)[] {
  const atlas = controller.surfaces.find((surface) => surface.kind === 'atlas');
  const views: SelectOption[] = [
    ...(atlas === undefined ? [] : [{ value: `${VIEW_PREFIX}${atlas.id}`, label: 'Both continents' }]),
    ...controller.presets.map((preset) => ({ value: preset.id, label: preset.name })),
  ];
  const zones = controller.zoneGroups.map((group) => ({
    group: group.label,
    options: group.zones.map((option) => ({ value: String(option.uiMapId), label: zoneOptionLabel(option.label, option.uiMapId, spans, minimap) })),
  }));
  return views.length === 0 ? zones : [{ group: 'Views', options: views }, ...zones];
}

export const AppTopBar = memo(function AppTopBar({
  store,
  dataset,
  projectName,
  search,
  onSearchChange,
  onSearchSubmit,
  searchRef,
  onAbout,
  mapController = null,
  announce,
  download,
  onOpenSettings,
  onOpenProjects,
  geometry = null,
  data = null,
}: AppTopBarProps) {
  const session = useProjectSession();
  const [fileDialog, setFileDialog] = useState<FileDialog | null>(null);
  // The RXP dialogs load on first use (lazy.tsx, CR-19).
  // So do Import and Export (lazy parts: ui-refresh.md §10.3, the entry's stop line).
  const files = useLazyKept(loadImportExport, fileDialog === 'import' || fileDialog === 'export');
  const rxpImport = useLazy(loadRxpImportDialog, fileDialog === 'rxp-import');
  const rxpExport = useLazy(loadRxpExportDialog, fileDialog === 'rxp-export');
  const character = useEditor(store, selectCharacter);
  const theme = useEditor(store, selectTheme);
  const editingLocked = useEditor(store, selectEditingLocked);
  const zone = useEditor(store, selectZone);
  const spans = useDerivedSelector(selectZoneSpans);
  // The style shown, for the underground cities' names (a string snapshot: a re-render only when it changes).
  const minimap = useSyncExternalStore(mapController?.subscribe ?? noSubscribe, () => mapController?.getStatus().style.shown === 'minimap', () => false);
  // With a map: the zones it can fit, grouped by world map. Without one, the dataset's zones
  // (the chooser is unavailable then, and says why).
  const zoneOptions = useMemo(
    () =>
      mapController === null
        ? dataset.zones().map((z) => ({ value: String(z.uiMapId), label: z.name ?? `UiMap ${String(z.uiMapId)}` }))
        : goToOptions(mapController, spans, minimap),
    [dataset, mapController, spans, minimap],
  );
  const zoneLabel = useMemo(
    () =>
      new Map([
        ...(mapController?.zoneGroups ?? []).flatMap((group) => group.zones.map((option) => [String(option.uiMapId), option.label] as const)),
        ...(mapController?.presets ?? []).map((preset) => [preset.id, preset.name] as const),
        ...(mapController?.surfaces ?? []).map((surface) => [`${VIEW_PREFIX}${surface.id}`, surface.kind === 'atlas' ? 'both continents' : surface.name] as const),
      ]),
    [mapController],
  );
  const onJump = useCallback(
    (value: string) => {
      if (mapController === null) return;
      let shown = false;
      if (value.startsWith(PRESET_PREFIX)) shown = mapController.showPreset(value);
      else if (value.startsWith(VIEW_PREFIX)) {
        const surface = mapController.surfaces.find((info) => `${VIEW_PREFIX}${info.id}` === value);
        shown = surface !== undefined && mapController.showSurface(surface.id);
      } else if (/^[1-9]\d*$/.test(value)) {
        // The zone values are the controller's own UiMap ids, written as decimal integers.
        shown = mapController.jumpToZone(Number(value) as UiMapId);
      }
      if (shown) announce?.(`Map shows ${zoneLabel.get(value) ?? 'the zone'}.`);
    },
    [mapController, announce, zoneLabel],
  );
  const questName = useCallback((id: QuestId) => dataset.quest(id)?.name ?? null, [dataset]);
  const openImport = useCallback(() => {
    setFileDialog('import');
  }, []);
  const openExport = useCallback(() => {
    setFileDialog('export');
  }, []);
  const closeFileDialog = useCallback(() => {
    setFileDialog(null);
  }, []);
  // The RXP dialogs replace the Import or Export dialog they are opened from.
  const openRxpImport = useCallback(() => {
    setFileDialog('rxp-import');
  }, []);
  const openRxpExport = useCallback(() => {
    setFileDialog('rxp-export');
  }, []);
  const unavailable: TopBarUnavailable = {
    // Import replaces the project, which the store refuses while a lock is held.
    import: session === null ? (editingLocked ? `${LOCKED_REASON}. ${NOT_YET.import}` : NOT_YET.import) : editingLocked ? LOCKED_REASON : null,
    export: session === null ? NOT_YET.export : null,
    settings: onOpenSettings === undefined ? NOT_YET.settings : null,
  };
  const bar = (
    <TopBar
      character={{ name: characterName(character), faction: character.faction }}
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
      onImport={session === null ? noop : openImport}
      onExport={session === null ? noop : openExport}
      onSettings={onOpenSettings ?? noop}
      onAbout={onAbout}
      theme={theme}
      onThemeChange={(next) => {
        store.setView({ theme: next });
      }}
      unavailable={unavailable}
    />
  );
  if (session === null) return bar;
  return (
    <div className="frl-apptop">
      {bar}
      <ProjectBar session={session} announce={announce} questName={questName} onOpenProjects={onOpenProjects} />
      {files.kind === 'ready' ? (
        <>
          <files.value.ImportDialog
            open={fileDialog === 'import'}
            onClose={closeFileDialog}
            session={session}
            announce={announce}
            unavailableReason={editingLocked ? LOCKED_REASON : null}
            rxp={<RxpImportEntry onOpen={openRxpImport} unavailableReason={editingLocked ? LOCKED_REASON : null} />}
          />
          <files.value.ExportDialog
            open={fileDialog === 'export'}
            onClose={closeFileDialog}
            session={session}
            announce={announce}
            download={download}
            rxp={<RxpExportEntry onOpen={openRxpExport} />}
          />
        </>
      ) : (
        (fileDialog === 'import' || fileDialog === 'export') && <LazyDialogFallback title={fileDialog === 'export' ? 'Export' : 'Import'} state={files} onClose={closeFileDialog} />
      )}
      {rxpImport.kind === 'ready' ? (
        <rxpImport.value.RxpImportDialog
          open={fileDialog === 'rxp-import'}
          onClose={closeFileDialog}
          store={store}
          session={session}
          dataset={dataset}
          data={data}
          geometry={geometry}
          announce={announce}
          unavailableReason={editingLocked ? LOCKED_REASON : null}
        />
      ) : (
        <LazyDialogFallback title={RXP_IMPORT_LABEL} state={rxpImport} onClose={closeFileDialog} />
      )}
      {rxpExport.kind === 'ready' ? (
        <rxpExport.value.RxpExportDialog
          open={fileDialog === 'rxp-export'}
          onClose={closeFileDialog}
          store={store}
          dataset={dataset}
          geometry={geometry}
          projectName={projectName}
          announce={announce}
          download={download}
        />
      ) : (
        <LazyDialogFallback title={RXP_EXPORT_LABEL} state={rxpExport} onClose={closeFileDialog} />
      )}
    </div>
  );
});
