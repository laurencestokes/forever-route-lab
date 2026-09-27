import { describe, expect, it } from 'vitest';
import type { RouteStep } from '../domain/route';
import { makeTurnInStep } from '../domain/step-factory';
import { questId, sequentialIdSource } from '../domain/ids';
import { appBaseline, appQuest, appScenario, appSteps, at, questScenario } from './optimizer-test-helpers';
import { type VerificationReport, verifyCandidate } from './optimizer-verify';

/**
 * The verification re-walk (docs/research/optimizer-m7.md §4.1): each rule fails the candidates
 * that break it, the best route found passes, and `estimatedMs: null` skips parity.
 */

const rules = (report: VerificationReport): string[] => [...new Set(report.failures.map((f) => f.rule))].sort();

/** Fixture 1: A 101 far, B 102 and C 103 near; target 3,000. */
const fixture1 = () =>
  questScenario(
    [
      [101, 3000, 3000, 0],
      [102, 1600, 100, 0],
      [103, 1600, 0, 100],
    ],
    [0, 200],
  );

const pick = (steps: readonly RouteStep[], ...indices: number[]): RouteStep[] =>
  indices.map((i) => {
    const step = steps[i];
    if (step === undefined) throw new Error(`no step ${String(i)}`);
    return step;
  });

describe('verifyCandidate', () => {
  it('passes the best route found, within parity of its estimate', () => {
    const made = fixture1();
    const { run, baseline } = appBaseline(made, 3000);
    const steps = made.project.route.steps;
    const report = verifyCandidate({ run, baseline, steps: pick(steps, 2, 3, 4, 5), estimatedMs: 46_142 });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.engineMs).toBeCloseTo(46_142.1, 0);
    expect(report.originalMs).toBeCloseTo(632_142.1, 0);
    expect(report.parity).toBeLessThan(1);
    expect(report.steps).toEqual([...pick(steps, 2, 3, 4, 5), steps[6]]);
    expect(report.metrics.xpGained.value).toBe(3200);
  });

  it('fails the original order on improvement only, and skips parity without an estimate', () => {
    const made = fixture1();
    const { run, baseline } = appBaseline(made, 3000);
    const report = verifyCandidate({ run, baseline, steps: made.project.route.steps.slice(0, 6), estimatedMs: null });
    expect(rules(report)).toEqual(['improvement']);
    expect(report.parity).toBeNull();
    expect(report.engineMs).toBe(report.originalMs);
  });

  it('fails an estimate far from the re-walk (parity), and a candidate below the target (improvement)', () => {
    const made = fixture1();
    const { run, baseline } = appBaseline(made, 3000);
    const steps = made.project.route.steps;
    expect(rules(verifyCandidate({ run, baseline, steps: pick(steps, 2, 3, 4, 5), estimatedMs: 60_000 }))).toEqual(['parity']);
    // B alone: 1,600 XP of 3,000.
    const short = verifyCandidate({ run, baseline, steps: pick(steps, 2, 3), estimatedMs: null });
    expect(rules(short)).toEqual(['improvement']);
    expect(short.failures[0]?.detail).toMatch(/gains 1600 known XP, below the target of 3000/);
  });

  it('fails an estimate beyond the part bound though within 1% of the re-walk (review PAR-09)', () => {
    const made = fixture1();
    const { run, baseline } = appBaseline(made, 3000);
    const steps = made.project.route.steps;
    // 4 steps and 1 exit step: a part bound of 20 ms; 1% of 46,142 ms is 461 ms.
    const drifted = verifyCandidate({ run, baseline, steps: pick(steps, 2, 3, 4, 5), estimatedMs: 46_142 + 100 });
    expect(rules(drifted)).toEqual(['parity']);
    expect(drifted.parityBound).toBe(20);
    expect(drifted.failures[0]?.detail).toMatch(/bound 20\.0 ms/);
    const close = verifyCandidate({ run, baseline, steps: pick(steps, 2, 3, 4, 5), estimatedMs: 46_142 + 15 });
    expect(close.failures).toEqual([]);
  });

  it('judges improvement against the incumbent it is given, and not at all for the incumbent itself (review PAR-05)', () => {
    const made = fixture1();
    const { run, baseline } = appBaseline(made, 3000);
    const steps = made.project.route.steps;
    const best = pick(steps, 2, 3, 4, 5);
    // Against an incumbent faster than the candidate, the candidate is no improvement.
    const against = verifyCandidate({ run, baseline: { ...baseline, incumbentMs: 40_000 }, steps: best, estimatedMs: null });
    expect(rules(against)).toEqual(['improvement']);
    expect(against.incumbentMs).toBe(40_000);
    expect(against.failures[0]?.detail).toMatch(/not shorter than the original with the grind fill the target needs, 40000\.0 ms/);
    // The original judged as the incumbent: every rule but improvement.
    const itself = verifyCandidate({ run, baseline, steps: steps.slice(0, 6), estimatedMs: null, judgeImprovement: false });
    expect(itself.failures).toEqual([]);
    expect(itself.incumbentMs).toBe(itself.originalMs);
  });

  it('fails a quest dropped in part (anchors) that is left in the log (loose-end)', () => {
    const made = fixture1();
    const { run, baseline } = appBaseline(made, 3000);
    const steps = made.project.route.steps;
    const report = verifyCandidate({ run, baseline, steps: pick(steps, 0, 2, 3, 4, 5), estimatedMs: null });
    expect(rules(report)).toEqual(['anchors', 'loose-end']);
  });

  it('fails anchors out of their original order', () => {
    const s = appSteps();
    const made = appScenario({
      quests: [appQuest(741, 1000), appQuest(742, 1000)],
      steps: [...s.pair(741, 200, 100), s.note(300, -200, { locked: true }), ...s.pair(742, -200, 100), s.note(-300, -200, { locked: true })],
      exit: [400, 0],
    });
    const { run, baseline } = appBaseline(made);
    const steps = made.project.route.steps;
    expect(baseline.anchors).toEqual(new Set([steps[2]?.id, steps[5]?.id]));
    const swapped = verifyCandidate({ run, baseline, steps: pick(steps, 5, 3, 4, 2, 0, 1), estimatedMs: null });
    expect(rules(swapped)).toContain('anchors');
    // Fixture 7e's best route found keeps them in order and passes.
    const kept = verifyCandidate({ run, baseline, steps: pick(steps, 2, 5, 3, 4, 0, 1), estimatedMs: null });
    expect(kept.failures).toEqual([]);
  });

  it('fails an accept made before its level gate (availability, errors)', () => {
    const s = appSteps();
    const made = appScenario({
      quests: [appQuest(501, 4000), appQuest(502, 4000), appQuest(503, 1000, { minLevel: 11 })],
      steps: [...s.pair(501, 400, 300), ...s.pair(502, 800, 0), ...s.pair(503, -100, 0)],
      exit: [800, 0],
    });
    const { run, baseline } = appBaseline(made);
    const steps = made.project.route.steps;
    const early = verifyCandidate({ run, baseline, steps: pick(steps, 4, 5, 0, 1, 2, 3), estimatedMs: null });
    expect(rules(early)).toEqual(['availability', 'errors']);
    expect(early.newIssues.map((issue) => issue.code)).toContain('VAL004-min-level');
    // B, A, C: 296.310 s against 298.000 s.
    const best = verifyCandidate({ run, baseline, steps: pick(steps, 2, 3, 0, 1, 4, 5), estimatedMs: 296_310 });
    expect(best.failures).toEqual([]);
  });

  it('fails a changed end state on a quest the suffix names (end-state), and a changed suffix (errors)', () => {
    const s = appSteps();
    const suffix = [makeTurnInStep(sequentialIdSource(9000), { questId: questId(701), location: at(500, 0) })];
    const made = appScenario({
      quests: [appQuest(701, 1000), appQuest(702, 1000)],
      steps: [s.accept(701, 500, 0), ...s.pair(702, -100, 0)],
      suffix,
    });
    const { run, baseline } = appBaseline(made);
    expect(baseline.summary.qExt).toEqual([701]);
    const steps = made.project.route.steps;
    // X's accept dropped: X is not in the log at the section end, and the suffix turn-in fails.
    const dropped = verifyCandidate({ run, baseline, steps: pick(steps, 1, 2), estimatedMs: null });
    expect(rules(dropped)).toContain('end-state');
    expect(rules(dropped)).toContain('errors');
    // Fixture 7a's best route found: accept Y, turn in Y, accept X (79.000 s against 179.000 s).
    const best = verifyCandidate({ run, baseline, steps: pick(steps, 1, 2, 0), estimatedMs: 79_000 });
    expect(best.failures).toEqual([]);
  });
});
