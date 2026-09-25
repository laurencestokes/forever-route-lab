/**
 * Theme preference. `system` follows `prefers-color-scheme`; `light` and `dark` force a theme by
 * setting `data-theme` on the root element (tokens.css). Persisting the preference is the app's
 * job (the IndexedDB `settings` store); this module only applies it.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

/** The toggle cycles system → light → dark → system. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  switch (current) {
    case 'system':
      return 'light';
    case 'light':
      return 'dark';
    case 'dark':
      return 'system';
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Applies a preference to an element (normally `document.documentElement`). */
export function applyThemePreference(root: Element, preference: ThemePreference): void {
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}
