import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import { THEME_LABELS, nextThemePreference, type ThemePreference } from '../lib/theme';
import { Button } from '../primitives/Button';
import { Icon, type IconName } from '../primitives/Icon';
import { IconButton } from '../primitives/IconButton';
import { Select, type SelectOption, type SelectOptionGroup } from '../primitives/Select';
import { TextInput } from '../primitives/TextInput';
import { Toolbar, ToolbarSeparator } from '../primitives/Toolbar';
import './TopBar.css';

export const PRODUCT_NAME = 'Forever Route Lab';

const THEME_ICONS: Readonly<Record<ThemePreference, IconName>> = {
  system: 'theme-system',
  light: 'theme-light',
  dark: 'theme-dark',
};

/** The project actions that can be unavailable. */
export type TopBarAction = 'import' | 'export' | 'settings';

/**
 * Why each project action cannot be used now, for example `'Arrives in Milestone 4'`. An action
 * with a reason renders `aria-disabled`: it stays focusable in the toolbar, gives the reason as its
 * description and tooltip, and does not call its handler. No reason (or null): available.
 */
export type TopBarUnavailable = { readonly [A in TopBarAction]?: string | null | undefined };

export interface TopBarZones {
  /** The zone currently shown ('' for none). The select starts from it and resets when it changes. */
  readonly value: string;
  readonly options: readonly (SelectOption | SelectOptionGroup)[];
  /**
   * Jumps to the chosen zone, on Enter in the select or on Go. Browsing the options with the arrow
   * keys only changes the choice, never the map (WCAG 3.2.2).
   */
  readonly onJump?: ((value: string) => void) | undefined;
  /** Why jumping is unavailable (for example `'Arrives with the map in Milestone 3'`); null or omitted: available. */
  readonly unavailableReason?: string | null | undefined;
}

/** The character the route is for, as the character button says it ("Orc Warrior", "Horde"). */
export interface TopBarCharacter {
  readonly name: string;
  /** The faction in words: faction is shown by words only, never by a colour. */
  readonly faction: string;
}

export interface TopBarProps {
  /** The character button's words (D-048 D): it opens Settings. */
  readonly character: TopBarCharacter;
  readonly search: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly onSubmit?: ((value: string) => void) | undefined;
    readonly inputRef?: Ref<HTMLInputElement> | undefined;
    /** The app-level shortcut that focuses the field, in `aria-keyshortcuts` syntax (e.g. `'Control+K'`). */
    readonly keyShortcuts?: string | undefined;
  };
  readonly zones: TopBarZones;
  readonly onImport: () => void;
  readonly onExport: () => void;
  readonly onSettings: () => void;
  readonly onAbout: () => void;
  readonly theme: ThemePreference;
  readonly onThemeChange: (next: ThemePreference) => void;
  /** Actions that cannot be used now, with the reason (not built yet, or import while a proposal is open). */
  readonly unavailable?: TopBarUnavailable | undefined;
}

/** The product mark: an original route line through three waypoints. */
export function BrandMark() {
  return (
    <svg className="frl-brand__mark" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M3.5 15.5C7 15.5 6.5 9.5 10 9.5s3.5-1 5-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="0.1 3.1"
      />
      <circle cx="3.5" cy="15.5" r="2.25" fill="currentColor" />
      <circle className="frl-brand__node" cx="10" cy="9.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 2.75v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 2.75 19 4.5 16 6.25z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

const ACTION_TITLES: Readonly<Record<TopBarAction, string>> = {
  import: 'Import a project or RXP guide',
  export: 'Export the project or an RXP guide',
  settings: 'Settings: character, route profile, assumptions and ruleset',
};

const ACTIONS: readonly TopBarAction[] = ['import', 'export', 'settings'];

/**
 * "Go to zone or view…" (ui-refresh.md §8): a native select (the atlas's views first, then the
 * zones) and a Go button. The choice stays local until it is committed, so arrowing through the
 * closed select (which fires `change` in Chromium on Windows) never jumps the map and never snaps
 * back to the placeholder.
 */
function ZoneJump({ zones }: { readonly zones: TopBarZones }) {
  const reasonId = useId();
  const [draft, setDraft] = useState(zones.value);
  const [shown, setShown] = useState(zones.value);
  if (shown !== zones.value) {
    // The caller now shows another zone (after a jump, or from the map): start from it.
    setShown(zones.value);
    setDraft(zones.value);
  }
  const reason = zones.unavailableReason ?? null;
  const jump = () => {
    const onJump = zones.onJump;
    if (reason !== null || draft === '' || onJump === undefined) return;
    onJump(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLSelectElement)) return;
    event.preventDefault();
    jump();
  };
  return (
    <span className="frl-topbar__zone" onKeyDown={onKeyDown}>
      <Select
        label="Go to zone or view"
        hideLabel
        className="frl-topbar__zone-select"
        placeholder="Go to zone or view…"
        value={draft}
        options={zones.options}
        onChange={setDraft}
      />
      <Button
        className="frl-topbar__zone-go"
        aria-label="Go to the chosen zone or view"
        aria-disabled={reason === null ? undefined : true}
        aria-describedby={reason === null ? undefined : reasonId}
        title={reason === null ? 'Show the chosen zone or view on the map (Enter)' : `Go to zone or view: ${reason}`}
        onClick={jump}
      >
        Go
      </Button>
      {reason !== null && (
        <span id={reasonId} hidden>
          {reason}
        </span>
      )}
    </span>
  );
}

/**
 * The top bar (ui-refresh.md §8): the product (the page's h1), quest search, "Go to zone or view…",
 * the character button that opens Settings (D-048 D), and Import, Export, Theme and About (ARCHITECTURE
 * §12.4). The route's name and the Projects menu live in the route panel's header (§4.1).
 */
export function TopBar({
  character,
  search,
  zones,
  onImport,
  onExport,
  onSettings,
  onAbout,
  theme,
  onThemeChange,
  unavailable = {},
}: TopBarProps) {
  const baseId = useId();
  const next = nextThemePreference(theme);
  const handlers: Readonly<Record<TopBarAction, () => void>> = { import: onImport, export: onExport, settings: onSettings };
  const reasonOf = (action: TopBarAction): string | null => unavailable[action] ?? null;
  const reasonId = (action: TopBarAction) => `${baseId}-${action}-reason`;
  /** One project action's props: its handler when available, else aria-disabled with the reason. */
  const actionProps = (action: TopBarAction) => {
    const reason = reasonOf(action);
    return reason === null
      ? { title: ACTION_TITLES[action], onClick: handlers[action] }
      : { title: `${ACTION_TITLES[action]}: ${reason}`, 'aria-disabled': true, 'aria-describedby': reasonId(action) };
  };
  return (
    <header className="frl-topbar">
      <div className="frl-brand">
        <BrandMark />
        <h1 className="frl-brand__name">{PRODUCT_NAME}</h1>
      </div>
      <span className="frl-topbar__spacer" />
      <div role="search" className="frl-topbar__search">
        <TextInput
          label="Search quests"
          hideLabel
          type="search"
          icon="search"
          placeholder="Search quests"
          keyShortcuts={search.keyShortcuts}
          value={search.value}
          onChange={search.onChange}
          onSubmit={search.onSubmit}
          inputRef={search.inputRef}
        />
      </div>
      <ZoneJump zones={zones} />
      <Toolbar label="Project actions" className="frl-topbar__actions">
        <Button
          className="frl-topbar__character"
          aria-label={`${character.name} · ${character.faction}, settings`}
          {...actionProps('settings')}
        >
          <Icon name="settings" size={16} />
          <span className="frl-topbar__character-words" aria-hidden="true">
            <b className="frl-topbar__character-name">{character.name}</b>
            <span className="frl-topbar__character-faction"> · {character.faction}</span>
          </span>
        </Button>
        <Button icon="import" {...actionProps('import')}>
          <span className="frl-topbar__button-label">Import</span>
        </Button>
        <Button icon="export" {...actionProps('export')}>
          <span className="frl-topbar__button-label">Export</span>
        </Button>
        <ToolbarSeparator />
        <IconButton
          icon={THEME_ICONS[theme]}
          label={`${THEME_LABELS[theme]}. Switch to ${THEME_LABELS[next].toLowerCase()}`}
          onClick={() => {
            onThemeChange(next);
          }}
        />
        <IconButton icon="about" label={`About ${PRODUCT_NAME}`} onClick={onAbout} />
      </Toolbar>
      {ACTIONS.map((action) => {
        const reason = reasonOf(action);
        return reason === null ? null : (
          <span key={action} id={reasonId(action)} hidden>
            {reason}
          </span>
        );
      })}
    </header>
  );
}
