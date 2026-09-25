import { describe, expect, it } from 'vitest';
import { isIdentity, parseConversion } from './conversion';
import { syntheticConversion } from './test-support';

const DUROTAR = { id: 1411, name: 'Durotar', mapId: 1, areaId: 14, assignmentId: 46721, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
const MULGORE = {
  id: 1412, name: 'Mulgore', mapId: 1, areaId: 215, assignmentId: 46722, xMin: -3835.416015625, xMax: 266.666015625, yMin: -3675, yMax: 2479.1669921875,
  coefficients: { scaleX: 0.8348002068275978, offsetX: 7.007453108736848, scaleY: 0.8349418225477033, offsetY: 13.15387327724201 },
};

describe('parseConversion', () => {
  it('reads the geometry block in conversion.json field names, sorted by UiMap', () => {
    const parsed = parseConversion(syntheticConversion([MULGORE, DUROTAR]));
    expect(parsed.sourceBuild).toBe('1.15.9.69722');
    expect(parsed.targetBuild).toBe('1.60.1.69893');
    expect(parsed.transforms.map((t) => t.uiMapId)).toEqual([1411, 1412]);
    const [durotar, mulgore] = parsed.transforms;
    expect(durotar?.targetBounds).toEqual({ left: -1962.4998779297, right: -7249.9995117188, top: 1808.3332519531, bottom: -1716.6666259766 });
    expect(durotar && isIdentity(durotar.coefficients)).toBe(true);
    expect(mulgore?.changed).toBe(true);
    expect(mulgore?.coefficients).toEqual(MULGORE.coefficients);
  });

  it('fails closed on missing or mistyped fields and duplicate UiMaps', () => {
    const broken = syntheticConversion([DUROTAR]);
    const geometry = broken['geometry'] as { transforms: Record<string, unknown>[] };
    const [first] = geometry.transforms;
    if (first === undefined) throw new Error('fixture');
    first['target_bounds'] = { left: 1, right: 2, top: 'x', bottom: 4 };
    expect(() => parseConversion(broken)).toThrow('conversion.json geometry.transforms[0].target_bounds.top: expected a finite number');
    first['target_bounds'] = { left: 1, right: 2, top: 3, bottom: 4 };
    first['changed'] = 'no';
    expect(() => parseConversion(broken)).toThrow(/changed: expected a boolean/);
    expect(() => parseConversion(syntheticConversion([DUROTAR, DUROTAR]))).toThrow(/appears twice/);
    expect(() => parseConversion({})).toThrow(/geometry: expected an object/);
  });
});
