import { cx } from '../lib/cx';
import { formatInteger, formatPercent } from '../lib/format';
import { AssumedMarker } from '../markers/AssumedMarker';
import './StatusBar.css';

export interface XpBarProps {
  /** Level; null when unknown. */
  readonly level: number | null;
  /** XP into the level; null when unknown. */
  readonly xp: number | null;
  /** XP from this level to the next; null when unknown or at the level cap. */
  readonly xpToNext: number | null;
  /** The level cap is reached: the bar is full and says so. */
  readonly atCap?: boolean | undefined;
  /**
   * Level and XP are minimums: XP from some quests is unknown and was not counted. The bar shows
   * a marker at the known amount and hatching beyond it, and the text reads "≥".
   */
  readonly lowerBound: boolean;
  /** Why the value is a lower bound, e.g. `'3 quests with unknown XP are not counted'`. */
  readonly lowerBoundReason?: string | undefined;
  readonly assumed?: boolean | undefined;
  readonly eraFallback?: boolean | undefined;
  /** Why level or XP is unknown. */
  readonly unknownReason?: string | undefined;
  /** Accessible name of the bar. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

export interface XpBarState {
  readonly kind: 'unknown' | 'cap' | 'progress';
  /** 0..1 fill; 0 when unknown. */
  readonly fraction: number;
  /** Short visible text after the bar. */
  readonly text: string;
  /** Full sentence for `aria-valuetext` and the tooltip. */
  readonly valueText: string;
}

/** The bar's state, separated from rendering so the arithmetic is testable. */
export function xpBarState(props: Pick<XpBarProps, 'level' | 'xp' | 'xpToNext' | 'atCap' | 'lowerBound' | 'lowerBoundReason' | 'unknownReason'>): XpBarState {
  const { level, xp, xpToNext, atCap = false, lowerBound } = props;
  const atLeast = lowerBound ? 'at least ' : '';
  const bound = lowerBound ? '≥' : '';
  const reason = lowerBound && props.lowerBoundReason !== undefined ? ` (lower bound: ${props.lowerBoundReason})` : lowerBound ? ' (lower bound)' : '';
  if (level === null) {
    const why = props.unknownReason === undefined ? '' : `: ${props.unknownReason}`;
    return { kind: 'unknown', fraction: 0, text: 'XP ?', valueText: `Level unknown${why}` };
  }
  if (atCap) {
    return {
      kind: 'cap',
      fraction: 1,
      text: 'Max level',
      valueText: `${lowerBound ? 'At least level' : 'Level'} ${String(level)}, the level cap${reason}`,
    };
  }
  if (xp === null || xpToNext === null || xpToNext <= 0) {
    const why = props.unknownReason === undefined ? '' : `: ${props.unknownReason}`;
    return {
      kind: 'unknown',
      fraction: 0,
      text: 'XP ?',
      valueText: `${lowerBound ? 'At least level' : 'Level'} ${String(level)}, XP unknown${why}`,
    };
  }
  const fraction = Math.min(1, Math.max(0, xp / xpToNext));
  return {
    kind: 'progress',
    fraction,
    text: `${bound}${formatInteger(xp)} / ${formatInteger(xpToNext)} XP`,
    valueText: `${lowerBound ? 'At least level' : 'Level'} ${String(level)}, ${atLeast}${formatInteger(xp)} of ${formatInteger(xpToNext)} XP (${formatPercent(fraction)})${reason}`,
  };
}

/** Level and XP progress for the status bar, with the lower-bound and assumed states. */
export function XpBar(props: XpBarProps) {
  const { level, xpToNext, lowerBound, assumed = false, eraFallback = false, label = 'Projected level', className } = props;
  const state = xpBarState(props);
  const percent = `${String(state.fraction * 100)}%`;
  const progressAttributes =
    state.kind === 'progress' && xpToNext !== null && props.xp !== null
      ? { 'aria-valuemin': 0, 'aria-valuemax': xpToNext, 'aria-valuenow': Math.min(props.xp, xpToNext) }
      : state.kind === 'cap'
        ? { 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 1 }
        : {};
  return (
    <div
      className={cx('frl-xpbar', `frl-xpbar--${state.kind}`, lowerBound && 'is-lower-bound', className)}
      title={state.valueText}
      data-state={lowerBound ? 'lower-bound' : state.kind}
    >
      <span className="frl-xpbar__level frl-num" aria-hidden="true">
        {lowerBound && <span className="frl-xpbar__bound">≥</span>}
        Lv {level ?? '?'}
      </span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={state.valueText}
        {...progressAttributes}
        className="frl-xpbar__track"
      >
        <div className="frl-xpbar__fill" style={{ width: percent }} />
        {lowerBound && state.kind === 'progress' && (
          <>
            <div className="frl-xpbar__beyond" style={{ left: percent }} />
            <div className="frl-xpbar__marker" style={{ left: percent }} />
          </>
        )}
      </div>
      <span className="frl-xpbar__text frl-num" aria-hidden="true">
        {state.text}
      </span>
      {assumed && <AssumedMarker reason="assumption" />}
      {eraFallback && <AssumedMarker reason="era-fallback" />}
    </div>
  );
}
