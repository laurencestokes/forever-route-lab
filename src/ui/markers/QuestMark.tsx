import { memo } from 'react';
import {
  COLOUR_MIN_SHAPE_PX,
  DUNGEON_GLYPH,
  type GlyphPath,
  type MarkDifficulty,
  type MarkState,
  markColour,
  QUEST_GLYPH,
  resolveMarkLook,
  TURN_IN_GLYPH,
} from '../../app/map-exports';
import type { Difficulty } from '../../rules/difficulty';
import { cx } from '../lib/cx';
import './markers.css';

/*
 * The route rows' and quest lists' quest mark (docs/research/ui-refresh.md §5.1, step UR.2): a disc
 * with our own "!" or "?". Its glyph paths and its state table are the one set the map's pins draw
 * (src/map/marks.ts, map-presentation.md §25.2.2 and §25.2.3), read through app/map-exports as the
 * same objects, never copies. It is built on DifficultyLabel's rating: the disc takes the quest's
 * difficulty colour through the reserved --frl-difficulty-* tokens (markers.css), the only other
 * reader of them (tests/ui-tokens.test.ts holds the allowlist).
 *
 * - **Filled** (a state with something to take: available, may be available, low level, ready): the
 *   disc takes the difficulty colour, radius 10 in the 22-unit box, with a 1.5 keyline and the glyph
 *   in the dark difficulty well (D-048, review UO-01). The glyph is the shared 24-unit path drawn at
 *   0.70 (the reviewed mock's `scale(0.7)`). An unknown difficulty takes the neutral
 *   --frl-difficulty-unknown, never a difficulty colour.
 * - **Hollow** (nothing to take yet: locked, unlocks soon, in progress, record unknown): a
 *   --frl-border-strong ring and an ink glyph; the row's own background shows through.
 * - **Edge:** "not sure" (may be available, record unknown) is dashed: a dashed ring outside a filled
 *   disc, or the hollow ring itself dashed.
 * - **Badges** take the map's slots (BADGE_SLOT_OF): top left the dungeon-quest arch, top right the
 *   state (the lock, the level it unlocks at, the progress pie from 12 o'clock clockwise, a dashed
 *   empty pie when the record is unknown).
 *
 * D-041 G as D-047 words it: the colour appears only on a shape of 11px or more, the disc here (22px,
 * or 18px in one-line rows, so always), and always with the pips beside it: the caller draws the
 * quest's `DifficultyLabel` chip next to a coloured mark (`questMarkColour` says when). The mark is
 * decorative (`aria-hidden`); the row's or list item's name says the state in words.
 */

export type QuestMarkState = Extract<MarkState, 'available' | 'uncertain' | 'locked' | 'unlocks-soon' | 'low-level' | 'ready' | 'in-progress' | 'record-unknown'>;

/** The quest-mark states in the table's order (map-presentation.md §25.2.3). */
export const QUEST_MARK_STATE_ORDER: readonly QuestMarkState[] = ['available', 'uncertain', 'locked', 'unlocks-soon', 'low-level', 'ready', 'in-progress', 'record-unknown'];

export type QuestMarkSize = 'md' | 'compact';

/** The disc's diameter in CSS pixels: --frl-mark-size and --frl-mark-size-compact (tokens.css). */
export const QUEST_MARK_PX: Readonly<Record<QuestMarkSize, number>> = { md: 22, compact: 18 };

/** The paths a mark draws, by glyph: the marks module's own objects (one path set). */
export const QUEST_MARK_GLYPHS: Readonly<Record<'quest' | 'turn-in', GlyphPath>> = { quest: QUEST_GLYPH, 'turn-in': TURN_IN_GLYPH };

/** The mark's box: 22 units, drawn at 22px or 18px. */
const BOX = 22;
const CENTRE = BOX / 2;
/** The glyph's 24-unit box drawn at 0.70, centred: 16.8 units from 2.6. */
const GLYPH_SCALE = 0.7;
const GLYPH_OFFSET = (BOX - 24 * GLYPH_SCALE) / 2;
/** Badge discs (radius 4.6) centred on the rim's 45° slots, as the reviewed mock places them. */
const BADGE_RADIUS = 4.6;
const BADGE_CENTRES = { tl: { x: 3.8, y: 3.8 }, tr: { x: 18.2, y: 3.8 } } as const;
const PIE_RADIUS = 2.9;

/**
 * The difficulty a mark shows, or null for none: `markColour` of the marks module on the disc's
 * size. A coloured mark always has the pips beside it (the caller's chip), so colour never stands
 * alone; locked, unlocks-soon, in-progress and record-unknown marks show none.
 */
export function questMarkColour(state: QuestMarkState, difficulty: Difficulty | null, size: QuestMarkSize = 'md'): MarkDifficulty | null {
  return markColour(state, difficulty, QUEST_MARK_PX[size])?.difficulty ?? null;
}

/** A path coordinate, to 2 decimals at most (so 3.8 − 0.9 reads 2.9). */
const num = (value: number): string => String(Math.round(value * 100) / 100);

/** A pie wedge of `fraction` (0 to 1) from 12 o'clock, clockwise, as a path; null for none, a circle for all. */
function pieWedge(x0: number, y0: number, r: number, fraction: number): string | null {
  if (!(fraction > 0)) return null;
  if (fraction >= 1) return `M${num(x0)} ${num(y0 - r)}a${num(r)} ${num(r)} 0 1 1 0 ${num(2 * r)}a${num(r)} ${num(r)} 0 1 1 0 ${num(-2 * r)}z`;
  const angle = -Math.PI / 2 + fraction * 2 * Math.PI;
  return `M${num(x0)} ${num(y0)}V${num(y0 - r)}A${num(r)} ${num(r)} 0 ${fraction > 0.5 ? 1 : 0} 1 ${num(x0 + r * Math.cos(angle))} ${num(y0 + r * Math.sin(angle))}z`;
}

function GlyphParts({ glyph, className }: { readonly glyph: GlyphPath; readonly className: string }) {
  return (
    <g className={className}>
      {glyph.map((part) =>
        part.mode === 'stroke' ? (
          <path key={part.d} d={part.d} className="frl-quest-mark__stroke" fill="none" strokeWidth={part.width} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={part.d} d={part.d} className="frl-quest-mark__fill" />
        ),
      )}
    </g>
  );
}

export interface QuestMarkProps {
  readonly state: QuestMarkState;
  /** The quest's difficulty at the step (DifficultyLabel's rating); null when it cannot be worked out. */
  readonly difficulty: Difficulty | null;
  /** 22px (`md`, two-line rows and lists) or 18px (`compact`, one-line rows). */
  readonly size?: QuestMarkSize | undefined;
  /** In progress: objectives done of the total; the pie is empty while nothing is done or the total is unknown. */
  readonly progress?: { readonly done: number; readonly total: number | null } | null | undefined;
  /** Unlocks soon: the level it unlocks at, in the badge ("?" when unknown). */
  readonly unlockLevel?: number | null | undefined;
  /** The quest's objectives are inside a dungeon: the arch badge, top left. */
  readonly dungeonQuest?: boolean | undefined;
  /**
   * The glyph, when the row's verb decides it: a turn-in step that is locked or "may be" keeps its
   * "?" (the table's locked and uncertain states are drawn with the "!" of an accept). Omitted: the
   * state's own glyph.
   */
  readonly glyph?: 'quest' | 'turn-in' | undefined;
  readonly className?: string | undefined;
}

/** A quest's "!" or "?" in a row or a quest list, in its state (see the file comment). */
export const QuestMark = memo(function QuestMark({ state, difficulty, size = 'md', progress = null, unlockLevel = null, dungeonQuest = false, glyph: glyphName, className }: QuestMarkProps) {
  const look = resolveMarkLook(state, { dungeonQuest });
  const filled = look.colour !== 'none';
  const colour = filled ? questMarkColour(state, difficulty, size) : null;
  const dashed = look.edge === 'dashed';
  const shown = glyphName ?? (look.glyph === 'turn-in' ? 'turn-in' : 'quest');
  const glyph = shown === 'turn-in' ? TURN_IN_GLYPH : QUEST_GLYPH;
  const fraction = progress === null || progress.total === null || progress.total <= 0 ? 0 : Math.min(1, Math.max(0, progress.done / progress.total));
  return (
    <svg
      className={cx(
        'frl-quest-mark',
        `frl-quest-mark--${size}`,
        filled ? 'is-filled' : 'is-hollow',
        dashed && 'is-uncertain',
        filled && `frl-quest-mark--${colour ?? 'unknown'}`,
        className,
      )}
      viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
      width={QUEST_MARK_PX[size]}
      height={QUEST_MARK_PX[size]}
      aria-hidden="true"
      focusable="false"
      data-state={state}
      data-glyph={shown}
      data-colour={filled ? (colour ?? 'unknown') : 'none'}
    >
      {filled ? (
        <>
          <circle className="frl-quest-mark__disc" cx={CENTRE} cy={CENTRE} r={10} />
          {dashed && <circle className="frl-quest-mark__ring" cx={CENTRE} cy={CENTRE} r={12.6} />}
        </>
      ) : (
        <circle className="frl-quest-mark__disc" cx={CENTRE} cy={CENTRE} r={10.2} />
      )}
      <g transform={`translate(${String(GLYPH_OFFSET)} ${String(GLYPH_OFFSET)}) scale(${String(GLYPH_SCALE)})`}>
        <GlyphParts glyph={glyph} className="frl-quest-mark__glyph" />
      </g>
      {look.badges.map((badge) => {
        if (badge !== 'dungeon-quest' && badge !== 'lock' && badge !== 'level' && badge !== 'progress' && badge !== 'progress-unknown') return null;
        const slot = badge === 'dungeon-quest' ? BADGE_CENTRES.tl : BADGE_CENTRES.tr;
        const { x, y } = slot;
        return (
          <g key={badge} className={cx('frl-quest-mark__badge-group', `frl-quest-mark__badge-group--${badge}`)} data-badge={badge} data-slot={badge === 'dungeon-quest' ? 'tl' : 'tr'}>
            <circle className="frl-quest-mark__badge" cx={x} cy={y} r={BADGE_RADIUS} />
            {badge === 'lock' && (
              <>
                <path className="frl-quest-mark__lock" d={`M${num(x - 1.25)} ${num(y)}V${num(y - 0.9)}A1.25 1.25 0 0 1 ${num(x + 1.25)} ${num(y - 0.9)}V${num(y)}`} />
                <rect className="frl-quest-mark__badge-ink" x={x - 2.1} y={y - 0.2} width={4.2} height={3} rx={0.6} />
              </>
            )}
            {badge === 'level' && (
              <text className="frl-quest-mark__level" x={x} y={y + 2.1} textAnchor="middle">
                {unlockLevel === null ? '?' : String(unlockLevel)}
              </text>
            )}
            {(badge === 'progress' || badge === 'progress-unknown') && (
              <>
                <circle className={cx('frl-quest-mark__pie-rim', badge === 'progress-unknown' && 'is-unknown')} cx={x} cy={y} r={PIE_RADIUS} />
                {badge === 'progress' && fraction > 0 && <path className="frl-quest-mark__badge-ink frl-quest-mark__pie" d={pieWedge(x, y, PIE_RADIUS, fraction) ?? ''} data-fraction={fraction.toFixed(3)} />}
              </>
            )}
            {badge === 'dungeon-quest' && (
              <g transform={`translate(${String(x - 3)} ${String(y - 3)}) scale(0.25)`}>
                <GlyphParts glyph={DUNGEON_GLYPH} className="frl-quest-mark__arch" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
});

/** The smallest disc that may carry a colour (D-041 G, D-047): both row sizes clear it. */
export const QUEST_MARK_COLOUR_MIN_PX = COLOUR_MIN_SHAPE_PX;
