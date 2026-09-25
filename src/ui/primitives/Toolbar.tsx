import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import './primitives.css';

/**
 * Items take part in the roving tab stop even when unavailable (`aria-disabled="true"`): the WAI-ARIA
 * toolbar pattern keeps them focusable, so activating an item that then becomes unavailable (Delete
 * with the last selected step, Undo with the last entry) never drops focus to the page. Natively
 * disabled buttons cannot take focus, so they are skipped.
 */
const ITEM_SELECTOR = 'button:not(:disabled), [data-toolbar-item]';

/** The unavailable toolbar item an event came from, if any. */
function unavailableItem(toolbar: HTMLElement, target: EventTarget): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest<HTMLElement>('[aria-disabled="true"]');
  return item !== null && toolbar.contains(item) ? item : null;
}

export interface ToolbarProps {
  /** Accessible name of the toolbar. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * `role="toolbar"` with one tab stop: Left/Right move between items, Home/End jump to the ends
 * (WAI-ARIA toolbar pattern). Items are the buttons inside (or elements marked
 * `data-toolbar-item`); do not give them a `tabIndex` yourself, the toolbar manages it.
 * Render an unavailable item with `aria-disabled="true"` rather than `disabled`: it stays
 * focusable, looks unavailable (primitives.css styles `aria-disabled` buttons like disabled ones),
 * and the toolbar swallows its clicks, so its own handler never runs. Text fields and selects
 * belong outside toolbars, where arrow keys keep their usual meaning.
 */
export function Toolbar({ label, children, className }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(0);

  const items = (): HTMLElement[] =>
    ref.current === null ? [] : Array.from(ref.current.querySelectorAll<HTMLElement>(ITEM_SELECTOR));

  // Re-assert the roving tab stop after every render: items can appear, disappear or be disabled.
  useLayoutEffect(() => {
    const list = items();
    if (list.length === 0) return;
    if (active.current >= list.length) active.current = list.length - 1;
    list.forEach((item, i) => {
      item.tabIndex = i === active.current ? 0 : -1;
    });
  });

  const focusItem = (index: number) => {
    const list = items();
    const item = list[index];
    if (item === undefined) return;
    active.current = index;
    list.forEach((other, i) => {
      other.tabIndex = i === index ? 0 : -1;
    });
    item.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const current = list.findIndex((item) => item === event.target);
    if (current === -1) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % list.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + list.length) % list.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = list.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusItem(next);
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className={cx('frl-toolbar', className)}
      onKeyDown={onKeyDown}
      onClickCapture={(event: MouseEvent<HTMLDivElement>) => {
        // Enter and Space on a focused button arrive as clicks too.
        if (unavailableItem(event.currentTarget, event.target) === null) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onFocus={(event) => {
        const index = items().findIndex((item) => item === event.target);
        if (index !== -1 && index !== active.current) focusItem(index);
      }}
    >
      {children}
    </div>
  );
}

/** A thin vertical rule between toolbar groups. */
export function ToolbarSeparator() {
  return <span className="frl-toolbar__separator" role="separator" aria-orientation="vertical" />;
}
