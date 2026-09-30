import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';
import './primitives.css';

/**
 * The button variants (docs/research/ui-refresh.md §7.1; D-048):
 * - `default`: the tile fill with a strong edge, which darkens and takes the muted ink on hover;
 *   most actions (Accept, Turn in, Import, the Add footer).
 * - `secondary`: an alias of `default`, kept while earlier callers use it (ui-refresh §7.1, review
 *   UR-07: MapFrame's choice list and the project strip); it draws exactly as `default`.
 * - `primary`: the one likely next action in a context (Save in a dialog, the state's action in
 *   Details), at most one per context.
 * - `danger`: destructive actions (Delete project, Delete step): the error hue's text and edge.
 * - `ghost`: no fill or edge until hover; toolbars and disclosures.
 * - `link`: an inline action drawn as a link (New custom quest, Done here, Needs <prerequisite>).
 */
export type ButtonVariant = 'default' | 'secondary' | 'primary' | 'danger' | 'ghost' | 'link';
export type ControlSize = 'sm' | 'md';

/** The look a variant draws with: `secondary` is `default`. */
export const buttonLook = (variant: ButtonVariant): Exclude<ButtonVariant, 'secondary'> => (variant === 'secondary' ? 'default' : variant);

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'type'> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ControlSize | undefined;
  /** Leading icon; the text label stays the accessible name. */
  readonly icon?: IconName | undefined;
  readonly type?: 'button' | 'submit' | undefined;
  /**
   * Makes the button a toggle (`aria-pressed`), drawn pressed while true: the selection tint, accent
   * text in bold and a doubled accent edge (Pick on map, Map focus). Its name does not change. A
   * disclosure sets `aria-expanded` instead, which draws the same look (Map layers, View, Summary).
   */
  readonly pressed?: boolean | undefined;
}

/** A text button. Defaults to `type="button"` so it never submits a form by accident. */
export function Button({ variant = 'default', size = 'md', icon, type = 'button', pressed, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed ?? rest['aria-pressed']}
      className={cx('frl-button', `frl-button--${buttonLook(variant)}`, `frl-button--${size}`, className)}
    >
      {icon !== undefined && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}
