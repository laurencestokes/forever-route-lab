import { useId } from 'react';
import { cx } from '../lib/cx';
import type { ControlSize } from './Button';
import { Icon } from './Icon';
import './primitives.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

export interface SelectOptionGroup {
  readonly group: string;
  readonly options: readonly SelectOption[];
}

export interface SelectProps {
  /** Visible or visually hidden label; always the accessible name. */
  readonly label: string;
  readonly hideLabel?: boolean | undefined;
  readonly value: string;
  readonly options: readonly (SelectOption | SelectOptionGroup)[];
  readonly onChange: (value: string) => void;
  /** Shown as a first, unselectable option when `value` matches none of the options. */
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}

function isGroup(entry: SelectOption | SelectOptionGroup): entry is SelectOptionGroup {
  return 'group' in entry;
}

/** A native select, restyled. Native keeps keyboard, typeahead and screen-reader behaviour. */
export function Select({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  size = 'md',
  id,
  className,
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <span className={cx('frl-field', hideLabel && 'frl-field--inline', className)}>
      <label htmlFor={selectId} className={cx('frl-field__label', hideLabel && 'frl-visually-hidden')}>
        {label}
      </label>
      <span className={cx('frl-select', `frl-select--${size}`)}>
        <select
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((entry) =>
            isGroup(entry) ? (
              <optgroup key={`group:${entry.group}`} label={entry.group}>
                {entry.options.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              <option key={entry.value} value={entry.value} disabled={entry.disabled}>
                {entry.label}
              </option>
            ),
          )}
        </select>
        <Icon name="chevron-down" size={14} className="frl-select__chevron" />
      </span>
    </span>
  );
}
