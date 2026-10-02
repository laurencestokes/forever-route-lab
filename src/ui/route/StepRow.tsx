import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatDuration, formatDurationLong, formatInteger, formatLevel } from '../lib/format';
import { describeIssueCounts, SEVERITY_LABELS, totalIssues, worstSeverity } from '../lib/issues';
import type { Readout } from '../lib/readout';
import { Icon, type IconName } from '../primitives/Icon';
import { DifficultyLabel, DifficultyPips, describeDifficulty } from '../markers/DifficultyLabel';
import { PENDING_TRAVEL_TEXTS, PendingMarker, type PendingTravel } from '../markers/PendingMarker';
import { ProvenanceBadge } from '../markers/ProvenanceBadge';
import { QuestMark } from '../markers/QuestMark';
import { ReadoutValue } from '../markers/ReadoutValue';
import { SeverityIcon } from '../markers/SeverityIcon';
import { StepMark } from '../markers/StepMark';
import { STEP_KIND_LABELS } from '../markers/StepTypeGlyph';
import { describeForeverProvenance } from '../markers/provenance';
import type { EstimateColumn, GroupRowModel, RowMarkState, StepRowModel, TopNumber } from './rows';
import type { RowDensity } from './virtual';
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
  /** Two lines of 44px (the default; B+, D-051) or one line of 28px (the compact View choice). */
  readonly density?: RowDensity | undefined;
  readonly onClick?: ((event: MouseEvent<HTMLDivElement>) => void) | undefined;
  readonly onDoubleClick?: ((event: MouseEvent<HTMLDivElement>) => void) | undefined;
  /** The pointer entered the row (the map highlights its step's marker). */
  readonly onMouseEnter?: (() => void) | undefined;
  /** Pointer down on the drag handle (the step number). Omit for no drag (read-only lists). */
  readonly onHandlePointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
}

export interface StepRowProps extends RowFrameProps {
  readonly model: StepRowModel;
  /** Label of the group header this step sits under, or null; spoken as "in group …". */
  readonly groupLabel?: string | null | undefined;
  /** One-line rows: which estimate the right-hand column shows (default the level after the step); the name says all three. */
  readonly estimateColumn?: EstimateColumn | undefined;
  /** Two-line rows: the top number over the level after (default the XP gained). */
  readonly topNumber?: TopNumber | undefined;
  /** Hides the editing affordances (lock, duplicate, delete); a locked step still shows its lock. */
  readonly readOnly?: boolean | undefined;
  readonly onToggleLock?: (() => void) | undefined;
  readonly onDuplicate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  /**
   * Two-line rows: the row is drawn grown (D-051): the issue in full on lines of its own, the row
   * actions below line 2. The list grows its active step row unless the list is too short for it
   * (`activeRowCanGrow`); defaults to `active`.
   */
  readonly grown?: boolean | undefined;
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

/** A quest mark's state in words, by the step's kind (the mark itself is decorative). */
const MARK_WORDS: Readonly<Record<'accept' | 'turnin', Readonly<Partial<Record<RowMarkState, string>>>>> = {
  accept: { available: 'Available', uncertain: 'May be available', locked: 'Cannot be accepted here' },
  turnin: { ready: 'Ready to turn in', uncertain: 'May be ready to turn in', locked: 'Cannot be turned in here', 'record-unknown': 'Readiness unknown' },
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
 * simulated yet) the reason is said once. A level-up adds "reaches level N" to the level.
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
  const up = model.levelUp === null ? '' : `, reaches level ${String(model.levelUp)}`;
  return [
    `${readoutWords('Level after step', level, formatLevel)}${up}`,
    readoutWords('XP gained', xp, xpWords),
    model.pending === null ? time : `${time}, pending: ${PENDING_ROW_WORDS[model.pending]}`,
  ];
}

/** Sentences joined with full stops, never doubling one where a part already ends in one (`ours.md` §5). */
function sentences(parts: readonly string[]): string {
  return `${parts.map((part) => part.replace(/\.+$/, '')).join('. ')}.`;
}

/** " (1 of 2)" after a title in a chain, as the name and the tooltip say it; nothing for none. */
const chainWords = (model: StepRowModel): string => (model.chain === null ? '' : ` (${String(model.chain.index)} of ${String(model.chain.length)})`);

/**
 * The accessible name of a step row; the row's children are presentational (role option). It says
 * the whole row in a fixed order: the number, the kind and title with the chain position and where,
 * the group, the mark's state, the difficulty and provenance, every estimate (whichever the row
 * shows) with a level-up, the issues by severity and the worst one's words (line 2 shows them), and
 * the lock.
 */
export function describeStepRow(model: StepRowModel, groupLabel: string | null = null): string {
  const parts: string[] = [];
  const chain = chainWords(model);
  const detail = model.detail === null ? '' : `, ${model.detail.replaceAll(' · ', ', ')}`;
  const group = groupLabel === null ? '' : `, in group ${groupLabel}`;
  parts.push(`${String(model.number)}. ${STEP_KIND_LABELS[model.kind]}: ${model.title}${chain}${detail}${group}`);
  const markWords = model.mark === null || (model.kind !== 'accept' && model.kind !== 'turnin') ? undefined : MARK_WORDS[model.kind][model.mark];
  if (markWords !== undefined) parts.push(markWords);
  if (model.quest !== null) {
    parts.push(describeDifficulty(model.quest.level, model.quest.difficulty, model.quest.uncertain));
    if (model.quest.provenance.claim !== 'unknown') parts.push(describeForeverProvenance(model.quest.provenance));
  }
  parts.push(...estimateWords(model));
  if (totalIssues(model.issues) > 0) parts.push(`Issues: ${describeIssueCounts(model.issues)}`);
  if (model.issue !== null) parts.push(`${SEVERITY_LABELS[model.issue.severity]}: ${model.issue.message}`);
  if (model.locked) parts.push('Locked');
  return sentences(parts);
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
    `Level after ${short(model.projectedLevel, formatLevel)}${model.levelUp === null ? '' : ` (reaches level ${String(model.levelUp)})`}`,
    `XP ${short(model.xpGained, formatXpGained)}`,
    `Time ${short(model.duration, formatDuration)}${model.pending === null ? '' : ` (${PENDING_TITLE_WORDS[model.pending]})`}`,
  ];
  const assumptions = model.assumptions === null ? '' : `. This step reads ${model.assumptions}`;
  return `${parts.join(' · ')}${assumptions}`;
}

/** The step time with its markers and, while it is provisional, the hourglass in its left gutter. */
function TimeValue({ model, detail }: { readonly model: StepRowModel; readonly detail: string | undefined }) {
  return (
    <>
      {model.pending !== null && <PendingMarker silent detail={PENDING_TRAVEL_TEXTS[model.pending]} className="frl-steprow__pending" />}
      <ReadoutValue readout={model.duration} format={formatDuration} formatLong={formatDurationLong} compactMarkers assumptionDetail={detail} />
    </>
  );
}

/** XP gained with its markers: a gain in bold, a known zero muted and regular (review UO-14). */
function XpValue({ model, detail }: { readonly model: StepRowModel; readonly detail: string | undefined }) {
  const zero = model.xpGained.value === 0 && !model.xpGained.lowerBound;
  return (
    <span className={cx('frl-steprow__xp', zero && 'is-zero')}>
      <ReadoutValue readout={model.xpGained} format={formatXpGained} formatLong={xpWords} compactMarkers assumptionDetail={detail} />
    </span>
  );
}

/** The level after the step, with "↑" in bold where it crosses a whole level (ui-refresh.md §5.3). */
function LevelValue({ model }: { readonly model: StepRowModel }) {
  return (
    <span className={cx('frl-steprow__level', model.levelUp !== null && 'is-up')}>
      {model.levelUp !== null && (
        <span className="frl-steprow__up" aria-hidden="true">
          ↑
        </span>
      )}
      <ReadoutValue readout={model.projectedLevel} format={formatLevel} compactMarkers />
    </span>
  );
}

/**
 * One-line rows' estimate cell: the chosen estimate with its markers and, beside a step time that is
 * provisional, the pending hourglass. The level and XP columns never carry it: they do not wait for
 * walking paths (the row's name still says the travel time is pending).
 */
function EstimateCell({ model, column }: { readonly model: StepRowModel; readonly column: EstimateColumn }) {
  const detail = model.assumptions === null ? undefined : `this step reads ${model.assumptions}`;
  return (
    <span className="frl-steprow__estimate" data-column={column} title={estimateTitle(model)}>
      {column === 'level' && <LevelValue model={model} />}
      {column === 'xp' && <XpValue model={model} detail={detail} />}
      {column === 'time' && <TimeValue model={model} detail={detail} />}
    </span>
  );
}

/** Two-line rows' estimates: the top number (XP gained or the step time) over the level after. */
function EstimatePair({ model, top }: { readonly model: StepRowModel; readonly top: TopNumber }) {
  const detail = model.assumptions === null ? undefined : `this step reads ${model.assumptions}`;
  return (
    <span className="frl-steprow__estimates" title={estimateTitle(model)}>
      <span className="frl-steprow__estimate frl-steprow__top" data-column={top}>
        {top === 'xp' ? <XpValue model={model} detail={detail} /> : <TimeValue model={model} detail={detail} />}
      </span>
      <span className="frl-steprow__estimate frl-steprow__bottom" data-column="level">
        <LevelValue model={model} />
      </span>
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

/** The drag handle's pointer wiring: pressing it drags, never selects or focuses. */
function handleProps(onHandlePointerDown: ((event: PointerEvent<HTMLElement>) => void) | undefined) {
  return onHandlePointerDown === undefined
    ? {}
    : {
        title: 'Drag to reorder (keyboard: Alt+↑ / Alt+↓)',
        onPointerDown: onHandlePointerDown,
        onMouseDown: (event: MouseEvent) => {
          event.preventDefault();
        },
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
        },
      };
}

function RowFrame({
  id,
  selected,
  active,
  dragging = false,
  posInSet,
  setSize,
  style,
  density = 'two-line',
  onClick,
  onDoubleClick,
  onMouseEnter,
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
      className={cx('frl-row', `frl-row--${density}`, className, selected && 'is-selected', active && 'is-active', dragging && 'is-dragging')}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
      {...data}
    >
      {children}
    </div>
  );
}

/** The row's mark: the quest's "!" or "?" in its state, or the kind's neutral disc (ui-refresh.md §5.1, §5.2). */
function RowMark({ model, compact }: { readonly model: StepRowModel; readonly compact: boolean }) {
  const size = compact ? 'compact' : 'md';
  if ((model.kind === 'accept' || model.kind === 'turnin') && model.mark !== null) {
    return (
      <QuestMark
        state={model.mark}
        difficulty={model.quest?.difficulty ?? null}
        size={size}
        glyph={model.kind === 'turnin' ? 'turn-in' : 'quest'}
        className="frl-steprow__mark"
      />
    );
  }
  if (model.kind === 'accept' || model.kind === 'turnin') return null;
  return <StepMark kind={model.kind} size={size} className="frl-steprow__mark" />;
}

/** Whether the row's mark is a quest's "!" or "?", which says accept or turn in by itself (`RowMark`). */
const markSaysVerb = (model: StepRowModel): boolean => (model.kind === 'accept' || model.kind === 'turnin') && model.mark !== null;

/**
 * Line 1's title: the verb in the muted ink, then what it acts on (one ellipsis for both). `verb`
 * false leaves the verb to the mark (one-line rows, review UI-15); the tooltip and the row's name
 * keep it, with the chain position.
 */
function TitleText({ model, withDetail, verb = true }: { readonly model: StepRowModel; readonly withDetail: boolean; readonly verb?: boolean }) {
  const detail = withDetail && model.detail !== null ? model.detail : null;
  // The chain position is in every row's tooltip, as in its name, wherever line 1 has room for it or not (D-051).
  const full = `${model.verb} ${model.title}${chainWords(model)}`;
  return (
    <span className="frl-steprow__title" title={detail === null ? full : `${full} · ${detail}`}>
      {verb && (
        <>
          <span className="frl-steprow__verb">{model.verb}</span>{' '}
        </>
      )}
      {model.title}
      {detail !== null && <span className="frl-steprow__detail"> {detail}</span>}
    </span>
  );
}

/** The chain position after the title, muted: "1/2" (the name says "1 of 2"). */
function Chain({ model }: { readonly model: StepRowModel }) {
  return model.chain === null ? null : (
    <span className="frl-steprow__chain frl-num">
      {model.chain.index}/{model.chain.length}
    </span>
  );
}

/** The issue marker: the worst severity's shape and the step's issue count. */
function IssueMarker({ model }: { readonly model: StepRowModel }) {
  const worst = worstSeverity(model.issues);
  if (worst === null) return null;
  return (
    <span className="frl-steprow__issues" title={`Issues: ${describeIssueCounts(model.issues)}`} data-severity={worst}>
      <SeverityIcon severity={worst} labelled={false} size={12} />
      <span className="frl-num">{totalIssues(model.issues)}</span>
    </span>
  );
}

/**
 * One route step: two lines of 44px (the default, layout B+, D-051) or one line of 28px
 * (docs/research/ui-refresh.md §6). Two lines: the number (the drag handle); the mark, with the
 * quest's difficulty pips under it in ink; line 1 with the verb, title, provenance and lock, then the
 * chain where it fits; line 2 with "Lv n" and where the step happens, or the worst issue in words
 * (its shape drawn once); the row actions (duplicate, delete, lock) at line 2's end, shown only on
 * hover, on the selected row (one row selected) and on the active row (CSS); on the right the top
 * number (XP gained or the step time) over the level after. The active row always shows the chain on
 * line 1. It is also grown (taller; the list grows it unless the list is too short, `grown`): line 2
 * shows where whole, and the issue's words get two lines of their own below, with the row actions at
 * their end. One line: today's row with the mark, the verb, the chip and one
 * chosen estimate; duplicate and delete appear on hover or when active.
 */
export function StepRow({
  model,
  groupLabel = null,
  estimateColumn = 'level',
  topNumber = 'xp',
  readOnly = false,
  onToggleLock,
  onDuplicate,
  onDelete,
  onHandlePointerDown,
  grown: grownProp,
  ...frame
}: StepRowProps) {
  const density = frame.density ?? 'two-line';
  const quest = model.quest;
  const handle = handleProps(readOnly ? undefined : onHandlePointerDown);
  const number = (
    <span className={cx('frl-steprow__number frl-num', handle.onPointerDown !== undefined && 'is-handle')} aria-hidden="true" {...handle}>
      {model.number}
    </span>
  );
  const provenance = quest !== null && quest.provenance.claim !== 'unknown' && <ProvenanceBadge provenance={quest.provenance} className="frl-steprow__provenance" />;
  const chip = quest !== null && (
    <DifficultyLabel level={quest.level} difficulty={quest.difficulty} uncertain={quest.uncertain} className="frl-steprow__difficulty" />
  );
  const actions = !readOnly && (onDuplicate !== undefined || onDelete !== undefined || onToggleLock !== undefined) && (
    <span className="frl-steprow__actions">
      {onDuplicate !== undefined && <RowAction icon="duplicate" label="Duplicate step" shortcut="Ctrl+D" action="duplicate" onActivate={onDuplicate} />}
      {onDelete !== undefined && <RowAction icon="delete" label="Delete step" shortcut="Delete" action="delete" onActivate={onDelete} />}
      {density === 'two-line' && (
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
  );
  const grown = density === 'two-line' && (grownProp ?? frame.active);
  const className = cx('frl-steprow', model.locked && 'is-locked', model.pending !== null && 'is-pending', grown && 'is-grown');
  const data = { 'data-row-type': 'step', 'data-step-kind': model.kind };
  const label = describeStepRow(model, groupLabel);

  if (density === 'one-line') {
    return (
      <RowFrame {...frame} label={label} className={className} data={data}>
        {number}
        <RowMark model={model} compact />
        {/* The "!" or "?" says accept or turn in: one-line rows give its room to the name (review UI-15). */}
        <TitleText model={model} withDetail verb={!markSaysVerb(model)} />
        <Chain model={model} />
        {actions}
        {provenance}
        {chip}
        <IssueMarker model={model} />
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

  const issue = model.issue;
  // Line 2's place: who, then the zone, which stays when the lead gives way at rest (the active row
  // shows both whole); the coordinates are in the tooltip and the name (UI-01).
  const place = model.place ?? null;
  const detail = model.assumptions === null ? undefined : `this step reads ${model.assumptions}`;
  // "Lv n" in place of the chip (D-051): the pips are under the mark, whose colour is the difficulty's.
  const level = quest !== null && (
    <span className={cx('frl-steprow__lv frl-num', quest.uncertain && 'is-uncertain')} title={describeDifficulty(quest.level, quest.difficulty, quest.uncertain)}>
      Lv {quest.level ?? '?'}
    </span>
  );
  const where =
    model.kind === 'travel' && topNumber !== 'time' ? (
      <span className="frl-steprow__detail frl-steprow__travel-time">
        <TimeValue model={model} detail={detail} />
      </span>
    ) : (
      model.detail !== null && (
        <span className={cx('frl-steprow__detail', place !== null && 'is-place')} title={model.detail}>
          {place === null ? (
            model.detail
          ) : (
            <>
              {place.lead !== null && <span className="frl-steprow__lead">{place.lead}</span>}
              {place.lead !== null && place.zone !== null && <span className="frl-steprow__sep"> · </span>}
              {place.zone !== null && <span className="frl-steprow__zone">{place.zone}</span>}
            </>
          )}
        </span>
      )
    );
  // At rest the worst issue takes line 2 in place of where; the grown (active) row keeps where on
  // line 2 and gives the issue its own lines below. Its shape is drawn once, either way (D-051); its
  // tooltip has the step's issue counts, either way.
  const issueTitle = issue === null ? undefined : `${issue.message}. Issues: ${describeIssueCounts(model.issues)}`;
  const issueWords = issue !== null && (
    <>
      <SeverityIcon severity={issue.severity} labelled={false} size={12} />
      <span className="frl-steprow__issue-text">{issue.short ?? issue.message}</span>
    </>
  );
  const second = issue !== null && !grown ? (
    <span className="frl-steprow__issue" data-severity={issue.severity} title={issueTitle}>
      {issueWords}
    </span>
  ) : (
    where
  );
  return (
    <RowFrame {...frame} label={label} className={className} data={data}>
      {number}
      <span className="frl-steprow__markbox">
        <RowMark model={model} compact={false} />
        {quest !== null && <DifficultyPips difficulty={quest.difficulty} className="frl-steprow__pips" />}
      </span>
      <span className="frl-steprow__text">
        <span className="frl-steprow__line1">
          {/* The title, provenance and lock never part; the chain wraps out of sight where it does not fit (not on the active row). */}
          <span className="frl-steprow__head">
            <TitleText model={model} withDetail={false} />
            {provenance}
            {model.locked && (
              <span className="frl-steprow__locked" title="Locked">
                <Icon name="lock" size={14} />
              </span>
            )}
          </span>
          <Chain model={model} />
        </span>
        <span className="frl-steprow__line2">
          {level}
          {level !== false && second !== false && second !== null && <span className="frl-steprow__sep">·</span>}
          {second}
          {actions}
        </span>
      </span>
      <EstimatePair model={model} top={topNumber} />
      {grown && issue !== null && (
        <span className="frl-steprow__more" data-severity={issue.severity} title={issueTitle}>
          {/* Two floats keep the second line's end clear for the row actions. */}
          <span className="frl-steprow__float" />
          <span className="frl-steprow__float" />
          {issueWords}
        </span>
      )}
    </RowFrame>
  );
}

export interface GroupRowProps extends RowFrameProps {
  readonly model: GroupRowModel;
}

/** The level span of a group's steps in words and short form ("6.0-6.8"), or null before the walk. */
function spanOf(model: GroupRowModel): { readonly text: string; readonly words: string } | null {
  const span = model.levelSpan;
  if (span === null || span.from.value === null || span.to.value === null) return null;
  const bound = span.from.lowerBound || span.to.lowerBound;
  const text = `${bound ? '≥' : ''}${formatLevel(span.from.value)}-${formatLevel(span.to.value)}`;
  return { text, words: `levels after its steps ${bound ? 'at least ' : ''}${formatLevel(span.from.value)} to ${formatLevel(span.to.value)}` };
}

/** A group header: the steps an imported RXP step lowered to, as tall as the list's step rows. */
export function GroupRow({ model, onHandlePointerDown, ...frame }: GroupRowProps) {
  const count = `${String(model.stepCount)} ${model.stepCount === 1 ? 'step' : 'steps'}`;
  const span = spanOf(model);
  const handle = handleProps(onHandlePointerDown);
  const twoLine = (frame.density ?? 'two-line') === 'two-line';
  return (
    <RowFrame
      {...frame}
      label={`Group: ${model.label}, ${count}${span === null ? '' : `, ${span.words}`}.`}
      className="frl-grouprow"
      data={{ 'data-row-type': 'group' }}
    >
      <span className={cx('frl-grouprow__handle', handle.onPointerDown !== undefined && 'is-handle')} aria-hidden="true" {...handle} />
      <span className="frl-grouprow__text">
        <span className="frl-grouprow__label" title={model.label}>
          {model.label}
        </span>
        {twoLine && (
          <span className="frl-grouprow__meta frl-num">
            {count}
            {model.imported && ' · imported RXP step'}
          </span>
        )}
      </span>
      {!twoLine && <span className="frl-grouprow__count frl-num">{count}</span>}
      {span !== null && <span className="frl-grouprow__span frl-num">{span.text}</span>}
    </RowFrame>
  );
}
