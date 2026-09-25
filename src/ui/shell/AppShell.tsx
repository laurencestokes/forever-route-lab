import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import '../styles/tokens.css';
import '../styles/base.css';
import './AppShell.css';

/** The route panel's width range (ARCHITECTURE §12.4, docs/UI.md "Layout"). */
export const LEFT_PANEL_MIN = 320;
export const LEFT_PANEL_MAX = 380;
export const LEFT_PANEL_DEFAULT = 340;

export function clampLeftWidth(width: number): number {
  if (!Number.isFinite(width)) return LEFT_PANEL_DEFAULT;
  return Math.round(Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, width)));
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
  /** Route panel width in px, clamped to 320-380. */
  readonly leftWidth?: number | undefined;
  /** Makes the route panel resizable (pointer and keyboard); receives the clamped width. */
  readonly onLeftWidthChange?: ((width: number) => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * The application frame: a CSS grid with the top bar, the route editor on the left, the map in
 * the centre, the side panel on the right and the status bar at the bottom. Below 1024px the side
 * panel moves under the map; below 720px everything stacks. Importing it loads the design tokens
 * and base styles.
 */
export function AppShell({ top, left, centre, right, bottom, leftWidth, onLeftWidthChange, className }: AppShellProps) {
  const width = clampLeftWidth(leftWidth ?? LEFT_PANEL_DEFAULT);
  const style = { '--frl-left-width': `${String(width)}px` } as CSSProperties;
  return (
    <div className={cx('frl-shell', className)} style={style}>
      <div className="frl-shell__top">{top}</div>
      <main className="frl-shell__left" aria-label="Route editor">
        {left}
        {onLeftWidthChange !== undefined && <ResizeHandle width={width} onChange={onLeftWidthChange} />}
      </main>
      <section className="frl-shell__centre" aria-label="Map">
        {centre}
      </section>
      <aside className="frl-shell__right" aria-label="Quests and details">
        {right}
      </aside>
      <div className="frl-shell__bottom">{bottom}</div>
    </div>
  );
}

interface ResizeHandleProps {
  readonly width: number;
  readonly onChange: (width: number) => void;
}

/** A vertical splitter: drag, or focus and use ←/→ (Shift for bigger steps), Home and End. */
function ResizeHandle({ width, onChange }: ResizeHandleProps) {
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);
  const latestWidth = useRef(width);

  useEffect(() => {
    latestWidth.current = width;
  }, [width]);

  useEffect(() => {
    if (drag === null) return undefined;
    const onMove = (event: globalThis.PointerEvent) => {
      const next = clampLeftWidth(drag.startWidth + event.clientX - drag.startX);
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
  }, [drag, onChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 20 : 4;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = width - step;
    else if (event.key === 'ArrowRight') next = width + step;
    else if (event.key === 'Home') next = LEFT_PANEL_MIN;
    else if (event.key === 'End') next = LEFT_PANEL_MAX;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampLeftWidth(next);
    if (clamped !== width) onChange(clamped);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize route panel"
      aria-valuemin={LEFT_PANEL_MIN}
      aria-valuemax={LEFT_PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className={cx('frl-shell__resize', drag !== null && 'is-dragging')}
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        setDrag({ startX: event.clientX, startWidth: width });
      }}
    />
  );
}
