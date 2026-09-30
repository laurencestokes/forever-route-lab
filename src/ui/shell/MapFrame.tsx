import { memo, useContext, useId, useLayoutEffect, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { cx } from '../lib/cx';
import { VisuallyHidden } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import type { IconName } from '../primitives/Icon';
import { IconButton } from '../primitives/IconButton';
import { Toolbar } from '../primitives/Toolbar';
import { MapFocusContext } from './AppShell';
import './MapFrame.css';

/**
 * The map panel's frame (docs/UI.md §12; docs/research/map-presentation.md §25.3.0, §25.3.1; D-047;
 * step MP.4b): the stage the map engine mounts into, taking the whole map region, with its controls
 * floating on it, MapGenie's way:
 * - top left, **Map layers**, the drawer's disclosure (`aria-expanded`, `aria-controls`), just right
 *   of the drawer while it is open;
 * - top right, **Map focus** (the shell's toggle, claimed from `MapFocusContext`);
 * - bottom right, the **Map view** toolbar: Zoom in and Zoom out, then Fit route and Focus step
 *   (one toolbar, arrow keys inside);
 * - bottom left, the **caption**: what the map shows (the art's notice), the route note and the
 *   pointer's text, on a backplate, never a live region (UI.md §9 rule 12).
 *
 * The **Map layers drawer** (300 px, `--frl-map-drawer-width`) docks on the stage's left where the
 * map region is 900 px or more (`useMapRegionDocking`), and lies over the stage's left edge below
 * that (a container query does the layout). Its content is the caller's (a lazy part). There is no
 * toolbar row and no status line any more: the map takes the region (review UO-02).
 *
 * The map is supplementary (UI.md §9 rule 12): every control here is a button with a name, and
 * everything the map does can also be done from the route list, the Available tab or Details.
 * Keyboard order in the region: Map layers, the drawer (when open), the map surface, Map focus, the
 * Map view toolbar.
 */

/** One map command in the Map view toolbar. */
export interface MapCommand {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
  /** Tooltip when available. */
  readonly title: string;
  /** Why it cannot be used now; it then renders aria-disabled with this as its description. */
  readonly unavailable: string | null;
  readonly onRun: () => void;
  /** The toolbar group it belongs to: zoom (first), or the view commands (second). */
  readonly group?: 'zoom' | 'view' | undefined;
}

/** Where the map engine is: loading its chunk, ready, failed to load (with a retry), or not available at all. */
export type MapEngineState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string; readonly onRetry: () => void }
  | { readonly kind: 'unavailable'; readonly message: string };

/** The map region's width from which the drawer docks beside the stage (§25.3.1). */
export const DRAWER_DOCK_MIN_PX = 900;

/** "Pointer on: …", the caption's hover text; nothing for null. */
export function MapHoverText({ text }: { readonly text: string | null }) {
  if (text === null) return null;
  return (
    <span className="frl-mapframe__hover" title={text}>
      <VisuallyHidden>Pointer on: </VisuallyHidden>
      {text}
    </span>
  );
}

/**
 * Whether the map region is wide enough for the drawer to dock (§25.3.1: 900 px or more), from the
 * element's width as a `ResizeObserver` reports it (the container query lays the drawer out; this is
 * for the behaviour that depends on it: the default open state and Escape). `initial` until measured.
 */
export function useMapRegionDocking(ref: RefObject<HTMLElement | null>, initial = false): boolean {
  const [docked, setDocked] = useState(initial);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const measure = (width: number): void => {
      if (width > 0) setDocked(width >= DRAWER_DOCK_MIN_PX);
    };
    measure(element.getBoundingClientRect().width || element.clientWidth);
    const Observer = element.ownerDocument.defaultView?.ResizeObserver;
    if (Observer === undefined) return undefined;
    const observer = new Observer((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return docked;
}

/** The drawer's place in the frame (§25.3.1): its id (the toggle's `aria-controls`), whether it is open and docked, and its content. */
export interface MapDrawerFrameProps {
  readonly id: string;
  readonly open: boolean;
  readonly docked: boolean;
  readonly onToggle: () => void;
  /** The drawer (a lazy part), or its stand-in while it loads. */
  readonly content: ReactNode;
}

export interface MapFrameProps {
  readonly drawer: MapDrawerFrameProps;
  /** The Map view toolbar's commands, in order: the zoom group, then the view group. */
  readonly commands: readonly MapCommand[];
  /** What kind of map this is, always visible (MAPS.md §8.1; D-033 rule 2): "Painted map art © Blizzard Entertainment". */
  readonly notice: string;
  /** The notice's short form, shown instead of it in a narrow map ("Art © Blizzard"). */
  readonly noticeShort?: string | undefined;
  readonly engine: MapEngineState;
  /** The element the engine mounts into. */
  readonly stageRef: Ref<HTMLDivElement>;
  /** The map region (for its width: `useMapRegionDocking`). */
  readonly regionRef?: Ref<HTMLDivElement> | undefined;
  /** Id of the instructions paragraph, for the engine surface's `aria-describedby`. */
  readonly instructionsId: string;
  /** Read with the map surface: the notice, the map's name and how to use it. */
  readonly instructions: string;
  /** The caption's lines (a pick in progress, the route on this map, what the map cannot follow). */
  readonly caption: readonly string[];
  /**
   * What the pointer is over: its text (null for nothing), or an element that renders
   * `MapHoverText` itself, so a hover re-renders only that element (M3 review PERF-14).
   */
  readonly hover: ReactNode;
  /**
   * The map popover (map-presentation.md §14.2; step MP.6), a lazy part the map panel renders when a
   * click opens it; null for none. It is placed inside the stage, beside the clicked point.
   */
  readonly popover?: ReactNode;
  /**
   * The "Viewing" chip (map-presentation.md §13.5; step MP.7): from the zone band, the zone at the
   * view centre with its span and `DifficultyLabel`, at the stage's top left beside Map layers. It is
   * DOM, so it is in the accessibility tree and shows the difficulty colours through the chip itself.
   */
  readonly viewing?: ReactNode;
  readonly className?: string | undefined;
}

function EngineCard({ engine }: { readonly engine: MapEngineState }): ReactNode {
  switch (engine.kind) {
    case 'ready':
      return null;
    case 'loading':
      return (
        <div className="frl-mapframe__card" role="status">
          Loading the map…
        </div>
      );
    case 'failed':
      return (
        <div className="frl-mapframe__card" role="alert">
          <p className="frl-mapframe__card-title">The map could not be loaded</p>
          <p>{engine.message}</p>
          <p>The route list, the Available tab and Details work without it.</p>
          <Button size="sm" onClick={engine.onRetry}>
            Try again
          </Button>
        </div>
      );
    case 'unavailable':
      return (
        <div className="frl-mapframe__card">
          <p className="frl-mapframe__card-title">No map here</p>
          <p>{engine.message}</p>
        </div>
      );
  }
}

/** The shell's Map focus toggle, drawn here once claimed (so it sits between the map surface and the toolbar in the tab order). */
function MapFocusToggle() {
  const slot = useContext(MapFocusContext);
  const claim = slot?.claim;
  useLayoutEffect(() => (claim === undefined ? undefined : claim()), [claim]);
  if (slot === null || !slot.claimed) return null;
  return slot.toggle;
}

export const MapFrame = memo(function MapFrame({
  drawer,
  commands,
  notice,
  noticeShort,
  engine,
  stageRef,
  regionRef,
  instructionsId,
  instructions,
  caption,
  hover,
  popover = null,
  viewing = null,
  className,
}: MapFrameProps) {
  const baseId = useId();
  const reasonId = (command: MapCommand) => `${baseId}-${command.id}-reason`;
  const usable = engine.kind === 'ready';
  const zoom = commands.filter((command) => command.group === 'zoom');
  const view = commands.filter((command) => command.group !== 'zoom');
  const commandButton = (command: MapCommand) =>
    command.icon === undefined ? (
      <Button
        key={command.id}
        size="md"
        className="frl-mapframe__command"
        title={command.unavailable === null ? command.title : `${command.title}: ${command.unavailable}`}
        aria-disabled={command.unavailable === null ? undefined : true}
        aria-describedby={command.unavailable === null ? undefined : reasonId(command)}
        onClick={() => {
          if (command.unavailable === null) command.onRun();
        }}
      >
        {command.label}
      </Button>
    ) : (
      <IconButton
        key={command.id}
        icon={command.icon}
        label={command.label}
        variant="tile"
        className="frl-mapframe__command"
        aria-disabled={command.unavailable === null ? undefined : true}
        aria-describedby={command.unavailable === null ? undefined : reasonId(command)}
        onClick={() => {
          if (command.unavailable === null) command.onRun();
        }}
      />
    );
  return (
    <div className={cx('frl-mapframe', drawer.open && 'is-drawer-open', drawer.docked ? 'is-docked' : 'is-over', className)} ref={regionRef}>
      <div className="frl-mapframe__region">
        {/* A disclosure (§25.3.8: `aria-expanded`, not `aria-pressed`), drawn with the kit's pressed look while open. */}
        <IconButton
          icon="layers"
          label="Map layers"
          variant="tile"
          className={cx('frl-mapframe__layers-toggle', drawer.open && 'is-pressed')}
          aria-expanded={drawer.open}
          aria-controls={drawer.open ? drawer.id : undefined}
          onClick={drawer.onToggle}
        />
        {drawer.open && (
          <div className="frl-mapframe__drawer" id={drawer.id}>
            {drawer.content}
          </div>
        )}
        <div className="frl-mapframe__stage">
          <div className={cx('frl-mapframe__host', !usable && 'is-idle')} ref={stageRef} />
          <EngineCard engine={engine} />
          {usable && viewing !== null && <div className="frl-mapframe__viewing">{viewing}</div>}
          {usable && popover}
          <p id={instructionsId} className="frl-visually-hidden">
            {instructions}
          </p>
          <div className="frl-mapframe__focus">
            <MapFocusToggle />
          </div>
          <div className="frl-mapframe__view">
            <Toolbar label="Map view" className="frl-mapframe__toolbar">
              {zoom.length > 0 && <span className="frl-mapframe__group">{zoom.map(commandButton)}</span>}
              {view.length > 0 && <span className="frl-mapframe__group">{view.map(commandButton)}</span>}
            </Toolbar>
            {commands.map((command) =>
              command.unavailable === null ? null : (
                <span key={command.id} id={reasonId(command)} hidden>
                  {command.unavailable}
                </span>
              ),
            )}
          </div>
          <div className="frl-mapframe__caption">
            <p className={cx('frl-mapframe__notice', noticeShort !== undefined && 'has-short')} title={notice}>
              <span className="frl-mapframe__notice-long">{notice}</span>
              {noticeShort !== undefined && <span className="frl-mapframe__notice-short">{noticeShort}</span>}
            </p>
            {caption.map((line) => (
              <p key={line} className="frl-mapframe__caption-line">
                {line}
              </p>
            ))}
            {typeof hover === 'string' || hover === null || hover === undefined ? <MapHoverText text={typeof hover === 'string' ? hover : null} /> : hover}
          </div>
        </div>
      </div>
    </div>
  );
});
