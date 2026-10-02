/**
 * The readability measurement's pure part (readability.ts): the per-row records the page reports and
 * the counts made from them, with the definitions of docs/reviews/rework-followup.md ("Readability
 * study", "Readability mocks", "Readability critic"). No browser here; harness.test.ts checks it.
 *
 * **Cut** (the mocks' correction of the study): a text is cut when any of its glyph boxes (a Range
 * over its text) reaches past the box that clips it by more than 0.02 px across, or by more than
 * 1 px up or down, whether an ellipsis shows or not. The mocks counted any sub-pixel overflow (their
 * step 5 shows an ellipsis for less than 1 px); 0.02 px leaves out an overflow of one layout unit
 * (1/64 px), which Chromium draws whole, without an ellipsis (a zone "Durotar" squeezed by 1/64 px
 * beside a shrunk NPC name, measured in this harness). The clipping box is the intersection of every
 * box from the text up to its row that clips (overflow other than visible, or paint containment;
 * the row itself always), so a name squeezed inside a container that never overflows still counts
 * (the critic's second check). A text with no glyph box drawn is **absent** (not on screen at all).
 * `hidden` is a text that is laid out but wholly outside its clip (the chain wrapped away).
 */

/** How much of one text is on screen. */
export type TextState = 'whole' | 'cut' | 'hidden' | 'absent';

export interface TextMeasure {
  readonly state: TextState;
  readonly text: string;
  /** The width the text needs and the width it is given (CSS px), to one decimal. */
  readonly needPx: number;
  readonly clipPx: number;
  /** Lines it takes (glyph boxes stacked), for the active row's issue. */
  readonly lines: number;
}

/** What the page reports for one step row in one state. */
export interface RowRecord {
  /** aria-posinset: the step's number. */
  readonly step: number;
  readonly kind: string;
  /** The row has a quest (its difficulty is in its name): the study's "quest rows" (54 of 55 on the sample). */
  readonly quest: boolean;
  readonly selected: boolean;
  readonly active: boolean;
  readonly hovered: boolean;
  /** The row's height in CSS px. */
  readonly height: number;
  /** The row's worst issue is the D-040 carried work ("no step finishes …", VAL030). */
  readonly carried: boolean;
  /** The row has an issue at all (its line 2 says the worst one). */
  readonly hasIssue: boolean;
  /** The row has a chain position ("2/7"). */
  readonly hasChain: boolean;
  readonly title: TextMeasure | null;
  readonly chain: TextMeasure | null;
  readonly issue: TextMeasure | null;
  readonly lead: TextMeasure | null;
  readonly zone: TextMeasure | null;
  /** The row buttons are drawn. */
  readonly buttons: boolean;
  /** The row's accessible name and its title's tooltip. */
  readonly name: string;
  readonly tooltip: string;
}

export interface Count {
  readonly count: number;
  readonly of: number;
  /** The steps counted. */
  readonly steps: readonly number[];
}

const count = (rows: readonly RowRecord[], within: (row: RowRecord) => boolean, counted: (row: RowRecord) => boolean): Count => {
  const pool = rows.filter(within);
  const hits = pool.filter(counted);
  return { count: hits.length, of: pool.length, steps: hits.map((row) => row.step) };
};

const shown = (text: TextMeasure | null): boolean => text !== null && text.state !== 'absent';
const notWhole = (text: TextMeasure | null): boolean => text !== null && text.state !== 'whole';
const isWhole = (text: TextMeasure | null): boolean => text !== null && text.state === 'whole';

/** The study's counts for rows in one state (at rest, or hovered). */
export interface RowCounts {
  /** Quest titles cut, of the quest rows (the mocks' "13 of 54"). */
  readonly questTitlesCut: Count;
  /** Every row's title cut, of all rows (the study's "13 of 55" with step 5 missed: 14 with it). */
  readonly titlesCut: Count;
  /** Issue rows whose words are cut, of the issue rows (the study's "22 of 22"). */
  readonly issueWordsCut: Count;
  /** NPC names cut, of the rows that show one (the mocks' "24 of 32"). */
  readonly npcNamesCut: Count;
  /** Zones cut, of the rows that show one. */
  readonly zonesCut: Count;
  /** Quest rows that show no NPC or zone at all (the critic's "22 of 54"). */
  readonly noPlace: Count;
  /** Chain positions not wholly shown, of the rows with one (the critic's "12 of 38"). */
  readonly chainHidden: Count;
}

export function rowCounts(rows: readonly RowRecord[]): RowCounts {
  return {
    questTitlesCut: count(rows, (row) => row.quest, (row) => notWhole(row.title)),
    titlesCut: count(rows, () => true, (row) => notWhole(row.title)),
    issueWordsCut: count(rows, (row) => row.hasIssue, (row) => !isWhole(row.issue)),
    npcNamesCut: count(rows, (row) => shown(row.lead), (row) => notWhole(row.lead)),
    zonesCut: count(rows, (row) => shown(row.zone), (row) => notWhole(row.zone)),
    noPlace: count(rows, (row) => row.quest, (row) => !shown(row.lead) && !shown(row.zone)),
    chainHidden: count(rows, (row) => row.hasChain, (row) => !isWhole(row.chain)),
  };
}

/** D-051's checks on the active row, over every step made active in turn. */
export interface ActiveCounts {
  /** Issue rows whose words are whole when active. */
  readonly issueWhole: Count;
  /** Quest rows whose NPC name and zone are both whole when active. */
  readonly placeWhole: Count;
  readonly npcWhole: Count;
  readonly zoneWhole: Count;
  /** Carried turn-ins (D-040) whose cue (the issue's words) is on screen at all, and whole. */
  readonly carriedCueShown: Count;
  readonly carriedCueWhole: Count;
  /** Rows with a chain position that show it whole when active (D-051: always). */
  readonly chainShown: Count;
  readonly titleWhole: Count;
  /** Rows that drew their buttons when active. */
  readonly buttons: Count;
  /** The active row's height (CSS px): the smallest and largest seen. */
  readonly heightPx: readonly [number, number];
}

export function activeCounts(rows: readonly RowRecord[]): ActiveCounts {
  const heights = rows.map((row) => row.height);
  return {
    issueWhole: count(rows, (row) => row.hasIssue, (row) => isWhole(row.issue)),
    placeWhole: count(rows, (row) => row.quest, (row) => isWhole(row.lead) && isWhole(row.zone)),
    npcWhole: count(rows, (row) => row.quest, (row) => isWhole(row.lead)),
    zoneWhole: count(rows, (row) => row.quest, (row) => isWhole(row.zone)),
    carriedCueShown: count(rows, (row) => row.carried, (row) => row.issue !== null && (row.issue.state === 'whole' || row.issue.state === 'cut')),
    carriedCueWhole: count(rows, (row) => row.carried, (row) => isWhole(row.issue)),
    chainShown: count(rows, (row) => row.hasChain, (row) => isWhole(row.chain)),
    titleWhole: count(rows, () => true, (row) => isWhole(row.title)),
    buttons: count(rows, () => true, (row) => row.buttons),
    heightPx: heights.length === 0 ? [0, 0] : [Math.min(...heights), Math.max(...heights)],
  };
}

/** Whether every row's accessible name and title tooltip carry its chain position and quest level (D-051). */
export function namesCarry(rows: readonly RowRecord[]): { readonly chainInName: Count; readonly chainInTooltip: Count; readonly levelInName: Count } {
  const chainOf = (row: RowRecord): string | null => {
    const match = / \((\d+) of (\d+)\)/.exec(row.name);
    return match === null ? null : `${match[1] ?? ''}/${match[2] ?? ''}`;
  };
  return {
    chainInName: count(rows, (row) => row.hasChain, (row) => chainOf(row) !== null),
    chainInTooltip: count(rows, (row) => row.hasChain, (row) => {
      const chain = chainOf(row);
      return chain !== null && (row.tooltip.includes(chain) || row.tooltip.includes(chain.replace('/', ' of ')));
    }),
    levelInName: count(rows, (row) => row.quest, (row) => /Quest level (\d+|unknown)/.test(row.name)),
  };
}

/** "13 of 54", for the printed table. */
export const ofText = (value: Count): string => `${String(value.count)} of ${String(value.of)}`;
