import { memo, useMemo, type RefObject } from 'react';
import type { EditorStore } from '../../app';
import { useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import { TopBar, type TopBarUnavailable } from '../shell/TopBar';
import { selectEditingLocked, selectRouteName, selectTheme } from './selectors';

/**
 * Why the unfinished top-bar actions cannot be used yet. They render aria-disabled with this text
 * as their description and tooltip (docs/UI.md §9 rule 6), instead of opening a notice.
 */
export const NOT_YET = {
  import: 'Arrives in Milestone 4 (project files) and Milestone 5 (RXP guides)',
  export: 'Arrives in Milestone 4 (project files) and Milestone 5 (RXP guides)',
  settings: 'Arrives with rules and simulation in Milestone 6',
  zone: 'Arrives with the map in Milestone 3',
} as const;

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
}

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
}: AppTopBarProps) {
  const routeName = useEditor(store, selectRouteName);
  const theme = useEditor(store, selectTheme);
  const editingLocked = useEditor(store, selectEditingLocked);
  const zoneOptions = useMemo(
    () => dataset.zones().map((z) => ({ value: String(z.uiMapId), label: z.name ?? `UiMap ${String(z.uiMapId)}` })),
    [dataset],
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
      zones={{ value: '', options: zoneOptions, onJump: noop, unavailableReason: NOT_YET.zone }}
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
