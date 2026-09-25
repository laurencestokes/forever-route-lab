import type { DatasetIdentity } from '../../domain/dataset';
import { sha256Hex, type Sha256Digest } from '../hash';
import { DATA_OUTPUT_FILES } from './rows';

/**
 * `public/data/manifest.json`, the single authoritative manifest (DATA_PROVENANCE §8). The loader
 * reads only what it needs: the identity, each output's path, size and SHA-256, the SHA-256 of the
 * `conversion.json` the data frame comes from (to pair the data with the map geometry), and
 * whether it is the fixture slice. Every other field is provenance for people and tools and is
 * ignored here.
 */

/** The QuestieDB input whose zone frames the dataset's percentages are in (MAPS.md §5.6). */
export const CONVERSION_INPUT_PATH = 'data/Forever/conversion.json';

export interface ManifestOutput {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly records: number | null;
}

export interface DataManifest {
  readonly schemaVersion: 1;
  readonly dataRevision: string;
  readonly upstreamCommit: string;
  readonly upstreamRepository: string;
  /** `sourceGameBuilds.dbcTarget`: the data frame build (D-013). */
  readonly frameBuild: string;
  /**
   * The SHA-256 of the pinned `data/Forever/conversion.json` (its `inputs` entry): the file the
   * data frame and the placeholder geometry's zone frames both come from (M2 review COORD-10).
   */
  readonly conversionSha256: string;
  readonly foreverContentVerified: boolean;
  /** Sorted by path. */
  readonly outputs: readonly ManifestOutput[];
  /**
   * Present only in the fixture slice's manifest (DATA_PROVENANCE §7.1). The loader refuses a slice
   * unless it is asked to load one (tests), so a deploy of the fixture never passes for the dataset.
   */
  readonly slice: { readonly uiMapId: number; readonly label: string } | null;
}

export type ManifestParseResult = { readonly ok: true; readonly manifest: DataManifest } | { readonly ok: false; readonly errors: readonly string[] };

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const BUILD = /^\d+\.\d+\.\d+\.\d+$/;
/** A plain file name: no directories, so a manifest can never point a fetch outside `data/`. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the fields the loader relies on; nothing else in the manifest is interpreted. */
export function parseManifest(json: unknown): ManifestParseResult {
  const errors: string[] = [];
  if (!isRecord(json)) return { ok: false, errors: ['manifest.json: expected an object'] };
  const text = (key: string, pattern: RegExp, value: unknown, path = key): string => {
    if (typeof value === 'string' && pattern.test(value)) return value;
    errors.push(`manifest.json.${path}: expected ${pattern === HEX64 ? 'a SHA-256 hex digest' : pattern === HEX40 ? 'a 40-hex commit' : 'a build like 1.60.1.69893'}`);
    return '';
  };
  if (json['schemaVersion'] !== 1) errors.push('manifest.json.schemaVersion: expected 1 (this app reads manifest version 1)');
  if (json['dataset'] !== 'questiedb-forever') errors.push('manifest.json.dataset: expected "questiedb-forever"');
  const dataRevision = text('dataRevision', HEX64, json['dataRevision']);
  const upstream = isRecord(json['upstream']) ? json['upstream'] : {};
  const upstreamCommit = text('commit', HEX40, upstream['commit'], 'upstream.commit');
  const repository = upstream['repository'];
  if (typeof repository !== 'string') errors.push('manifest.json.upstream.repository: expected a string');
  const builds = isRecord(json['sourceGameBuilds']) ? json['sourceGameBuilds'] : {};
  const frameBuild = text('dbcTarget', BUILD, builds['dbcTarget'], 'sourceGameBuilds.dbcTarget');
  const verified = json['foreverContentVerified'];
  if (typeof verified !== 'boolean') errors.push('manifest.json.foreverContentVerified: expected true or false');

  const rawInputs = json['inputs'];
  const inputs: readonly unknown[] = Array.isArray(rawInputs) ? rawInputs : [];
  const conversions = inputs.filter((entry) => isRecord(entry) && entry['path'] === CONVERSION_INPUT_PATH);
  const [conversion] = conversions;
  let conversionSha256 = '';
  if (conversions.length !== 1 || !isRecord(conversion)) {
    errors.push(`manifest.json.inputs: expected exactly one ${CONVERSION_INPUT_PATH} entry (the data frame's source)`);
  } else {
    conversionSha256 = text('sha256', HEX64, conversion['sha256'], `inputs[${CONVERSION_INPUT_PATH}].sha256`);
  }

  const outputs: ManifestOutput[] = [];
  const rawOutputs = json['outputs'];
  if (!Array.isArray(rawOutputs)) errors.push('manifest.json.outputs: expected an array');
  else {
    rawOutputs.forEach((entry: unknown, i) => {
      const at = `manifest.json.outputs[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      const { path, sha256, bytes, records } = entry;
      if (typeof path !== 'string' || !FILE_NAME.test(path)) errors.push(`${at}.path: expected a plain file name`);
      if (typeof sha256 !== 'string' || !HEX64.test(sha256)) errors.push(`${at}.sha256: expected a SHA-256 hex digest`);
      if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) errors.push(`${at}.bytes: expected a size in bytes`);
      if (records !== null && (typeof records !== 'number' || !Number.isSafeInteger(records) || records < 0)) {
        errors.push(`${at}.records: expected a count or null`);
      }
      if (typeof path === 'string' && typeof sha256 === 'string' && typeof bytes === 'number') {
        outputs.push({ path, sha256, bytes, records: typeof records === 'number' ? records : null });
      }
    });
    const paths = outputs.map((o) => o.path);
    const sorted = [...paths].sort();
    if (paths.some((p, i) => p !== sorted[i]) || new Set(paths).size !== paths.length) {
      errors.push('manifest.json.outputs: paths must be unique and sorted');
    }
    const missing = DATA_OUTPUT_FILES.filter((p) => !paths.includes(p));
    const unknown = paths.filter((p) => !DATA_OUTPUT_FILES.includes(p));
    if (missing.length > 0) errors.push(`manifest.json.outputs: missing ${missing.join(', ')}`);
    if (unknown.length > 0) {
      errors.push(`manifest.json.outputs: lists ${unknown.join(', ')}, which this version of the app does not read (the data and the app are from different builds)`);
    }
  }

  const rawSlice = json['slice'];
  let slice: DataManifest['slice'] = null;
  if (isRecord(rawSlice) && typeof rawSlice['uiMapId'] === 'number' && typeof rawSlice['label'] === 'string') {
    slice = { uiMapId: rawSlice['uiMapId'], label: rawSlice['label'] };
  } else if (rawSlice !== undefined) errors.push('manifest.json.slice: expected { uiMapId, label }');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      dataRevision,
      upstreamCommit,
      upstreamRepository: typeof repository === 'string' ? repository : '',
      frameBuild,
      conversionSha256,
      foreverContentVerified: verified === true,
      outputs,
      slice,
    },
  };
}

/**
 * The text `dataRevision` is the SHA-256 of (DATA_PROVENANCE §8.3): one `path \t sha256 \n` line
 * per output, sorted by path. The paths are plain ASCII names, so UTF-16 order is byte order.
 */
export function dataRevisionInput(outputs: readonly Pick<ManifestOutput, 'path' | 'sha256'>[]): string {
  return [...outputs]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((o) => `${o.path}\t${o.sha256}\n`)
    .join('');
}

/** Recomputes the `dataRevision` from the outputs, so a manifest edited by hand is caught. */
export function computeDataRevision(subtle: Sha256Digest, outputs: readonly Pick<ManifestOutput, 'path' | 'sha256'>[]): Promise<string> {
  return sha256Hex(subtle, dataRevisionInput(outputs));
}

/** `DatasetIdentity` (src/domain/dataset.ts) from the manifest. */
export function identityOf(manifest: DataManifest): DatasetIdentity {
  return {
    dataRevision: manifest.dataRevision,
    frameBuild: manifest.frameBuild,
    upstreamCommit: manifest.upstreamCommit,
    foreverContentVerified: manifest.foreverContentVerified,
  };
}
