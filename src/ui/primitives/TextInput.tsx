import { useId, type Ref } from 'react';
import { cx } from '../lib/cx';
import type { ControlSize } from './Button';
import { Icon, type IconName } from './Icon';
import './primitives.css';

export interface TextInputProps {
  readonly label: string;
  readonly hideLabel?: boolean | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Enter. */
  readonly onSubmit?: ((value: string) => void) | undefined;
  readonly type?: 'text' | 'search' | undefined;
  readonly placeholder?: string | undefined;
  readonly icon?: IconName | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  /** Shortcut hint for assistive technology, in `aria-keyshortcuts` syntax (e.g. `'Control+K'`). */
  readonly keyShortcuts?: string | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
}

/**
 * A single-line text field. With `type="search"`, Escape clears a non-empty value (and is left
 * alone when the field is already empty, so dialogs can still close on it).
 */
export function TextInput({
  label,
  hideLabel = false,
  value,
  onChange,
  onSubmit,
  type = 'text',
  placeholder,
  icon,
  disabled = false,
  size = 'md',
  keyShortcuts,
  id,
  className,
  inputRef,
}: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <span className={cx('frl-field', hideLabel && 'frl-field--inline', className)}>
      <label htmlFor={inputId} className={cx('frl-field__label', hideLabel && 'frl-visually-hidden')}>
        {label}
      </label>
      <span className={cx('frl-input', `frl-input--${size}`, icon !== undefined && 'frl-input--with-icon')}>
        {icon !== undefined && <Icon name={icon} size={14} className="frl-input__icon" />}
        <input
          ref={inputRef}
          id={inputId}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-keyshortcuts={keyShortcuts}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit !== undefined) {
              event.preventDefault();
              onSubmit(event.currentTarget.value);
            } else if (event.key === 'Escape' && type === 'search' && value !== '') {
              event.preventDefault();
              event.stopPropagation();
              onChange('');
            }
          }}
        />
      </span>
    </span>
  );
}
