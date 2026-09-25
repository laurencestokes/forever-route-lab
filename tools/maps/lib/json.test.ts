import { describe, expect, it } from 'vitest';
import { formatJson, INLINE_ARRAY_WIDTH } from './json';

describe('formatJson', () => {
  it('writes nested objects indented, flat rows inline, a final LF and nothing else', () => {
    const text = formatJson({
      _generated: { by: 'x' },
      maps: { '1414': { name: 'Kalimdor', assignments: [{ id: 1, uiMin: [0, 0], ok: true, note: null }] }, '947': { name: 'Azeroth', assignments: [] } },
    });
    expect(text).toBe(
      [
        '{',
        '  "_generated": {',
        '    "by": "x"',
        '  },',
        '  "maps": {',
        '    "947": {',
        '      "name": "Azeroth",',
        '      "assignments": []',
        '    },',
        '    "1414": {',
        '      "name": "Kalimdor",',
        '      "assignments": [',
        '        { "id": 1, "uiMin": [0, 0], "ok": true, "note": null }',
        '      ]',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('\r');
  });

  it('keeps numbers in shortest round-trip form, so the source decimals survive', () => {
    const values = [-1716.6666259766, 12266.700195312, 0.03990000114, -1000000, 7466.6000976562, 0.8348002068275978];
    expect(formatJson(values)).toBe(`[${values.map(String).join(', ')}]\n`);
    expect(JSON.parse(formatJson(values))).toEqual(values);
  });

  it('breaks long primitive arrays one item per line', () => {
    const long = Array.from({ length: 20 }, (_, i) => `column_${String(i)}`);
    const text = formatJson({ header: long });
    // "{", '"header": [', the items, "]", "}" and the empty string after the final LF
    expect(text.split('\n').length).toBe(long.length + 5);
    expect(`[${long.map((s) => JSON.stringify(s)).join(', ')}]`.length).toBeGreaterThan(INLINE_ARRAY_WIDTH);
  });

  it('is deterministic and refuses values JSON cannot hold', () => {
    const value = { b: 1, a: [1, { c: 'd' }] };
    expect(formatJson(value)).toBe(formatJson(structuredClone(value)));
    expect(() => formatJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => formatJson({ x: () => 1 })).toThrow(/cannot write/);
  });
});
