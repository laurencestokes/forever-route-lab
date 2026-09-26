/**
 * `src/engine`: the route walker (docs/ARCHITECTURE.md §9.2). It walks a route once, step by step,
 * pricing each step with `src/sim` and applying it to one mutable character state, and hands the
 * results to visitors (the validator, route context). Pure: the dataset, geometry, rules, travel
 * model and TravelGraph are injected; no clock, no randomness.
 */
export * from './accept';
export * from './conditions';
export * from './legs';
export { cloneState, knownNodeKeys } from './state';
export { isDeathSkip } from './steps';
export * from './types';
export * from './walker';
