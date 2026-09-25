import type { ReactElement } from 'react';

/**
 * Interface icons: original 16×16 line drawings in `currentColor`, so they follow the text colour
 * of whatever holds them. Step-type glyphs live in markers/StepTypeGlyph.tsx.
 */
export type IconName =
  | 'search'
  | 'import'
  | 'export'
  | 'settings'
  | 'theme-system'
  | 'theme-light'
  | 'theme-dark'
  | 'about'
  | 'lock'
  | 'unlock'
  | 'duplicate'
  | 'delete'
  | 'grip'
  | 'close'
  | 'layers'
  | 'chevron-down'
  | 'map-pin'
  | 'add';

const ICONS: Readonly<Record<IconName, ReactElement>> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" />
    </>
  ),
  import: (
    <>
      <path d="M2.75 10.25v2.25c0 .41.34.75.75.75h9c.41 0 .75-.34.75-.75v-2.25" />
      <path d="M8 2.75v7M5 6.75l3 3 3-3" />
    </>
  ),
  export: (
    <>
      <path d="M2.75 10.25v2.25c0 .41.34.75.75.75h9c.41 0 .75-.34.75-.75v-2.25" />
      <path d="M8 9.75v-7M5 5.75l3-3 3 3" />
    </>
  ),
  settings: (
    <>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      <circle cx="5.5" cy="4.5" r="1.6" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.6" fill="currentColor" />
      <circle cx="7" cy="11.5" r="1.6" fill="currentColor" />
    </>
  ),
  'theme-system': (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
    </>
  ),
  'theme-light': (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
    </>
  ),
  'theme-dark': <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z" />,
  about: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25V11" />
      <circle cx="8" cy="5" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.85-.85" />
    </>
  ),
  duplicate: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.25" />
      <path d="M10.5 3.25v-.5a.75.75 0 0 0-.75-.75h-6.5a.75.75 0 0 0-.75.75v6.5c0 .41.34.75.75.75h.5" />
    </>
  ),
  delete: (
    <>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5" />
      <path d="m4.5 4.5.6 8.3a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8.3" />
    </>
  ),
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="4" r="1.1" />
      <circle cx="10" cy="4" r="1.1" />
      <circle cx="6" cy="8" r="1.1" />
      <circle cx="10" cy="8" r="1.1" />
      <circle cx="6" cy="12" r="1.1" />
      <circle cx="10" cy="12" r="1.1" />
    </g>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  layers: (
    <>
      <path d="M8 2.5 14 5.75 8 9 2 5.75z" />
      <path d="M2.5 8.9 8 12l5.5-3.1" />
    </>
  ),
  'chevron-down': <path d="M4.5 6.25 8 9.75l3.5-3.5" />,
  'map-pin': (
    <>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </>
  ),
  add: <path d="M8 3v10M3 8h10" />,
};

export interface IconProps {
  readonly name: IconName;
  readonly size?: 14 | 16 | undefined;
  /** Accessible name. Omit for decorative icons (the usual case: the control carries the name). */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

export function Icon({ name, size = 16, label, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {ICONS[name]}
    </svg>
  );
}
