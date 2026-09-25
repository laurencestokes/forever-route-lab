/**
 * Reader for QuestieDB `data/Forever/conversion.json` (docs/research/coordinates.md §10.1).
 * Only the `geometry` block is read. Fails closed: any field missing or of the wrong type throws,
 * so an upstream format change is noticed at the next pin bump rather than silently mis-read.
 */

export interface Bounds {
  /** Region_4 = world Ymax (west edge). */
  readonly left: number;
  /** Region_1 = world Ymin (east edge). */
  readonly right: number;
  /** Region_3 = world Xmax (north edge). */
  readonly top: number;
  /** Region_0 = world Xmin (south edge). */
  readonly bottom: number;
}

export interface Coefficients {
  readonly scaleX: number;
  readonly offsetX: number;
  readonly scaleY: number;
  readonly offsetY: number;
}

export interface ConversionTransform {
  readonly uiMapId: number;
  readonly targetName: string;
  readonly areaId: number;
  readonly mapId: number;
  readonly targetAssignmentId: number;
  readonly changed: boolean;
  readonly coefficients: Coefficients;
  readonly sourceBounds: Bounds;
  readonly targetBounds: Bounds;
}

export interface ConversionGeometry {
  /** Era frame build, `geometry.source_build` (1.15.9.69722 at the pin). */
  readonly sourceBuild: string;
  /** Forever frame build, `geometry.target_build` (1.60.1.69893 at the pin). */
  readonly targetBuild: string;
  /** Ascending by UiMapId. */
  readonly transforms: readonly ConversionTransform[];
  readonly unsupportedUiMapIds: readonly number[];
  readonly addedUiMapIds: readonly number[];
}

type Json = Readonly<Record<string, unknown>>;

const record = (value: unknown, path: string): Json => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`conversion.json ${path}: expected an object`);
  return value as Json;
};
const array = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`conversion.json ${path}: expected an array`);
  return value;
};
const finite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`conversion.json ${path}: expected a finite number`);
  return value;
};
const integer = (value: unknown, path: string): number => {
  const n = finite(value, path);
  if (!Number.isInteger(n) || n < 0) throw new Error(`conversion.json ${path}: expected a non-negative integer`);
  return n;
};
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value === '') throw new Error(`conversion.json ${path}: expected a non-empty string`);
  return value;
};

const bounds = (value: unknown, path: string): Bounds => {
  const b = record(value, path);
  return { left: finite(b['left'], `${path}.left`), right: finite(b['right'], `${path}.right`), top: finite(b['top'], `${path}.top`), bottom: finite(b['bottom'], `${path}.bottom`) };
};

const ids = (value: unknown, path: string): readonly number[] =>
  array(value, path)
    .map((entry, i) => integer(record(entry, `${path}[${String(i)}]`)['ui_map_id'], `${path}[${String(i)}].ui_map_id`))
    .sort((a, b) => a - b);

export function parseConversion(value: unknown): ConversionGeometry {
  const geometry = record(record(value, '(root)')['geometry'], 'geometry');
  const transforms = array(geometry['transforms'], 'geometry.transforms').map((entry, i): ConversionTransform => {
    const path = `geometry.transforms[${String(i)}]`;
    const t = record(entry, path);
    const c = record(t['coefficients'], `${path}.coefficients`);
    if (typeof t['changed'] !== 'boolean') throw new Error(`conversion.json ${path}.changed: expected a boolean`);
    return {
      uiMapId: integer(t['ui_map_id'], `${path}.ui_map_id`),
      targetName: text(t['target_name'], `${path}.target_name`),
      areaId: integer(t['area_id'], `${path}.area_id`),
      mapId: integer(t['map_id'], `${path}.map_id`),
      targetAssignmentId: integer(t['target_assignment_id'], `${path}.target_assignment_id`),
      changed: t['changed'],
      coefficients: {
        scaleX: finite(c['scale_x'], `${path}.coefficients.scale_x`),
        offsetX: finite(c['offset_x'], `${path}.coefficients.offset_x`),
        scaleY: finite(c['scale_y'], `${path}.coefficients.scale_y`),
        offsetY: finite(c['offset_y'], `${path}.coefficients.offset_y`),
      },
      sourceBounds: bounds(t['source_bounds'], `${path}.source_bounds`),
      targetBounds: bounds(t['target_bounds'], `${path}.target_bounds`),
    };
  });
  const seen = new Set<number>();
  for (const t of transforms) {
    if (seen.has(t.uiMapId)) throw new Error(`conversion.json geometry.transforms: UiMap ${String(t.uiMapId)} appears twice`);
    seen.add(t.uiMapId);
  }
  return {
    sourceBuild: text(geometry['source_build'], 'geometry.source_build'),
    targetBuild: text(geometry['target_build'], 'geometry.target_build'),
    transforms: [...transforms].sort((a, b) => a.uiMapId - b.uiMapId),
    unsupportedUiMapIds: ids(geometry['unsupported'], 'geometry.unsupported'),
    addedUiMapIds: ids(geometry['added_maps'], 'geometry.added_maps'),
  };
}

export const isIdentity = (c: Coefficients): boolean => c.scaleX === 1 && c.offsetX === 0 && c.scaleY === 1 && c.offsetY === 0;
