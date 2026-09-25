import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ZonesFile } from './lib/shapes';
import { toolIdentity } from './lib/tool-identity';
import { FIXTURE_DATA_DIR, loadUpstream, PUBLIC_DATA_DIR } from './lib/upstream';
import { validateDirectory } from './lib/validate-lib';

/**
 * `pnpm data:validate` on the committed dataset and fixture slice (no QuestieDB clone needed), and
 * the checks catching tampering: every generated file is hash-recorded and marked, so an edit by
 * hand fails. Only `extract --check` (extract.test.ts, with the clone) proves that the files equal
 * a fresh extraction (DATA_PROVENANCE §7 item 1).
 */

const pin = loadUpstream();
const temps: string[] = [];

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'questiedb-validate-'));
  temps.push(dir);
  cpSync(FIXTURE_DATA_DIR, dir, { recursive: true });
  return dir;
}

const edit = (dir: string, name: string, change: (text: string) => string): void => {
  writeFileSync(join(dir, name), change(readFileSync(join(dir, name), 'utf8')), 'utf8');
};

/** Edits a JSON file structurally (the key order, and so `_generated` first, is kept). */
const editJson = (dir: string, name: string, change: (value: Record<string, unknown>) => void): void => {
  const value = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
  change(value);
  writeFileSync(join(dir, name), `${JSON.stringify(value)}\n`, 'utf8');
};
const findingsOf = (dir: string): readonly { readonly check: string; readonly message: string }[] => validateDirectory({ dir, pin, slice: true, toolTreeHash: null }).findings;

// The committed public/data, validated in every `pnpm test` with no clone (review findings code-F1,
// data-F3): hashes, the dataRevision, golden shipped counts, references, zones and the tool tree.
describe.skipIf(!existsSync(join(PUBLIC_DATA_DIR, 'manifest.json')))('validate on the committed public/data', () => {
  it('passes, including the toolTreeHash of this checkout', () => {
    const result = validateDirectory({ dir: PUBLIC_DATA_DIR, pin, slice: false, toolTreeHash: toolIdentity().toolTreeHash });
    expect(result.findings).toEqual([]);
  });

  // The direct links are exactly the AreaIDs of the UiMapAssignment rows in the committed geometry
  // (COORD-3): the extractor derives them from QuestieDB's tables, tools/maps from conversion.json
  // and the cited DB2 rows.
  const GEOMETRY = join(PUBLIC_DATA_DIR, '..', 'maps', 'placeholder', 'geometry.placeholder.json');
  it.skipIf(!existsSync(GEOMETRY))('links as direct exactly the AreaIDs that the placeholder geometry assigns a frame', () => {
    const zones = JSON.parse(readFileSync(join(PUBLIC_DATA_DIR, 'zones.json'), 'utf8')) as ZonesFile;
    const geometry = JSON.parse(readFileSync(GEOMETRY, 'utf8')) as { readonly maps: Readonly<Record<string, { readonly assignments: readonly { readonly areaId: number }[] }>> };
    const frames = Object.entries(geometry.maps).flatMap(([uiMapId, map]) => map.assignments.filter((row) => row.areaId > 0).map((row) => `${String(row.areaId)}→${uiMapId}`));
    const direct = Object.entries(zones.areas).filter(([, row]) => row.link === 'direct').map(([areaId, row]) => `${areaId}→${String(row.uiMapId)}`);
    expect(direct.sort()).toEqual([...new Set(frames)].sort());
    expect(direct).toHaveLength(54);
  });
});

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!existsSync(join(FIXTURE_DATA_DIR, 'manifest.json')))('validate on the committed fixture slice', () => {
  it('passes, including the toolTreeHash of this checkout', () => {
    const result = validateDirectory({ dir: FIXTURE_DATA_DIR, pin, slice: true, toolTreeHash: toolIdentity().toolTreeHash });
    expect(result.findings).toEqual([]);
  });

  it('fails when a generated file is edited by hand', () => {
    const dir = copyFixture();
    edit(dir, 'items.json', (text) => text.replace('"itemClass":12', '"itemClass":13'));
    const checks = validateDirectory({ dir, pin, slice: true, toolTreeHash: null }).findings.map((finding) => finding.check);
    expect(checks).toContain('hashes');
  });

  it('fails when the dataRevision does not recompute', () => {
    const dir = copyFixture();
    edit(dir, 'manifest.json', (text) => text.replace(/"dataRevision": "[0-9a-f]{64}"/, `"dataRevision": "${'0'.repeat(64)}"`));
    expect(validateDirectory({ dir, pin, slice: true, toolTreeHash: null }).findings.map((f) => f.check)).toContain('dataRevision');
  });

  it('fails when a file loses its _generated first key', () => {
    const dir = copyFixture();
    edit(dir, 'zones.json', (text) => text.replace(/^\{\n"_generated":\{[^\n]*\},\n/, '{\n'));
    const checks = validateDirectory({ dir, pin, slice: true, toolTreeHash: null }).findings.map((f) => f.check);
    expect(checks).toContain('marking');
  });

  it('fails when the toolTreeHash is not the checkout’s', () => {
    const result = validateDirectory({ dir: FIXTURE_DATA_DIR, pin, slice: true, toolTreeHash: { tree: '0'.repeat(40), lockfile: '0'.repeat(64) } });
    expect(result.findings.map((f) => f.check)).toEqual(['toolTreeHash', 'toolTreeHash']);
  });

  it('fails on an unknown file in the directory', () => {
    const dir = copyFixture();
    writeFileSync(join(dir, 'extra.json'), '{}\n', 'utf8');
    expect(validateDirectory({ dir, pin, slice: true, toolTreeHash: null }).findings.map((f) => f.check)).toEqual(['files']);
  });

  it('fails when a drawable point is keyed by a routed subzone (COORD-3)', () => {
    const dir = copyFixture();
    // Gornek's point, moved from Durotar (14, a direct frame) to Valley of Trials (363, routed to 1411).
    edit(dir, 'spawns.json', (text) => text.replace('"3143":{"14":[[42.06,68.33]]}', '"3143":{"363":[[42.06,68.33]]}'));
    const coordinates = findingsOf(dir).filter((f) => f.check === 'coordinates');
    expect(coordinates.map((f) => f.message)).toEqual([expect.stringMatching(/^npc 3143: a drawable point is keyed by AreaId 363, a subzone routed to UiMap 1411/)]);
  });

  it("fails when an entrance's frameVerified disagrees with the audit list (COORD-4)", () => {
    const dir = copyFixture();
    editJson(dir, 'zones.json', (zones) => {
      (zones.dungeons as Record<string, unknown>)['5861'] = {
        name: 'Darkmoon Faire Island',
        alternativeAreaIds: [],
        parentZoneAreaId: 440,
        entrances: [
          { areaId: 12, x: 41.79, y: 69.52, frameVerified: true },
          { areaId: 215, x: 36.85, y: 35.86, frameVerified: true },
        ],
      };
    });
    const zones = findingsOf(dir).filter((f) => f.check === 'zones');
    expect(zones.map((f) => f.message)).toEqual(['dungeon 5861 entrance [215,36.85,35.86]: frameVerified true, expected false']);
  });

  it('checks overlay item drops and overlay quest points too (code-F15)', () => {
    const dir = copyFixture();
    editJson(dir, 'overlays.json', (overlays) => {
      const faction = overlays.faction as Record<string, Record<string, Record<string, unknown>>>;
      const alliance = faction.Alliance ?? {};
      const horde = faction.Horde ?? {};
      alliance.quests = { 8670: { objectives: [{ kind: 'event', text: null, points: { 14: [[101, 5]] } }] } };
      horde.items = { 4859: { dropItems: [999999] } };
    });
    const messages = findingsOf(dir).map((f) => `${f.check}: ${f.message}`);
    expect(messages).toContain('coordinates: overlay Alliance quest 8670 event area 14: [101,5] is outside 0-100');
    expect(messages).toContain('references: overlay Horde item 4859 references item 999999, which does not ship');
  });

  it('has a NOTICE.md that repeats the data notice and describes the slice', () => {
    const notice = readFileSync(join(FIXTURE_DATA_DIR, 'NOTICE.md'), 'utf8');
    expect(notice).toContain(pin.commit);
    expect(notice).toContain('## What this slice is');
    expect(notice).toContain('Durotar');
  });
});
