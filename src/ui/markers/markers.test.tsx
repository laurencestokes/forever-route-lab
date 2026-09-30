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
import { BADGE_SLOT_OF, DUNGEON_GLYPH, MARK_STATES, QUEST_GLYPH, QUEST_MARK_STATES, TURN_IN_GLYPH } from '../../app/map-exports';
import { QUEST_MARK_COLOUR_MIN_PX, QUEST_MARK_GLYPHS, QUEST_MARK_PX, QUEST_MARK_STATE_ORDER, QuestMark, type QuestMarkState, questMarkColour } from './QuestMark';
import { StepMark, type StepMarkKind } from './StepMark';

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

describe('QuestMark (ui-refresh.md §5.1; the state table is map-presentation.md §25.2.3)', () => {
  const mark = (container: HTMLElement) => {
    const svg = container.querySelector('svg.frl-quest-mark');
    if (svg === null) throw new Error('no mark');
    return svg;
  };
  const glyphPaths = (svg: Element) => [...svg.querySelectorAll('.frl-quest-mark__glyph path')].map((path) => path.getAttribute('d'));

  it('covers every quest-mark state of the one table, in its order', () => {
    expect(QUEST_MARK_STATE_ORDER).toEqual(QUEST_MARK_STATES);
  });

  it('draws the marks module’s own paths: one object, the "!" for quests and the "?" for turn-ins', () => {
    expect(QUEST_MARK_GLYPHS.quest).toBe(QUEST_GLYPH);
    expect(QUEST_MARK_GLYPHS['turn-in']).toBe(TURN_IN_GLYPH);
    for (const state of QUEST_MARK_STATE_ORDER) {
      cleanup();
      const { container } = render(<QuestMark state={state} difficulty="standard" />);
      const svg = mark(container);
      const glyph = MARK_STATES[state].glyph === 'turn-in' ? TURN_IN_GLYPH : QUEST_GLYPH;
      expect(glyphPaths(svg), state).toEqual(glyph.map((part) => part.d));
      expect(svg.getAttribute('data-glyph')).toBe(MARK_STATES[state].glyph);
      // Stroked parts keep the module's widths, with round caps (the constant-width "!", review UR-09).
      const stroke = svg.querySelector('.frl-quest-mark__glyph .frl-quest-mark__stroke');
      expect(stroke?.getAttribute('stroke-width')).toBe(String(glyph.find((part) => part.mode === 'stroke')?.width));
      expect(stroke?.getAttribute('stroke-linecap')).toBe('round');
    }
  });

  it('fills the disc with the difficulty colour only in a state that takes one, and only for a known difficulty', () => {
    const filled: QuestMarkState[] = ['available', 'uncertain', 'ready'];
    for (const state of filled) {
      for (const difficulty of DIFFICULTIES) {
        cleanup();
        const svg = mark(render(<QuestMark state={state} difficulty={difficulty} />).container);
        expect(svg.getAttribute('class'), `${state} ${difficulty}`).toContain('is-filled');
        expect(svg.getAttribute('class')).toContain(`frl-quest-mark--${difficulty}`);
        expect(svg.getAttribute('data-colour')).toBe(difficulty);
      }
      // Unknown difficulty: filled with the neutral, never a difficulty colour.
      cleanup();
      const unknown = mark(render(<QuestMark state={state} difficulty={null} />).container);
      expect(unknown.getAttribute('data-colour')).toBe('unknown');
      expect(unknown.getAttribute('class')).toContain('frl-quest-mark--unknown');
      for (const difficulty of DIFFICULTIES) expect(unknown.getAttribute('class')).not.toContain(`frl-quest-mark--${difficulty}`);
    }
    // A low-level quest is always the trivial grey (one pip on its chip).
    cleanup();
    expect(mark(render(<QuestMark state="low-level" difficulty="difficult" />).container).getAttribute('data-colour')).toBe('trivial');
    // Nothing to take yet: hollow and uncoloured, whatever the difficulty.
    for (const state of ['locked', 'unlocks-soon', 'in-progress', 'record-unknown'] as const) {
      cleanup();
      const svg = mark(render(<QuestMark state={state} difficulty="impossible" />).container);
      expect(svg.getAttribute('class'), state).toContain('is-hollow');
      expect(svg.getAttribute('data-colour')).toBe('none');
      expect(svg.getAttribute('class')).not.toContain('impossible');
      expect(questMarkColour(state, 'impossible')).toBeNull();
    }
  });

  it('colours only discs of 11px or more, which both row sizes are (D-041 G, D-047)', () => {
    expect(QUEST_MARK_COLOUR_MIN_PX).toBe(11);
    expect(QUEST_MARK_PX).toEqual({ md: 22, compact: 18 });
    expect(questMarkColour('available', 'difficult', 'md')).toBe('difficult');
    expect(questMarkColour('available', 'difficult', 'compact')).toBe('difficult');
    expect(questMarkColour('available', null, 'md')).toBeNull();
    const svg = mark(render(<QuestMark state="ready" difficulty="verydifficult" size="compact" />).container);
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('class')).toContain('frl-quest-mark--compact');
    expect(svg.getAttribute('data-colour')).toBe('verydifficult');
  });

  it('draws "may be available" as a dashed ring outside the coloured disc, and an unknown record as a dashed hollow ring', () => {
    const uncertain = mark(render(<QuestMark state="uncertain" difficulty="standard" />).container);
    expect(uncertain.getAttribute('class')).toContain('is-uncertain');
    const ring = uncertain.querySelector('.frl-quest-mark__ring');
    expect(Number(ring?.getAttribute('r'))).toBeGreaterThan(Number(uncertain.querySelector('.frl-quest-mark__disc')?.getAttribute('r')));
    cleanup();
    const unknown = mark(render(<QuestMark state="record-unknown" difficulty={null} />).container);
    expect(unknown.getAttribute('class')).toContain('is-hollow');
    expect(unknown.getAttribute('class')).toContain('is-uncertain');
    expect(unknown.querySelector('.frl-quest-mark__ring')).toBeNull();
    // Never "ready": the "?" with a dashed empty pie.
    expect(unknown.querySelector('.frl-quest-mark__pie-rim.is-unknown')).not.toBeNull();
    expect(unknown.querySelector('.frl-quest-mark__pie')).toBeNull();
    cleanup();
    expect(mark(render(<QuestMark state="available" difficulty="standard" />).container).querySelector('.frl-quest-mark__ring')).toBeNull();
  });

  it('puts each badge in the map’s slot: the state top right, the dungeon-quest arch top left', () => {
    const badgesOf = (svg: Element) => [...svg.querySelectorAll('[data-badge]')].map((g) => [g.getAttribute('data-badge'), g.getAttribute('data-slot')]);
    const lock = mark(render(<QuestMark state="locked" difficulty="standard" />).container);
    expect(badgesOf(lock)).toEqual([['lock', 'tr']]);
    expect(lock.querySelector('.frl-quest-mark__lock')).not.toBeNull();
    cleanup();
    const soon = mark(render(<QuestMark state="unlocks-soon" difficulty={null} unlockLevel={7} />).container);
    expect(badgesOf(soon)).toEqual([['level', 'tr']]);
    expect(soon.querySelector('.frl-quest-mark__level')?.textContent).toBe('7');
    cleanup();
    expect(mark(render(<QuestMark state="unlocks-soon" difficulty={null} />).container).querySelector('.frl-quest-mark__level')?.textContent).toBe('?');
    cleanup();
    const dungeon = mark(render(<QuestMark state="available" difficulty="difficult" dungeonQuest />).container);
    expect(badgesOf(dungeon)).toEqual([['dungeon-quest', 'tl']]);
    expect([...dungeon.querySelectorAll('.frl-quest-mark__arch path')].map((path) => path.getAttribute('d'))).toEqual(DUNGEON_GLYPH.map((part) => part.d));
    cleanup();
    const both = mark(render(<QuestMark state="in-progress" difficulty={null} dungeonQuest progress={{ done: 1, total: 3 }} />).container);
    expect(badgesOf(both)).toEqual([
      ['dungeon-quest', 'tl'],
      ['progress', 'tr'],
    ]);
    for (const [badge, slot] of badgesOf(both)) expect(BADGE_SLOT_OF[badge as keyof typeof BADGE_SLOT_OF]).toBe(slot);
  });

  it('fills the progress pie with the share of objectives done, from 12 o’clock clockwise; empty at none or an unknown total', () => {
    const pie = (progress: { done: number; total: number | null } | null) => {
      cleanup();
      return mark(render(<QuestMark state="in-progress" difficulty={null} progress={progress} />).container).querySelector('.frl-quest-mark__pie');
    };
    const third = pie({ done: 1, total: 3 });
    expect(third?.getAttribute('data-fraction')).toBe('0.333');
    // From the badge's centre straight up to 12 o'clock, then a short (under half) clockwise arc.
    expect(third?.getAttribute('d')).toMatch(/^M18\.2 3\.8V0\.9A2\.9 2\.9 0 0 1 /);
    expect(pie({ done: 2, total: 3 })?.getAttribute('d')).toMatch(/ 0 1 1 /);
    expect(pie({ done: 3, total: 3 })?.getAttribute('data-fraction')).toBe('1.000');
    expect(pie({ done: 0, total: 3 })).toBeNull();
    expect(pie({ done: 1, total: null })).toBeNull();
    expect(pie(null)).toBeNull();
  });

  it('is never a triangle: the "!" sits in a disc, and the mark has no polygon', () => {
    for (const state of QUEST_MARK_STATE_ORDER) {
      cleanup();
      const svg = mark(render(<QuestMark state={state} difficulty="difficult" dungeonQuest />).container);
      expect(svg.firstElementChild?.tagName.toLowerCase(), state).toBe('circle');
      expect(svg.firstElementChild?.getAttribute('class')).toBe('frl-quest-mark__disc');
      expect(svg.querySelectorAll('polygon, polyline')).toHaveLength(0);
      // No closed three-point outline (the warning triangle's shape).
      for (const path of svg.querySelectorAll('path')) expect(path.getAttribute('d') ?? '', state).not.toMatch(/^M[\d.\s-]+L?[\d.\s-]+L?[\d.\s-]+[zZ]$/);
    }
  });

  it('is decorative: the row or list item names the state in words', () => {
    const svg = mark(render(<QuestMark state="available" difficulty="standard" />).container);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('StepMark', () => {
  it('draws the other kinds on a neutral disc with today’s glyphs, decoratively, in both sizes', () => {
    const kinds: StepMarkKind[] = ['complete', 'travel', 'grind', 'hearth', 'flight', 'train', 'vendor', 'note', 'abandon'];
    for (const kind of kinds) {
      cleanup();
      const { container } = render(<StepMark kind={kind} />);
      const disc = container.querySelector('.frl-step-mark');
      expect(disc?.getAttribute('aria-hidden'), kind).toBe('true');
      expect(disc?.querySelector('svg')?.getAttribute('data-step-kind')).toBe(kind);
      expect(disc?.querySelector('svg')?.getAttribute('width')).toBe('14');
      // No hue for a kind: the glyph is the muted ink, in CSS (markers.css), never a class per colour.
      expect(disc?.className).not.toMatch(/difficulty|forever|severity/);
    }
    cleanup();
    const compact = render(<StepMark kind="note" size="compact" />).container.querySelector('.frl-step-mark');
    expect(compact?.className).toContain('frl-step-mark--compact');
    expect(compact?.querySelector('svg')?.getAttribute('width')).toBe('12');
  });
});
