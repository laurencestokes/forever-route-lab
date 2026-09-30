/**
 * The canvas twins of `DifficultyLabel` agree with it (docs/research/map-presentation.md §12.5,
 * §25.2.3; D-041 G; step MP.7): the zone cards' chip and the quest pins' pip tag light as many pips
 * as the chip's rank, so a rating reads the same on the map as in the lists. They cannot import each
 * other (map/leaflet may not import ui), so this test, outside src/, compares them.
 */
import { describe, expect, it } from 'vitest';
import { PIPS_LIT } from '../src/map/marks';
import { CHIP_PIPS_LIT } from '../src/map/leaflet/glyphs';
import { DIFFICULTY_RANK } from '../src/ui/markers/DifficultyLabel';

describe('the difficulty twins', () => {
  it('light as many pips as DifficultyLabel for every difficulty', () => {
    expect(CHIP_PIPS_LIT).toEqual(DIFFICULTY_RANK);
    expect(PIPS_LIT).toEqual(DIFFICULTY_RANK);
  });
});
