/**
 * Facts every map tool shares: the client pin, the committed placeholder geometry's path and the
 * links the notices cite. They live apart from `constants.ts` and `art-notice.ts` (which re-export
 * them) so that the minimap tool's module closure, its manifest's `toolTreeHash`
 * (docs/research/map-atlas.md §18.7), holds only what its output depends on: an edit to the
 * painted-art tables or notice no longer invalidates the minimap pack (review finding MD-01).
 */

/**
 * The client build `convert.ts`, `atlas.ts`, `minimap.ts` and `import.ts --build` read
 * (terrain-navigation.md §2, gate G1): `LocalCasc.open({ pin })` refuses any other installed
 * build. The committed art, atlas and minimap record it.
 */
export const CLIENT_PIN = { product: 'wow_classic_beta', version: '1.60.1.70124', buildKey: 'dd3dfc2881c407299f46c2aaf34c130b' } as const;

/** The committed placeholder geometry (MAPS.md §5.5). */
export const PLACEHOLDER_DIR = 'public/maps/placeholder';
export const GEOMETRY_FILE = 'geometry.placeholder.json';

/** Blizzard's Legal FAQ, the governing source D-033 records (checked 2026-09-26). */
export const BLIZZARD_LEGAL_FAQ = 'https://www.blizzard.com/en-us/legal/c1ae32ac-7ff9-4ac3-a03b-fc04b8697010/blizzard-legal-faq';
export const REPOSITORY_URL = 'https://github.com/laurencestokes/forever-route-lab';
