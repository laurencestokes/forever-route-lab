// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordProvenance } from '../../domain/dataset';
import type { StepKind } from '../../domain/route';
import { knownReadout, unknownReadout } from '../lib/readout';
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../../app/rules-exports';
import { AssumedMarker } from './AssumedMarker';
import { DIFFICULTY_TEXT, DifficultyLabel, PIP_BOX_HEIGHT, PIP_BOX_WIDTH, describeDifficulty } from './DifficultyLabel';
import { ProvenanceBadge } from './ProvenanceBadge';
import { ReadoutValue } from './ReadoutValue';
import { SeverityIcon } from './SeverityIcon';
import { STEP_KIND_LABELS, StepTypeGlyph } from './StepTypeGlyph';
import { describeForeverProvenance, foreverProvenanceOf } from './provenance';

afterEach(cleanup);

const provenance = (p: Partial<RecordProvenance>): RecordProvenance => ({
  upstreamDiff: 'era',
  foreverStatus: 'unknown',
  corrected: false,
  created: false,
  source: 'questiedb',
  ...p,
});

describe('foreverProvenanceOf', () => {
  it('is unknown for every Era-baseline record', () => {
    expect(foreverProvenanceOf(provenance({}))).toEqual({ claim: 'unknown', declaredBy: null });
    expect(foreverProvenanceOf(provenance({ upstreamDiff: 'era-coords' }))).toEqual({ claim: 'unknown', declaredBy: null });
  });

  it('reads the dataset diff', () => {
    expect(foreverProvenanceOf(provenance({ upstreamDiff: 'forever-new' }))).toEqual({ claim: 'new', declaredBy: 'data' });
    expect(foreverProvenanceOf(provenance({ upstreamDiff: 'forever-changed' }))).toEqual({ claim: 'changed', declaredBy: 'data' });
  });

  it('prefers a user declaration', () => {
    expect(foreverProvenanceOf(provenance({ upstreamDiff: 'forever-changed', foreverStatus: 'user-declared-new' }))).toEqual({
      claim: 'new',
      declaredBy: 'user',
    });
    expect(foreverProvenanceOf(provenance({ foreverStatus: 'user-declared-changed' }))).toEqual({ claim: 'changed', declaredBy: 'user' });
  });

  it('describes each claim in words', () => {
    expect(describeForeverProvenance({ claim: 'unknown', declaredBy: null })).toBe('Forever status: unknown');
    expect(describeForeverProvenance({ claim: 'new', declaredBy: 'data' })).toBe('New in Forever (per the dataset)');
    expect(describeForeverProvenance({ claim: 'changed', declaredBy: 'user' })).toBe('Changed in Forever (user-declared)');
  });
});

describe('ProvenanceBadge', () => {
  it('renders nothing compact for unknown, and text in full', () => {
    const { container, rerender } = render(<ProvenanceBadge provenance={{ claim: 'unknown', declaredBy: null }} />);
    expect(container.innerHTML).toBe('');
    rerender(<ProvenanceBadge provenance={{ claim: 'unknown', declaredBy: null }} variant="full" />);
    expect(container.textContent).toBe('Forever status: unknown');
  });

  it('uses ◆ for new and ◇ for changed, with text and the user-declared variant', () => {
    const { container, rerender } = render(<ProvenanceBadge provenance={{ claim: 'new', declaredBy: 'data' }} />);
    expect(container.textContent).toBe('◆New in Forever (per the dataset)');
    rerender(<ProvenanceBadge provenance={{ claim: 'changed', declaredBy: 'user' }} variant="full" />);
    const badge = container.querySelector('.frl-provenance');
    expect(badge?.className).toContain('frl-provenance--user');
    expect(badge?.textContent).toBe('◇Changed in Forever · user-declared');
    expect(badge?.getAttribute('title')).toBe('Changed in Forever (user-declared)');
  });
});

describe('DifficultyLabel', () => {
  it('carries difficulty as colour class, pip count and text', () => {
    const { container } = render(<DifficultyLabel level={12} difficulty="verydifficult" variant="full" />);
    const label = container.querySelector('.frl-difficulty') as HTMLElement;
    expect(label.className).toContain('frl-difficulty--verydifficult');
    expect(label.querySelectorAll('.frl-difficulty__pip.is-on')).toHaveLength(4);
    expect(label.textContent).toContain('Very difficult');
    expect(label.getAttribute('title')).toBe('Quest level 12, Very difficult (orange)');
  });

  it('stays neutral and says so when unknown', () => {
    const { container } = render(<DifficultyLabel level={null} difficulty={null} />);
    const label = container.querySelector('.frl-difficulty') as HTMLElement;
    expect(label.getAttribute('data-difficulty')).toBe('unknown');
    expect(label.querySelectorAll('.frl-difficulty__pip.is-on')).toHaveLength(0);
    expect(label.textContent).toContain('?');
    expect(describeDifficulty(null, null, false)).toBe('Quest level unknown, difficulty unknown');
  });

  it('uses the labels of the rules module, not a copy', () => {
    expect(DIFFICULTY_TEXT).toBe(DIFFICULTY_LABELS);
    for (const difficulty of DIFFICULTIES) {
      cleanup();
      const { container } = render(<DifficultyLabel level={10} difficulty={difficulty} variant="full" />);
      expect(container.querySelector('.frl-difficulty__text')?.textContent).toBe(DIFFICULTY_LABELS[difficulty]);
      expect(describeDifficulty(10, difficulty, false)).toContain(DIFFICULTY_LABELS[difficulty]);
    }
  });

  it('draws the pips on whole pixels with crisp edges: 2px bars, 1px gaps', () => {
    const { container } = render(<DifficultyLabel level={12} difficulty="difficult" />);
    const svg = container.querySelector('svg.frl-difficulty__pips') as SVGSVGElement;
    expect([PIP_BOX_WIDTH, PIP_BOX_HEIGHT]).toEqual([14, 10]);
    expect(svg.getAttribute('viewBox')).toBe('0 0 14 10');
    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.getAttribute('height')).toBe('10');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    const rects = [...svg.querySelectorAll('rect')].map((r) => ({
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      width: Number(r.getAttribute('width')),
      height: Number(r.getAttribute('height')),
      rounded: r.hasAttribute('rx'),
    }));
    expect(rects).toEqual([
      { x: 0, y: 8, width: 2, height: 2, rounded: false },
      { x: 3, y: 6, width: 2, height: 4, rounded: false },
      { x: 6, y: 4, width: 2, height: 6, rounded: false },
      { x: 9, y: 2, width: 2, height: 8, rounded: false },
      { x: 12, y: 0, width: 2, height: 10, rounded: false },
    ]);
    for (const rect of rects) {
      expect(Number.isInteger(rect.x) && Number.isInteger(rect.y) && Number.isInteger(rect.width) && Number.isInteger(rect.height)).toBe(true);
    }
    expect(svg.querySelectorAll('.frl-difficulty__pip.is-on')).toHaveLength(3);
  });

  it('flags a difficulty computed from a lower-bound level', () => {
    const { container } = render(<DifficultyLabel level={5} difficulty="standard" uncertain />);
    expect(container.querySelector('.frl-difficulty--uncertain')).not.toBeNull();
    expect(describeDifficulty(5, 'standard', true)).toBe('Quest level 5, Standard (green), from a lower-bound level: may be easier');
  });
});

describe('StepTypeGlyph', () => {
  it('has a named glyph for every step kind', () => {
    const kinds = Object.keys(STEP_KIND_LABELS) as StepKind[];
    expect(kinds).toHaveLength(11);
    for (const kind of kinds) {
      cleanup();
      render(<StepTypeGlyph kind={kind} />);
      expect(screen.getByRole('img', { name: STEP_KIND_LABELS[kind] }).getAttribute('data-step-kind')).toBe(kind);
    }
  });

  it('can be decorative', () => {
    const { container } = render(<StepTypeGlyph kind="hearth" labelled={false} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('SeverityIcon', () => {
  it('names each severity', () => {
    render(
      <>
        <SeverityIcon severity="error" />
        <SeverityIcon severity="warning" />
        <SeverityIcon severity="info" />
      </>,
    );
    expect(screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'))).toEqual(['Error', 'Warning', 'Info']);
  });
});

describe('AssumedMarker and ReadoutValue', () => {
  it('explains the marker in text', () => {
    const { container } = render(<AssumedMarker detail="seconds per kill 20" />);
    expect(container.textContent).toBe('≈(Depends on assumptions: seconds per kill 20)');
    cleanup();
    const era = render(<AssumedMarker reason="era-fallback" />);
    expect(era.container.textContent).toContain('Uses Era values where Forever values are unknown');
  });

  it('renders lower bounds with ≥ and says "at least"', () => {
    const { container } = render(<ReadoutValue readout={knownReadout(1234, { lowerBound: true })} format={String} />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('≥1234');
    expect(container.querySelector('.frl-visually-hidden')?.textContent).toBe('at least 1234');
  });

  it('renders unknown as ? with its reason, never 0', () => {
    const { container } = render(<ReadoutValue readout={unknownReadout('Quest XP unknown')} format={String} />);
    expect(container.textContent).toBe('?Unknown: Quest XP unknown');
  });
});
