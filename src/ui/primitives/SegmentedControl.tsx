import { useId } from 'react';
import { cx } from '../lib/cx';
import type { ControlSize } from './Button';
import './primitives.css';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Why the option cannot be chosen now; the option is then disabled, with the reason as its tooltip. */
  readonly unavailable?: string | null | undefined;
}

export interface SegmentedControlProps<T extends string> {
  /** The group's name, a visually hidden legend ("Map style", "Rows"). */
  readonly legend: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly size?: ControlSize | undefined;
  /** The radios' `name`; a unique one by default. */
  readonly name?: string | undefined;
  /** Ids of elements that describe the group, for `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * A segmented control (docs/research/ui-refresh.md §7.1): native radios in a fieldset with a
 * visually hidden legend, so the arrow keys, the one tab stop and the spoken "1 of 2" come from the
 * browser. The checked option has the selection tint, a 2px accent underline and bold text (under
 * forced colours a 2px `Highlight` edge). Used by View's rows choice and the map's style control
 * ("Minimap | Painted").
 */
export function SegmentedControl<T extends string>({ legend, options, value, onChange, size = 'sm', name, describedBy, className }: SegmentedControlProps<T>) {
  const autoName = useId();
  const group = name ?? autoName;
  return (
    <fieldset className={cx('frl-segmented', `frl-segmented--${size}`, className)} aria-describedby={describedBy}>
      <legend className="frl-visually-hidden">{legend}</legend>
      {options.map((option) => {
        const unavailable = option.unavailable ?? null;
        const checked = option.value === value;
        return (
          <label key={option.value} className={cx('frl-segmented__option', checked && 'is-checked', unavailable !== null && 'is-unavailable')} title={unavailable ?? undefined}>
            <input
              type="radio"
              className="frl-segmented__input"
              name={group}
              value={option.value}
              checked={checked}
              disabled={unavailable !== null}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <span className="frl-segmented__label">{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
