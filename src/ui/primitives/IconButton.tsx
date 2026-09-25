import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';
import { toAriaKeyShortcuts } from '../lib/keys';
import type { ControlSize } from './Button';
import { Icon, type IconName } from './Icon';
import './primitives.css';

export interface IconButtonProps
  extends Omit<ComponentProps<'button'>, 'type' | 'children' | 'aria-label' | 'title' | 'aria-keyshortcuts'> {
  readonly icon: IconName;
  /** Accessible name, also shown as the tooltip. Required: an icon alone names nothing. */
  readonly label: string;
  /**
   * Shortcut as people read it, for example `'Ctrl+D'`: appended to the tooltip and exposed to
   * assistive technology as `aria-keyshortcuts` (`'Control+D'`).
   */
  readonly shortcut?: string | undefined;
  /** Makes the button a toggle (`aria-pressed`). */
  readonly pressed?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly variant?: 'ghost' | 'secondary' | undefined;
}

/**
 * A square button with an icon. The name is `aria-label`; the native `title` is the tooltip for
 * pointer users (the kit has no custom tooltip). Screen readers may also read the title as a
 * description, which repeats the name with the shortcut: accepted, since the shortcut is then
 * heard too, and `aria-keyshortcuts` carries it in machine-readable form (docs/UI.md §9).
 */
export function IconButton({
  icon,
  label,
  shortcut,
  pressed,
  size = 'md',
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps) {
  const keyShortcuts = shortcut === undefined ? '' : toAriaKeyShortcuts(shortcut);
  return (
    <button
      {...rest}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={keyShortcuts === '' ? undefined : keyShortcuts}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      className={cx(
        'frl-icon-button',
        `frl-icon-button--${variant}`,
        `frl-icon-button--${size}`,
        pressed === true && 'is-pressed',
        className,
      )}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
