import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon } from './Icon';
import './primitives.css';

/** What an external link says after its words, for assistive technology (visually hidden; the glyph shows it). */
export const EXTERNAL_LINK_TEXT = '(opens in a new tab)';

export interface ExternalLinkProps extends Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel' | 'referrerPolicy' | 'children' | 'className' | 'title'> {
  /** An absolute `https:` address on another site. */
  readonly href: string;
  /** The visible words; the accessible name starts with them and ends with "(opens in a new tab)". */
  readonly children: ReactNode;
  readonly className?: string | undefined;
  /** A tooltip, for example the site's name. */
  readonly title?: string | undefined;
}

/**
 * A link to another site, marked as external (D-041 J; docs/research/ui-refresh.md §7.1): the
 * external glyph after the words, "(opens in a new tab)" in the name, a new tab with no opener and
 * no referrer, so the page we link to learns nothing about the route being planned.
 */
export function ExternalLink({ href, children, className, title, ...rest }: ExternalLinkProps) {
  return (
    <a {...rest} className={cx('frl-external-link', className)} href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={title}>
      {children}
      <Icon name="external" size={14} className="frl-external-link__glyph" />
      <span className="frl-visually-hidden">{` ${EXTERNAL_LINK_TEXT}`}</span>
    </a>
  );
}
