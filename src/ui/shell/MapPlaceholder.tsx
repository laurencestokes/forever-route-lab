import { useId } from 'react';
import { PlaceholderTag } from '../primitives/Badge';
import { Icon } from '../primitives/Icon';
import './MapPlaceholder.css';

export interface MapLayerStub {
  readonly id: string;
  readonly label: string;
}

/** The layers the map will offer (ARCHITECTURE §7, §12.4). Shown disabled until Milestone 3. */
export const PLANNED_MAP_LAYERS: readonly MapLayerStub[] = [
  { id: 'route', label: 'Route line' },
  { id: 'steps', label: 'Step markers' },
  { id: 'available', label: 'Available quests' },
  { id: 'objectives', label: 'Objective areas' },
  { id: 'flights', label: 'Flight paths' },
];

export interface MapPlaceholderProps {
  /** The active step, echoed so selection visibly reaches the centre panel. */
  readonly focus?: { readonly title: string; readonly location: string | null } | null | undefined;
  readonly layers?: readonly MapLayerStub[] | undefined;
  /** Which map geometry is loaded, in one line (docs/MAPS.md §5.6 step 6); omitted when unknown. */
  readonly geometry?: string | null | undefined;
}

/**
 * The centre panel until the map lands in Milestone 3: says so plainly, carries the Placeholder
 * label, and stubs the layer panel. Nothing here is drawn from game data or map art.
 *
 * The card and the layer stub are laid out side by side in a grid (stacked when the panel is
 * narrow), never on top of each other; the panel scrolls rather than overlap when it is short.
 */
export function MapPlaceholder({ focus = null, layers = PLANNED_MAP_LAYERS, geometry = null }: MapPlaceholderProps) {
  const headingId = useId();
  const layersId = useId();
  return (
    <div className="frl-mapph" aria-labelledby={headingId} role="group">
      <svg className="frl-mapph__art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
        <path className="frl-mapph__line" d="M20 96C60 96 52 40 104 40s48 44 92 44 28-52 28-52" />
        <circle className="frl-mapph__node" cx="20" cy="96" r="6" />
        <circle className="frl-mapph__node" cx="104" cy="40" r="6" />
        <circle className="frl-mapph__node" cx="196" cy="84" r="6" />
        <circle className="frl-mapph__node" cx="224" cy="32" r="6" />
      </svg>
      <div className="frl-mapph__layout">
        <div className="frl-mapph__card">
          <PlaceholderTag what="map" />
          <h2 id={headingId} className="frl-mapph__title">
            The map arrives in Milestone 3
          </h2>
          <p className="frl-mapph__text">
            It will draw the route line, step markers and quest locations over zone maps. Until then this panel only shows
            which step is active.
          </p>
          {geometry !== null && <p className="frl-mapph__text">{`Geometry loaded: ${geometry}.`}</p>}
          <p className="frl-mapph__focus">
            <Icon name="map-pin" size={14} />
            {focus === null ? (
              <span>No active step</span>
            ) : (
              <span>
                <span className="frl-mapph__focus-title">{focus.title}</span>
                {focus.location !== null && <span className="frl-mapph__focus-location"> · {focus.location}</span>}
              </span>
            )}
          </p>
        </div>
        <fieldset className="frl-mapph__layers" aria-describedby={layersId} disabled>
          <legend className="frl-mapph__layers-title">
            <Icon name="layers" size={14} />
            Layers
          </legend>
          {layers.map((layer) => (
            <label key={layer.id} className="frl-mapph__layer">
              <input type="checkbox" defaultChecked={false} />
              {layer.label}
            </label>
          ))}
          <p id={layersId} className="frl-mapph__layers-note">
            Available with the map (Milestone 3).
          </p>
        </fieldset>
      </div>
    </div>
  );
}
