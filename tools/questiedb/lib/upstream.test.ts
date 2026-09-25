import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadUpstream, parseUpstream, UPSTREAM_JSON } from './upstream';

const raw = JSON.parse(readFileSync(UPSTREAM_JSON, 'utf8')) as Record<string, unknown>;
const withCheck = (licenceCheck: unknown): unknown => ({ ...raw, licenceCheck });

describe('upstream.json', () => {
  it('parses the pin, the semantics inputs and the licence check', () => {
    const pin = loadUpstream();
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.inputs.some((input) => input.role === 'semantics')).toBe(true);
    expect(pin.licenceCheck).toEqual({
      date: '2026-09-25',
      method: 'full-history check of every branch',
      result: "no root licence file (none covering Questie's own code or data) on the default branch of Questie/QuestieDB or Questie/Questie",
      note: expect.stringContaining('bundled third-party material') as unknown,
      upstreamLicenceFile: null,
      evidence: 'docs/DATA_PROVENANCE.md §3.1',
    });
  });

  it('keeps the licence check next to the pin and refuses a malformed one (data-F9)', () => {
    const check = raw.licenceCheck as Record<string, unknown>;
    expect(() => parseUpstream({ ...raw, licenceCheck: undefined })).toThrow(/"licenceCheck" must be an object/);
    expect(() => parseUpstream(withCheck({ ...check, date: '25/09/2026' }))).toThrow(/YYYY-MM-DD/);
    expect(() => parseUpstream(withCheck({ ...check, upstreamLicenceFile: 'LICENSE' }))).toThrow(/change trigger/);
    expect(() => parseUpstream(withCheck({ ...check, result: '' }))).toThrow(/"result" must be a non-empty string/);
    expect(parseUpstream(withCheck({ ...check, note: null })).licenceCheck.note).toBeNull();
  });

  it('refuses an unknown input role', () => {
    const inputs = (raw.inputs as readonly Record<string, unknown>[]).map((input, index) => (index === 0 ? { ...input, role: 'documentation' } : input));
    expect(() => parseUpstream({ ...raw, inputs })).toThrow(/inputs\[0\]\.role is invalid/);
  });
});
