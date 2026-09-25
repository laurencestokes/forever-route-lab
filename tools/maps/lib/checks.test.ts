import { describe, expect, it } from 'vitest';
import { canonicalGeometryContent } from '../../../src/geo/content';
import { parseGeometryFile } from '../../../src/geo/geometry';
import { passed, placeholderChecks, type CheckResult } from './checks';
import { sha256Hex } from './hash';
import { formatJson } from './json';
import { buildPlaceholder } from './placeholder';
import { committedGeometryJson, conversionFromCommitted, inputsFrom, readRepoText } from './test-support';

/**
 * The placeholder checks on the full 49 + 12 rows without a QuestieDB checkout: conversion.json's
 * geometry block is reconstructed from the committed file, so every content check has real data.
 */
const expected = buildPlaceholder(inputsFrom(conversionFromCommitted()));

type Json = Record<string, unknown>;
const failing = (results: readonly CheckResult[]): readonly string[] => results.filter((r) => !passed(r)).map((r) => r.id);
const run = (geometryText: string, noticeText: string | null = expected.noticeText) => placeholderChecks({ geometryText, noticeText, expected });

const tampered = (edit: (json: Json) => void): string => {
  const json = JSON.parse(expected.geometryText) as Json;
  edit(json);
  return formatJson(json);
};
const map = (json: Json, id: string): Json => (json['maps'] as Record<string, Json>)[id] as Json;
const row = (json: Json, id: string, index = 0): Json => (map(json, id)['assignments'] as Json[])[index] as Json;

describe('placeholderChecks', () => {
  it('passes R1 and P1-P5, P7, P8 on a faithful build', () => {
    const results = run(expected.geometryText);
    expect(results.map((r) => r.id)).toEqual(['R1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'P8']);
    expect(failing(results)).toEqual([]);
  });

  it('passes every content check on the committed file (only R1, byte identity, needs the real blob hash)', () => {
    const results = run(readRepoText('public/maps/placeholder/geometry.placeholder.json'), readRepoText('public/maps/placeholder/NOTICE.md'));
    expect(failing(results)).toEqual(['R1']);
    expect(committedGeometryJson()['frameHash']).toBe('2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f');
  });

  it('P1 and P4 catch a moved QuestieDB frame', () => {
    expect(failing(run(tampered((json) => (row(json, '1411')['xMin'] = -1716.5))))).toEqual(['R1', 'P1', 'P4', 'P8']);
  });

  it('P1 catches a renamed frame or a changed assignment ID', () => {
    expect(failing(run(tampered((json) => (map(json, '1454')['name'] = 'Orgrimmar City'))))).toEqual(['R1', 'P1', 'P8']);
    expect(failing(run(tampered((json) => (row(json, '1454')['id'] = 1))))).toEqual(['R1', 'P1', 'P8']);
  });

  it('P2 catches a db2-csv row or UiMap that differs from the rows file', () => {
    expect(failing(run(tampered((json) => (map(json, '2524')['parent'] = 947))))).toEqual(['R1', 'P2', 'P8']);
    expect(failing(run(tampered((json) => (row(json, '947', 1)['uiMin'] = [0.55, 0.0994]))))).toEqual(['R1', 'P2', 'P8']);
    // inputs is provenance: not content, so P8 still passes.
    expect(failing(run(tampered((json) => ((json['inputs'] as Record<string, Json>)['db2-csv'] as Json)['sha256'] = '0'.repeat(64))))).toEqual(['R1', 'P2']);
  });

  it('P3 catches an extra UiMap and a wrong build', () => {
    const extra = tampered((json) => {
      (json['maps'] as Record<string, Json>)['2999'] = { ...map(json, '2524'), assignments: [{ ...row(json, '2524'), id: 99999 }] };
    });
    expect(failing(run(extra))).toContain('P3');
    expect(failing(run(tampered((json) => (row(json, '1411')['build'] = '1.60.1.70009'))))).toEqual(['R1', 'P1', 'P3', 'P8']);
  });

  it('P4 catches a recorded frame hash that does not match the frames', () => {
    expect(failing(run(tampered((json) => (json['frameHash'] = 'f'.repeat(64)))))).toEqual(['R1', 'P4']);
  });

  it('P5 catches a missing or altered Era → Forever coefficient set', () => {
    expect(failing(run(tampered((json) => delete (json['eraToForever'] as Json)['1433'])))).toEqual(['R1', 'P5', 'P8']);
    expect(failing(run(tampered((json) => (((json['eraToForever'] as Json)['1412'] as Json)['offsetY'] = 13.15))))).toEqual(['R1', 'P5', 'P8']);
  });

  it('P7 catches a non-isotropic frame; 2665 (1.5 region on square art) is exempt', () => {
    expect(failing(run(tampered((json) => (row(json, '1411')['yMax'] = -1900))))).toEqual(['R1', 'P1', 'P4', 'P7', 'P8']);
    const p7 = run(expected.geometryText).find((r) => r.id === 'P7');
    expect(p7?.problems).toEqual([]);
  });

  it('P8 catches a recorded content hash that does not match the content, and an edit with a recomputed hash', () => {
    expect(failing(run(tampered((json) => (json['contentHash'] = 'f'.repeat(64)))))).toEqual(['R1', 'P8']);
    // A hand edit that also rewrites contentHash passes the loader's self-check, but not validate:
    // P1 compares with conversion.json, and P8 with a fresh import.
    const edited = tampered((json) => {
      (((json['eraToForever'] as Json)['1412'] as Json)['scaleX'] as number) *= 1.5;
      const parsed = parseGeometryFile(json);
      if (!parsed.ok) throw new Error(parsed.errors.join('; '));
      json['contentHash'] = sha256Hex(canonicalGeometryContent(parsed.geometry));
    });
    const p8 = run(edited).find((r) => r.id === 'P8');
    expect(p8?.problems).toEqual([expect.stringContaining("differs from a fresh import's") as unknown]);
    expect(failing(run(edited))).toEqual(['R1', 'P5', 'P8']);
  });

  it('R1 reports a missing or stale NOTICE, and P0 an unparseable file', () => {
    expect(run(expected.geometryText, null).find((r) => r.id === 'R1')?.problems).toEqual(['NOTICE.md is missing']);
    expect(run(expected.geometryText, 'edited').find((r) => r.id === 'R1')?.problems).toEqual(['NOTICE.md differs from a fresh import']);
    expect(failing(run('{ not json'))).toEqual(['R1', 'P0']);
    expect(failing(run(tampered((json) => (json['schema'] = 2))))).toEqual(['R1', 'P0']);
  });
});
