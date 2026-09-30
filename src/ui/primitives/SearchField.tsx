import { useId, type KeyboardEvent, type Ref } from 'react';
import { cx } from '../lib/cx';
import type { ControlSize } from './Button';
import { Icon } from './Icon';
import './primitives.css';

export interface SearchFieldProps {
  /** The field's name ("Search the map"); visually hidden unless `showLabel`. */
  readonly label: string;
  readonly showLabel?: boolean | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Enter. */
  readonly onSubmit?: ((value: string) => void) | undefined;
  readonly placeholder?: string | undefined;
  /** The clear button's name; "Clear search" by default. */
  readonly clearLabel?: string | undefined;
  /** Down in the field: move to the first result (the Map layers drawer, map-presentation.md §25.3.8). */
  readonly onArrowDown?: (() => void) | undefined;
  /** Shortcut hint for assistive technology, in `aria-keyshortcuts` syntax (e.g. `'Control+K'`). */
  readonly keyShortcuts?: string | undefined;
  /** Ids of elements that describe the field (a hint, a result count), for `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly id?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly className?: string | undefined;
}

/**
 * A search field (docs/research/ui-refresh.md §7.1; the Map layers drawer, map-presentation.md
 * §25.3.5): the search icon, a `searchbox`, and a clear button while there is text. Escape clears
 * text when there is some, and is left alone in an empty field, so the drawer or a dialog around it
 * can close on it. The clear button puts focus back in the field.
 */
export function SearchField({
  label,
  showLabel = false,
  value,
  onChange,
  onSubmit,
  placeholder,
  clearLabel = 'Clear search',
  onArrowDown,
  keyShortcuts,
  describedBy,
  disabled = false,
  size = 'md',
  id,
  inputRef,
  className,
}: SearchFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onSubmit !== undefined) {
      event.preventDefault();
      onSubmit(event.currentTarget.value);
    } else if (event.key === 'Escape' && value !== '') {
      event.preventDefault();
      event.stopPropagation();
      onChange('');
    } else if (event.key === 'ArrowDown' && onArrowDown !== undefined) {
      event.preventDefault();
      onArrowDown();
    }
  };
  return (
    <span className={cx('frl-field', !showLabel && 'frl-field--inline', 'frl-search', className)}>
      <label htmlFor={inputId} className={cx('frl-field__label', !showLabel && 'frl-visually-hidden')}>
        {label}
      </label>
      <span className={cx('frl-input', `frl-input--${size}`, 'frl-input--with-icon', 'frl-search__box', value !== '' && 'has-value')}>
        <Icon name="search" size={14} className="frl-input__icon" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-keyshortcuts={keyShortcuts}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
        {value !== '' && !disabled && (
          <button
            type="button"
            className="frl-search__clear"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={(event) => {
              onChange('');
              event.currentTarget.parentElement?.querySelector('input')?.focus();
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </span>
    </span>
  );
}
