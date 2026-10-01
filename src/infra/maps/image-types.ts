/**
 * The two image types map art may be (docs/MAPS.md §5.3), from a file's name: apart from the header
 * reader (`image-header.ts`), which only local art needs and loads when it first verifies an image,
 * so it stays out of the entry chunk (D-050 item 6).
 */
export type ImageContentType = 'image/png' | 'image/webp';

/** The content type a file name's extension promises (`.png`, `.webp`), or null for any other name. */
export function contentTypeOfName(name: string): ImageContentType | null {
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  return null;
}
