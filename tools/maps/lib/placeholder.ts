import { areaId, uiMapId, worldMapId, type UiMapId } from '../../../src/domain/ids';
import { canonicalGeometryContent } from '../../../src/geo/content';
import { canonicalFrameTuples } from '../../../src/geo/frame';
import { createMapGeometry } from '../../../src/geo/geometry';
import type { EraToForeverCoefficients, MapGeometry, UiMapGeometry } from '../../../src/geo/types';
import { DB2_BUILD, PRODUCT } from './constants';
import { isIdentity, parseConversion, type ConversionGeometry, type ConversionTransform } from './conversion';
import { geometryMapsFromRows, parseDb2RowsFile, type Db2RowsFile } from './db2-rows';
import { gitBlobId, lfBytes, sha256Hex } from './hash';
import { formatJson } from './json';
import { noticeText } from './notice';

/**
 * Builds `public/maps/placeholder/geometry.placeholder.json` and its `NOTICE.md` from the two
 * pinned or committed inputs (ARCHITECTURE §6; docs/MAPS.md §5.3, §8.2): QuestieDB
 * `conversion.json` (the LF git blob at the pin) and the committed rows file. Pure apart from
 * hashing: the caller reads the bytes; the same bytes always give the same output bytes.
 */

export interface PlaceholderInputs {
  readonly conversion: {
    /** The LF git blob, exactly as stored at `commit`. */
    readonly bytes: Uint8Array;
    readonly repoUrl: string;
    readonly commit: string;
    readonly path: string;
    /** From the pin (lib/pin.ts); the build fails unless the blob hashes to it. */
    readonly expectedSha256: string;
  };
  readonly rows: {
    /** The committed rows file (hashed as LF bytes). */
    readonly bytes: Uint8Array;
    readonly path: string;
  };
  /**
   * The date of the licence check the NOTICE states, from upstream.json `licenceCheck.date`, so a
   * pin bump that repeats the check updates the NOTICE too (M2 review data-F9).
   */
  readonly licenceCheckDate: string;
}

export interface PlaceholderBuild {
  readonly geometry: MapGeometry;
  readonly geometryText: string;
  readonly noticeText: string;
  readonly frameHash: string;
  /** SHA-256 of `canonicalGeometryContent(geometry)` (docs/MAPS.md §5.3), written as `contentHash`. */
  readonly contentHash: string;
  readonly frameUiMapIds: readonly UiMapId[];
  readonly conversion: ConversionGeometry;
  readonly conversionSha256: string;
  readonly rowsFile: Db2RowsFile;
  readonly rowsSha256: string;
}

/**
 * What the questiedb-conversion rows carry beyond `conversion.json` itself: QuestieDB derives a
 * transform only from an OrderIndex 0 row with a full (0,0)-(1,1) UI rectangle, no WMO restriction
 * and unrestricted Z (`tools/dbc/coordinates.py:33-47`, `Bounds.from_assignment`, at the pin), and
 * the Milestone 0 check found all 49 such rows in the 1.60.1.70009 CSV (coordinates.md §10.3).
 */
export const CONVERSION_IMPLIED = {
  orderIndex: 0,
  uiMin: [0, 0],
  uiMax: [1, 1],
  evidence: 'QuestieDB tools/dbc/coordinates.py:33-47 (Bounds.from_assignment accepts only OrderIndex 0, a full (0,0)-(1,1) UI rectangle, no WMO restriction and unrestricted Z)',
} as const;

function conversionMap(t: ConversionTransform, build: string): UiMapGeometry {
  return {
    uiMapId: uiMapId(t.uiMapId),
    name: t.targetName,
    nameSource: 'questiedb-conversion',
    type: null,
    parent: null,
    assignments: [
      {
        id: t.targetAssignmentId,
        mapId: worldMapId(t.mapId),
        areaId: areaId(t.areaId),
        orderIndex: CONVERSION_IMPLIED.orderIndex,
        xMin: t.targetBounds.bottom,
        xMax: t.targetBounds.top,
        yMin: t.targetBounds.right,
        yMax: t.targetBounds.left,
        uiMin: CONVERSION_IMPLIED.uiMin,
        uiMax: CONVERSION_IMPLIED.uiMax,
        source: 'questiedb-conversion',
        build,
      },
    ],
  };
}

/** The `maps` object of a geometry file (docs/MAPS.md §5.3): UiMaps ascending, rows ascending by OrderIndex, fixed key order. */
export function mapsJson(geometry: MapGeometry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const map of geometry.maps.values()) {
    out[String(map.uiMapId)] = {
      name: map.name,
      nameSource: map.nameSource,
      type: map.type,
      parent: map.parent,
      assignments: map.assignments.map((row) => ({
        id: row.id,
        mapId: row.mapId,
        areaId: row.areaId,
        orderIndex: row.orderIndex,
        xMin: row.xMin,
        xMax: row.xMax,
        yMin: row.yMin,
        yMax: row.yMax,
        uiMin: [...row.uiMin],
        uiMax: [...row.uiMax],
        source: row.source,
        build: row.build,
      })),
    };
  }
  return out;
}

/** The `eraToForever` object of a geometry file, ascending by UiMap. */
export function eraJson(geometry: MapGeometry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, c] of geometry.eraToForever) {
    out[String(id)] = { scaleX: c.scaleX, offsetX: c.offsetX, scaleY: c.scaleY, offsetY: c.offsetY, fromBuild: c.fromBuild, toBuild: c.toBuild, source: c.source };
  }
  return out;
}

export function buildPlaceholder(inputs: PlaceholderInputs): PlaceholderBuild {
  const { conversion: c, rows: r } = inputs;
  const conversionSha256 = sha256Hex(c.bytes);
  if (conversionSha256 !== c.expectedSha256) {
    throw new Error(`${c.path} at ${c.commit} hashes to ${conversionSha256}, expected ${c.expectedSha256} (read the LF git blob, never a CRLF working file)`);
  }
  const conversion = parseConversion(JSON.parse(Buffer.from(c.bytes).toString('utf8')) as unknown);
  for (const t of conversion.transforms) {
    if (!t.changed && !isIdentity(t.coefficients)) throw new Error(`conversion.json: UiMap ${String(t.uiMapId)} is unchanged but has non-identity coefficients`);
  }

  const rowsLf = lfBytes(r.bytes);
  const rowsSha256 = sha256Hex(rowsLf);
  const rowsFile = parseDb2RowsFile(JSON.parse(rowsLf.toString('utf8')) as unknown);
  const db2Maps = geometryMapsFromRows(rowsFile);
  const overlap = db2Maps.filter((map) => conversion.transforms.some((t) => t.uiMapId === map.uiMapId));
  if (overlap.length > 0) throw new Error(`UiMaps ${overlap.map((m) => String(m.uiMapId)).join(', ')} are in both conversion.json and the rows file`);

  const era = conversion.transforms
    .filter((t) => t.changed)
    .map((t): readonly [UiMapId, EraToForeverCoefficients] => [
      uiMapId(t.uiMapId),
      { ...t.coefficients, fromBuild: conversion.sourceBuild, toBuild: conversion.targetBuild, source: 'questiedb-conversion' },
    ]);
  const draft = createMapGeometry({
    kind: 'placeholder',
    product: PRODUCT,
    recordedFrameHash: null,
    maps: [...conversion.transforms.map((t) => conversionMap(t, conversion.targetBuild)), ...db2Maps],
    eraToForever: era,
  });
  const frameUiMapIds = conversion.transforms.map((t) => uiMapId(t.uiMapId));
  const frame = canonicalFrameTuples(draft, frameUiMapIds);
  if (!frame.ok) throw new Error(`frame set incompatible at UiMaps ${frame.incompatible.join(', ')}`);
  const frameHash = sha256Hex(frame.canonical);
  // The content hash is taken over the finished geometry (the recorded hashes are not part of it).
  const contentHash = sha256Hex(canonicalGeometryContent(draft));
  const geometry: MapGeometry = { ...draft, recordedFrameHash: frameHash, recordedContentHash: contentHash };

  const csvSha256 = { UiMapAssignment: rowsFile.sources.UiMapAssignment.sha256, UiMap: rowsFile.sources.UiMap.sha256 };
  const json = {
    _generated: {
      by: 'tools/maps import --placeholder',
      upstream:
        `Questie/QuestieDB@${c.commit} ${c.path}; ` +
        `UiMapAssignment and UiMap @ ${DB2_BUILD} (CSV SHA-256 ${csvSha256.UiMapAssignment}, ${csvSha256.UiMap}) via ${r.path}`,
      notice: 'NOTICE.md',
      edit: 'do not edit; regenerate with pnpm maps:placeholder',
    },
    schema: 1,
    kind: 'placeholder',
    product: PRODUCT,
    frameHash,
    contentHash,
    inputs: {
      'questiedb-conversion': {
        repo: c.repoUrl,
        commit: c.commit,
        path: c.path,
        sha256: conversionSha256,
        gitBlob: gitBlobId(c.bytes),
        build: conversion.targetBuild,
        eraBuild: conversion.sourceBuild,
        implied: { ...CONVERSION_IMPLIED, uiMin: [...CONVERSION_IMPLIED.uiMin], uiMax: [...CONVERSION_IMPLIED.uiMax] },
      },
      'db2-csv': { path: r.path, sha256: rowsSha256, build: DB2_BUILD, csvSha256 },
    },
    maps: mapsJson(geometry),
    eraToForever: eraJson(geometry),
  };

  const notice = noticeText({
    questiedbRepo: c.repoUrl,
    commit: c.commit,
    conversionPath: c.path,
    conversionSha256,
    frameBuild: conversion.targetBuild,
    eraBuild: conversion.sourceBuild,
    frameCount: frameUiMapIds.length,
    eraUiMapIds: era.map(([id]) => id),
    db2Build: DB2_BUILD,
    db2RowCount: db2Maps.reduce((n, map) => n + map.assignments.length, 0),
    db2UiMaps: db2Maps.map((map) => ({ id: map.uiMapId, name: map.name, rows: map.assignments.length })),
    rowsFile: r.path,
    rowsFileSha256: rowsSha256,
    csvSha256,
    frameHash,
    contentHash,
    licenceCheckDate: inputs.licenceCheckDate,
  });

  return {
    geometry,
    geometryText: formatJson(json),
    noticeText: notice,
    frameHash,
    contentHash,
    frameUiMapIds,
    conversion,
    conversionSha256,
    rowsFile,
    rowsSha256,
  };
}

