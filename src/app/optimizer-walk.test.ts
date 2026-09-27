import { describe, expect, it } from 'vitest';
import { analyseSection } from '../optimizer/core';
import { appHost, questScenario } from './optimizer-test-helpers';
import { createRunWalker, walkSection } from './optimizer-walk';

/**
 * The run's private walks (docs/research/optimizer-m7.md §5.1): one place cache per run (review
 * PRF-07), so the analysis's leg pairs and the baseline walk that compile prices resolve to the
 * same endpoint objects, and the travel model's per-point caches are reused between them.
 */

const scenario = () =>
  questScenario(
    [
      [101, 3000, 3000, 0],
      [102, 1600, 100, 0],
      [103, 1600, 0, 100],
    ],
    [0, 200],
  );

describe('the run walker', () => {
  it('shares one place cache between the analysis walk and the baseline walk', () => {
    const made = scenario();
    const run = createRunWalker(appHost(made));
    const analysisWalk = walkSection(run, made.project, made.section, { probe: false });
    const baselineWalk = walkSection(run, made.project, made.section, { probe: true, from: 0 });
    expect(analysisWalk.walk.places).toBe(run.places);
    expect(baselineWalk.walk.places).toBe(analysisWalk.walk.places);
  });

  it("resolves the analysis's leg pairs and the baseline's places to the same endpoint objects", () => {
    const made = scenario();
    const run = createRunWalker(appHost(made));
    const analysisWalk = walkSection(run, made.project, made.section, { probe: false });
    const analysis = analyseSection({ project: made.project, section: made.section, goal: { targetXp: 3000, grindFill: 'shortfall' }, context: run.engine, walk: analysisWalk.walk, availability: run.availability });
    if (!analysis.ok) throw new Error(analysis.reason);
    const baselineWalk = walkSection(run, made.project, made.section, { probe: true, from: analysis.castWindowStart });
    const step = made.project.route.steps[made.section.first];
    if (step === undefined || !('location' in step) || step.location === null) throw new Error('no located first step');
    const fromAnalysis = analysisWalk.walk.places.location(step.location);
    if (fromAnalysis === null) throw new Error('the first step does not resolve');
    expect(baselineWalk.walk.places.location(step.location)).toBe(fromAnalysis);
    // Every point the matrix asks for is one of the run's own endpoint objects.
    const points = new Set(analysis.pairs.flatMap((pair) => [pair.from.point, pair.to.point]));
    expect(points.has(fromAnalysis.point)).toBe(true);
  });
});
