import { describe, expect, it } from 'vitest';
import { globalShortcutFor, routeEditorShortcutFor, type ShortcutKey } from './useShortcuts';

const key = (k: string, mods: Partial<Omit<ShortcutKey, 'key'>> = {}): ShortcutKey => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('globalShortcutFor', () => {
  it('knows undo, redo and search, with Ctrl or Cmd', () => {
    expect(globalShortcutFor(key('z', { ctrlKey: true }))).toBe('undo');
    expect(globalShortcutFor(key('z', { metaKey: true }))).toBe('undo');
    expect(globalShortcutFor(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(globalShortcutFor(key('y', { ctrlKey: true }))).toBe('redo');
    expect(globalShortcutFor(key('k', { ctrlKey: true }))).toBe('search');
  });

  it('leaves the route commands and everything else alone', () => {
    for (const input of [
      key('Delete'),
      key('d', { ctrlKey: true }),
      key('a', { ctrlKey: true }),
      key('ArrowUp', { altKey: true }),
      key('Escape'),
      key('z'),
      key('z', { ctrlKey: true, altKey: true }),
      key('y', { ctrlKey: true, shiftKey: true }),
    ]) {
      expect(globalShortcutFor(input)).toBeNull();
    }
  });
});

describe('routeEditorShortcutFor', () => {
  it('knows the route commands', () => {
    expect(routeEditorShortcutFor(key('a', { ctrlKey: true }))).toBe('selectAll');
    expect(routeEditorShortcutFor(key('D', { metaKey: true }))).toBe('duplicate');
    expect(routeEditorShortcutFor(key('Delete'))).toBe('delete');
    expect(routeEditorShortcutFor(key('ArrowUp', { altKey: true }))).toBe('moveUp');
    expect(routeEditorShortcutFor(key('ArrowDown', { altKey: true }))).toBe('moveDown');
    expect(routeEditorShortcutFor(key('Escape'))).toBe('clearSelection');
    expect(routeEditorShortcutFor(key('x', { ctrlKey: true }))).toBe('cut');
    expect(routeEditorShortcutFor(key('C', { metaKey: true }))).toBe('copy');
    expect(routeEditorShortcutFor(key('v', { ctrlKey: true }))).toBe('paste');
    expect(routeEditorShortcutFor(key('j'))).toBe('join');
    expect(routeEditorShortcutFor(key('J'))).toBe('join');
  });

  it('ignores modified variants and the global keys', () => {
    for (const input of [
      key('Delete', { shiftKey: true }),
      key('Delete', { ctrlKey: true }),
      key('ArrowUp', { altKey: true, shiftKey: true }),
      key('ArrowUp'),
      key('a', { ctrlKey: true, shiftKey: true }),
      key('Escape', { shiftKey: true }),
      key('z', { ctrlKey: true }),
      key('k', { ctrlKey: true }),
      key('v', { ctrlKey: true, shiftKey: true }),
      key('j', { ctrlKey: true }),
      key('j', { altKey: true }),
    ]) {
      expect(routeEditorShortcutFor(input)).toBeNull();
    }
  });
});

describe('Alt+M, map focus (ui-refresh.md §4.3)', () => {
  it('reads the physical key, so Option+M on a Mac (which types "µ") works too', () => {
    expect(globalShortcutFor(key('m', { altKey: true, code: 'KeyM' }))).toBe('mapFocus');
    expect(globalShortcutFor(key('µ', { altKey: true, code: 'KeyM' }))).toBe('mapFocus');
  });

  it('is Alt+M alone: not M, not Ctrl or Shift with it, and not another key that types "m"', () => {
    expect(globalShortcutFor(key('m', { code: 'KeyM' }))).toBeNull();
    expect(globalShortcutFor(key('m', { altKey: true, ctrlKey: true, code: 'KeyM' }))).toBeNull();
    expect(globalShortcutFor(key('M', { altKey: true, shiftKey: true, code: 'KeyM' }))).toBeNull();
    expect(globalShortcutFor(key('m', { altKey: true, code: 'Semicolon' }))).toBeNull();
    expect(routeEditorShortcutFor(key('m', { altKey: true, code: 'KeyM' }))).toBeNull();
  });
});
