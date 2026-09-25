import { DIFFICULTY_LABELS } from '../../app/rules-exports';
import type { Difficulty } from '../../rules/difficulty';
import { cx } from '../lib/cx';
import './markers.css';

/*
 * The difficulty colours themselves are CSS tokens (--frl-difficulty-*) that mirror
 * DIFFICULTY_COLORS in src/rules/difficulty.ts (tests/ui-tokens.test.ts compares them). The
 * words are the rules module's own DIFFICULTY_LABELS, which ui imports through app (ARCHITECTURE
 * §4), so they cannot drift.
 */

/**
 * Text for each difficulty: the rules module's DIFFICULTY_LABELS, not a copy.
 * @deprecated Import DIFFICULTY_LABELS from src/app/rules-exports.ts; kept for the kit's export.
 */
export const DIFFICULTY_TEXT: Readonly<Record<Difficulty, string>> = DIFFICULTY_LABELS;

/** The in-game colour name, so readers who cannot tell the hues apart can still map them. */
export const DIFFICULTY_COLOUR_NAMES: Readonly<Record<Difficulty, string>> = {
  trivial: 'grey',
  standard: 'green',
  difficult: 'yellow',
  verydifficult: 'orange',
  impossible: 'red',
};

/** 1 (trivial) to 5 (impossible): the number of filled pips. */
export const DIFFICULTY_RANK: Readonly<Record<Difficulty, 1 | 2 | 3 | 4 | 5>> = {
  trivial: 1,
  standard: 2,
  difficult: 3,
  verydifficult: 4,
  impossible: 5,
};

const PIPS = [1, 2, 3, 4, 5] as const;

/**
 * Pip geometry in whole CSS pixels, drawn with crisp edges so the five bars never blur into one
 * staircase at 1x: 2px bars, 1px gaps, heights 2 to 10px.
 */
export const PIP_WIDTH = 2;
export const PIP_GAP = 1;
export const PIP_BOX_WIDTH = PIPS.length * PIP_WIDTH + (PIPS.length - 1) * PIP_GAP;
export const PIP_BOX_HEIGHT = 10;

export interface DifficultyLabelProps {
  /** Quest level; null when unknown. */
  readonly level: number | null;
  /** Difficulty at the player's projected level; null when it cannot be computed. */
  readonly difficulty: Difficulty | null;
  /** `compact`: pips and level. `full`: adds the difficulty word. */
  readonly variant?: 'compact' | 'full' | undefined;
  /**
   * The player level behind the difficulty is a lower bound (unknown-XP quests earlier in the
   * route), so the quest may really be easier. Drawn with a dashed edge and explained in text.
   */
  readonly uncertain?: boolean | undefined;
  readonly className?: string | undefined;
}

export function describeDifficulty(level: number | null, difficulty: Difficulty | null, uncertain: boolean): string {
  const levelText = level === null ? 'Quest level unknown' : `Quest level ${String(level)}`;
  if (difficulty === null) return `${levelText}, difficulty unknown`;
  const base = `${levelText}, ${DIFFICULTY_LABELS[difficulty]} (${DIFFICULTY_COLOUR_NAMES[difficulty]})`;
  return uncertain ? `${base}, from a lower-bound level: may be easier` : base;
}

/**
 * Quest level with its difficulty. Difficulty is carried three ways: the reserved colour, the
 * number of filled pips (shape), and text (visible in `full`, tooltip and screen-reader text
 * always). The chip keeps its dark well in both themes so every difficulty colour has contrast.
 */
export function DifficultyLabel({ level, difficulty, variant = 'compact', uncertain = false, className }: DifficultyLabelProps) {
  const rank = difficulty === null ? 0 : DIFFICULTY_RANK[difficulty];
  const description = describeDifficulty(level, difficulty, uncertain);
  return (
    <span
      className={cx(
        'frl-difficulty',
        difficulty === null ? 'frl-difficulty--unknown' : `frl-difficulty--${difficulty}`,
        uncertain && 'frl-difficulty--uncertain',
        className,
      )}
      title={description}
      data-difficulty={difficulty ?? 'unknown'}
    >
      <svg
        className="frl-difficulty__pips"
        viewBox={`0 0 ${String(PIP_BOX_WIDTH)} ${String(PIP_BOX_HEIGHT)}`}
        width={PIP_BOX_WIDTH}
        height={PIP_BOX_HEIGHT}
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        {PIPS.map((pip) => (
          <rect
            key={pip}
            className={pip <= rank ? 'frl-difficulty__pip is-on' : 'frl-difficulty__pip'}
            x={(pip - 1) * (PIP_WIDTH + PIP_GAP)}
            y={PIP_BOX_HEIGHT - pip * 2}
            width={PIP_WIDTH}
            height={pip * 2}
          />
        ))}
      </svg>
      <span className="frl-difficulty__level frl-num" aria-hidden="true">
        {level === null ? '?' : level}
      </span>
      {variant === 'full' && (
        <span className="frl-difficulty__text" aria-hidden="true">
          {difficulty === null ? 'Unknown' : DIFFICULTY_LABELS[difficulty]}
        </span>
      )}
      <span className="frl-visually-hidden">{description}</span>
    </span>
  );
}
