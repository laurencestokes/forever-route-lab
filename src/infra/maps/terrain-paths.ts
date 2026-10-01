/**
 * Where the committed terrain byproducts are (`public/maps/terrain/`; D-032), relative to the app's
 * base: apart from their parser (`terrain.ts`), which loads only when the map first asks for them,
 * so it stays out of the entry chunk (D-050 item 6).
 */
export const TERRAIN_MANIFEST_PATH = 'maps/terrain/manifest.json';
/** Where the deployed terrain notice is, relative to the app's base. */
export const TERRAIN_NOTICE_PATH = 'maps/terrain/NOTICE.md';
