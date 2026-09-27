/**
 * `src/optimizer/core`: the optimiser's pure core (docs/research/optimizer-m7.md): section
 * analysis and compilation, the search problem, transitions, the beam search stepper, evaluation
 * and decoding. No clock, no randomness, no browser globals; `src/validate` is read as types only.
 * The results are the best route found under these assumptions, never "optimal".
 */
export { decodeSolution, type DecodedSection } from './decode';
export { evaluateSequence } from './evaluate';
export { HASH_SEED, laneConstants, LEHMER_MODULUS, LEHMER_MULTIPLIER, P1, P2 } from './hash';
export { buildMatrix, createMatrixCache, CROSS_MAP, NOT_REQUESTED, UNKNOWN_MS } from './matrix';
export { compileProblem, isDynamicCode, transferList } from './problem';
export { analyseSection, MAX_LOCATIONS, MAX_REQUESTED_LEGS } from './section';
export { createSearch, ENTRIES_PER_KEY } from './search';
export * from './types';
