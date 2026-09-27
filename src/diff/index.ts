/**
 * `src/diff`: the route diff (docs/ARCHITECTURE.md §13, docs/research/optimizer-m7.md §10). Pure;
 * imports only `domain`.
 */
export { applyChangeSets, applyRouteChangeSets } from './apply';
export { buildChangeSets, type ChangeSetInput, closeChangeSets } from './change-sets';
export { diffRoute, diffRoutes } from './diff';
export { structurallyEqual } from './equal';
export { longestIncreasingSubsequence } from './lis';
export { hostIndices, semanticStepKey, stepQuestIds } from './steps';
export type { ChangeSet, DiffOp, DiffOpKind, DiffOptions, DiffRelations, RouteDiff, StepDependency } from './types';
