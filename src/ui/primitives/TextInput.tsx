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
  /** The value can be read, selected and copied but not changed; the field stays focusable. */
  readonly readOnly?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  /** Shortcut hint for assistive technology, in `aria-keyshortcuts` syntax (e.g. `'Control+K'`). */
  readonly keyShortcuts?: string | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  /** The on-screen keyboard to offer (`decimal`, `numeric`); the value stays text. */
  readonly inputMode?: 'text' | 'numeric' | 'decimal' | undefined;
  /** Ids of elements that describe the field (a hint, a problem), for `aria-describedby`. */
  readonly describedBy?: string | undefined;
  /** The value cannot be used as it is (`aria-invalid`); say why in a described-by element. */
  readonly invalid?: boolean | undefined;
  readonly onBlur?: (() => void) | undefined;
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
  readOnly = false,
  size = 'md',
  keyShortcuts,
  id,
  className,
  inputRef,
  inputMode,
  describedBy,
  invalid = false,
  onBlur,
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
          readOnly={readOnly}
          aria-keyshortcuts={keyShortcuts}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          inputMode={inputMode}
          onBlur={onBlur}
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
