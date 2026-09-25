import { cx } from '../lib/cx';
import { describeForeverProvenance, type ForeverProvenance } from './provenance';
import './markers.css';

export interface ProvenanceBadgeProps {
  readonly provenance: ForeverProvenance;
  /**
   * `compact` (route rows, quest lists): the glyph only, and nothing at all for `unknown`.
   * `full` (Details): glyph and text; `unknown` reads "Forever status: unknown".
   */
  readonly variant?: 'compact' | 'full' | undefined;
  readonly className?: string | undefined;
}

/**
 * Forever provenance: ◆ new in Forever, ◇ changed in Forever, in the reserved cyan. A claim the
 * user declared (rather than the dataset) gets a dashed frame and the words "user-declared".
 */
export function ProvenanceBadge({ provenance, variant = 'compact', className }: ProvenanceBadgeProps) {
  const description = describeForeverProvenance(provenance);
  if (provenance.claim === 'unknown') {
    if (variant === 'compact') return null;
    return <span className={cx('frl-provenance', 'frl-provenance--unknown', className)}>{description}</span>;
  }
  const glyph = provenance.claim === 'new' ? '◆' : '◇';
  const user = provenance.declaredBy === 'user';
  return (
    <span
      className={cx(
        'frl-provenance',
        `frl-provenance--${provenance.claim}`,
        user && 'frl-provenance--user',
        `frl-provenance--${variant}`,
        className,
      )}
      title={description}
      data-claim={provenance.claim}
      data-declared-by={provenance.declaredBy}
    >
      <span className="frl-provenance__glyph" aria-hidden="true">
        {glyph}
      </span>
      {variant === 'full' ? (
        <span className="frl-provenance__text">
          {provenance.claim === 'new' ? 'New in Forever' : 'Changed in Forever'}
          {user && <span className="frl-provenance__who"> · user-declared</span>}
        </span>
      ) : (
        <span className="frl-visually-hidden">{description}</span>
      )}
    </span>
  );
}
