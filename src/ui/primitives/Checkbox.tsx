import { useId } from 'react';
import { cx } from '../lib/cx';
import './primitives.css';

export interface CheckboxProps {
  /** The visible label; always the accessible name. */
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  /** Ids of elements that describe the box (a hint), for `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}

/** A native checkbox with its label after it, restyled only in size and spacing. */
export function Checkbox({ label, checked, onChange, disabled = false, describedBy, id, className }: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? autoId;
  return (
    <span className={cx('frl-checkbox', className)}>
      <input
        id={boxId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <label htmlFor={boxId}>{label}</label>
    </span>
  );
}
