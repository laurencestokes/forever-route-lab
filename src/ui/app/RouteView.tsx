import { ESTIMATE_COLUMN_LABELS, ESTIMATE_COLUMNS, type EstimateColumn, type TopNumber } from '../route/rows';
import type { RowDensity } from '../route/virtual';
import { AssumedMarker } from '../markers/AssumedMarker';
import { PendingMarker } from '../markers/PendingMarker';
import { QuestMark } from '../markers/QuestMark';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { Select } from '../primitives/Select';
import type { RowPrefs } from './RoutePanel';

const isEstimateColumn = (value: string): value is EstimateColumn => (ESTIMATE_COLUMNS as readonly string[]).includes(value);

const COLUMN_OPTIONS = ESTIMATE_COLUMNS.map((column) => ({ value: column, label: ESTIMATE_COLUMN_LABELS[column] }));
const DENSITY_OPTIONS: readonly { readonly value: RowDensity; readonly label: string }[] = [
  { value: 'two-line', label: 'Two lines' },
  { value: 'one-line', label: 'One line' },
];
const TOP_OPTIONS: readonly { readonly value: TopNumber; readonly label: string }[] = [
  { value: 'xp', label: 'XP gained' },
  { value: 'time', label: 'Step time' },
];

/**
 * The key to the rows' marks and markers (ui-refresh.md §4.1): it replaces the banner's always-visible
 * key. The marks are drawn as the rows draw them; each line's words carry the meaning.
 */
function RowKey() {
  return (
    <ul className="frl-view__key">
      <li>
        <QuestMark state="available" difficulty="standard" /> Accept, available: the colour is the quest's difficulty, its pips beside it
      </li>
      <li>
        <QuestMark state="uncertain" difficulty="standard" /> May be available (a doubt at the step, or not simulated yet)
      </li>
      <li>
        <QuestMark state="locked" difficulty={null} /> Cannot be taken here: an error at the step
      </li>
      <li>
        <QuestMark state="ready" difficulty="standard" /> Turn in, ready
      </li>
      <li>
        <span className="frl-view__glyph">?</span> unknown, with the reason in its tooltip · <span className="frl-view__glyph">≈</span> depends on assumptions ·{' '}
        <AssumedMarker reason="era-fallback" /> Era value · <span className="frl-view__glyph">≥ ≤</span> a lower or upper bound
      </li>
      <li>
        <PendingMarker silent /> a travel time that waits for its walking path · <span className="frl-view__glyph">↑</span> reaches a new level
      </li>
      <li>
        <span className="frl-view__band" /> the steps after the selection; the dashed line is where new steps go
      </li>
    </ul>
  );
}

/**
 * View's content (ui-refresh.md §4.1), a lazy part: Rows ("Two lines" or "One line"), the top number
 * of two-line rows ("XP gained" or "Step time") or the one estimate of one-line rows ("Rows show"),
 * and the key to the marks, which replaces the banner's always-visible key.
 */
export function RowViewPanel({ prefs, onChange }: { readonly prefs: RowPrefs; readonly onChange: (patch: Partial<RowPrefs>) => void }) {
  return (
    <>
      <div className="frl-view__row">
        <span className="frl-view__caption" aria-hidden="true">
          Rows
        </span>
        <SegmentedControl
          legend="Rows"
          options={DENSITY_OPTIONS}
          value={prefs.density}
          onChange={(density) => {
            onChange({ density });
          }}
        />
      </div>
      {prefs.density === 'two-line' ? (
        <div className="frl-view__row">
          <span className="frl-view__caption" aria-hidden="true">
            Top number
          </span>
          <SegmentedControl
            legend="Top number"
            options={TOP_OPTIONS}
            value={prefs.topNumber}
            onChange={(topNumber) => {
              onChange({ topNumber });
            }}
          />
        </div>
      ) : (
        <Select
          label="Rows show"
          size="sm"
          className="frl-view__column"
          value={prefs.column}
          options={COLUMN_OPTIONS}
          onChange={(value) => {
            if (isEstimateColumn(value)) onChange({ column: value });
          }}
        />
      )}
      <p className="frl-view__caption">Key</p>
      <RowKey />
    </>
  );
}
