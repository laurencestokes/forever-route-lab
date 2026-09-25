/**
 * Shortcut text as people read it (`'Ctrl+D'`, `'Alt+↑'`, `'Ctrl+Shift+Z or Ctrl+Y'`) turned into
 * `aria-keyshortcuts` syntax: modifiers and keys by their UI Events names, `+` inside one
 * shortcut, a space between alternatives (`'Control+D'`, `'Alt+ArrowUp'`,
 * `'Control+Shift+Z Control+Y'`). Alternatives are separated by ` or `, ` / ` or `, `.
 */

const KEY_NAMES: Readonly<Record<string, string>> = {
  ctrl: 'Control',
  control: 'Control',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  '⌘': 'Meta',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  home: 'Home',
  end: 'End',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
};

function keyName(part: string): string {
  const named = KEY_NAMES[part.toLowerCase()];
  if (named !== undefined) return named;
  // Single characters are printed as the key cap shows them (`'D'`, `'L'`); function keys as is.
  return part.length === 1 ? part.toUpperCase() : part;
}

/** `aria-keyshortcuts` for shortcut text; an empty string when there is nothing to announce. */
export function toAriaKeyShortcuts(shortcut: string): string {
  return shortcut
    .split(/\s+or\s+|\s+\/\s+|\s*,\s+/i)
    .map((alternative) => alternative.trim())
    .filter((alternative) => alternative !== '')
    .map((alternative) =>
      alternative
        .split('+')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map(keyName)
        .join('+'),
    )
    .filter((alternative) => alternative !== '')
    .join(' ');
}
