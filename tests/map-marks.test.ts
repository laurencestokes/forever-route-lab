/**
 * The marks module and the band constants against the modules they repeat values from
 * (docs/research/map-presentation.md §25.2.2, §5.1; steps MP.1 and MP.2b). A cross-module test:
 * src/map/marks.ts imports nothing (marks-pins.ts imports only it), and map/layers imports only
 * types from map/adapter, so each keeps its own copy, checked here.
 */
import { describe, expect, it } from 'vitest';
import * as exported from '../src/app/map-exports';
import { BAND_EDGES } from '../src/map/adapter';
import { LAYER_BAND_EDGES } from '../src/map/layers';
import * as marks from '../src/map/marks';
import * as pinMarks from '../src/map/marks-pins';
import { DIFFICULTIES } from '../src/rules';
import { DIFFICULTY_RANK } from '../src/ui/markers/DifficultyLabel';

describe('src/map/marks.ts against the modules it mirrors', () => {
  it('names the same five difficulties as the rules, with DifficultyLabel’s pips', () => {
    expect(marks.MARK_DIFFICULTIES).toEqual(DIFFICULTIES);
    for (const difficulty of DIFFICULTIES) expect(marks.PIPS_LIT[difficulty], difficulty).toBe(DIFFICULTY_RANK[difficulty]);
  });

  it('sizes pins between the continent band’s edges, the same as map/adapter’s bands and map/layers’ copy', () => {
    expect(marks.PIN_SIZE.fromPxPerYard).toBe(BAND_EDGES.continent);
    expect(marks.PIN_SIZE.toPxPerYard).toBe(BAND_EDGES.zone);
    expect(LAYER_BAND_EDGES).toEqual(BAND_EDGES);
  });

  it('reaches ui through app/map-exports as the same objects, never copies (one path set)', () => {
    expect(exported.QUEST_GLYPH).toBe(marks.QUEST_GLYPH);
    expect(exported.TURN_IN_GLYPH).toBe(marks.TURN_IN_GLYPH);
    expect(exported.MARK_STATES).toBe(marks.MARK_STATES);
    expect(exported.MARK_GLYPHS).toBe(pinMarks.MARK_GLYPHS);
    expect(pinMarks.MARK_GLYPHS.quest).toBe(marks.QUEST_GLYPH);
    expect(exported.markColour).toBe(marks.markColour);
    expect(exported.COLOUR_MIN_SHAPE_PX).toBe(11);
  });
});
