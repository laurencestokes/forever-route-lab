import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseUpstream } from '../../questiedb/lib/upstream';
import { REPO_ROOT } from '../../build/lib/fs';
import { pinFromUpstream, resolvePin, UPSTREAM_PIN_FILE } from './pin';
import { RECORDED_PIN, tempDir, writeFile } from './test-support';

const OTHER_COMMIT = 'a'.repeat(40);
const OTHER_HASH = 'b'.repeat(64);

type Json = Record<string, unknown>;
/** The repository's own upstream.json, as a mutable object to derive variants from. */
const upstreamJson = (): Json => JSON.parse(readFileSync(join(REPO_ROOT, UPSTREAM_PIN_FILE), 'utf8')) as Json;
const inputsOf = (json: Json): Json[] => json['inputs'] as Json[];

let root = '';
let dispose = (): void => undefined;
beforeEach(() => {
  ({ dir: root, dispose } = tempDir('frl-pin-'));
});
afterEach(() => dispose());

describe('resolvePin (tools/questiedb/upstream.json through parseUpstream)', () => {
  it('reads the repository’s own pin, which agrees with DATA_PROVENANCE §2 and §4.1 (the test oracle)', () => {
    expect(resolvePin(REPO_ROOT, null)).toEqual({
      commit: RECORDED_PIN.commit,
      conversionSha256: RECORDED_PIN.conversionSha256,
      repository: RECORDED_PIN.repository,
      cachePath: RECORDED_PIN.cachePath,
      licenceCheckDate: RECORDED_PIN.licenceCheckDate,
      commitSource: 'tools/questiedb/upstream.json',
    });
    expect(resolvePin(REPO_ROOT, RECORDED_PIN.commit).commitSource).toBe('--commit');
  });

  it('takes the commit and the conversion.json hash from whatever upstream.json pins', () => {
    const json = upstreamJson();
    json['commit'] = OTHER_COMMIT;
    const conversion = inputsOf(json).find((input) => input['path'] === 'data/Forever/conversion.json');
    if (conversion === undefined) throw new Error('fixture: upstream.json lists conversion.json');
    conversion['sha256'] = OTHER_HASH;
    writeFile(root, UPSTREAM_PIN_FILE, JSON.stringify(json));
    expect(resolvePin(root, null)).toMatchObject({ commit: OTHER_COMMIT, conversionSha256: OTHER_HASH });
  });

  it('refuses a missing upstream.json, one the data pipeline’s parser refuses, and one without the conversion.json input', () => {
    expect(() => resolvePin(root, null)).toThrow(/upstream.json is missing/);
    writeFile(root, UPSTREAM_PIN_FILE, JSON.stringify({ ...upstreamJson(), commit: 'b6f5b07' }));
    expect(() => resolvePin(root, null)).toThrow(/full 40-character SHA/);
    const json = upstreamJson();
    json['inputs'] = inputsOf(json).filter((input) => input['path'] !== 'data/Forever/conversion.json');
    writeFile(root, UPSTREAM_PIN_FILE, JSON.stringify(json));
    expect(() => resolvePin(root, null)).toThrow(/lists no data\/Forever\/conversion.json input/);
  });

  it('refuses a --commit other than the pin (no hash is recorded for it) and a short SHA', () => {
    const upstream = parseUpstream(upstreamJson());
    expect(() => pinFromUpstream(upstream, OTHER_COMMIT)).toThrow(/no recorded SHA-256 .* pins b6f5b07b/);
    expect(() => pinFromUpstream(upstream, 'b6f5b07')).toThrow(/full 40-character/);
  });

  it('no longer guesses at other layouts (the heuristic reader is gone)', () => {
    writeFile(root, UPSTREAM_PIN_FILE, JSON.stringify({ pin: { commit: OTHER_COMMIT }, hashes: { 'data/Forever/conversion.json': OTHER_HASH } }));
    expect(() => resolvePin(root, null)).toThrow(/upstream.json/);
  });
});
