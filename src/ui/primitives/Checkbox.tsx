import { useEffect, useId, useRef } from 'react';
import { cx } from '../lib/cx';
import './primitives.css';

export interface CheckboxProps {
  /** The visible label; always the accessible name. */
  readonly label: string;
  /**
   * Checked, unchecked, or `'mixed'`: a group heading whose rows differ (the Map layers drawer,
   * map-presentation.md §25.3.8; ui-refresh.md §7.1), drawn with a dash in the box.
   */
  readonly checked: boolean | 'mixed';
  /** The new state: pressing a mixed box checks it. */
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  /** Ids of elements that describe the box (a hint), for `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * A native checkbox with its label after it, restyled only in size and spacing. The mixed state is
 * the box's `indeterminate` property (the browser's dash, and the platform's mixed state) with
 * `aria-checked="mixed"` beside it; forced colours keep the system box.
 */
export function Checkbox({ label, checked, onChange, disabled = false, describedBy, id, className }: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? autoId;
  const box = useRef<HTMLInputElement | null>(null);
  const mixed = checked === 'mixed';
  // Every render: a press clears the browser's own flag even when the owner keeps the box mixed.
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = mixed;
  });
  return (
    <span className={cx('frl-checkbox', mixed && 'is-mixed', className)}>
      <input
        ref={box}
        id={boxId}
        type="checkbox"
        checked={checked === true}
        aria-checked={mixed ? 'mixed' : undefined}
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
