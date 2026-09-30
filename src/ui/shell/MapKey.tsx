import type { ReactNode } from 'react';
import { baseMapShownText } from './AboutDialog';
import { DrawerIconView, type DrawerIcon } from './MapCategoryDrawer';

/**
 * The key at the foot of the Map layers drawer (docs/research/map-presentation.md §25.3.6; step
 * MP.4b): what the rows cannot name — the pins' edges, fills and badges, the pip tag and the colour
 * rule, clusters and stacks, the line styles — and the map's own notes: whose art the base map is,
 * with both notices and which one is shown (map-atlas.md §21.6, step MM.7), the atlas's arcs and
 * insets, and how to read the grid; the zone names, cards and their difficulty chip, the underground
 * cities, the zone faction patterns and the fallback tint (steps MP.7, MP.10), and the popover (MP.6).
 * Every glyph, line style and badge on the map is named here or in a row (UI.md §9 rule 12).
 */

export interface MapKeyProps {
  /** The style shown ("Minimap", "Painted"), or null when the atlas draws no tiles. */
  readonly shownStyle: 'minimap' | 'painted' | null;
  /** The notices' links, relative to the page. */
  readonly notices: { readonly painted: string; readonly minimap: string; readonly art: string };
  /** The atlas is shown: its arcs, insets and layout, and each inset's note. */
  readonly atlas: { readonly notes: readonly string[] } | null;
  /** Which geometry is loaded (MAPS.md §5.6 step 6); null when not known. */
  readonly geometry?: string | null;
}

interface Entry {
  readonly icon: ReactNode;
  readonly text: string;
}

const pin = (icon: DrawerIcon): ReactNode => <DrawerIconView icon={icon} />;

/** A line style as the canvas draws it, at half scale (style.ts `LINE_STYLES`). */
function Line({ dash, width = 2.2, cap = 'butt', opacity }: { readonly dash: string | null; readonly width?: number; readonly cap?: 'butt' | 'round'; readonly opacity?: number }) {
  return (
    <svg className="frl-mapdrawer__icon" viewBox="0 0 20 18" width={20} height={18} aria-hidden="true" focusable="false">
      <line x1="1" y1="9" x2="19" y2="9" stroke="currentColor" strokeWidth={width} strokeDasharray={dash ?? undefined} strokeLinecap={cap} strokeOpacity={opacity} />
    </svg>
  );
}

const EDGES: readonly Entry[] = [
  { icon: pin({ kind: 'pin', glyph: 'quest' }), text: 'Solid edge: as stated' },
  { icon: pin({ kind: 'pin', glyph: 'quest', edge: 'dashed' }), text: 'Dashed edge: not sure (may be available, may be known, record unknown)' },
  { icon: pin({ kind: 'pin', glyph: 'flight', edge: 'double' }), text: 'Double edge: used by both factions' },
  { icon: pin({ kind: 'pin', glyph: 'flight', hollow: true }), text: 'Hollow glyph: not known yet' },
  { icon: pin({ kind: 'pin', glyph: 'innkeeper', light: true }), text: 'Light pin: a service (innkeeper, trainer, vendor)' },
  // review PR-14: the other faction's flight points (their row's own pin).
  { icon: pin({ kind: 'pin', glyph: 'flight', hollow: true, struck: true, badge: 'faction' }), text: 'Struck-through glyph with a letter (A or H): the other faction’s flight point' },
];

const BADGES: readonly Entry[] = [
  { icon: pin({ kind: 'pin', glyph: 'quest', badge: 'lock' }), text: 'Lock, top right: needs a prerequisite' },
  { icon: pin({ kind: 'pin', glyph: 'quest', badge: 'level' }), text: 'Level, top right: the level it unlocks at' },
  { icon: pin({ kind: 'pin', glyph: 'turn-in', badge: 'pie' }), text: 'Pie, top right: the share of objectives done' },
  { icon: pin({ kind: 'pin', glyph: 'turn-in', edge: 'dashed', badge: 'pie-unknown' }), text: 'Dashed empty pie: the objective record is unknown; never shown as ready' },
  { icon: pin({ kind: 'pin', glyph: 'quest', badge: 'arch' }), text: 'Arch, top left: the quest has objectives inside a dungeon' },
  { icon: pin({ kind: 'pin', glyph: 'flight', badge: 'faction' }), text: 'Letter A or H, top right: the other faction’s' },
  { icon: pin({ kind: 'pin', glyph: 'dungeon', badge: 'position' }), text: 'Dashed ring, bottom left: the entrance’s position is not verified' },
  { icon: pin({ kind: 'pin', glyph: 'quest', badge: 'count' }), text: '“×12”, bottom right: a cluster or a stack of that many' },
];

const LINES: readonly Entry[] = [
  { icon: <Line dash={null} cap="round" />, text: 'On foot or mounted: solid, along the walking path where there is one' },
  { icon: <Line dash="2 2" />, text: 'Walking path still being computed: straight, short dashes' },
  { icon: <Line dash="5 1.5 1 1.5 1 1.5" />, text: 'No walking path found: straight, dash-dot-dot' },
  { icon: <Line dash="5 3" />, text: 'Boat, zeppelin or other transport: dashed' },
  { icon: <Line dash="0.5 3" cap="round" />, text: 'Flight: dotted' },
  { icon: <Line dash="6 2.5 1 2.5" />, text: 'Hearthstone: dash and dot' },
  { icon: <Line dash={null} width={4} cap="round" />, text: 'Leg into the active step: thick' },
  // map-presentation.md §13.6 (review PR-02): the dash is the cue, the fade (55 %, beads 60 %) a second one.
  { icon: <Line dash="2.5 3" opacity={0.55} />, text: 'Route after the selected step: dashed and faded; its steps faded; other legs keep their own dashes' },
  { icon: <Line dash="7 3.5" />, text: 'Proposed route: long dashes' },
  // review PR-14: the travel network (style.ts `network-flight`, `network-transport`) and the zone borders.
  { icon: <Line dash={null} width={1.1} cap="round" />, text: 'Flight network: thin, solid; zoomed in only the hovered or selected flight point’s flights and the route’s own' },
  { icon: <Line dash="3 3" width={1.1} />, text: 'Transport rides between stops: thin, dashed' },
  { icon: <DrawerIconView icon={{ kind: 'swatch', swatch: 'border' }} />, text: 'Zone border: from the client’s terrain areas; a picture, points keep their published zone' },
];

function Section({ title, entries }: { readonly title: string; readonly entries: readonly Entry[] }) {
  return (
    <section className="frl-mapkey__section" aria-label={title}>
      <h4 className="frl-mapkey__heading">{title}</h4>
      <ul className="frl-mapkey__list">
        {entries.map((entry) => (
          <li key={entry.text} className="frl-mapkey__entry">
            {entry.icon}
            <span>{entry.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How to read the grid labels (MAPS.md §7.5: world X runs north, Y west). */
export const MAP_GRID_NOTE = 'Grid in yards: X grows north (N), Y grows west (W). RXP writes world pairs as (Y, X).';

/** How the atlas lays the continents out (map-atlas.md §5.3): a layout choice, not geography. */
export const ATLAS_LAYOUT_NOTE = 'Both continents at one scale, the sea between them narrowed to fit: how far apart they are here is a layout choice, not the game’s.';

export function MapKey({ shownStyle, notices, atlas, geometry = null }: MapKeyProps) {
  return (
    <div className="frl-mapkey">
      <Section title="Pins" entries={EDGES} />
      <Section title="Badges" entries={BADGES} />
      <p className="frl-mapkey__note">
        Quest pins take their difficulty colour from 16 px, with the pips in a tag beside them; a cluster only when all its quests share one difficulty. Colour is never the only cue: the pips, the edge and the
        badges say it too.
      </p>
      <p className="frl-mapkey__note">
        Zoomed out, quest givers and turn-ins gather into clusters that count their quests; a click zooms in to them. Zoomed in, pins of one kind whose heads overlap stack into one, and a click lists them.
      </p>
      <Section title="Route lines" entries={LINES} />
      <h4 className="frl-mapkey__heading">Names and zones</h4>
      <p className="frl-mapkey__note">
        Zone names carry the quest levels of the zone for your character (the dataset’s Era levels, marked E); the new zones their announced level, worded
        “(official)” or “(reported)”. On a zone card the difficulty chip rates the zone’s median quest level at your level after the step, with its pips; it is
        shown only where at least 10 quests are open and their levels spread over at most 15 (both assumptions); a dashed edge: your level is a lower bound.
        In the minimap style Ironforge and the Undercity are underground: their names say so, and their frames are dashed.
      </p>
      <p className="frl-mapkey__note">
        Zone faction (optional): hatching / for Alliance territory, \ for Horde territory, both for the client value 6, dots for a sanctuary; no pattern for no
        faction territory in the client. Where no painted art is shown, each zone takes a plain tint of its painted colour: a picture, not a signal.
      </p>
      <p className="frl-mapkey__note">A click on a pin, or on the map zoomed in, opens a popover of what can be added there; Escape closes it.</p>
      {atlas !== null && (
        <Section
          title="Atlas"
          entries={[
            { icon: <Line dash="5 3" />, text: 'Boat, zeppelin or other ride between the continents: an arc in the leg’s own dashes; not a distance' },
            { icon: <DrawerIconView icon={{ kind: 'swatch', swatch: 'inset' }} />, text: 'A separate world map shown in a box, not in its place: the game does not place it on the world map' },
          ]}
        />
      )}
      <h4 className="frl-mapkey__heading">Base map</h4>
      <p className="frl-mapkey__note">
        Both base maps are Blizzard Entertainment’s artwork, shown with notices; this project is not affiliated with or endorsed by Blizzard Entertainment.{' '}
        {baseMapShownText(shownStyle)}
      </p>
      <ul className="frl-mapkey__links">
        <li>
          <a href={notices.minimap}>Minimap notice</a> (the client’s minimap textures, the water recoloured)
        </li>
        <li>
          <a href={notices.painted}>Painted map notice</a> (the painted zone maps, composed into one atlas)
        </li>
        <li>
          <a href={notices.art}>Map art notice</a> (the painted maps one at a time)
        </li>
      </ul>
      <p className="frl-mapkey__note">{MAP_GRID_NOTE}</p>
      {geometry !== null && <p className="frl-mapkey__note">{`Geometry loaded: ${geometry}.`}</p>}
      {atlas !== null && (
        <>
          <p className="frl-mapkey__note">{ATLAS_LAYOUT_NOTE}</p>
          {atlas.notes.map((note) => (
            <p key={note} className="frl-mapkey__note">
              {note}.
            </p>
          ))}
        </>
      )}
    </div>
  );
}
