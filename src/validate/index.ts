/**
 * `src/validate`: the route validator and the issue-code registry (docs/ARCHITECTURE.md §9.4,
 * docs/SIMULATION.md §7). Pure: the validator is a visitor of the engine's walk; it reads the
 * walker's state and records and turns rule failures and simulation facts into `ValidationIssue`s.
 *
 * Main entry points:
 * - `validateRoute(project, context, options)`: walk, simulate and validate once;
 * - `createRouteValidator(context)`: a visitor and accept policy for a long-lived walker (re-walks
 *   from checkpoints re-validate only the steps they visit);
 * - `ISSUE_CODES`, `issueCodeSpec`, `formatIssueMessage`: the registry.
 */
export * from './availability';
export * from './codes';
export { factIssues, pendingLegsIssue } from './facts';
export { compareIssues, createIssue, type IssueWords, NO_ISSUES, orderStepIssues, questLabel, type QuestNames } from './issue';
export * from './validator';
