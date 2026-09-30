import * as L from 'leaflet';
import { resolveTile, tileUrl, type TileBandDescriptor } from '../adapter';
import { decodeImage, tileKey, type DecodedTiles, type DecodeImage } from './atlas-decoded';
import { AtlasUnderlay } from './atlas-underlay';

/**
 * The atlas raster in Leaflet (docs/research/map-atlas.md §7.2, §8.3, §21; D-042 A3, A10; steps ATL.7
 * and MM.1): one style's tile layer over its never-pruned underlay (`atlas-underlay.ts`: level −5
 * painted, −6 minimap), both our own code.
 *
 * - **Only keys the index lists are requested.** Every key goes through `resolveTile` (map/adapter)
 *   before Leaflet creates an element: a sea key, or a key outside the index's grid, is not a valid
 *   tile (`_isValidTile`), so it creates no element and the container's deep-sea background shows
 *   (MA-10). A URL is built only for a stored key (`tileUrl`).
 * - **Ancestor-first tiles** (MA-01): every tile element is a `<div aria-hidden="true">` that starts
 *   as the crop of its nearest ancestor already decoded in this session (a CSS background of that
 *   file, scaled `2^k` and offset), so a pan, zoom-out, jump or preset shows the best picture already
 *   in memory at once, and the underlay only where nothing finer is decoded. A stored key then adds
 *   its own `<img alt="" decoding="async">`, which fades in over 150 ms after `decode()` (no fade
 *   under reduced motion); a virtual key keeps a crop, of its nearest stored ancestor once that has
 *   decoded. `done` is called at once (in a microtask: Leaflet files the tile only after
 *   `createTile` returns), so Leaflet prunes the previous level straight away.
 * - Options as §8.3 lists them: 256 px, native levels −8 to 0, `maxZoom` 2, the extent as `bounds`,
 *   `noWrap`, `keepBuffer` from the band (2 painted, 1 minimap: §24.5), `updateWhenZooming` true,
 *   `updateWhenIdle` false, `updateInterval` 100.
 *   Retina tiles are never requested (a grid layer has no `detectRetina`); the map's own
 *   `fadeAnimation` is off (the layer's image fade replaces it).
 * - It extends `L.GridLayer`, not `L.TileLayer`: every tile element is a `<div>`, and
 *   `TileLayer`'s load, abort and removal code assumes `<img>` tiles (Leaflet 1.9.4
 *   `_abortLoading` would drop every other level's tiles, `_removeTile` sets `src` on the element).
 * - **A style switch** (§21.2, §24.5): the old band's tiles outside the view (its kept buffer) are
 *   pruned when it is held under the new one (`pruneOffView`), and it keeps no buffer while held; its
 *   first view's outcome (`onFirstView`) tells the adapter when the new band covers the old.
 * - Leaflet 1.9.4 internals used: `GridLayer._isValidTile`, `_update`, `_pruneTiles` and `_tiles`,
 *   `Map._getNewPixelOrigin` (the underlay).
 */

export interface AtlasTileLayerOptions {
  readonly band: TileBandDescriptor;
  readonly decoded: DecodedTiles;
  /** Fade stored images in over 150 ms after decoding (false under reduced motion). */
  readonly fade: boolean;
  /** The map's greatest zoom (the layer draws level 0 magnified above it). */
  readonly maxZoom: number;
  readonly pane?: string;
  /** Default `decodeImage`. */
  readonly decodeImage?: DecodeImage;
}

/** Leaflet 1.9.4 internals of `L.GridLayer` used here. */
interface GridInternals {
  _isValidTile(coords: L.Coords): boolean;
  _update(center?: L.LatLng): void;
  _pruneTiles(): void;
  _tiles: Readonly<Record<string, { readonly el: HTMLElement; readonly coords: L.Coords; readonly current: boolean }>>;
}

const gridPrototype = L.GridLayer.prototype as unknown as GridInternals;

/** Leaflet's transparent 1×1 GIF (`L.Util.emptyImageUrl`): cancels an image's request. */
const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAA=';

/** Sets `element`'s background to a crop of the ancestor at `url`: `scale` × `scale` tiles, this one the (`dx`, `dy`)-th. */
function cropFrom(element: HTMLElement, url: string, tileSize: number, scale: number, dx: number, dy: number): void {
  const style = element.style;
  style.backgroundImage = `url("${url}")`;
  style.backgroundSize = `${String(tileSize * scale)}px ${String(tileSize * scale)}px`;
  style.backgroundPosition = `${String(-dx * tileSize)}px ${String(-dy * tileSize)}px`;
  style.backgroundRepeat = 'no-repeat';
  // The picture the crop holds, for the memory measure (`AtlasTiles.liveImages`).
  element.dataset['crop'] = url;
}

/** Drops a tile's crop once its own image covers it (review MR-08). */
function clearCrop(element: HTMLElement): void {
  element.style.backgroundImage = '';
  delete element.dataset['crop'];
}

/** The fade's length (map.css `.frl-atlas-tile__img`), and the margin after it at which a crop is dropped when no `transitionend` came (the tile hidden, the transition cut short). */
const FADE_MS = 150;
const FADE_MARGIN_MS = 100;

/** Counts for tests and diagnostics. */
export interface AtlasTileCounts {
  /** Tile elements created (stored and virtual keys; sea keys create none). */
  readonly created: number;
  readonly stored: number;
  readonly virtual: number;
  /** Stored images or ancestors this layer decoded (keys already decoded in the session are not counted again). */
  readonly decoded: number;
  /** Stored images or ancestors that failed to load or decode (the crop or the underlay stays). */
  readonly failed: number;
  /** Stored images or ancestors this layer asked to decode (review MR-05: a first view over the sea asks for none). */
  readonly asked: number;
  /** Stored keys whose image was decoded in the session already, shown at once. */
  readonly known: number;
}

/**
 * How a band's first view settled (map-atlas.md §21.2, §21.4): `failed` when every image it asked
 * for failed. A first view that asks for no image (all sea, review MR-05) is decided by the
 * underlay's images instead, which every style has.
 */
export type FirstView = 'ready' | 'failed';

export class AtlasTileLayer extends L.GridLayer {
  readonly band: TileBandDescriptor;
  private readonly frlDecoded: DecodedTiles;
  private readonly frlFade: boolean;
  private readonly frlDecode: DecodeImage;
  private frlPending = 0;
  private frlIdle: (() => void)[] = [];
  private frlCounts = { created: 0, stored: 0, virtual: 0, decoded: 0, failed: 0, asked: 0, known: 0 };

  constructor(options: AtlasTileLayerOptions) {
    const { band } = options;
    const extent = band.bounds;
    super({
      tileSize: band.tileSize,
      minNativeZoom: band.minNativeZoom,
      maxNativeZoom: band.maxNativeZoom,
      // Leaflet's default least zoom (0) would drop every tile below it.
      minZoom: -Infinity,
      maxZoom: options.maxZoom,
      bounds: L.latLngBounds([0 - extent.sMax, extent.eMin], [0 - extent.sMin, extent.eMax]),
      noWrap: true,
      keepBuffer: band.keepBuffer,
      updateWhenZooming: true,
      updateWhenIdle: false,
      updateInterval: 100,
      pane: options.pane ?? 'frl-atlas',
      className: options.fade ? 'frl-atlas' : 'frl-atlas frl-atlas--still',
    });
    this.band = band;
    this.frlDecoded = options.decoded;
    this.frlFade = options.fade;
    this.frlDecode = options.decodeImage ?? decodeImage;
    this.on('tileunload', this.frlUnload);
  }

  override onAdd(map: L.Map): this {
    super.onAdd(map);
    queueMicrotask(() => {
      this.checkIdle();
    });
    return this;
  }

  /** Calls `callback` once no stored image of the tiles created so far is still decoding (the underlay loads then, map-atlas.md §8.3). */
  onceIdle(callback: () => void): void {
    this.frlIdle.push(callback);
    queueMicrotask(() => {
      this.checkIdle();
    });
  }

  counts(): AtlasTileCounts {
    return { ...this.frlCounts };
  }

  /**
   * Removes the tiles outside the view (the kept buffer), and keeps none from now on (map-atlas.md
   * §21.2, §24.5: a band held under a new one during a style switch holds at most one view).
   */
  pruneOffView(): void {
    (this.options as L.GridLayerOptions).keepBuffer = 0;
    const map = this._map as L.Map | undefined;
    if (map === undefined) return;
    const grid = this as unknown as GridInternals;
    grid._update(map.getCenter());
    grid._pruneTiles();
  }

  /** Sea keys and keys outside the index are not tiles: no element, no request (map-atlas.md §7.2, MA-10). */
  _isValidTile(coords: L.Coords): boolean {
    if (!gridPrototype._isValidTile.call(this, coords)) return false;
    return resolveTile(this.band.index, coords.z, coords.x, coords.y).kind !== 'sea';
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const document = this._map.getContainer().ownerDocument;
    const tile = document.createElement('div');
    tile.className = 'frl-atlas-tile';
    tile.setAttribute('aria-hidden', 'true');
    const { z, x, y } = coords;
    tile.dataset['key'] = tileKey(z, x, y);
    const resolved = resolveTile(this.band.index, z, x, y);
    this.frlCounts.created += 1;
    const own = tileKey(z, x, y);
    if (resolved.kind === 'stored') {
      this.frlCounts.stored += 1;
      const decoded = this.frlDecoded.has(own);
      // Always from the nearest crop, a decoded key's too (review MR-09): its new image loads
      // asynchronously when the browser has dropped the resource, and the crop covers until then.
      this.cropNearestDecoded(tile, z, x, y);
      const url = tileUrl(this.band, z, x, y);
      if (url !== null) this.addImage(tile, own, url, decoded);
    } else if (resolved.kind === 'virtual') {
      this.frlCounts.virtual += 1;
      const ancestor = tileKey(resolved.z, resolved.x, resolved.y);
      const url = tileUrl(this.band, resolved.z, resolved.x, resolved.y);
      if (url !== null && this.frlDecoded.has(ancestor)) cropFrom(tile, url, this.band.tileSize, resolved.scale, resolved.dx, resolved.dy);
      else {
        this.cropNearestDecoded(tile, z, x, y);
        if (url !== null) this.loadAncestor(tile, ancestor, url, resolved.scale, resolved.dx, resolved.dy);
      }
    }
    queueMicrotask(() => {
      done(undefined, tile);
    });
    return tile;
  }

  /** The crop of the nearest ancestor of (z, x, y) decoded in this session, if any; else the element stays clear over the underlay. */
  private cropNearestDecoded(tile: HTMLElement, z: number, x: number, y: number): void {
    for (let az = z - 1; az >= this.band.minNativeZoom; az -= 1) {
      const scale = 2 ** (z - az);
      const ax = Math.floor(x / scale);
      const ay = Math.floor(y / scale);
      if (!this.frlDecoded.has(tileKey(az, ax, ay))) continue;
      const url = tileUrl(this.band, az, ax, ay);
      if (url === null) continue;
      cropFrom(tile, url, this.band.tileSize, scale, x - ax * scale, y - ay * scale);
      return;
    }
  }

  /** A stored key's own image, over its crop: shown at once when already decoded, else faded in after `decode()`. */
  private addImage(tile: HTMLElement, key: string, url: string, decoded: boolean): void {
    const image = tile.ownerDocument.createElement('img');
    image.className = 'frl-atlas-tile__img';
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    image.src = url;
    tile.appendChild(image);
    if (decoded) {
      this.frlCounts.known += 1;
      image.classList.add('frl-atlas-tile__img--in', 'frl-atlas-tile__img--now');
      // Its crop goes once the image itself has loaded (review MR-09).
      if (image.complete && image.naturalWidth > 0) clearCrop(tile);
      else
        image.addEventListener(
          'load',
          () => {
            clearCrop(tile);
          },
          { once: true },
        );
      return;
    }
    this.frlPending += 1;
    this.frlCounts.asked += 1;
    void this.frlDecoded.track(key, () => image, this.frlDecode).then((ok) => {
      this.frlPending -= 1;
      if (ok) {
        this.frlCounts.decoded += 1;
        image.classList.add('frl-atlas-tile__img--in');
        // The crop under it is no longer needed once the image covers the tile: at once without a
        // fade, else once the fade has ended (review MR-08: a crop kept holds its ancestor's picture).
        if (!this.frlFade) clearCrop(tile);
        else this.afterFade(tile, image);
      } else if (image.getAttribute('src') !== EMPTY_IMAGE) this.frlCounts.failed += 1;
      this.checkIdle();
    });
  }

  /** Drops the tile's crop when its image's fade ends (`transitionend`), or a little after the fade's length when none comes. */
  private afterFade(tile: HTMLElement, image: HTMLImageElement): void {
    let done = false;
    const drop = (): void => {
      if (done) return;
      done = true;
      clearCrop(tile);
    };
    image.addEventListener('transitionend', drop, { once: true });
    tile.ownerDocument.defaultView?.setTimeout(drop, FADE_MS + FADE_MARGIN_MS);
  }

  /** A virtual key's stored ancestor, decoded off screen once; the tile then shows its crop. */
  private loadAncestor(tile: HTMLElement, key: string, url: string, scale: number, dx: number, dy: number): void {
    const document = tile.ownerDocument;
    const image = (): HTMLImageElement => {
      const element = document.createElement('img');
      element.decoding = 'async';
      element.alt = '';
      element.src = url;
      return element;
    };
    this.frlPending += 1;
    this.frlCounts.asked += 1;
    void this.frlDecoded.track(key, image, this.frlDecode).then((ok) => {
      this.frlPending -= 1;
      if (ok) {
        this.frlCounts.decoded += 1;
        cropFrom(tile, url, this.band.tileSize, scale, dx, dy);
      } else this.frlCounts.failed += 1;
      this.checkIdle();
    });
  }

  private checkIdle(): void {
    if (this.frlPending > 0 || this.frlIdle.length === 0 || this._map === undefined) return;
    const callbacks = this.frlIdle;
    this.frlIdle = [];
    for (const callback of callbacks) callback();
  }

  /** A removed tile's image request is cancelled (as `TileLayer` does for its `<img>` tiles). */
  private readonly frlUnload = (event: L.LeafletEvent): void => {
    const tile = (event as L.TileEvent).tile as HTMLElement | undefined;
    const image = tile?.querySelector('img');
    if (image !== null && image !== undefined && !image.complete) image.src = EMPTY_IMAGE;
  };
}

export interface AtlasTilesOptions {
  readonly decoded: DecodedTiles;
  readonly fade: boolean;
  readonly maxZoom: number;
  readonly tilePane?: string;
  readonly underlayPane?: string;
  readonly decodeImage?: DecodeImage;
}

/**
 * What the adapter draws for a `TileBandDescriptor`: the underlay and the tile layer, as one layer.
 * The underlay's images load once the tile layer's first view has decoded (map-atlas.md §8.3,
 * §24.2), and that moment is the band's first view (`onFirstView`): the adapter then removes a band
 * held under this one during a style switch (§21.2).
 */
export class AtlasTiles extends L.LayerGroup {
  readonly band: TileBandDescriptor;
  readonly tiles: AtlasTileLayer;
  readonly underlay: AtlasUnderlay;
  private frlFirst: FirstView | null = null;
  private frlFirstListeners: ((first: FirstView) => void)[] = [];

  constructor(band: TileBandDescriptor, options: AtlasTilesOptions) {
    const decode = options.decodeImage ?? decodeImage;
    const tiles = new AtlasTileLayer({ band, decoded: options.decoded, fade: options.fade, maxZoom: options.maxZoom, pane: options.tilePane ?? 'frl-atlas', decodeImage: decode });
    const underlay = new AtlasUnderlay({ band, decoded: options.decoded, pane: options.underlayPane ?? 'frl-underlay', decodeImage: decode });
    super([underlay, tiles]);
    this.band = band;
    this.tiles = tiles;
    this.underlay = underlay;
    tiles.onceIdle(() => {
      underlay.load();
      const counts = tiles.counts();
      // A first view that asked for no image and showed none already decoded (the sea, review
      // MR-05) proves nothing: the underlay's images, every style's, decide it instead.
      if (counts.asked === 0 && counts.known === 0) {
        underlay.onceSettled(() => {
          const under = underlay.counts();
          this.settleFirst(under.failed > 0 && under.decoded === 0 ? 'failed' : 'ready');
        });
        return;
      }
      this.settleFirst(counts.failed > 0 && counts.decoded === 0 && counts.known === 0 ? 'failed' : 'ready');
    });
  }

  private settleFirst(first: FirstView): void {
    if (this.frlFirst !== null) return;
    this.frlFirst = first;
    const listeners = this.frlFirstListeners;
    this.frlFirstListeners = [];
    for (const listener of listeners) listener(first);
  }

  /** How the first view settled; null until it has. */
  get firstView(): FirstView | null {
    return this.frlFirst;
  }

  /** Calls `listener` once the first view has settled (at once, in a microtask, if it already has). */
  onFirstView(listener: (first: FirstView) => void): void {
    const first = this.frlFirst;
    if (first === null) this.frlFirstListeners.push(listener);
    else
      queueMicrotask(() => {
        listener(first);
      });
  }

  /**
   * The pictures the tile and underlay panes hold now (map-atlas.md §24.5 counts them): the distinct
   * files of their images (a source other than the cancelled request's) and of the tiles' crops
   * (review MR-08: an ancestor decoded off screen lives only as the crops' background, and a crop
   * under an image fading in holds its ancestor too). Each file is one decoded picture.
   */
  liveImages(): number {
    const files = new Set<string>();
    for (const layer of [this.tiles.getContainer(), this.underlay.element()]) {
      if (layer === null || layer === undefined) continue;
      for (const image of layer.querySelectorAll('img')) {
        const src = image.getAttribute('src');
        if (src !== null && src !== '' && src !== EMPTY_IMAGE) files.add(src);
      }
      for (const tile of layer.querySelectorAll<HTMLElement>('.frl-atlas-tile')) {
        const crop = tile.dataset['crop'];
        if (crop !== undefined && crop !== '') files.add(crop);
      }
    }
    return files.size;
  }
}
