import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatDuration, formatDurationLong, formatInteger, formatLevel } from '../lib/format';
import { describeIssueCounts, totalIssues, worstSeverity } from '../lib/issues';
import type { Readout } from '../lib/readout';
import { Icon, type IconName } from '../primitives/Icon';
import { DifficultyLabel, describeDifficulty } from '../markers/DifficultyLabel';
import { PENDING_TRAVEL_TEXTS, PendingMarker, type PendingTravel } from '../markers/PendingMarker';
import { ProvenanceBadge } from '../markers/ProvenanceBadge';
import { ReadoutValue } from '../markers/ReadoutValue';
import { SeverityIcon } from '../markers/SeverityIcon';
import { STEP_KIND_LABELS, StepTypeGlyph } from '../markers/StepTypeGlyph';
import { describeForeverProvenance } from '../markers/provenance';
import type { EstimateColumn, GroupRowModel, StepRowModel } from './rows';
import './RouteList.css';

/** Shared by step and group rows: the list positions them and wires the pointer. */
interface RowFrameProps {
  readonly id?: string | undefined;
  readonly selected: boolean;
  /** The list's active (keyboard focus) row. */
  readonly active: boolean;
  readonly dragging?: boolean | undefined;
  /**
   * Position among the list's steps (group headers are not counted) and the number of steps. Set
   * on step rows only: a header row has no position, so a screen reader never hears two numbers.
   */
  readonly posInSet?: number | undefined;
  readonly setSize?: number | undefined;
  readonly style?: CSSProperties | undefined;
  readonly onClick?: ((event: MouseEvent<HTMLDivElement>) => void) | undefined;
  readonly onDoubleClick?: ((event: MouseEvent<HTMLDivElement>) => void) | undefined;
  /** The pointer entered the row (the map highlights its step's marker). */
  readonly onMouseEnter?: (() => void) | undefined;
  /** Pointer down on the drag handle. Omit to hide the handle (read-only lists). */
  readonly onHandlePointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
}

export interface StepRowProps extends RowFrameProps {
  readonly model: StepRowModel;
  /** Label of the group header this step sits under, or null; spoken as "in group …". */
  readonly groupLabel?: string | null | undefined;
  /** Which estimate the right-hand column shows (default the level after the step); the name says all three. */
  readonly estimateColumn?: EstimateColumn | undefined;
  /** Hides the editing affordances (lock, duplicate, delete); a locked step still shows its lock. */
  readonly readOnly?: boolean | undefined;
  readonly onToggleLock?: (() => void) | undefined;
  readonly onDuplicate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}

/** How a row's name says a pending travel time, after "Time …, pending: ". */
const PENDING_ROW_WORDS: Readonly<Record<PendingTravel, string>> = {
  path: 'its walking path is still being computed, so the travel time is a straight-line estimate for now',
  retrying: 'computing its walking path failed and will be tried again shortly, so the travel time is a straight-line estimate for now',
  paused: 'computing walking paths is paused, so the travel time is a straight-line estimate until you resume',
  failed: 'its walking path could not be computed, so the travel time is a straight-line estimate',
  checking: 'the navigation data is still being checked, so the travel time is a straight-line estimate for now',
};

/** The estimate tooltip's short form of a pending travel time. */
const PENDING_TITLE_WORDS: Readonly<Record<PendingTravel, string>> = {
  path: 'walking path pending',
  retrying: 'walking path to be retried',
  paused: 'walking paths paused',
  failed: 'walking path failed',
  checking: 'navigation data being checked',
};

/** "(depends on assumptions, uses Era values)", or nothing for a plain value. */
function flagWords(readout: Readout<number>): string {
  const flags = [readout.assumed ? 'depends on assumptions' : null, readout.eraFallback ? 'uses Era values' : null].filter((flag) => flag !== null);
  return flags.length === 0 ? '' : ` (${flags.join(', ')})`;
}

/** `Level after step at least 9.0 (depends on assumptions)`, `XP gained unknown: <reason>`. */
function readoutWords(label: string, readout: Readout<number>, words: (value: number) => string): string {
  if (readout.value === null) return `${label} unknown${readout.unknownReason === null ? '' : `: ${readout.unknownReason}`}`;
  const bound = readout.lowerBound ? 'at least ' : readout.upperBound ? 'at most ' : '';
  return `${label} ${bound}${words(readout.value)}${flagWords(readout)}`;
}

/** The spoken XP gained: `450 XP`. */
const xpWords = (value: number): string => `${formatInteger(value)} XP`;

/**
 * The step's estimates in words. When all three are unknown for the same reason (nothing is
 * simulated yet) the reason is said once.
 */
function estimateWords(model: StepRowModel): string[] {
  const { projectedLevel: level, xpGained: xp, duration } = model;
  if (
    level.value === null &&
    xp.value === null &&
    duration.value === null &&
    level.unknownReason === xp.unknownReason &&
    xp.unknownReason === duration.unknownReason
  ) {
    return [`Level after step, XP and time unknown${level.unknownReason === null ? '' : `: ${level.unknownReason}`}`];
  }
  const time = readoutWords('Time', duration, formatDurationLong);
  return [
    readoutWords('Level after step', level, formatLevel),
    readoutWords('XP gained', xp, xpWords),
    model.pending === null ? time : `${time}, pending: ${PENDING_ROW_WORDS[model.pending]}`,
  ];
}

/**
 * The accessible name of a step row; the row's children are presentational (role option).
 * `groupLabel` names the group header the step sits under, if any. It says every estimate (the
 * level after the step, the XP gained and the time), whichever one the row's column shows, and the
 * issues found at the step by severity.
 */
export function describeStepRow(model: StepRowModel, groupLabel: string | null = null): string {
  const parts: string[] = [];
  const detail = model.detail === null ? '' : `, ${model.detail}`;
  const group = groupLabel === null ? '' : `, in group ${groupLabel}`;
  parts.push(`${String(model.number)}. ${STEP_KIND_LABELS[model.kind]}: ${model.title}${detail}${group}`);
  if (model.quest !== null) {
    parts.push(describeDifficulty(model.quest.level, model.quest.difficulty, model.quest.uncertain));
    if (model.quest.provenance.claim !== 'unknown') parts.push(describeForeverProvenance(model.quest.provenance));
  }
  parts.push(...estimateWords(model));
  if (totalIssues(model.issues) > 0) parts.push(`Issues: ${describeIssueCounts(model.issues)}`);
  if (model.locked) parts.push('Locked');
  return `${parts.join('. ')}.`;
}

/** XP gained as the column shows it: `+450`; nothing gained is `0`. */
export function formatXpGained(value: number): string {
  return value > 0 ? `+${formatInteger(value)}` : formatInteger(value);
}

/** The estimate cell's tooltip: all three estimates, short, and what they read. */
function estimateTitle(model: StepRowModel): string {
  const short = (readout: Readout<number>, format: (value: number) => string): string =>
    readout.value === null
      ? '?'
      : `${readout.lowerBound ? '≥' : readout.upperBound ? '≤' : ''}${format(readout.value)}${readout.assumed ? ' ≈' : ''}${readout.eraFallback ? ' E' : ''}`;
  const parts = [
    `Level after ${short(model.projectedLevel, formatLevel)}`,
    `XP ${short(model.xpGained, formatXpGained)}`,
    `Time ${short(model.duration, formatDuration)}${model.pending === null ? '' : ` (${PENDING_TITLE_WORDS[model.pending]})`}`,
  ];
  const assumptions = model.assumptions === null ? '' : `. This step reads ${model.assumptions}`;
  return `${parts.join(' · ')}${assumptions}`;
}

/**
 * The right-hand estimate cell: the chosen estimate with its markers, and, beside a step time that
 * is provisional, the pending hourglass. The level and XP columns never carry it: they do not wait
 * for walking paths (the row's name still says the travel time is pending).
 */
function EstimateCell({ model, column }: { readonly model: StepRowModel; readonly column: EstimateColumn }) {
  const detail = model.assumptions === null ? undefined : `this step reads ${model.assumptions}`;
  return (
    <span className="frl-steprow__estimate" data-column={column} title={estimateTitle(model)}>
      {column === 'time' && model.pending !== null && (
        <PendingMarker silent detail={PENDING_TRAVEL_TEXTS[model.pending]} className="frl-steprow__pending" />
      )}
      {column === 'level' && <ReadoutValue readout={model.projectedLevel} format={formatLevel} compactMarkers />}
      {column === 'xp' && (
        <ReadoutValue readout={model.xpGained} format={formatXpGained} formatLong={xpWords} compactMarkers assumptionDetail={detail} />
      )}
      {column === 'time' && (
        <ReadoutValue
          readout={model.duration}
          format={formatDuration}
          formatLong={formatDurationLong}
          compactMarkers
          assumptionDetail={detail}
        />
      )}
    </span>
  );
}

interface RowActionProps {
  readonly icon: IconName;
  /** Tooltip text; the same action is named in the row's keys and the route toolbar. */
  readonly label: string;
  readonly shortcut: string;
  /** `data-action`, for tests and styling. */
  readonly action: 'duplicate' | 'delete' | 'lock';
  /** Omit to show the affordance disabled. */
  readonly onActivate?: (() => void) | undefined;
  readonly pressed?: boolean | undefined;
}

/**
 * A pointer-only affordance inside a row (duplicate, delete, lock). Not a button: the row is an
 * `option`, whose children are presentational, so a focusable control inside it would be hidden
 * from some screen readers and reported by automated checks (nested-interactive). It is a span,
 * hidden from assistive technology and never focusable; every action also has a list key and a
 * toolbar button (docs/UI.md §8). Pressing it keeps focus on the list and does not select the row.
 */
function RowAction({ icon, label, shortcut, action, onActivate, pressed = false }: RowActionProps) {
  return (
    <span
      aria-hidden="true"
      title={`${label} (${shortcut})`}
      data-action={action}
      className={cx('frl-row__action', pressed && 'is-pressed', onActivate === undefined && 'is-disabled')}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault();
      }}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onActivate?.();
      }}
      onDoubleClick={(event: MouseEvent) => {
        event.stopPropagation();
      }}
    >
      <Icon name={icon} size={14} />
    </span>
  );
}

function RowFrame({
  id,
  selected,
  active,
  dragging = false,
  posInSet,
  setSize,
  style,
  onClick,
  onDoubleClick,
  onMouseEnter,
  onHandlePointerDown,
  label,
  className,
  children,
  data,
}: RowFrameProps & {
  readonly label: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly data: Readonly<Record<`data-${string}`, string>>;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-label={label}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      className={cx('frl-row', className, selected && 'is-selected', active && 'is-active', dragging && 'is-dragging')}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
      {...data}
    >
      {onHandlePointerDown === undefined ? (
        <span className="frl-row__handle frl-row__handle--none" aria-hidden="true" />
      ) : (
        <span
          className="frl-row__handle"
          aria-hidden="true"
          title="Drag to reorder (keyboard: Alt+↑ / Alt+↓)"
          onPointerDown={onHandlePointerDown}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon name="grip" size={14} />
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * One route step on one 28px line: number, step glyph, title, quest level and provenance, issue
 * marker, one estimate (level after, XP or time, with the pending hourglass while a walking path
 * is computed), lock toggle; duplicate and delete appear on hover or when active.
 */
export function StepRow({ model, groupLabel = null, estimateColumn = 'level', readOnly = false, onToggleLock, onDuplicate, onDelete, ...frame }: StepRowProps) {
  const worst = worstSeverity(model.issues);
  const issueTotal = totalIssues(model.issues);
  const quest = model.quest;
  return (
    <RowFrame
      {...frame}
      onHandlePointerDown={readOnly ? undefined : frame.onHandlePointerDown}
      label={describeStepRow(model, groupLabel)}
      className={cx('frl-steprow', model.locked && 'is-locked', model.pending !== null && 'is-pending')}
      data={{ 'data-row-type': 'step', 'data-step-kind': model.kind }}
    >
      <span className="frl-steprow__number frl-num" aria-hidden="true">
        {model.number}
      </span>
      <StepTypeGlyph kind={model.kind} className="frl-steprow__glyph" />
      <span className="frl-steprow__title" title={model.detail === null ? model.title : `${model.title} · ${model.detail}`}>
        {model.title}
        {model.detail !== null && <span className="frl-steprow__detail"> {model.detail}</span>}
      </span>
      {!readOnly && (onDuplicate !== undefined || onDelete !== undefined) && (
        <span className="frl-steprow__actions">
          {onDuplicate !== undefined && (
            <RowAction icon="duplicate" label="Duplicate step" shortcut="Ctrl+D" action="duplicate" onActivate={onDuplicate} />
          )}
          {onDelete !== undefined && <RowAction icon="delete" label="Delete step" shortcut="Delete" action="delete" onActivate={onDelete} />}
        </span>
      )}
      {quest !== null && quest.provenance.claim !== 'unknown' && (
        <ProvenanceBadge provenance={quest.provenance} className="frl-steprow__provenance" />
      )}
      {quest !== null && (
        <DifficultyLabel
          level={quest.level}
          difficulty={quest.difficulty}
          uncertain={quest.uncertain}
          className="frl-steprow__difficulty"
        />
      )}
      {worst !== null && (
        <span className="frl-steprow__issues" title={`Issues: ${describeIssueCounts(model.issues)}`} data-severity={worst}>
          <SeverityIcon severity={worst} labelled={false} size={12} />
          <span className="frl-num">{issueTotal}</span>
        </span>
      )}
      <EstimateCell model={model} column={estimateColumn} />
      <span className="frl-steprow__lock">
        {readOnly ? (
          model.locked && <Icon name="lock" size={14} label="Locked" />
        ) : (
          <RowAction
            icon={model.locked ? 'lock' : 'unlock'}
            label={model.locked ? 'Unlock step' : 'Lock step'}
            shortcut="L"
            action="lock"
            pressed={model.locked}
            onActivate={onToggleLock}
          />
        )}
      </span>
    </RowFrame>
  );
}

export interface GroupRowProps extends RowFrameProps {
  readonly model: GroupRowModel;
}

/** A group header: the steps an imported RXP step lowered to. */
export function GroupRow({ model, ...frame }: GroupRowProps) {
  const count = `${String(model.stepCount)} ${model.stepCount === 1 ? 'step' : 'steps'}`;
  return (
    <RowFrame
      {...frame}
      label={`Group: ${model.label}, ${count}.`}
      className="frl-grouprow"
      data={{ 'data-row-type': 'group' }}
    >
      <span className="frl-grouprow__label" title={model.label}>
        {model.label}
      </span>
      <span className="frl-grouprow__count frl-num">{count}</span>
    </RowFrame>
  );
}
