import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MapController, MapStatus } from '../../app/map-exports';
import type { DatasetView } from '../../domain/dataset';
import type { UiMapId } from '../../domain/ids';
import type { Location } from '../../domain/points';
import { locationDetail } from '../app-model';
import { Button, Select, TextInput, formatDurationLong, formatInteger } from '../kit';
import { minutesText, parseMinutes, parseNumber } from './field-parse';
import type { Announce } from './LiveAnnouncer';
import './Editing.css';

/**
 * Field editors of the Details tab (docs/UI.md §14): a step's or a custom quest's location, and a
 * step's duration override. Controlled: they call `onChange` with the new value, and the caller
 * dispatches the command (or keeps a draft).
 */

// Location ------------------------------------------------------------------------------------

export interface LocationPick {
  readonly controller: MapController;
  /** What the point is for, in words: "the location of step 12" (the map's status line says it). */
  readonly what: string;
}

export interface LocationEditorProps {
  /** The field's name: "Location", "Starter location". */
  readonly label: string;
  readonly value: Location | null;
  readonly dataset: DatasetView;
  readonly disabled: boolean;
  readonly onChange: (location: Location | null) => void;
  /** Pick on map; null when there is no map (the typed point is the keyboard path either way, UI.md §9 rule 12). */
  readonly pick: LocationPick | null;
  readonly announce?: Announce | undefined;
}

const NO_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_STATUS = (): MapStatus | null => null;

/** Why the map cannot pick a point, or null when it can. */
function pickUnavailable(pick: LocationPick | null, status: MapStatus | null): string | null {
  if (pick === null) return 'No map is loaded here: type the zone and percent instead';
  if (status === null || !status.attached) return 'The map is not ready yet: type the zone and percent instead';
  return null;
}

/** The typed fields for a location: its zone point as it is, or empty for a world point or none. */
function typedFieldsOf(value: Location | null): { readonly zone: string; readonly x: string; readonly y: string } {
  const source = value?.source.space === 'zone' ? value.source : null;
  return source === null ? { zone: '', x: '', y: '' } : { zone: String(source.uiMapId), x: String(source.x), y: String(source.y) };
}

/** Why Clear does nothing: there is no value. */
export const NOTHING_TO_CLEAR = 'Nothing to clear: no value is set';

/**
 * A location: what it is now, a typed zone-percent point (zone, X %, Y %: the keyboard path),
 * "Pick on map" (the next click on the map, as a world point with the zone hint; Escape cancels),
 * and Clear. A typed point is in the Forever frame, as the in-game map shows it. The typed fields
 * follow the value whenever it changes (undo, redo, a map pick, Clear: CR-17), so "Set point"
 * never re-applies a point that is no longer there; pressed on the value's own point, it keeps it
 * as it is (its frame included).
 */
export function LocationEditor({ label, value, dataset, disabled, onChange, pick, announce }: LocationEditorProps) {
  const hintId = useId();
  const problemId = useId();
  const clearId = useId();
  const controller = pick?.controller ?? null;
  const status = useSyncExternalStore(controller?.subscribe ?? NO_SUBSCRIBE, controller?.getStatus ?? NO_STATUS, controller?.getStatus ?? NO_STATUS);
  const [typed, setTyped] = useState(() => typedFieldsOf(value));
  const [typedFor, setTypedFor] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  if (typedFor !== value) {
    // The value changed outside the fields: they show it again (adjusting state when a prop changes).
    setTypedFor(value);
    setTyped(typedFieldsOf(value));
    setProblem(null);
  }
  const { zone, x, y } = typed;
  const setZone = (next: string) => {
    setTyped((current) => ({ ...current, zone: next }));
  };
  const setX = (next: string) => {
    setTyped((current) => ({ ...current, x: next }));
  };
  const setY = (next: string) => {
    setTyped((current) => ({ ...current, y: next }));
  };
  const picking = pick !== null && status?.pick?.label === pick.what;
  const startedRef = useRef(false);
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);

  const zoneOptions = useMemo(
    () =>
      dataset
        .zones()
        .map((z) => ({ value: String(z.uiMapId), label: z.name ?? `UiMap ${String(z.uiMapId)}` }))
        .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : Number(a.value) - Number(b.value))),
    [dataset],
  );

  // A pick this editor started ends with it (another step selected, the panel closed).
  useEffect(
    () => () => {
      const last = pickRef.current;
      if (startedRef.current && last !== null && last.controller.getStatus().pick?.label === last.what) last.controller.cancelPick();
    },
    [],
  );

  const setPoint = () => {
    const px = parseNumber(x);
    const py = parseNumber(y);
    if (zone === '' || px.kind !== 'number' || py.kind !== 'number') {
      const message = 'Choose a zone and type X and Y as numbers (percent of the zone map, as the in-game map shows them).';
      setProblem(message);
      announce?.(`Not set: ${message}`);
      return;
    }
    setProblem(null);
    const current = value?.source.space === 'zone' ? value.source : null;
    // The value's own point, unchanged: keep it as it is (an Era-frame point stays Era).
    if (current !== null && String(current.uiMapId) === zone && current.x === px.value && current.y === py.value) return;
    onChange({ source: { space: 'zone', uiMapId: Number(zone) as UiMapId, x: px.value, y: py.value, frame: 'forever', lexemes: null }, label: null, radius: null });
  };

  const unavailable = pickUnavailable(pick, status);
  const startPick = () => {
    if (pick === null || unavailable !== null || disabled) return;
    if (picking) {
      pick.controller.cancelPick();
      startedRef.current = false;
      announce?.('Pick on map cancelled.');
      return;
    }
    const started = pick.controller.startPick({
      label: pick.what,
      onPick: (point) => {
        startedRef.current = false;
        onChange({ source: point, label: null, radius: null });
      },
    });
    startedRef.current = started;
    if (started) announce?.(`Click the map to place ${pick.what}. Escape cancels.`);
  };

  const current = locationDetail(value, dataset);
  return (
    <fieldset className="frl-app-location" disabled={disabled}>
      <legend className="frl-app-location__legend">{label}</legend>
      <p className="frl-app-location__value" id={hintId}>
        {current ?? 'Not set'}
      </p>
      <div className="frl-app-location__typed">
        <Select label="Zone" value={zone} options={zoneOptions} placeholder="Choose a zone" onChange={setZone} size="sm" disabled={disabled} />
        <span className="frl-app-location__pair">
          <TextInput label="X %" value={x} onChange={setX} onSubmit={setPoint} size="sm" inputMode="decimal" disabled={disabled} className="frl-app-location__number" />
          <TextInput label="Y %" value={y} onChange={setY} onSubmit={setPoint} size="sm" inputMode="decimal" disabled={disabled} className="frl-app-location__number" />
        </span>
        <Button size="sm" onClick={setPoint} disabled={disabled} aria-describedby={problem === null ? undefined : problemId}>
          Set point
        </Button>
      </div>
      {problem !== null && (
        <p className="frl-app-problem" id={problemId}>
          {problem}
        </p>
      )}
      <div className="frl-app-actions">
        {/* A toggle keeps its name: pressed says it is picking, and pressing it again cancels (ARIA APG). */}
        <Button
          size="sm"
          icon="map-pin"
          aria-pressed={picking}
          aria-disabled={unavailable === null && !disabled ? undefined : true}
          title={unavailable ?? (picking ? 'Picking: press again or Escape to cancel' : `The next click on the map sets ${pick?.what ?? 'the point'}`)}
          onClick={startPick}
        >
          Pick on map
        </Button>
        {/* Not natively disabled when there is no value: a disabled button drops the focus it holds (UI-F4). */}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-disabled={value === null ? true : undefined}
          aria-describedby={value === null ? clearId : undefined}
          title={value === null ? NOTHING_TO_CLEAR : undefined}
          onClick={() => {
            if (value !== null) onChange(null);
          }}
        >
          Clear
        </Button>
      </div>
      {value === null && (
        <span id={clearId} className="frl-visually-hidden">
          {NOTHING_TO_CLEAR}
        </span>
      )}
      {picking && <p className="frl-app-hint">Click the map to place it. Escape cancels.</p>}
    </fieldset>
  );
}

// Duration ------------------------------------------------------------------------------------

export interface DurationEditorProps {
  /** The override in seconds, or null (the estimate applies). */
  readonly value: number | null;
  readonly disabled: boolean;
  readonly onChange: (seconds: number | null) => void;
  readonly announce?: Announce | undefined;
}

/**
 * A step's duration override, typed in minutes and stored in whole seconds (the project's unit),
 * with the conversion said in words: "12.5 minutes is stored as 750 seconds". Empty clears it, and
 * the estimate applies (unknown until simulation).
 */
export function DurationEditor({ value, disabled, onChange, announce }: DurationEditorProps) {
  const hintId = useId();
  const problemId = useId();
  const clearId = useId();
  const [text, setText] = useState(value === null ? '' : minutesText(value));
  const [textFor, setTextFor] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  if (textFor !== value) {
    // Keyed on the step only, so the field keeps focus after Enter; it follows the value here (undo, Clear: UI-F4).
    setTextFor(value);
    setText(value === null ? '' : minutesText(value));
    setProblem(null);
  }
  const commit = () => {
    const parsed = parseMinutes(text);
    if (parsed.kind === 'invalid') {
      const message = 'Type the minutes as a number of at least 0 (for example 12.5), or leave the field empty.';
      setProblem(message);
      announce?.(`Not set: ${message}`);
      return;
    }
    setProblem(null);
    const seconds = parsed.kind === 'empty' ? null : parsed.seconds;
    if (seconds !== value) onChange(seconds);
    setText(seconds === null ? '' : minutesText(seconds));
  };
  const hint =
    value === null
      ? 'Not set: the estimate applies (unknown until simulation, Milestone 6).'
      : `Set: ${formatDurationLong(value)} (stored as ${formatInteger(value)} ${value === 1 ? 'second' : 'seconds'}), replacing the estimate.`;
  return (
    <div className="frl-app-duration">
      <div className="frl-app-duration__row">
        <TextInput
          label="Duration override (minutes)"
          value={text}
          onChange={(next) => {
            setText(next);
            if (problem !== null) setProblem(null);
          }}
          onSubmit={commit}
          size="sm"
          inputMode="decimal"
          disabled={disabled}
          describedBy={problem === null ? hintId : `${hintId} ${problemId}`}
          invalid={problem !== null}
        />
        <Button size="sm" onClick={commit} disabled={disabled}>
          Set
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-disabled={value === null ? true : undefined}
          aria-describedby={value === null ? clearId : undefined}
          title={value === null ? NOTHING_TO_CLEAR : undefined}
          onClick={() => {
            if (value === null) return;
            setText('');
            setProblem(null);
            onChange(null);
          }}
        >
          Clear
        </Button>
        {value === null && (
          <span id={clearId} className="frl-visually-hidden">
            {NOTHING_TO_CLEAR}
          </span>
        )}
      </div>
      <p className="frl-app-hint" id={hintId}>
        {hint} Minutes are stored in whole seconds.
      </p>
      {problem !== null && (
        <p className="frl-app-problem" id={problemId}>
          {problem}
        </p>
      )}
    </div>
  );
}
