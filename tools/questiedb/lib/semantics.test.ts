import { describe, expect, it } from 'vitest';
import { assertTranscriptionsCurrent, TranscriptionError, TRANSCRIPTIONS, transcriptionProblems } from './semantics';
import { loadUpstream, type UpstreamInput } from './upstream';

const pin = loadUpstream();

describe('transcribed upstream behaviour is hash-pinned (data-F2)', () => {
  it('pins every transcribed file, with the hash each transcribing module names', () => {
    expect(transcriptionProblems(pin.inputs)).toEqual([]);
    expect(() => {
      assertTranscriptionsCurrent(pin.inputs);
    }).not.toThrow();
    const semantics = pin.inputs.filter((input) => input.role === 'semantics').map((input) => input.path);
    expect(semantics).toEqual([
      'src/corrections/register.lua',
      'src/derived/requiredRaces.lua',
      'src/derived/_end.lua',
      'src/meta/normalize.lua',
      'src/support/data.lua',
      'docs/forever-coordinate-audit.md',
    ]);
    // compat.lua, registry.lua and config.lua are read too, but their transcribed parts are pinned the same way.
    expect(new Set(TRANSCRIPTIONS.map((t) => t.path))).toEqual(new Set([...semantics, 'src/corrections/compat.lua', 'src/corrections/registry.lua', 'src/config.lua']));
  });

  it('fails when a pin bump changes a transcribed file, naming every module to review', () => {
    const bumped: UpstreamInput[] = pin.inputs.map((input) => (input.path === 'src/corrections/register.lua' ? { ...input, sha256: 'f'.repeat(64) } : input));
    const problems = transcriptionProblems(bumped);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^lib\/plan\.ts transcribes src\/corrections\/register\.lua .* but upstream\.json pins ffffffffffff…: review/);
    expect(problems[1]).toMatch(/^lib\/corrections\.ts transcribes src\/corrections\/register\.lua/);
    expect(() => {
      assertTranscriptionsCurrent(bumped);
    }).toThrow(TranscriptionError);
  });

  it('fails when a transcribed file is no longer pinned, or a semantics input is not transcribed', () => {
    expect(transcriptionProblems(pin.inputs.filter((input) => input.path !== 'src/derived/_end.lua'))).toEqual([
      expect.stringMatching(/^lib\/derived\.ts transcribes src\/derived\/_end\.lua .*which upstream\.json does not pin$/),
    ]);
    const extra: UpstreamInput = { path: 'src/derived/waypoints.lua', role: 'semantics', sha256: '0'.repeat(64) };
    expect(transcriptionProblems([...pin.inputs, extra])).toEqual(['src/derived/waypoints.lua has role "semantics" but no module names it as transcribed']);
  });
});
