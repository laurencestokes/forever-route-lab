/**
 * `src/geo`: coordinates and map metadata (ARCHITECTURE §6, D-017, D-018; docs/MAPS.md;
 * docs/research/coordinates.md). Pure: no DOM, Node, clock, randomness or bitwise operators.
 * Hashing the canonical frame and content strings happens in `tools/maps` (node:crypto) and
 * `infra/maps` (WebCrypto), never here.
 */
export * from './content';
export * from './distance';
export * from './era';
export * from './frame';
export * from './geometry';
export * from './groups';
export * from './resolve';
export * from './transforms';
export * from './types';
export * from './zones';
