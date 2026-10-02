// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ISSUES, describeIssueCounts } from '../lib/issues';
import { knownReadout, unknownReadout } from '../lib/readout';
import { PENDING_CHECKING_TEXT, PENDING_TRAVEL_TEXT } from '../markers/PendingMarker';
import { DIFFICULTY_RANK } from '../markers/DifficultyLabel';
import { UNKNOWN_FOREVER_PROVENANCE } from '../markers/provenance';
import { GroupRow, StepRow, describeStepRow } from './StepRow';
import type { GroupRowModel, StepRowModel } from './rows';

afterEach(cleanup);

const base: StepRowModel = {
  type: 'step',
  key: 'step-12',
  number: 12,
  kind: 'accept',
  verb: 'Accept',
  title: 'Placeholder quest A',
  chain: null,
  detail: 'Placeholder zone',
  projectedLevel: knownReadout(7.46),
  duration: knownReadout(125),
  xpGained: knownReadout(0),
  pending: null,
  assumptions: null,
  quest: { level: 8, difficulty: 'difficult', uncertain: false, provenance: UNKNOWN_FOREVER_PROVENANCE },
  issues: NO_ISSUES,
  issue: null,
  mark: 'available',
  levelUp: null,
  locked: false,
};

/** The estimates as the name says them when they are 7.4, 0 XP and 2 minutes 5 seconds. */
const BASE_ESTIMATES = 'Level after step 7.4. XP gained 0 XP. Time 2 minutes 5 seconds';

const group: GroupRowModel = { type: 'group', key: 'g1', label: 'Placeholder group', stepCount: 3, imported: true, levelSpan: null };

describe('describeStepRow', () => {
  it('names the step in words: number, kind, title, where, the mark, difficulty and every estimate', () => {
    expect(describeStepRow(base)).toBe(`12. Accept quest: Placeholder quest A, Placeholder zone. Available. Quest level 8, Difficult (yellow). ${BASE_ESTIMATES}.`);
  });

  it('spells out lower bounds, assumptions, issues with the worst one in words, provenance and the lock', () => {
    const model: StepRowModel = {
      ...base,
      kind: 'turnin',
      verb: 'Turn in',
      detail: null,
      mark: 'locked',
      quest: { level: 8, difficulty: 'standard', uncertain: true, provenance: { claim: 'new', declaredBy: 'user' } },
      projectedLevel: knownReadout(9.05, { lowerBound: true, assumed: true }),
      xpGained: knownReadout(450, { assumed: true, eraFallback: true }),
      duration: knownReadout(3700, { assumed: true }),
      issues: { error: 1, warning: 2, info: 0 },
      issue: { severity: 'error', message: 'The quest is not in the log' },
      locked: true,
    };
    expect(describeStepRow(model)).toBe(
      '12. Turn in quest: Placeholder quest A. Cannot be turned in here. Quest level 8, Standard (green), from a lower-bound level: may be easier. ' +
        'New in Forever (user-declared). Level after step at least 9.0 (depends on assumptions). ' +
        'XP gained 450 XP (depends on assumptions, uses Era values). Time 1 hour 1 minute (depends on assumptions). ' +
        'Issues: 1 error, 2 warnings. Error: The quest is not in the log. Locked.',
    );
  });

  it('says the chain position, the NPC and zone with a comma, and a level-up', () => {
    const model: StepRowModel = { ...base, chain: { index: 1, length: 2 }, detail: 'Kaltunk · Durotar 43.3, 68.5', levelUp: 8, projectedLevel: knownReadout(8.1) };
    expect(describeStepRow(model)).toBe(
      '12. Accept quest: Placeholder quest A (1 of 2), Kaltunk, Durotar 43.3, 68.5. Available. Quest level 8, Difficult (yellow). ' +
        'Level after step 8.1, reaches level 8. XP gained 0 XP. Time 2 minutes 5 seconds.',
    );
  });

  it('never doubles a full stop after a title that ends in one (ours.md §5)', () => {
    const model: StepRowModel = { ...base, kind: 'note', verb: 'Note', title: 'Not planned.', detail: null, quest: null, mark: null };
    expect(describeStepRow(model)).toBe(`12. Note: Not planned. ${BASE_ESTIMATES}.`);
    expect(describeStepRow(model)).not.toContain('..');
  });

  it('says every mark state of an accept and a turn-in', () => {
    expect(describeStepRow({ ...base, mark: 'uncertain' })).toContain('. May be available. ');
    expect(describeStepRow({ ...base, mark: 'locked' })).toContain('. Cannot be accepted here. ');
    const turnin: StepRowModel = { ...base, kind: 'turnin', verb: 'Turn in' };
    expect(describeStepRow({ ...turnin, mark: 'ready' })).toContain('. Ready to turn in. ');
    expect(describeStepRow({ ...turnin, mark: 'uncertain' })).toContain('. May be ready to turn in. ');
    expect(describeStepRow({ ...turnin, mark: 'record-unknown' })).toContain('. Readiness unknown. ');
  });

  it('says when a travel time waits for its walking path, or for the navigation data to be checked', () => {
    expect(describeStepRow({ ...base, pending: 'path' })).toContain(
      'Time 2 minutes 5 seconds, pending: its walking path is still being computed, so the travel time is a straight-line estimate for now.',
    );
    expect(describeStepRow({ ...base, pending: 'checking' })).toContain(
      'Time 2 minutes 5 seconds, pending: the navigation data is still being checked, so the travel time is a straight-line estimate for now.',
    );
  });

  it('says an upper bound as "at most"', () => {
    expect(describeStepRow({ ...base, xpGained: knownReadout(450, { upperBound: true }) })).toContain('XP gained at most 450 XP');
  });

  it('names the group a step sits under', () => {
    expect(describeStepRow(base, 'Placeholder guide, step 3')).toBe(
      '12. Accept quest: Placeholder quest A, Placeholder zone, in group Placeholder guide, step 3. ' + `Available. Quest level 8, Difficult (yellow). ${BASE_ESTIMATES}.`,
    );
    expect(describeStepRow(base, null)).toBe(describeStepRow(base));
  });

  it('keeps unknown estimates unknown, with their reasons', () => {
    const model: StepRowModel = {
      ...base,
      kind: 'grind',
      verb: 'Grind',
      mark: null,
      quest: null,
      projectedLevel: unknownReadout('Quest XP unknown'),
      xpGained: unknownReadout('No XP record'),
    };
    expect(describeStepRow(model)).toBe(
      '12. Grind: Placeholder quest A, Placeholder zone. Level after step unknown: Quest XP unknown. XP gained unknown: No XP record. Time 2 minutes 5 seconds.',
    );
  });

  it('says a shared reason once when nothing is simulated', () => {
    const unknown = unknownReadout<number>('Not simulated yet');
    const model: StepRowModel = { ...base, quest: null, projectedLevel: unknown, xpGained: unknown, duration: unknown };
    expect(describeStepRow(model)).toBe('12. Accept quest: Placeholder quest A, Placeholder zone. Available. Level after step, XP and time unknown: Not simulated yet.');
  });
});

describe('StepRow, two lines (the default; B+, D-051)', () => {
  it('leads line 1 with the verb, then the title and provenance, then the chain; line 2 has "Lv n" and where, and no chip', () => {
    const { container } = render(<StepRow model={{ ...base, chain: { index: 1, length: 2 } }} selected={false} active={false} />);
    const option = screen.getByRole('option');
    expect(option.className).toContain('frl-row--two-line');
    const line1 = container.querySelector('.frl-steprow__line1');
    expect(line1?.querySelector('.frl-steprow__verb')?.textContent).toBe('Accept');
    expect(line1?.querySelector('.frl-steprow__head .frl-steprow__title')?.textContent).toBe('Accept Placeholder quest A');
    // The chain follows the title's group, so it is the one part of line 1 that wraps away where it does not fit.
    expect(line1?.querySelector(':scope > .frl-steprow__chain')?.textContent).toBe('1/2');
    expect([...(line1?.children ?? [])].map((el) => el.className)).toEqual(['frl-steprow__head', 'frl-steprow__chain frl-num']);
    const line2 = container.querySelector('.frl-steprow__line2');
    expect(line2?.querySelector('.frl-steprow__lv')?.textContent).toBe('Lv 8');
    expect(line2?.querySelector('.frl-steprow__detail')?.textContent).toBe('Placeholder zone');
    expect(container.querySelector('.frl-difficulty')).toBeNull();
    expect(container.querySelector('[data-difficulty]')).toBeNull();
  });

  it('draws the quest mark in its state, coloured by difficulty only when filled, and a turn-in with its "?"', () => {
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} />);
    const mark = () => container.querySelector('.frl-quest-mark');
    expect(mark()?.getAttribute('data-state')).toBe('available');
    expect(mark()?.getAttribute('data-colour')).toBe('difficult');
    expect(mark()?.getAttribute('data-glyph')).toBe('quest');
    rerender(<StepRow model={{ ...base, mark: 'locked' }} selected={false} active={false} />);
    expect(mark()?.getAttribute('data-colour')).toBe('none');
    expect(mark()?.querySelector('[data-badge="lock"]')).not.toBeNull();
    rerender(<StepRow model={{ ...base, kind: 'turnin', verb: 'Turn in', mark: 'locked' }} selected={false} active={false} />);
    // The table's locked state is an accept's "!": a turn-in step keeps its "?".
    expect(mark()?.getAttribute('data-glyph')).toBe('turn-in');
    rerender(<StepRow model={{ ...base, kind: 'travel', verb: 'Travel', quest: null, mark: null }} selected={false} active={false} />);
    expect(mark()).toBeNull();
    expect(container.querySelector('.frl-step-mark[data-step-kind="travel"]')).not.toBeNull();
  });

  it('shows the worst issue in words on line 2, with its shape, in place of where', () => {
    const { container } = render(
      <StepRow
        model={{ ...base, mark: 'locked', issues: { error: 1, warning: 1, info: 0 }, issue: { severity: 'error', message: 'Needs level 3: level before is 2.6' } }}
        selected={false}
        active={false}
      />,
    );
    const issue = container.querySelector('.frl-steprow__line2 .frl-steprow__issue');
    expect(issue?.getAttribute('data-severity')).toBe('error');
    expect(issue?.textContent).toContain('Needs level 3: level before is 2.6');
    expect(issue?.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.frl-steprow__line2 .frl-steprow__detail')).toBeNull();
    // The shape is drawn once (D-051): line 1 has no issue marker; the counts are in the tooltip and the name.
    expect(container.querySelector('.frl-steprow__issues')).toBeNull();
    expect(container.querySelectorAll('.frl-steprow svg.frl-severity-icon, .frl-steprow [data-severity] svg')).toHaveLength(1);
    expect(issue?.getAttribute('title')).toBe('Needs level 3: level before is 2.6. Issues: 1 error, 1 warning');
    expect(screen.getByRole('option').getAttribute('aria-label')).toContain('Issues: 1 error, 1 warning. Error: Needs level 3: level before is 2.6.');
    // Line 2 starts with the level, then the issue.
    expect([...(container.querySelector('.frl-steprow__line2')?.children ?? [])].map((el) => el.className.split(' ')[0])).toEqual(['frl-steprow__lv', 'frl-steprow__sep', 'frl-steprow__issue']);
  });

  it('puts XP gained over the level after, a known zero muted and regular, a gain in bold, and "↑" on a level-up', () => {
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} />);
    const top = () => container.querySelector('.frl-steprow__top');
    const bottom = () => container.querySelector('.frl-steprow__bottom');
    expect(top()?.getAttribute('data-column')).toBe('xp');
    expect(top()?.querySelector('.frl-steprow__xp')?.className).toContain('is-zero');
    expect(bottom()?.getAttribute('data-column')).toBe('level');
    expect(bottom()?.textContent).toContain('7.4');
    expect(bottom()?.querySelector('.frl-steprow__up')).toBeNull();
    rerender(<StepRow model={{ ...base, xpGained: knownReadout(1380), projectedLevel: knownReadout(4.6), levelUp: 4 }} selected={false} active={false} />);
    expect(top()?.textContent).toContain('+1,380');
    expect(top()?.querySelector('.frl-steprow__xp')?.className).not.toContain('is-zero');
    expect(bottom()?.querySelector('.frl-steprow__level')?.className).toContain('is-up');
    expect(bottom()?.querySelector('.frl-steprow__up')?.textContent).toBe('↑');
    expect(bottom()?.textContent).toMatch(/^↑4\.6/);
    // An unknown stays "?", never a muted zero.
    rerender(<StepRow model={{ ...base, xpGained: unknownReadout('No XP record') }} selected={false} active={false} />);
    expect(top()?.querySelector('.frl-steprow__xp')?.className).not.toContain('is-zero');
    expect(top()?.textContent).toContain('?');
  });

  it('can put the step time on top, with the hourglass in its gutter while it waits for a path', () => {
    const { container } = render(<StepRow model={{ ...base, pending: 'path' }} topNumber="time" selected={false} active={false} />);
    const top = container.querySelector('.frl-steprow__top');
    expect(top?.getAttribute('data-column')).toBe('time');
    expect(top?.textContent).toContain('2m 05s');
    expect(top?.querySelector('[data-state="pending"]')?.getAttribute('title')).toBe(PENDING_TRAVEL_TEXT);
  });

  it('says a travel step\'s time on line 2 when XP is on top', () => {
    const model: StepRowModel = { ...base, kind: 'travel', verb: 'Travel', title: 'to Razor Hill', quest: null, mark: null, detail: null, pending: 'path' };
    const { container } = render(<StepRow model={model} selected={false} active={false} />);
    const time = container.querySelector('.frl-steprow__line2 .frl-steprow__travel-time');
    expect(time?.textContent).toContain('2m 05s');
    expect(time?.querySelector('[data-state="pending"]')).not.toBeNull();
  });

  it('has duplicate, delete and lock as pointer-only spans at line 2\'s end (shown by CSS on hover, selection and the active row, D-051)', () => {
    const onClick = vi.fn();
    const handlers = { onToggleLock: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
    render(<StepRow model={base} selected={false} active={false} onClick={onClick} {...handlers} />);
    const option = screen.getByRole('option');
    const actions = option.querySelector('.frl-steprow__line2 .frl-steprow__actions');
    expect([...(actions?.querySelectorAll('[data-action]') ?? [])].map((el) => el.getAttribute('data-action'))).toEqual(['duplicate', 'delete', 'lock']);
    for (const el of actions?.querySelectorAll('[data-action]') ?? []) fireEvent.click(el);
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleLock).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(option.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"], [contenteditable]')).toHaveLength(0);
  });

  it('shows the lock on line 1 when locked, and no actions when read-only', () => {
    const { container } = render(<StepRow model={{ ...base, locked: true }} selected={false} active={false} readOnly onDelete={vi.fn()} onDuplicate={vi.fn()} onToggleLock={vi.fn()} />);
    expect(container.querySelector('.frl-steprow__line1 .frl-steprow__locked')).not.toBeNull();
    expect(container.querySelector('[data-action]')).toBeNull();
  });

  it('makes the number the drag handle, only where the list can drag', () => {
    const onHandle = vi.fn();
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} onHandlePointerDown={onHandle} />);
    const number = () => container.querySelector('.frl-steprow__number');
    expect(number()?.className).toContain('is-handle');
    expect(number()?.getAttribute('title')).toBe('Drag to reorder (keyboard: Alt+↑ / Alt+↓)');
    fireEvent.pointerDown(number() as Element);
    expect(onHandle).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.frl-row__handle')).toBeNull();
    rerender(<StepRow model={base} selected={false} active={false} readOnly onHandlePointerDown={onHandle} />);
    expect(number()?.className).not.toContain('is-handle');
  });
});

describe('StepRow, B+ details (D-051)', () => {
  const issueModel: StepRowModel = {
    ...base,
    kind: 'turnin',
    verb: 'Turn in',
    mark: 'ready',
    chain: { index: 2, length: 2 },
    detail: 'Gornek · Durotar 42.1, 68.3',
    place: { lead: 'Gornek', zone: 'Durotar' },
    issues: { error: 0, warning: 1, info: 0 },
    issue: { severity: 'warning', message: 'No step finishes objective 1 of Cutting Teeth', short: 'No step finishes objective 1' },
  };

  it('draws the pips under the mark, as many lit as the difficulty\'s rank, in ink; non-quest rows have none', () => {
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} />);
    const pips = () => container.querySelector('.frl-steprow__markbox > .frl-steprow__pips');
    expect(pips()?.getAttribute('aria-hidden')).toBe('true');
    expect(pips()?.querySelectorAll('.frl-difficulty__pip')).toHaveLength(5);
    expect(pips()?.querySelectorAll('.frl-difficulty__pip.is-on')).toHaveLength(DIFFICULTY_RANK.difficult);
    // The disc keeps the difficulty colour.
    expect(container.querySelector('.frl-steprow__markbox > .frl-quest-mark')?.getAttribute('data-colour')).toBe('difficult');
    for (const difficulty of ['trivial', 'standard', 'verydifficult', 'impossible'] as const) {
      rerender(<StepRow model={{ ...base, quest: { level: 8, difficulty, uncertain: false, provenance: UNKNOWN_FOREVER_PROVENANCE } }} selected={false} active={false} />);
      expect(pips()?.querySelectorAll('.frl-difficulty__pip.is-on')).toHaveLength(DIFFICULTY_RANK[difficulty]);
    }
    rerender(<StepRow model={{ ...base, quest: { level: null, difficulty: null, uncertain: false, provenance: UNKNOWN_FOREVER_PROVENANCE } }} selected={false} active={false} />);
    expect(pips()?.querySelectorAll('.frl-difficulty__pip.is-on')).toHaveLength(0);
    expect(container.querySelector('.frl-steprow__lv')?.textContent).toBe('Lv ?');
    rerender(<StepRow model={{ ...base, kind: 'grind', verb: 'Grind', quest: null, mark: null }} selected={false} active={false} />);
    expect(pips()).toBeNull();
    expect(container.querySelector('.frl-steprow__lv')).toBeNull();
    expect(container.querySelector('.frl-steprow__line2 > .frl-steprow__sep')).toBeNull();
  });

  it('says the level and difficulty in words in the "Lv n" tooltip, and marks a lower-bound difficulty', () => {
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} />);
    const lv = () => container.querySelector('.frl-steprow__lv');
    expect(lv()?.getAttribute('title')).toBe('Quest level 8, Difficult (yellow)');
    expect(lv()?.className).not.toContain('is-uncertain');
    rerender(<StepRow model={{ ...base, quest: { level: 8, difficulty: 'standard', uncertain: true, provenance: UNKNOWN_FOREVER_PROVENANCE } }} selected={false} active={false} />);
    expect(lv()?.getAttribute('title')).toBe('Quest level 8, Standard (green), from a lower-bound level: may be easier');
    expect(lv()?.className).toContain('is-uncertain');
  });

  it('carries the chain position in the tooltip and the name of every row, at rest and active, in both densities', () => {
    for (const density of ['two-line', 'one-line'] as const) {
      for (const active of [false, true]) {
        const { container, unmount } = render(<StepRow model={issueModel} density={density} selected={false} active={active} />);
        expect(container.querySelector('.frl-steprow__title')?.getAttribute('title')).toMatch(/^Turn in Placeholder quest A \(2 of 2\)/);
        expect(screen.getByRole('option').getAttribute('aria-label')).toContain('Placeholder quest A (2 of 2)');
        unmount();
      }
    }
    // No chain, no position.
    const { container } = render(<StepRow model={base} selected={false} active={false} />);
    expect(container.querySelector('.frl-steprow__title')?.getAttribute('title')).toBe('Accept Placeholder quest A');
  });

  it('gives the active row the place whole on line 2 and the issue in full below it, its shape still drawn once', () => {
    const { container, rerender } = render(<StepRow model={issueModel} selected={false} active={false} onDelete={vi.fn()} />);
    // At rest: the issue on line 2, no block.
    expect(container.querySelector('.frl-steprow__line2 .frl-steprow__issue')).not.toBeNull();
    expect(container.querySelector('.frl-steprow__more')).toBeNull();
    expect(container.querySelector('.frl-steprow__line2 .frl-steprow__lead')).toBeNull();
    rerender(<StepRow model={issueModel} selected active onDelete={vi.fn()} />);
    const line2 = container.querySelector('.frl-steprow__line2');
    expect(line2?.querySelector('.frl-steprow__issue')).toBeNull();
    expect(line2?.querySelector('.frl-steprow__lv')?.textContent).toBe('Lv 8');
    expect(line2?.querySelector('.frl-steprow__lead')?.textContent).toBe('Gornek');
    expect(line2?.querySelector('.frl-steprow__zone')?.textContent).toBe('Durotar');
    expect(line2?.querySelector('.frl-steprow__detail')?.getAttribute('title')).toBe('Gornek · Durotar 42.1, 68.3');
    // The D-040 carried-work cue: the warning's words in full, in its colour, with its shape, once.
    const more = container.querySelector('.frl-steprow__more');
    expect(more?.parentElement?.getAttribute('role')).toBe('option');
    expect(more?.getAttribute('data-severity')).toBe('warning');
    expect(more?.querySelector('.frl-steprow__issue-text')?.textContent).toBe('No step finishes objective 1');
    // Its tooltip has the step's issue counts, as the issue at rest does: the counts are not drawn anywhere on the row.
    expect(more?.getAttribute('title')).toBe(`No step finishes objective 1 of Cutting Teeth. Issues: ${describeIssueCounts(issueModel.issues)}`);
    expect(more?.getAttribute('title')).toContain('1 warning');
    expect(container.querySelectorAll('.frl-steprow [data-severity] svg')).toHaveLength(1);
    // The actions stay on line 2 (the CSS moves them to the extra's corner).
    expect(line2?.querySelector('.frl-steprow__actions [data-action="delete"]')).not.toBeNull();
    // The name is the same in both states.
    expect(screen.getByRole('option').getAttribute('aria-label')).toBe(describeStepRow(issueModel));
  });

  it('keeps an active row that the list does not grow (a list too short for it) as at rest: the issue on line 2, no block', () => {
    const { container } = render(<StepRow model={issueModel} selected active grown={false} onDelete={vi.fn()} />);
    const option = screen.getByRole('option');
    expect(option.className).toContain('is-active');
    expect(option.className).not.toContain('is-grown');
    expect(container.querySelector('.frl-steprow__more')).toBeNull();
    expect(container.querySelector('.frl-steprow__line2 .frl-steprow__issue')?.getAttribute('title')).toBe(
      `No step finishes objective 1 of Cutting Teeth. Issues: ${describeIssueCounts(issueModel.issues)}`,
    );
    expect(container.querySelectorAll('.frl-steprow [data-severity] svg')).toHaveLength(1);
    // The chain is still always on the active row (CSS keeps line 1 from wrapping it away), and in its name.
    expect(container.querySelector('.frl-steprow__line1 .frl-steprow__chain')?.textContent).toBe('2/2');
    expect(option.getAttribute('aria-label')).toBe(describeStepRow(issueModel));
  });

  it('adds no block to an active row without an issue, and keeps a travel step\'s time on line 2', () => {
    const { container, rerender } = render(<StepRow model={{ ...issueModel, issues: NO_ISSUES, issue: null }} selected={false} active />);
    expect(container.querySelector('.frl-steprow__more')).toBeNull();
    expect(container.querySelector('.frl-steprow__line2 .frl-steprow__zone')?.textContent).toBe('Durotar');
    const travel: StepRowModel = { ...base, kind: 'travel', verb: 'Travel', title: 'to Razor Hill', quest: null, mark: null, detail: null, issues: { error: 1, warning: 0, info: 0 }, issue: { severity: 'error', message: 'No path' } };
    rerender(<StepRow model={travel} selected={false} active />);
    expect(container.querySelector('.frl-steprow__line2 .frl-steprow__travel-time')).not.toBeNull();
    expect(container.querySelector('.frl-steprow__more .frl-steprow__issue-text')?.textContent).toBe('No path');
  });

  it('never puts anything focusable or interactive inside the option, active or not', () => {
    for (const active of [false, true]) {
      const { unmount } = render(<StepRow model={issueModel} selected={active} active={active} onDelete={vi.fn()} onDuplicate={vi.fn()} onToggleLock={vi.fn()} onHandlePointerDown={vi.fn()} />);
      const option = screen.getByRole('option');
      expect(option.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"], [contenteditable]')).toHaveLength(0);
      for (const el of option.querySelectorAll('[data-action]')) expect(el.closest('[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });
});

describe('StepRow, one line (the compact View choice)', () => {
  const oneLine = { density: 'one-line' as const, selected: false, active: false };

  it('renders one option with the number, the 18px mark, the title and level; the "!" says accept, so the name has the room (review UI-15)', () => {
    render(<StepRow model={base} {...oneLine} />);
    const option = screen.getByRole('option');
    expect(option.className).toContain('frl-row--one-line');
    expect(option.getAttribute('aria-selected')).toBe('false');
    expect(option.textContent).toContain('12');
    expect(option.textContent).toContain('Placeholder quest A');
    expect(option.querySelector('.frl-steprow__verb')).toBeNull();
    // The tooltip and the row's name keep the verb.
    expect(option.querySelector('.frl-steprow__title')?.getAttribute('title')).toMatch(/^Accept Placeholder quest A/);
    expect(option.getAttribute('aria-label')).toContain('Accept');
    // A step whose mark does not say its verb keeps it.
    const { container } = render(<StepRow model={{ ...base, kind: 'complete', mark: null }} {...oneLine} />);
    expect(container.querySelector('.frl-steprow__verb')).not.toBeNull();
    expect(option.textContent).toContain('7.4');
    expect(option.querySelector('.frl-quest-mark--compact')).not.toBeNull();
    expect(option.querySelector('[data-difficulty="difficult"]')).not.toBeNull();
  });

  it('shows the worst severity and the issue total', () => {
    const { container } = render(<StepRow model={{ ...base, issues: { error: 0, warning: 2, info: 1 } }} {...oneLine} />);
    const issues = container.querySelector('.frl-steprow__issues');
    expect(issues?.getAttribute('data-severity')).toBe('warning');
    expect(issues?.textContent).toBe('3');
    expect(issues?.getAttribute('title')).toBe('Issues: 2 warnings, 1 info issue');
    expect(screen.getByRole('option').getAttribute('aria-label')).toContain('Issues: 2 warnings, 1 info issue.');
  });

  it('shows a ≥ lower bound and the assumed marker', () => {
    const { container } = render(<StepRow model={{ ...base, projectedLevel: knownReadout(9.5, { lowerBound: true, assumed: true }) }} {...oneLine} />);
    const level = container.querySelector('.frl-steprow__estimate .frl-readout');
    expect(container.querySelector('.frl-steprow__estimate')?.getAttribute('data-column')).toBe('level');
    expect(level?.getAttribute('data-state')).toBe('lower-bound');
    expect(level?.textContent).toContain('≥9.5');
    expect(level?.querySelector('[data-reason="assumption"]')).not.toBeNull();
  });

  it('shows ? for an unknown level, never 0', () => {
    const { container } = render(<StepRow model={{ ...base, projectedLevel: unknownReadout('No XP data') }} {...oneLine} />);
    const level = container.querySelector('.frl-steprow__estimate .frl-readout');
    expect(level?.getAttribute('data-state')).toBe('unknown');
    expect(level?.textContent).toContain('?');
    expect(level?.textContent).not.toContain('0');
  });

  it('shows the chosen estimate with its basis markers: XP gained or the step time', () => {
    const model: StepRowModel = {
      ...base,
      xpGained: knownReadout(1250, { assumed: true, eraFallback: true }),
      duration: knownReadout(125, { eraFallback: true }),
      assumptions: 'seconds per kill (your assumption)',
    };
    const { container, rerender } = render(<StepRow model={model} estimateColumn="xp" {...oneLine} />);
    const cell = () => container.querySelector('.frl-steprow__estimate');
    expect(cell()?.getAttribute('data-column')).toBe('xp');
    expect(cell()?.textContent).toContain('+1,250');
    const marker = cell()?.querySelector('[data-reason="assumption"]');
    expect(marker?.getAttribute('title')).toBe('Depends on assumptions: this step reads seconds per kill (your assumption); also uses Era values where Forever values are unknown');
    rerender(<StepRow model={model} estimateColumn="time" {...oneLine} />);
    expect(cell()?.getAttribute('data-column')).toBe('time');
    expect(cell()?.textContent).toContain('2m 05s');
    expect(cell()?.querySelector('[data-reason="era-fallback"]')).not.toBeNull();
    expect(cell()?.getAttribute('title')).toBe('Level after 7.4 · XP +1,250 ≈ E · Time 2m 05s E. This step reads seconds per kill (your assumption)');
  });

  it('shows unknown XP and time as ? with the reason, never 0', () => {
    const model: StepRowModel = { ...base, xpGained: unknownReadout('No XP record'), duration: unknownReadout('No drop source') };
    const { container, rerender } = render(<StepRow model={model} estimateColumn="xp" {...oneLine} />);
    const readout = () => container.querySelector('.frl-steprow__estimate .frl-readout');
    expect(readout()?.getAttribute('data-state')).toBe('unknown');
    expect(readout()?.getAttribute('title')).toBe('No XP record');
    expect(readout()?.textContent).not.toContain('0');
    rerender(<StepRow model={model} estimateColumn="time" {...oneLine} />);
    expect(readout()?.getAttribute('title')).toBe('No drop source');
  });

  it('marks a step whose travel time waits for its walking path', () => {
    const { container, rerender } = render(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="time" {...oneLine} />);
    const option = screen.getByRole('option');
    expect(option.className).toContain('is-pending');
    const marker = container.querySelector('.frl-steprow__estimate [data-state="pending"]');
    expect(marker?.getAttribute('title')).toBe(PENDING_TRAVEL_TEXT);
    expect(marker?.textContent).toBe('');
    expect(option.getAttribute('aria-label')).toContain('pending: its walking path is still being computed');
    rerender(<StepRow model={{ ...base, pending: 'checking' }} estimateColumn="time" {...oneLine} />);
    expect(container.querySelector('.frl-steprow__estimate [data-state="pending"]')?.getAttribute('title')).toBe(PENDING_CHECKING_TEXT);
    rerender(<StepRow model={base} estimateColumn="time" {...oneLine} />);
    expect(container.querySelector('[data-state="pending"]')).toBeNull();
    expect(screen.getByRole('option').className).not.toContain('is-pending');
  });

  it('draws the hourglass beside the step time only: level and XP do not wait for walking paths (UI-12)', () => {
    const { container, rerender } = render(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="level" {...oneLine} />);
    expect(container.querySelector('[data-state="pending"]')).toBeNull();
    expect(screen.getByRole('option').getAttribute('aria-label')).toContain('pending: its walking path is still being computed');
    expect(container.querySelector('.frl-steprow__estimate')?.getAttribute('title')).toContain('(walking path pending)');
    rerender(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="xp" {...oneLine} />);
    expect(container.querySelector('[data-state="pending"]')).toBeNull();
    rerender(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="time" {...oneLine} />);
    expect(container.querySelector('[data-state="pending"]')).not.toBeNull();
  });

  const action = (name: 'duplicate' | 'delete' | 'lock') => {
    const el = screen.getByRole('option').querySelector(`[data-action="${name}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`no ${name} affordance`);
    return el;
  };

  it('runs lock, duplicate and delete without selecting the row', () => {
    const onClick = vi.fn();
    const onToggleLock = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    render(<StepRow model={base} density="one-line" selected={false} active onClick={onClick} onToggleLock={onToggleLock} onDuplicate={onDuplicate} onDelete={onDelete} />);
    expect(action('lock').getAttribute('title')).toBe('Lock step (L)');
    expect(action('duplicate').getAttribute('title')).toBe('Duplicate step (Ctrl+D)');
    expect(action('delete').getAttribute('title')).toBe('Delete step (Delete)');
    fireEvent.click(action('lock'));
    fireEvent.click(action('duplicate'));
    fireEvent.click(action('delete'));
    expect(onToggleLock).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the in-row affordances out of the accessibility tree and the tab order', () => {
    render(<StepRow model={base} density="one-line" selected={false} active onToggleLock={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    const option = screen.getByRole('option');
    const focusable = option.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"], [contenteditable]');
    expect(focusable).toHaveLength(0);
    for (const name of ['lock', 'duplicate', 'delete'] as const) {
      expect(action(name).tagName).toBe('SPAN');
      expect(action(name).closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(option.getAttribute('aria-label')).toBe(describeStepRow(base));
  });

  it('shows the pressed lock for a locked step', () => {
    render(<StepRow model={{ ...base, locked: true }} density="one-line" selected active={false} onToggleLock={vi.fn()} />);
    expect(action('lock').className).toContain('is-pressed');
    expect(action('lock').getAttribute('title')).toBe('Unlock step (L)');
    expect(screen.getByRole('option').className).toContain('is-locked');
  });

  it('shows the lock disabled when there is no lock handler', () => {
    const onClick = vi.fn();
    render(<StepRow model={base} density="one-line" selected={false} active onClick={onClick} onDuplicate={vi.fn()} />);
    expect(action('lock').className).toContain('is-disabled');
    fireEvent.click(action('lock'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no editing affordances when read-only but still shows the lock state', () => {
    render(<StepRow model={{ ...base, locked: true }} density="one-line" selected={false} active readOnly onToggleLock={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('option').querySelector('[data-action]')).toBeNull();
    expect(screen.getByRole('option').querySelector('[aria-label="Locked"]')).not.toBeNull();
  });
});

describe('StepRow, both densities', () => {
  it('says which group the step is in, and states its position only when given one', () => {
    render(<StepRow model={base} groupLabel="Step group" posInSet={12} setSize={40} selected={false} active={false} />);
    const option = screen.getByRole('option');
    expect(option.getAttribute('aria-label')).toMatch(/^12\. Accept quest: Placeholder quest A, Placeholder zone, in group Step group\. /);
    expect(option.getAttribute('aria-posinset')).toBe('12');
    expect(option.getAttribute('aria-setsize')).toBe('40');
  });

  it('shows provenance only when there is a claim', () => {
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} />);
    expect(container.querySelector('.frl-provenance')).toBeNull();
    rerender(<StepRow model={{ ...base, quest: { level: 8, difficulty: 'difficult', uncertain: false, provenance: { claim: 'changed', declaredBy: 'data' } } }} selected={false} active={false} />);
    const badge = container.querySelector('.frl-provenance');
    expect(badge?.getAttribute('data-claim')).toBe('changed');
    expect(badge?.textContent).toContain('◇');
  });
});

describe('GroupRow', () => {
  it('is an option naming the group and its size, as tall as the step rows', () => {
    render(<GroupRow model={group} selected={false} active={false} />);
    const option = screen.getByRole('option', { name: 'Group: Placeholder group, 3 steps.' });
    expect(option.getAttribute('data-row-type')).toBe('group');
    expect(option.hasAttribute('aria-posinset')).toBe(false);
    expect(option.hasAttribute('aria-setsize')).toBe(false);
    expect(option.className).toContain('frl-row--two-line');
    expect(option.querySelector('.frl-grouprow__meta')?.textContent).toBe('3 steps · imported RXP step');
  });

  it('shows and says the level span of its steps once the walk has them', () => {
    const model: GroupRowModel = { ...group, levelSpan: { from: knownReadout(6.04), to: knownReadout(6.8) } };
    const { container } = render(<GroupRow model={model} selected={false} active={false} />);
    expect(container.querySelector('.frl-grouprow__span')?.textContent).toBe('6.0-6.8');
    expect(screen.getByRole('option').getAttribute('aria-label')).toBe('Group: Placeholder group, 3 steps, levels after its steps 6.0 to 6.8.');
  });

  it('keeps one line in the compact density', () => {
    render(<GroupRow model={group} density="one-line" selected={false} active={false} />);
    expect(screen.getByRole('option').querySelector('.frl-grouprow__meta')).toBeNull();
    expect(screen.getByRole('option').querySelector('.frl-grouprow__count')?.textContent).toBe('3 steps');
  });
});
