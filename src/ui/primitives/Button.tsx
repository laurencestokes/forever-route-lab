import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';
import './primitives.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ControlSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'type'> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ControlSize | undefined;
  /** Leading icon; the text label stays the accessible name. */
  readonly icon?: IconName | undefined;
  readonly type?: 'button' | 'submit' | undefined;
}

/** A text button. Defaults to `type="button"` so it never submits a form by accident. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('frl-button', `frl-button--${variant}`, `frl-button--${size}`, className)}
    >
      {icon !== undefined && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}
