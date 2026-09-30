import { memo } from 'react';
import type { StepKind } from '../../domain/route';
import { cx } from '../lib/cx';
import type { QuestMarkSize } from './QuestMark';
import { StepTypeGlyph } from './StepTypeGlyph';
import './markers.css';

/** The step kinds a neutral disc draws: every kind but the quest marks' accept and turn-in (`QuestMark`). */
export type StepMarkKind = Exclude<StepKind, 'accept' | 'turnin'>;

/**
 * The route rows' mark for the other step kinds (docs/research/ui-refresh.md §5.1, step UR.2): a
 * neutral disc, the tile with a hairline edge, holding today's `StepTypeGlyph` in the muted ink
 * (complete, travel, grind, hearth, flight, train, vendor, note, abandon). Kinds are told apart by
 * glyph alone, never by a hue: WoWF-QRP's kind colours sit within 17° of a difficulty hue, the
 * provenance cyan or the warning violet. The map's flight point, vendor and innkeeper pins are the
 * filled forms of the plane, bag and hearth house here (one symbol per concept, review UR-12).
 * Decorative (`aria-hidden`): the row's name says the kind.
 */
export const StepMark = memo(function StepMark({ kind, size = 'md', className }: { readonly kind: StepMarkKind; readonly size?: QuestMarkSize | undefined; readonly className?: string | undefined }) {
  return (
    <span className={cx('frl-step-mark', `frl-step-mark--${size}`, className)} aria-hidden="true" data-step-kind={kind}>
      <StepTypeGlyph kind={kind} labelled={false} size={size === 'compact' ? 12 : 14} />
    </span>
  );
});
