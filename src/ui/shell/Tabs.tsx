import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Tabs.css';

export interface TabDefinition<Id extends string> {
  readonly id: Id;
  readonly label: string;
  /** Visual extra after the label (a count). Hidden from assistive technology; see `badgeLabel`. */
  readonly badge?: ReactNode;
  /**
   * The badge in words; the tab's accessible name becomes `'Validation, 2 errors, 1 warning'` and
   * `'Quest log, 4 quests after step 12'`, starting with the visible label (WCAG 2.5.3).
   */
  readonly badgeLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
}

export interface TabsProps<Id extends string> {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly TabDefinition<Id>[];
  readonly selectedId: Id;
  readonly onSelect: (id: Id) => void;
  /** Content of the selected tab's panel. Only the selected panel is mounted. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * The next enabled tab for a key, wrapping at the ends (WAI-ARIA tabs pattern), or null when the
 * key is not a tab-navigation key or no tab is enabled.
 */
export function nextEnabledTab(key: string, current: number, enabled: readonly boolean[]): number | null {
  const n = enabled.length;
  if (n === 0 || !enabled.some(Boolean)) return null;
  const scan = (from: number, step: 1 | -1): number => {
    let i = from;
    for (let tries = 0; tries < n; tries += 1) {
      i = (i + step + n) % n;
      if (enabled[i] === true) return i;
    }
    return current;
  };
  switch (key) {
    case 'ArrowRight':
      return scan(current, 1);
    case 'ArrowLeft':
      return scan(current, -1);
    case 'Home':
      return scan(n - 1, 1);
    case 'End':
      return scan(0, -1);
    default:
      return null;
  }
}

/**
 * Accessible tabs: `tablist` / `tab` / `tabpanel`, one tab stop (the selected tab), arrow keys,
 * Home and End, automatic activation. Controlled: the caller owns `selectedId`.
 *
 * There is one `tabpanel` element with a stable id; its content is swapped for the selected tab.
 * Every tab names it in `aria-controls` (so no tab points nowhere), and the panel is labelled by
 * whichever tab is selected.
 */
export function Tabs<Id extends string>({ label, tabs, selectedId, onSelect, children, className }: TabsProps<Id>) {
  const baseId = useId();
  const tabDomId = (id: Id) => `${baseId}-tab-${id}`;
  const panelDomId = `${baseId}-panel`;
  const buttons = useRef(new Map<Id, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === selectedId);
    const next = nextEnabledTab(
      event.key,
      current === -1 ? 0 : current,
      tabs.map((tab) => tab.disabled !== true),
    );
    if (next === null) return;
    const tab = tabs[next];
    if (tab === undefined) return;
    event.preventDefault();
    if (tab.id !== selectedId) onSelect(tab.id);
    buttons.current.get(tab.id)?.focus();
  };

  return (
    <div className={cx('frl-tabs', className)}>
      <div role="tablist" aria-label={label} aria-orientation="horizontal" className="frl-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el === null) buttons.current.delete(tab.id);
                else buttons.current.set(tab.id, el);
              }}
              type="button"
              role="tab"
              id={tabDomId(tab.id)}
              aria-selected={selected}
              aria-label={tab.badgeLabel === undefined ? undefined : `${tab.label}, ${tab.badgeLabel}`}
              aria-controls={panelDomId}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled === true}
              className={cx('frl-tabs__tab', selected && 'is-selected')}
              onClick={() => {
                if (!selected) onSelect(tab.id);
              }}
            >
              <span className="frl-tabs__label">{tab.label}</span>
              {tab.badge !== undefined && tab.badge !== null && (
                <span className="frl-tabs__badge" aria-hidden="true">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelDomId} aria-labelledby={tabDomId(selectedId)} tabIndex={0} className="frl-tabs__panel">
        {children}
      </div>
    </div>
  );
}
