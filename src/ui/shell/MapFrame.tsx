import { memo, useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cx } from '../lib/cx';
import { Badge, VisuallyHidden } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import type { IconName } from '../primitives/Icon';
import { IconButton } from '../primitives/IconButton';
import { Select, type SelectOption } from '../primitives/Select';
import { Toolbar } from '../primitives/Toolbar';
import { MapGlyph, MapLegend, type MapGlyphKind } from './MapLegend';
import './MapFrame.css';

/**
 * The map panel's frame (docs/UI.md §12): a toolbar (surface switcher, map commands, the layer
 * panel toggle and the "schematic map" notice), the stage the map engine mounts into, the layer
 * panel and the map key beside it, a status line, and the list of items at a clicked point where
 * several share it. Presentational: the caller owns the engine and passes a ref to the stage's host
 * element, which the engine fills with its own (focusable) surface.
 *
 * The map is supplementary (UI.md §9 rule 12): every command here is a button, select or checkbox
 * with a name, and everything the map does can also be done from the route list, the Available
 * tab or Details.
 */

/** One map command in the toolbar. */
export interface MapCommand {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
  /** Tooltip when available. */
  readonly title: string;
  /** Why it cannot be used now; it then renders aria-disabled with this as its description. */
  readonly unavailable: string | null;
  readonly onRun: () => void;
}

/** One row of the layer panel. */
export interface MapLayerRow {
  readonly id: string;
  readonly label: string;
  /** The layer's glyph or line style as the map draws it (the key's), or null for none. */
  readonly glyph?: MapGlyphKind | null | undefined;
  readonly visible: boolean;
  /** Why the layer cannot be shown here: the checkbox is disabled and the reason is shown. */
  readonly unavailable: string | null;
  /** What is drawn now, for example `"49 drawn"`; null for nothing to say. */
  readonly count: string | null;
  /** Honest notes: what is left out and why. */
  readonly notes: readonly string[];
}

export interface LayerPanelProps {
  readonly layers: readonly MapLayerRow[];
  readonly onToggle: (id: string, visible: boolean) => void;
  /** Lines under the layers (the geometry in use). */
  readonly footer?: readonly string[] | undefined;
  readonly id?: string | undefined;
}

/** The layer list: one checkbox per layer with its glyph, its count and its notes; unavailable layers say why. */
export const LayerPanel = memo(function LayerPanel({ layers, onToggle, footer = [], id }: LayerPanelProps) {
  const baseId = useId();
  return (
    <fieldset className="frl-layers" id={id}>
      <legend className="frl-layers__title">Layers</legend>
      <ul className="frl-layers__list">
        {layers.map((layer) => {
          const noteId = `${baseId}-${layer.id}`;
          const described = layer.unavailable !== null || layer.notes.length > 0;
          return (
            <li key={layer.id} className={cx('frl-layers__row', layer.unavailable !== null && 'is-unavailable')}>
              <label className="frl-layers__label">
                <input
                  type="checkbox"
                  checked={layer.unavailable === null && layer.visible}
                  disabled={layer.unavailable !== null}
                  aria-describedby={described ? noteId : undefined}
                  onChange={(event) => {
                    onToggle(layer.id, event.currentTarget.checked);
                  }}
                />
                {layer.glyph !== undefined && layer.glyph !== null && <MapGlyph kind={layer.glyph} className="frl-layers__glyph" />}
                <span className="frl-layers__name">{layer.label}</span>
                {layer.count !== null && <span className="frl-layers__count frl-num">{layer.count}</span>}
              </label>
              {described && (
                <ul className="frl-layers__notes" id={noteId}>
                  {layer.unavailable !== null && <li>{layer.unavailable}</li>}
                  {layer.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {footer.length > 0 && (
        <div className="frl-layers__footer">
          {footer.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </fieldset>
  );
});

/** Where the map engine is: loading its chunk, ready, failed to load (with a retry), or not available at all. */
export type MapEngineState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string; readonly onRetry: () => void }
  | { readonly kind: 'unavailable'; readonly message: string };

/**
 * Several items at one clicked point (a merged marker, MAPS.md §7.3): listed near the point so the
 * user picks one. Keyboard: focus moves to the first item; arrow keys move between items; Escape
 * closes and returns focus to the map.
 */
export interface MapChoiceProps {
  /** `6 steps here`. */
  readonly title: string;
  /** What picking does: `Choose one to select its step.` */
  readonly hint: string;
  readonly options: readonly string[];
  /** `Select all 6 steps`; null for no such action. */
  readonly allLabel: string | null;
  /** The point in stage pixels, with the stage's size; null to place the list at the top left. */
  readonly at: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly onChoose: (index: number) => void;
  readonly onAll: () => void;
  readonly onDismiss: () => void;
}

/** The list's width in pixels (MapFrame.css), for keeping it inside the stage. */
export const MAP_CHOICE_WIDTH = 260;

/** Where the list goes: beside the point, inside the stage, above the point in the lower half. */
export function mapChoicePosition(at: MapChoiceProps['at']): CSSProperties {
  if (at === null) return { left: 8, top: 8 };
  const left = Math.max(8, Math.min(at.x + 12, at.width - MAP_CHOICE_WIDTH - 8));
  return at.y <= at.height / 2 ? { left, top: Math.max(8, at.y + 12) } : { left, bottom: Math.max(8, at.height - at.y + 12) };
}

function MapChoiceList({ choice, returnFocus }: { readonly choice: MapChoiceProps; readonly returnFocus: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const { onDismiss } = choice;
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('.frl-mapchoice__option')?.focus();
  }, [choice.title, choice.options]);
  useEffect(() => {
    const root = rootRef.current;
    const doc = root?.ownerDocument;
    if (root === null || doc === undefined) return undefined;
    const onPointerDown = (event: Event) => {
      if (event.target instanceof Node && !root.contains(event.target)) onDismiss();
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onDismiss]);
  const close = (then: () => void) => {
    then();
    returnFocus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(onDismiss);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('.frl-mapchoice__option, .frl-mapchoice__all') ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = buttons.findIndex((button) => button === event.target);
    const last = buttons.length - 1;
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowDown' ? (current < 0 ? 0 : Math.min(last, current + 1)) : Math.max(0, current - 1);
    buttons[next]?.focus();
  };
  return (
    <div
      ref={rootRef}
      className="frl-mapchoice"
      role="dialog"
      aria-labelledby={`${baseId}-title`}
      aria-describedby={`${baseId}-hint`}
      style={mapChoicePosition(choice.at)}
      onKeyDown={onKeyDown}
    >
      <div className="frl-mapchoice__head">
        <p id={`${baseId}-title`} className="frl-mapchoice__title">
          {choice.title}
        </p>
        <IconButton
          icon="close"
          size="sm"
          label="Close"
          onClick={() => {
            close(onDismiss);
          }}
        />
      </div>
      <p id={`${baseId}-hint`} className="frl-mapchoice__hint">
        {choice.hint}
      </p>
      <ul className="frl-mapchoice__list">
        {choice.options.map((label, index) => (
          // Items can repeat their text (two spawns of one giver); the position keeps keys unique.
          <li key={`${String(index)}:${label}`}>
            <button
              type="button"
              className="frl-mapchoice__option"
              onClick={() => {
                close(() => {
                  choice.onChoose(index);
                });
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
      {choice.allLabel !== null && (
        <Button
          size="sm"
          variant="secondary"
          className="frl-mapchoice__all"
          onClick={() => {
            close(choice.onAll);
          }}
        >
          {choice.allLabel}
        </Button>
      )}
    </div>
  );
}

/** "Pointer on: …", the status line's hover text; nothing for null. */
export function MapHoverText({ text }: { readonly text: string | null }) {
  if (text === null) return null;
  return (
    <span className="frl-mapframe__hover" title={text}>
      <VisuallyHidden>Pointer on: </VisuallyHidden>
      {text}
    </span>
  );
}

export interface MapFrameProps {
  /** The surface switcher: one option per world map. */
  readonly surface: {
    readonly value: string;
    readonly options: readonly SelectOption[];
    readonly onChange: (value: string) => void;
  };
  readonly commands: readonly MapCommand[];
  readonly layersOpen: boolean;
  readonly onLayersOpenChange: (open: boolean) => void;
  readonly layers: LayerPanelProps;
  /** What kind of map this is, always visible (MAPS.md §8.1): "Schematic map: zone frames, not terrain". */
  readonly notice: string;
  /** The notice's short form, shown instead of it in a narrow panel ("Schematic"); without one the notice always shows in full. */
  readonly noticeShort?: string | undefined;
  readonly engine: MapEngineState;
  /** The element the engine mounts into. */
  readonly stageRef: Ref<HTMLDivElement>;
  /** Id of the instructions paragraph, for the engine surface's `aria-describedby`. */
  readonly instructionsId: string;
  /** Read with the map surface: the notice, the map's name and how to use it. */
  readonly instructions: string;
  /** One-line summaries under the map (the route on this surface). */
  readonly status: readonly string[];
  /**
   * What the pointer is over: its text (null for nothing), or an element that renders
   * `MapHoverText` itself, so a hover re-renders only that element (M3 review PERF-14).
   */
  readonly hover: ReactNode;
  /** Items at a clicked point to choose from; null for none. */
  readonly choice?: MapChoiceProps | null | undefined;
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

export const MapFrame = memo(function MapFrame({
  surface,
  commands,
  layersOpen,
  onLayersOpenChange,
  layers,
  notice,
  noticeShort,
  engine,
  stageRef,
  instructionsId,
  instructions,
  status,
  hover,
  choice = null,
  className,
}: MapFrameProps) {
  const baseId = useId();
  const layersId = `${baseId}-layers`;
  const reasonId = (command: MapCommand) => `${baseId}-${command.id}-reason`;
  const usable = engine.kind === 'ready';
  const stageBoxRef = useRef<HTMLDivElement>(null);
  /** Back to the engine's surface (the host's first child) after the choice list closes. */
  const returnFocus = () => {
    const surfaceEl = stageBoxRef.current?.querySelector('.frl-mapframe__host')?.firstElementChild;
    if (surfaceEl instanceof HTMLElement) surfaceEl.focus();
  };
  return (
    <div className={cx('frl-mapframe', layersOpen && 'is-layers-open', className)}>
      <div className="frl-mapframe__bar">
        <Select
          label="Map surface"
          hideLabel
          size="sm"
          className="frl-mapframe__surface"
          value={surface.value}
          options={surface.options}
          disabled={surface.options.length === 0}
          onChange={surface.onChange}
        />
        <Toolbar label="Map commands" className="frl-mapframe__commands">
          {commands.map((command) => (
            <Button
              key={command.id}
              size="sm"
              variant="ghost"
              icon={command.icon}
              title={command.unavailable === null ? command.title : `${command.title}: ${command.unavailable}`}
              aria-disabled={command.unavailable === null ? undefined : true}
              aria-describedby={command.unavailable === null ? undefined : reasonId(command)}
              onClick={() => {
                if (command.unavailable === null) command.onRun();
              }}
            >
              {command.label}
            </Button>
          ))}
          <IconButton
            icon="layers"
            size="sm"
            label="Layers"
            pressed={layersOpen}
            aria-controls={layersOpen ? layersId : undefined}
            onClick={() => {
              onLayersOpenChange(!layersOpen);
            }}
          />
        </Toolbar>
        {commands.map((command) =>
          command.unavailable === null ? null : (
            <span key={command.id} id={reasonId(command)} hidden>
              {command.unavailable}
            </span>
          ),
        )}
        <span className="frl-mapframe__spacer" />
        <Badge className={cx('frl-mapframe__notice', noticeShort !== undefined && 'has-short')} title={notice}>
          <span className="frl-mapframe__notice-long">{notice}</span>
          {noticeShort !== undefined && <span className="frl-mapframe__notice-short">{noticeShort}</span>}
        </Badge>
      </div>
      <div className="frl-mapframe__body">
        <div className="frl-mapframe__stage" ref={stageBoxRef}>
          <div className={cx('frl-mapframe__host', !usable && 'is-idle')} ref={stageRef} />
          <EngineCard engine={engine} />
          {usable && choice !== null && <MapChoiceList choice={choice} returnFocus={returnFocus} />}
          <p id={instructionsId} className="frl-visually-hidden">
            {instructions}
          </p>
        </div>
        {layersOpen && (
          <div className="frl-mapframe__side">
            <LayerPanel {...layers} id={layersId} />
            <MapLegend />
          </div>
        )}
      </div>
      <div className="frl-mapframe__status">
        {status.map((line) => (
          <span key={line} className="frl-mapframe__status-item">
            {line}
          </span>
        ))}
        {typeof hover === 'string' || hover === null || hover === undefined ? <MapHoverText text={typeof hover === 'string' ? hover : null} /> : hover}
      </div>
    </div>
  );
});
