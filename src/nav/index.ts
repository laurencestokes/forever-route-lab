/**
 * `src/nav`: terrain navigation at runtime (Milestone 3b, docs/research/terrain-navigation.md
 * §5-§9; D-028, D-030, D-031, D-034). Pure: no DOM, Node, fetch, clock, randomness, bitwise
 * operators, `hypot` or trigonometry (G14). It decodes the committed block (FRN3 v3) and per-map
 * (FRNM v1) files, links blocks as they load in any order, snaps endpoints with rules A and B,
 * and answers `legsFrom` with a resumable Dijkstra, a funnel per target and the ground/swim split.
 * Fetching, verification, pinning and the LRU belong to `src/nav/worker` (step 3b.6).
 */
export * from './bytes';
export * from './components';
export * from './cost';
export * from './format';
export * from './funnel';
export * from './grid';
export * from './heap';
export * from './legs';
export * from './link';
export * from './manifest';
export * from './mapfile';
export * from './mesh';
export * from './open';
export * from './snap';
