import { useId, type ReactElement } from 'react';
import { cx } from '../lib/cx';
import './MapLegend.css';

/**
 * The map's key (docs/UI.md §12; MAPS.md §7.5; M3 review MAP-A11Y-10): small inline SVGs that
 * repeat the canvas glyphs and line styles (src/map/leaflet/glyphs.ts and style.ts) in the same
 * kit colours, each beside the words that say what it means, so no map signal is carried by shape,
 * dash or colour alone (UI.md §1.3, §4). The SVGs are decorative: the text next to them is the
 * information.
 *
 * Geometry follows the canvas at its base sizes (CSS pixels): step bead r 5.5 with a hole of
 * 0.35 r; quest-start triangle r 6.5; turn-in square of half-side 0.85 × 5.5; objective dot r 3.5;
 * flight-master plus r 6 with arms 0.38 r wide; transition ring r 6.5 with a dot; halo ring; zone
 * count box. Dash patterns are the canvas ones at half scale (the key's lines are 18 px long). The
 * relief and painted-art swatches are drawn shapes, not images from the game.
 */

export type MapGlyphKind =
  | 'step'
  | 'quest-start'
  | 'quest-end'
  | 'objective'
  | 'flight-master'
  | 'transition'
  | 'halo'
  | 'aggregate'
  | 'frame'
  | 'extent'
  | 'art'
  | 'relief'
  | 'zone-outline'
  | 'coast'
  | 'line-route'
  | 'line-route-pending'
  | 'line-route-fallback'
  | 'line-transport'
  | 'line-flight'
  | 'line-hearth'
  | 'line-highlight'
  | 'line-proposal'
  | 'badge-instance'
  | 'badge-off-frame'
  | 'badge-leg-unknown'
  | 'badge-stack';

const CX = 10;
const CY = 8;

/** Plus-sign outline, as glyphs.ts draws it. */
function plusPoints(r: number): string {
  const t = r * 0.38;
  const pts: readonly (readonly [number, number])[] = [
    [-t, -r],
    [t, -r],
    [t, -t],
    [r, -t],
    [r, t],
    [t, t],
    [t, r],
    [-t, r],
    [-t, t],
    [-r, t],
    [-r, -t],
    [-t, -t],
  ];
  return pts.map(([x, y]) => `${String(CX + x)},${String(CY + y)}`).join(' ');
}

const line = (className: string): ReactElement => <line className={className} x1={1} y1={CY} x2={19} y2={CY} />;

/** A neutral dot the badges sit on. */
const base = <circle className="frl-mapglyph__muted" cx={8} cy={9} r={4} />;

function shapeOf(kind: MapGlyphKind): ReactElement {
  switch (kind) {
    case 'step':
      return (
        <>
          <circle className="frl-mapglyph__accent frl-mapglyph__edge" cx={CX} cy={CY} r={5.5} />
          <circle className="frl-mapglyph__hole" cx={CX} cy={CY} r={1.925} />
        </>
      );
    case 'quest-start':
      // Apex at -1.15 r, base at +0.75 r (glyphs.ts), lowered by a pixel to sit centred.
      return <polygon className="frl-mapglyph__ink frl-mapglyph__edge" points={`10,1.5 16.5,13.4 3.5,13.4`} />;
    case 'quest-end':
      return <rect className="frl-mapglyph__ink frl-mapglyph__edge" x={CX - 4.675} y={CY - 4.675} width={9.35} height={9.35} />;
    case 'objective':
      return <circle className="frl-mapglyph__ink frl-mapglyph__edge" cx={CX} cy={CY} r={3.5} />;
    case 'flight-master':
      return <polygon className="frl-mapglyph__ink frl-mapglyph__edge" points={plusPoints(6)} />;
    case 'transition':
      return (
        <>
          <circle className="frl-mapglyph__ring" cx={CX} cy={CY} r={5.75} />
          <circle className="frl-mapglyph__accent" cx={CX} cy={CY} r={2.08} />
        </>
      );
    case 'halo':
      return (
        <>
          <circle className="frl-mapglyph__halo-edge" cx={CX} cy={CY} r={6} />
          <circle className="frl-mapglyph__halo" cx={CX} cy={CY} r={6} />
        </>
      );
    case 'aggregate':
      return (
        <>
          <rect className="frl-mapglyph__box" x={1} y={2} width={18} height={12} rx={4} />
          <text className="frl-mapglyph__count" x={CX} y={CY + 0.5}>
            12
          </text>
        </>
      );
    case 'frame':
      return <rect className="frl-mapglyph__frame" x={2} y={2.5} width={16} height={11} />;
    case 'extent':
      return <rect className="frl-mapglyph__extent" x={2} y={2.5} width={16} height={11} />;
    case 'art':
      return (
        <>
          <rect className="frl-mapglyph__art" x={2} y={2.5} width={16} height={11} />
          <polyline className="frl-mapglyph__art-line" points="3.5,12 8,7 11,10 13,8.5 16.5,12" />
        </>
      );
    case 'relief':
      return (
        <>
          <rect className="frl-mapglyph__relief" x={2} y={2.5} width={16} height={11} />
          <polygon className="frl-mapglyph__relief-shade" points="2,13.5 8,6 11,9.5 14,5.5 18,13.5" />
        </>
      );
    case 'zone-outline':
      return <polyline className="frl-mapglyph__zone-outline" points="2,4 7,3.5 9,8 13,7.5 14,12.5 18,12" />;
    case 'coast':
      return <polyline className="frl-mapglyph__coast" points="1,11 4,9 7,10.5 10,7 13,8 16,5 19,5.5" />;
    case 'line-route':
      return line('frl-mapglyph__line is-route');
    case 'line-route-pending':
      return line('frl-mapglyph__line is-route-pending');
    case 'line-route-fallback':
      return line('frl-mapglyph__line is-route-fallback');
    case 'line-transport':
      return line('frl-mapglyph__line is-transport');
    case 'line-flight':
      return line('frl-mapglyph__line is-flight');
    case 'line-hearth':
      return line('frl-mapglyph__line is-hearth');
    case 'line-highlight':
      return line('frl-mapglyph__line is-highlight');
    case 'line-proposal':
      return line('frl-mapglyph__line is-proposal');
    case 'badge-instance':
      return (
        <>
          {base}
          <rect className="frl-mapglyph__badge frl-mapglyph__edge-thin" x={11} y={1.5} width={5} height={5} />
        </>
      );
    case 'badge-off-frame':
      return (
        <>
          {base}
          <circle className="frl-mapglyph__dashed" cx={8} cy={9} r={6.5} />
        </>
      );
    case 'badge-leg-unknown':
      return (
        <>
          {base}
          <text className="frl-mapglyph__question" x={13} y={8}>
            ?
          </text>
        </>
      );
    case 'badge-stack':
      return (
        <>
          {base}
          <circle className="frl-mapglyph__badge frl-mapglyph__edge-thin" cx={14} cy={12} r={3.75} />
          <text className="frl-mapglyph__stack" x={14} y={12.5}>
            3
          </text>
        </>
      );
  }
}

export interface MapGlyphProps {
  readonly kind: MapGlyphKind;
  readonly className?: string | undefined;
}

/** One map glyph or line style as a 20 × 16 inline SVG, hidden from assistive technology (its label says it). */
export function MapGlyph({ kind, className }: MapGlyphProps) {
  return (
    <svg className={cx('frl-mapglyph', className)} viewBox="0 0 20 16" width={20} height={16} aria-hidden="true" focusable="false" data-glyph={kind}>
      {shapeOf(kind)}
    </svg>
  );
}

/** One entry of the key: a glyph and what it means. */
export interface MapKeyEntry {
  readonly glyph: MapGlyphKind;
  readonly text: string;
}

export interface MapKeySection {
  readonly title: string;
  readonly entries: readonly MapKeyEntry[];
}

/** What every glyph, line style and badge on the map means (MAPS.md §7.5). */
export const MAP_KEY: readonly MapKeySection[] = [
  {
    title: 'Markers',
    entries: [
      { glyph: 'step', text: 'Route step' },
      { glyph: 'quest-start', text: 'Quest giver: starts quests' },
      { glyph: 'quest-end', text: 'Turn-in' },
      { glyph: 'objective', text: 'Objective target or area' },
      { glyph: 'flight-master', text: 'Flight master' },
      { glyph: 'transition', text: 'The route leaves or enters this map, or leaves for a place it does not give' },
      { glyph: 'halo', text: 'Selected, active or hovered step' },
      { glyph: 'aggregate', text: 'Zone count: quest points folded while zoomed out' },
      { glyph: 'frame', text: 'Zone frame: a map rectangle, not the zone’s border' },
      { glyph: 'extent', text: 'Edge of this world map' },
    ],
  },
  {
    title: 'Map',
    entries: [
      { glyph: 'art', text: 'Painted map art: Blizzard Entertainment’s artwork (see About)' },
      { glyph: 'relief', text: 'Relief: shading computed from the game’s terrain, not painted' },
      { glyph: 'zone-outline', text: 'Zone outline: a border from the game’s terrain areas' },
      { glyph: 'coast', text: 'Coastline: sea, lake and river shores' },
    ],
  },
  {
    title: 'Route lines',
    entries: [
      { glyph: 'line-route', text: 'On foot or mounted: solid, along the walking path where there is one' },
      { glyph: 'line-route-pending', text: 'Walking path still being computed: straight, short dashes' },
      { glyph: 'line-route-fallback', text: 'No walking path found: straight, dash-dot-dot' },
      { glyph: 'line-transport', text: 'Boat, zeppelin or other transport: dashed' },
      { glyph: 'line-flight', text: 'Flight: dotted' },
      { glyph: 'line-hearth', text: 'Hearthstone: dash and dot' },
      { glyph: 'line-highlight', text: 'Leg into the active step: thick' },
      { glyph: 'line-proposal', text: 'Proposed route: long dashes' },
    ],
  },
  {
    title: 'Badges',
    entries: [
      { glyph: 'badge-instance', text: 'Inside an instance: drawn at its entrance' },
      { glyph: 'badge-off-frame', text: 'Outside its zone’s map frame' },
      { glyph: 'badge-leg-unknown', text: 'Leg unknown: an earlier step could not be placed' },
      { glyph: 'badge-stack', text: 'Several items at one point: a click lists them' },
    ],
  },
];

/** How to read the grid labels (MAPS.md §7.5: world X runs north, Y west). */
export const MAP_GRID_NOTE = 'Grid in yards: X grows north (N), Y grows west (W). RXP writes world pairs as (Y, X).';

/** The key under the layer panel: every glyph, line style and badge with its meaning, and the grid axes. */
export function MapLegend({ className }: { readonly className?: string | undefined }) {
  const baseId = useId();
  return (
    <div className={cx('frl-mapkey', className)} role="group" aria-labelledby={`${baseId}-title`}>
      <p id={`${baseId}-title`} className="frl-layers__title">
        Key
      </p>
      {MAP_KEY.map((section, index) => {
        const titleId = `${baseId}-${String(index)}`;
        return (
          <div key={section.title} className="frl-mapkey__section">
            <p id={titleId} className="frl-mapkey__heading">
              {section.title}
            </p>
            <ul className="frl-mapkey__list" aria-labelledby={titleId}>
              {section.entries.map((entry) => (
                <li key={entry.glyph} className="frl-mapkey__entry">
                  <MapGlyph kind={entry.glyph} />
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="frl-mapkey__note">{MAP_GRID_NOTE}</p>
    </div>
  );
}
