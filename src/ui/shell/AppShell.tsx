import { createContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconButton } from '../primitives/IconButton';
import '../styles/tokens.css';
import '../styles/base.css';
import './AppShell.css';

/**
 * The side panels' width range (docs/research/ui-refresh.md §4.1, §4.2): both panels resize from
 * 300 to 460px, 340px by default. The map's room comes from collapsing panels, not narrow ones.
 */
export const LEFT_PANEL_MIN = 300;
export const LEFT_PANEL_MAX = 460;
export const LEFT_PANEL_DEFAULT = 340;
export const RIGHT_PANEL_MIN = 300;
export const RIGHT_PANEL_MAX = 460;
export const RIGHT_PANEL_DEFAULT = 340;

function clamp(width: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(width)) return fallback;
  return Math.round(Math.min(max, Math.max(min, width)));
}

export function clampLeftWidth(width: number): number {
  return clamp(width, LEFT_PANEL_MIN, LEFT_PANEL_MAX, LEFT_PANEL_DEFAULT);
}

export function clampRightWidth(width: number): number {
  return clamp(width, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX, RIGHT_PANEL_DEFAULT);
}

/** What the shell's collapse controls change (the caller keeps it, per browser). */
export interface ShellLayout {
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  /** Both side panels hidden; the collapse flags are what they return to. */
  readonly mapFocus: boolean;
}

export interface AppShellProps {
  /** Usually a <TopBar>. */
  readonly top: ReactNode;
  /** The route editor (a <RouteList> with its header). */
  readonly left: ReactNode;
  /** The map, or <MapPlaceholder> until Milestone 3. */
  readonly centre: ReactNode;
  /** Usually a <SidePanel>. */
  readonly right: ReactNode;
  /** Usually a <StatusBar>. */
  readonly bottom: ReactNode;
  /** Route panel width in px, clamped to 300-460. */
  readonly leftWidth?: number | undefined;
  /** Makes the route panel resizable (pointer and keyboard); receives the clamped width. */
  readonly onLeftWidthChange?: ((width: number) => void) | undefined;
  /** Quests and details panel width in px, clamped to 300-460. */
  readonly rightWidth?: number | undefined;
  readonly onRightWidthChange?: ((width: number) => void) | undefined;
  /**
   * Which panels are put away, and map focus (ui-refresh.md §4.3). With `onLayoutChange` the shell
   * draws a handle on each edge of the map, Enter on a separator collapses its panel, and the Map
   * focus toggle sits at the map's top right; without it the panels always show.
   */
  readonly layout?: ShellLayout | undefined;
  readonly onLayoutChange?: ((patch: Partial<ShellLayout>) => void) | undefined;
  readonly className?: string | undefined;
}

const OPEN: ShellLayout = { leftCollapsed: false, rightCollapsed: false, mapFocus: false };

/**
 * The Map focus toggle's place (ui-refresh.md §4.3; map-presentation.md §25.3.0, step MP.4b): the
 * shell makes the toggle, and the map's own chrome (`MapFrame`) claims it, so it floats at the map's
 * top right between the map surface and the Map view toolbar in the tab order. Unclaimed (a centre
 * with no map frame), the shell draws it itself over the map's top right.
 */
export interface MapFocusSlot {
  /** The toggle to draw, or null when the shell draws none (no layout handler). */
  readonly toggle: ReactElement | null;
  /** Takes the toggle into the map's chrome; returns the release. */
  readonly claim: () => () => void;
  /** Whether a map frame has claimed it (and so draws it). */
  readonly claimed: boolean;
}

export const MapFocusContext = createContext<MapFocusSlot | null>(null);

/** Where focus goes after a collapse or a restore (ui-refresh.md §4.3, §9.2): never onto something hidden. */
type FocusTarget = 'left-handle' | 'right-handle' | 'left-panel' | 'right-panel' | 'map-focus';

/** The first thing to focus in a restored panel: the route list, the selected tab, else its first control. */
function panelFocusTarget(panel: HTMLElement | null): HTMLElement | null {
  if (panel === null) return null;
  return (
    panel.querySelector<HTMLElement>('[role="listbox"]') ??
    panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
    panel.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')
  );
}

/**
 * The application frame: a CSS grid with the top bar, the route editor on the left, the map in
 * the centre, the side panel on the right and the status bar at the bottom. Below 1024px the side
 * panel moves under the map; below 720px everything stacks. Either side panel collapses from its
 * handle on the map's edge or with Enter on its separator, and map focus hides both (ui-refresh.md
 * §4.3); the handles take the hidden panel's place in the tab order. Importing it loads the design
 * tokens and base styles.
 */
export function AppShell({
  top,
  left,
  centre,
  right,
  bottom,
  leftWidth,
  onLeftWidthChange,
  rightWidth,
  onRightWidthChange,
  layout = OPEN,
  onLayoutChange,
  className,
}: AppShellProps) {
  const lw = clampLeftWidth(leftWidth ?? LEFT_PANEL_DEFAULT);
  const rw = clampRightWidth(rightWidth ?? RIGHT_PANEL_DEFAULT);
  const style = { '--frl-left-width': `${String(lw)}px`, '--frl-right-width': `${String(rw)}px` } as CSSProperties;
  const collapsible = onLayoutChange !== undefined;
  const leftShown = !collapsible || (!layout.mapFocus && !layout.leftCollapsed);
  const rightShown = !collapsible || (!layout.mapFocus && !layout.rightCollapsed);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const leftHandleRef = useRef<HTMLButtonElement>(null);
  const rightHandleRef = useRef<HTMLButtonElement>(null);
  const mapFocusRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [claims, setClaims] = useState(0);
  const [slotClaim] = useState(() => () => {
    setClaims((n) => n + 1);
    return () => {
      setClaims((n) => n - 1);
    };
  });

  // After a collapse or a restore: the target the control asked for; otherwise, when focus sat in a
  // panel that is now hidden (Alt+M from inside it), the Map focus toggle or the panel's handle.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    const targets: Readonly<Record<FocusTarget, () => HTMLElement | null>> = {
      'left-handle': () => leftHandleRef.current,
      'right-handle': () => rightHandleRef.current,
      'left-panel': () => panelFocusTarget(leftRef.current),
      'right-panel': () => panelFocusTarget(rightRef.current),
      'map-focus': () => mapFocusRef.current,
    };
    if (pending !== null) {
      targets[pending]()?.focus();
      return;
    }
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (!(active instanceof Node)) return;
    const hiddenLeft = !leftShown && leftRef.current?.contains(active) === true;
    const hiddenRight = !rightShown && rightRef.current?.contains(active) === true;
    if (!hiddenLeft && !hiddenRight) return;
    if (layout.mapFocus) mapFocusRef.current?.focus();
    else (hiddenLeft ? leftHandleRef : rightHandleRef).current?.focus();
  }, [leftShown, rightShown, layout.mapFocus]);

  const change = (patch: Partial<ShellLayout>, focus: FocusTarget | null) => {
    pendingFocus.current = focus;
    onLayoutChange?.(patch);
  };
  /** Shows or hides one panel. Showing it from map focus ends map focus with only that panel shown. */
  const toggle = (side: 'left' | 'right', show: boolean, focusHandle: boolean) => {
    const key = side === 'left' ? 'leftCollapsed' : 'rightCollapsed';
    const other = side === 'left' ? 'rightCollapsed' : 'leftCollapsed';
    if (show) {
      change(layout.mapFocus ? { mapFocus: false, [key]: false, [other]: true } : { [key]: false }, `${side}-panel`);
    } else {
      change({ [key]: true }, focusHandle ? `${side}-handle` : null);
    }
  };

  const focusToggle = collapsible ? (
    <IconButton
      ref={mapFocusRef}
      icon="map-focus"
      label="Map focus"
      shortcut="Alt+M"
      variant="tile"
      pressed={layout.mapFocus}
      className="frl-shell__map-focus"
      onClick={() => {
        change({ mapFocus: !layout.mapFocus }, 'map-focus');
      }}
    />
  ) : null;

  return (
    <div className={cx('frl-shell', !leftShown && 'is-left-hidden', !rightShown && 'is-right-hidden', className)} style={style}>
      <div className="frl-shell__top">{top}</div>
      <main ref={leftRef} className="frl-shell__left" aria-label="Route editor" hidden={!leftShown}>
        {left}
        {onLeftWidthChange !== undefined && (
          <ResizeHandle
            side="left"
            width={lw}
            onChange={onLeftWidthChange}
            onCollapse={
              collapsible
                ? () => {
                    toggle('left', false, true);
                  }
                : undefined
            }
          />
        )}
      </main>
      {collapsible && (
        <IconButton
          ref={leftHandleRef}
          icon={leftShown ? 'left' : 'right'}
          label={leftShown ? 'Hide the route panel' : 'Show the route panel'}
          variant="tile"
          size="sm"
          className="frl-shell__handle frl-shell__handle--left"
          onClick={() => {
            toggle('left', !leftShown, true);
          }}
        />
      )}
      <section className="frl-shell__centre" aria-label="Map">
        <MapFocusContext.Provider value={{ toggle: focusToggle, claim: slotClaim, claimed: claims > 0 }}>{centre}</MapFocusContext.Provider>
        {claims === 0 && focusToggle}
      </section>
      {collapsible && (
        <IconButton
          ref={rightHandleRef}
          icon={rightShown ? 'right' : 'left'}
          label={rightShown ? 'Hide the quests and details panel' : 'Show the quests and details panel'}
          variant="tile"
          size="sm"
          className="frl-shell__handle frl-shell__handle--right"
          onClick={() => {
            toggle('right', !rightShown, true);
          }}
        />
      )}
      <aside ref={rightRef} className="frl-shell__right" aria-label="Quests and details" hidden={!rightShown}>
        {right}
        {onRightWidthChange !== undefined && (
          <ResizeHandle
            side="right"
            width={rw}
            onChange={onRightWidthChange}
            onCollapse={
              collapsible
                ? () => {
                    toggle('right', false, true);
                  }
                : undefined
            }
          />
        )}
      </aside>
      <div className="frl-shell__bottom">{bottom}</div>
    </div>
  );
}

interface ResizeHandleProps {
  readonly side: 'left' | 'right';
  readonly width: number;
  readonly onChange: (width: number) => void;
  /** Enter collapses the panel (the WAI-ARIA window splitter's collapse key); omitted: Enter does nothing. */
  readonly onCollapse?: (() => void) | undefined;
}

const SEPARATOR_NAMES = { left: 'Resize route panel', right: 'Resize quests and details panel' } as const;

/**
 * A vertical splitter: drag, or focus and use ←/→ (Shift for bigger steps), Home and End; Enter
 * collapses the panel. The arrows move the splitter, so ← widens the right panel and narrows the
 * left one.
 */
function ResizeHandle({ side, width, onChange, onCollapse }: ResizeHandleProps) {
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);
  const latestWidth = useRef(width);
  const [min, max, clampTo] = side === 'left' ? [LEFT_PANEL_MIN, LEFT_PANEL_MAX, clampLeftWidth] : [RIGHT_PANEL_MIN, RIGHT_PANEL_MAX, clampRightWidth];
  const direction = side === 'left' ? 1 : -1;

  useEffect(() => {
    latestWidth.current = width;
  }, [width]);

  useEffect(() => {
    if (drag === null) return undefined;
    const onMove = (event: globalThis.PointerEvent) => {
      const next = clampTo(drag.startWidth + direction * (event.clientX - drag.startX));
      if (next !== latestWidth.current) onChange(next);
    };
    const onUp = () => {
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, onChange, clampTo, direction]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      if (onCollapse === undefined) return;
      event.preventDefault();
      onCollapse();
      return;
    }
    const step = event.shiftKey ? 20 : 4;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width - direction * step;
    else if (event.key === 'ArrowRight') next = width + direction * step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampTo(next);
    if (clamped !== width) onChange(clamped);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={SEPARATOR_NAMES[side]}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-keyshortcuts={onCollapse === undefined ? undefined : 'Enter'}
      tabIndex={0}
      className={cx('frl-shell__resize', `frl-shell__resize--${side}`, drag !== null && 'is-dragging')}
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        setDrag({ startX: event.clientX, startWidth: width });
      }}
    />
  );
}
