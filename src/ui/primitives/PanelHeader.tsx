import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import './primitives.css';

export interface PanelHeaderProps {
  readonly title: string;
  /** Secondary text after the title: `'124 steps'`. */
  readonly meta?: ReactNode;
  /** Right-aligned controls, usually a <Toolbar>. */
  readonly actions?: ReactNode;
  /** Heading level for the title (panels sit under the page's h1). */
  readonly level?: 2 | 3 | undefined;
  readonly className?: string | undefined;
}

/** A 32px panel header: title, meta and actions on one line. */
export function PanelHeader({ title, meta, actions, level = 2, className }: PanelHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cx('frl-panel-header', className)}>
      <Heading className="frl-panel-header__title">{title}</Heading>
      {meta !== undefined && <span className="frl-panel-header__meta">{meta}</span>}
      <span className="frl-panel-header__spacer" />
      {actions !== undefined && <span className="frl-panel-header__actions">{actions}</span>}
    </div>
  );
}
