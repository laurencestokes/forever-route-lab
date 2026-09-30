/**
 * The atlas keys decoded in this session, per band (docs/research/map-atlas.md §8.3, §21.2): what the
 * tile layer's ancestor-first tiles may start from, shared with the underlay. No Leaflet import.
 */

/** Decodes an image element: `HTMLImageElement.decode()` where it exists, else its load event. */
export type DecodeImage = (image: HTMLImageElement) => Promise<void>;

export const decodeImage: DecodeImage = (image) =>
  typeof image.decode === 'function'
    ? image.decode()
    : new Promise<void>((resolve, reject) => {
        if (image.complete && image.naturalWidth > 0) {
          resolve();
          return;
        }
        image.addEventListener('load', () => {
          resolve();
        });
        image.addEventListener('error', () => {
          reject(new Error(`could not load ${image.src}`));
        });
      });

/** A tile key, `z/x/y`. */
export const tileKey = (z: number, x: number, y: number): string => `${String(z)}/${String(x)}/${String(y)}`;

/**
 * One band's atlas keys decoded in this session, shared by its tile layer and underlay. The adapter
 * keeps one per band for its lifetime (map-atlas.md §21.2), so a band re-created after a surface or
 * style switch still starts from them, and a key of one style never stands in for another's.
 * Each key is decoded once: callers of `track` for a key share its decode, and the image of a
 * later caller is not even created.
 */
export class DecodedTiles {
  private readonly keys = new Set<string>();
  private readonly loading = new Map<string, Promise<boolean>>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    this.keys.add(key);
    this.loading.delete(key);
  }

  get size(): number {
    return this.keys.size;
  }

  /**
   * Decodes `key`'s image once (true when decoded): `image` is asked for only when the key is neither
   * decoded nor decoding. A failed decode is forgotten, so a later call tries again.
   */
  track(key: string, image: () => HTMLImageElement, decode: DecodeImage): Promise<boolean> {
    if (this.keys.has(key)) return Promise.resolve(true);
    const pending = this.loading.get(key);
    if (pending !== undefined) return pending;
    const promise = decode(image()).then(
      () => {
        this.add(key);
        return true;
      },
      () => {
        this.loading.delete(key);
        return false;
      },
    );
    this.loading.set(key, promise);
    return promise;
  }
}
