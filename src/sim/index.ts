/**
 * `src/sim`: XP, levels and the time model as pure functions (docs/ARCHITECTURE.md §9.3,
 * docs/SIMULATION.md). No route walking (src/engine walks) and no issue codes (src/validate turns
 * the returned facts into issues).
 */
export * from './estimate';
export * from './facts';
export * from './grind';
export * from './hearth';
export * from './interaction';
export * from './kill-xp';
export * from './objectives';
export * from './provenance';
export * from './quest-xp';
export * from './taxi';
export * from './transport';
export * from './travel';
export * from './xp';
