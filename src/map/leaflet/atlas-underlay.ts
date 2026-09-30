import * as L from 'leaflet';
import { storedTilesAt, tileUrl, type TileBandDescriptor } from '../adapter';
import { decodeImage, tileKey, type DecodedTiles, type DecodeImage } from './atlas-decoded';

/**
 * The atlas underlay (docs/research/map-atlas.md §8.3, MA-01; D-042 A3, A10; step ATL.7): one
 * container, in pane `frl-underlay` (z 244, under the tile layer's `frl-atlas`), holding an
 * `<img alt="">` for **every stored key of the underlay level** (the band's `underlayLevel`: −5 in the
 * painted style, 13 tiles, about 92 kB, the same files and URLs as the first view's tiles; −6 in the
 * minimap style, 4 tiles, 21 kB, §24.5), each at its pixel position on that level. It is never
 * pruned. On `zoom`, `viewreset` and `zoomanim` it sets **one** transform on the container
 * (translate and scale `2^(zoom − underlayLevel)`, the computation Leaflet 1.9.4's
 * `GridLayer._setZoomTransform` does), so it covers the whole extent at every zoom and during every
 * gesture frame, including the newly exposed edges of a zoom-out before the tile layer's next
 * update. Its images load when `load()` is called: after the tile layer's first view has decoded
 * (`AtlasTiles`). Each decoded image joins the session's decoded keys, so tiles can start as its crop.
 *
 * Leaflet 1.9.4 internals used: `Map._getNewPixelOrigin`. The container is scaled up to 128× at
 * zoom +2 (256× for the minimap's level −6), which the GPU composites; its cost on a laptop is measured in ATL.9 (§9.2), with hiding it
 * above zoom 0 as the fallback.
 */

interface MapInternals {
  _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
}

export interface AtlasUnderlayOptions {
  readonly band: TileBandDescriptor;
  readonly decoded: DecodedTiles;
  readonly pane?: string;
  readonly decodeImage?: DecodeImage;
}

export class AtlasUnderlay extends L.Layer {
  readonly band: TileBandDescriptor;
  private readonly frlDecoded: DecodedTiles;
  private readonly frlDecode: DecodeImage;
  private frlContainer: HTMLElement | null = null;
  private frlImages: { readonly key: string; readonly url: string; readonly image: HTMLImageElement }[] = [];
  private frlLoaded = false;
  private frlTransforms = 0;
  /** Its images' outcomes once loading (review MR-05: they decide a first view that asked for no tile). */
  private frlCounts = { asked: 0, decoded: 0, failed: 0 };
  private frlSettled: (() => void)[] = [];

  constructor(options: AtlasUnderlayOptions) {
    const layerOptions: L.LayerOptions = { pane: options.pane ?? 'frl-underlay' };
    super(layerOptions);
    // L.Layer has no initialize(), so the constructor does not take options by itself.
    L.Util.setOptions(this, layerOptions);
    this.band = options.band;
    this.frlDecoded = options.decoded;
    this.frlDecode = options.decodeImage ?? decodeImage;
  }

  override onAdd(map: L.Map): this {
    const document = map.getContainer().ownerDocument;
    const container = document.createElement('div');
    container.className = 'frl-atlas-underlay leaflet-zoom-animated';
    container.setAttribute('aria-hidden', 'true');
    const { band } = this;
    const level = band.underlayLevel;
    const size = band.tileSize;
    this.frlImages = [];
    for (const [x, y] of storedTilesAt(band.index, level)) {
      const url = tileUrl(band, level, x, y);
      if (url === null) continue;
      const image = document.createElement('img');
      image.className = 'frl-atlas-underlay__img';
      image.alt = '';
      image.decoding = 'async';
      image.draggable = false;
      image.style.left = `${String(x * size)}px`;
      image.style.top = `${String(y * size)}px`;
      image.style.width = `${String(size)}px`;
      image.style.height = `${String(size)}px`;
      container.appendChild(image);
      this.frlImages.push({ key: tileKey(level, x, y), url, image });
    }
    this.getPane()?.appendChild(container);
    this.frlContainer = container;
    this.setTransform(map.getCenter(), map.getZoom());
    if (this.frlLoaded) this.fill();
    return this;
  }

  override onRemove(): this {
    this.frlContainer?.remove();
    this.frlContainer = null;
    this.frlImages = [];
    return this;
  }

  override getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return { zoom: this.frlOnZoom, viewreset: this.frlOnZoom, zoomanim: this.frlOnAnim as L.LeafletEventHandlerFn };
  }

  /** Starts loading the images (once). */
  load(): void {
    if (this.frlLoaded) return;
    this.frlLoaded = true;
    this.fill();
  }

  /** The keys the underlay holds, `z/x/y` (tests and diagnostics). */
  keys(): readonly string[] {
    return this.frlImages.map((entry) => entry.key);
  }

  /** The container of the images, while on a map. */
  element(): HTMLElement | null {
    return this.frlContainer;
  }

  /** Transforms set so far (tests: one per zoom event). */
  transforms(): number {
    return this.frlTransforms;
  }

  get loaded(): boolean {
    return this.frlLoaded;
  }

  /** The images asked for, decoded (in the session, before or now) and failed so far. */
  counts(): { readonly asked: number; readonly decoded: number; readonly failed: number } {
    return { ...this.frlCounts };
  }

  /** Calls `callback` once every image asked for has decoded or failed (in a microtask, if they all have). */
  onceSettled(callback: () => void): void {
    this.frlSettled.push(callback);
    queueMicrotask(() => {
      this.checkSettled();
    });
  }

  private checkSettled(): void {
    const { asked, decoded, failed } = this.frlCounts;
    if (!this.frlLoaded || decoded + failed < asked || this.frlSettled.length === 0) return;
    const callbacks = this.frlSettled;
    this.frlSettled = [];
    for (const callback of callbacks) callback();
  }

  private fill(): void {
    for (const { key, url, image } of this.frlImages) {
      if (image.getAttribute('src') !== null) continue;
      image.src = url;
      this.frlCounts.asked += 1;
      void this.frlDecoded.track(key, () => image, this.frlDecode).then((ok) => {
        if (ok) this.frlCounts.decoded += 1;
        else this.frlCounts.failed += 1;
        this.checkSettled();
      });
    }
  }

  private readonly frlOnZoom = (): void => {
    const map = this._map as L.Map | undefined;
    if (map === undefined) return;
    this.setTransform(map.getCenter(), map.getZoom());
  };

  private readonly frlOnAnim = (event: L.ZoomAnimEvent): void => {
    this.setTransform(event.center, event.zoom);
  };

  /** Underlay-level pixels to layer pixels at `zoom` around `center`: `GridLayer._setZoomTransform` with the level's origin at the atlas origin. */
  private setTransform(center: L.LatLng, zoom: number): void {
    const map = this._map as L.Map | undefined;
    const container = this.frlContainer;
    if (map === undefined || container === null) return;
    const scale = map.getZoomScale(zoom, this.band.underlayLevel);
    const origin = (map as unknown as MapInternals)._getNewPixelOrigin(center, zoom);
    L.DomUtil.setTransform(container, L.point(0, 0).subtract(origin).round(), scale);
    this.frlTransforms += 1;
  }
}
