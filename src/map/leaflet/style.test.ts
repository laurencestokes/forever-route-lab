import { describe, expect, it } from 'vitest';
import type { NpcId, StepId, WorldMapId } from '../../domain/ids';
import type { AggregateDescriptor, LineStyle, MarkerDescriptor, MarkerKind } from '../adapter';
import {
  aggregateGlyph,
  compactCount,
  DEFAULT_MAP_PALETTE,
  frameStyle,
  glyphExtent,
  glyphHitRadius,
  markerGlyph,
  outlineStyle,
  paletteFrom,
  PALETTE_SOURCES,
  polylineStyle,
  stackText,
  type GlyphShape,
} from './style';

// map/leaflet may import only map/adapter values (ARCHITECTURE §4), so the tests brand ids themselves.
const npcId = (value: number): NpcId => value as NpcId;
const stepId = (value: string): StepId => value as StepId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

/**
 * The reserved difficulty colours (docs/UI.md §3.2, mirroring src/rules/difficulty.ts) and the
 * provenance cyan (UI.md §3.1). The map must never paint with them (UI.md §4). They are written
 * out here because map/leaflet may not import rules values (ARCHITECTURE §4).
 */
const RESERVED = ['#808080', '#40bf40', '#ffff00', '#ff8040', '#ff1a1a', '#006d7d', '#3ccfe0'];

const marker = (kind: MarkerKind, style: MarkerDescriptor['style'] = 'neutral', count = 1): MarkerDescriptor => ({
  type: 'marker',
  id: kind,
  point: { mapId: worldMapId(1), x: 0, y: 0 },
  kind,
  style,
  emphasis: 'normal',
  label: null,
  badges: [],
  ref: { kind: 'step', stepId: stepId('s') },
  count,
  refs: Array.from({ length: count }, () => ({ kind: 'step', stepId: stepId('s') }) as const),
  labels: Array.from({ length: count }, () => null),
});

describe('palette', () => {
  it('reads --frl-map-<role> first, then the kit token, then the light default', () => {
    const properties: Record<string, string> = {
      '--frl-map-route': ' #111111 ',
      '--frl-accent': '#222222',
      '--frl-fg': '',
    };
    const palette = paletteFrom((property) => properties[property] ?? '');
    expect(palette.route).toBe('#111111');
    expect(palette.accent).toBe('#222222');
    expect(palette.flight).toBe('#222222');
    expect(palette.ink).toBe(PALETTE_SOURCES.ink.fallback);
    expect(paletteFrom(() => '')).toEqual(DEFAULT_MAP_PALETTE);
  });

  it('strokes frames and the extent with the map-frame token, then the strong border (M3 review MAP-A11Y-6)', () => {
    const lookup =
      (properties: Readonly<Record<string, string>>) =>
      (property: string): string =>
        properties[property] ?? '';
    const kit = paletteFrom(lookup({ '--frl-border-strong': '#101010' }));
    expect([kit.frame, kit.extent]).toEqual(['#101010', '#101010']);
    const token = paletteFrom(lookup({ '--frl-map-frame': '#202020', '--frl-border-strong': '#101010' }));
    expect([token.frame, token.extent]).toEqual(['#202020', '#202020']);
    const extent = paletteFrom(lookup({ '--frl-map-extent': '#303030', '--frl-map-frame': '#202020' }));
    expect([extent.frame, extent.extent]).toEqual(['#202020', '#303030']);
  });

  it('never defaults to a reserved difficulty or provenance colour', () => {
    const values: readonly string[] = Object.values(DEFAULT_MAP_PALETTE as unknown as Readonly<Record<string, string>>);
    for (const value of values) expect(RESERVED).not.toContain(value.toLowerCase());
    for (const source of Object.values(PALETTE_SOURCES)) {
      for (const token of [source.token, ...(source.also ?? [])]) {
        expect(token.startsWith('--frl-difficulty')).toBe(false);
        expect(token.startsWith('--frl-forever')).toBe(false);
      }
    }
  });
});

describe('line styles', () => {
  const styles: readonly LineStyle[] = ['route', 'transport', 'flight', 'hearth', 'route-pending', 'route-fallback', 'highlight', 'proposal'];

  it('gives every leg style its own dash pattern, so colour is never the only cue', () => {
    const patterns = styles.filter((s) => s !== 'highlight').map((s) => polylineStyle(s, 'normal', DEFAULT_MAP_PALETTE).dashArray);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(polylineStyle('route', 'normal', DEFAULT_MAP_PALETTE).dashArray).toBeNull();
    expect(polylineStyle('highlight', 'normal', DEFAULT_MAP_PALETTE).weight).toBeGreaterThan(polylineStyle('route', 'normal', DEFAULT_MAP_PALETTE).weight);
  });

  it('draws walked legs without a path straight in the route colour, pending faded in short dashes, fallback dash-dot-dot', () => {
    const route = polylineStyle('route', 'normal', DEFAULT_MAP_PALETTE);
    const pending = polylineStyle('route-pending', 'normal', DEFAULT_MAP_PALETTE);
    const fallback = polylineStyle('route-fallback', 'normal', DEFAULT_MAP_PALETTE);
    expect([pending.color, fallback.color]).toEqual([route.color, route.color]);
    expect(pending).toMatchObject({ dashArray: '4 4' });
    expect(pending.opacity).toBeLessThan(route.opacity);
    expect(fallback).toMatchObject({ dashArray: '10 3 2 3 2 3', opacity: route.opacity });
    // Neither looks like the hearth's dash-dot or the flight's dots.
    expect([pending.dashArray, fallback.dashArray]).not.toContain(polylineStyle('hearth', 'normal', DEFAULT_MAP_PALETTE).dashArray);
  });

  it('thickens strong lines and fades dim ones', () => {
    const normal = polylineStyle('route', 'normal', DEFAULT_MAP_PALETTE);
    expect(polylineStyle('route', 'strong', DEFAULT_MAP_PALETTE).weight).toBe(normal.weight + 2);
    expect(polylineStyle('route', 'dim', DEFAULT_MAP_PALETTE).opacity).toBeLessThan(normal.opacity);
    expect(normal.fill).toBe(false);
  });

  it('draws zone frames filled and the extent as a dashed outline', () => {
    expect(frameStyle('zone', 'normal', DEFAULT_MAP_PALETTE)).toMatchObject({ fill: true, dashArray: null, color: DEFAULT_MAP_PALETTE.frame });
    expect(frameStyle('zone', 'strong', DEFAULT_MAP_PALETTE)).toMatchObject({ color: DEFAULT_MAP_PALETTE.frameStrong, weight: 2.5 });
    expect(frameStyle('extent', 'normal', DEFAULT_MAP_PALETTE)).toMatchObject({ fill: false, dashArray: '6 4' });
  });

  it('leaves out a zone frame’s fill over painted art', () => {
    expect(frameStyle('zone', 'normal', DEFAULT_MAP_PALETTE, false)).toMatchObject({ fill: false, fillOpacity: 0, opacity: 1 });
    expect(frameStyle('zone', 'strong', DEFAULT_MAP_PALETTE, false)).toMatchObject({ fill: false, color: DEFAULT_MAP_PALETTE.frameStrong });
  });

  it('strokes zone outlines like frames, at full opacity, and the coastline thinner in the muted ink', () => {
    expect(outlineStyle('zones', DEFAULT_MAP_PALETTE)).toMatchObject({ color: DEFAULT_MAP_PALETTE.zoneOutline, weight: 1.5, opacity: 1, fill: false, dashArray: null });
    expect(outlineStyle('coast', DEFAULT_MAP_PALETTE)).toMatchObject({ color: DEFAULT_MAP_PALETTE.coast, weight: 1, opacity: 1, fill: false });
    // The outline role takes the frame token first, as frames do.
    expect(paletteFrom((property) => (property === '--frl-map-frame' ? '#202020' : '')).zoneOutline).toBe('#202020');
  });

  it('strokes frames at full opacity, so the frame token keeps its 3:1 against the map', () => {
    expect(frameStyle('zone', 'normal', DEFAULT_MAP_PALETTE).opacity).toBe(1);
    expect(frameStyle('zone', 'strong', DEFAULT_MAP_PALETTE).opacity).toBe(1);
    expect(frameStyle('extent', 'normal', DEFAULT_MAP_PALETTE).opacity).toBe(1);
  });
});

describe('glyph specs', () => {
  it('sizes and colours markers by kind, style and emphasis', () => {
    const step = markerGlyph(marker('step', 'accent'), DEFAULT_MAP_PALETTE);
    expect(step).toMatchObject({ shape: 'step', fill: DEFAULT_MAP_PALETTE.accent, stroke: DEFAULT_MAP_PALETTE.markerEdge, alpha: 1 });
    const strong = markerGlyph(marker('step', 'accent'), DEFAULT_MAP_PALETTE, 'strong');
    expect(strong.size).toBeCloseTo(step.size * 1.35, 9);
    expect(markerGlyph(marker('objective'), DEFAULT_MAP_PALETTE).size).toBeLessThan(step.size);
    expect(markerGlyph(marker('halo', 'accent'), DEFAULT_MAP_PALETTE)).toMatchObject({ fill: null, stroke: DEFAULT_MAP_PALETTE.accent });
    expect(markerGlyph(marker('quest-start', 'muted'), DEFAULT_MAP_PALETTE).fill).toBe(DEFAULT_MAP_PALETTE.inkMuted);
    expect(markerGlyph(marker('quest-end', 'proposal'), DEFAULT_MAP_PALETTE, 'dim').alpha).toBe(0.4);
    expect(glyphHitRadius(step)).toBe(step.size + 2);
    expect(step.stack).toBeNull();
  });

  it('gives a stack a count badge: the count up to 9, then 9+', () => {
    expect(markerGlyph(marker('step', 'accent', 3), DEFAULT_MAP_PALETTE).stack).toBe('3');
    expect([stackText(2), stackText(9), stackText(10), stackText(250)]).toEqual(['2', '9', '9+', '9+']);
  });

  it('bounds every glyph by its paint, badges and count included (M3 review PERF-13)', () => {
    const shapes: readonly MarkerKind[] = ['step', 'quest-start', 'quest-end', 'objective', 'flight-master', 'transition', 'halo'];
    for (const kind of shapes) {
      const spec = markerGlyph(marker(kind), DEFAULT_MAP_PALETTE, 'strong');
      expect(glyphExtent(spec), kind).toBeGreaterThanOrEqual(spec.size * 0.85 + 1);
      expect(glyphExtent(spec), kind).toBeLessThanOrEqual(spec.size * 1.15 + 3);
    }
    const plain = markerGlyph(marker('step'), DEFAULT_MAP_PALETTE);
    const unknown = markerGlyph({ ...marker('step'), badges: ['leg-unknown'] }, DEFAULT_MAP_PALETTE);
    expect(glyphExtent(unknown)).toBeGreaterThanOrEqual(plain.size + 8.5);
    const stacked = markerGlyph(marker('step', 'accent', 4), DEFAULT_MAP_PALETTE);
    expect(glyphExtent(stacked)).toBeGreaterThan(glyphExtent(plain));
    const shape: GlyphShape = 'aggregate';
    expect(glyphExtent({ ...plain, shape, size: 12 })).toBeCloseTo(12 + plain.strokeWidth / 2 + 1, 9);
  });

  it('writes aggregate counts compactly and never overstates them', () => {
    expect([compactCount(0), compactCount(37), compactCount(999), compactCount(1000), compactCount(4369), compactCount(9999), compactCount(12500)]).toEqual([
      '0',
      '37',
      '999',
      '1.0k',
      '4.3k',
      '9.9k',
      '12k',
    ]);
    const aggregate: AggregateDescriptor = {
      type: 'aggregate',
      id: 'agg',
      point: { mapId: worldMapId(1), x: 0, y: 0 },
      layer: 'objectives',
      count: 4369,
      subjects: 3,
      emphasis: 'normal',
      label: null,
      ref: { kind: 'spawn', subject: { kind: 'npc', id: npcId(1) }, spawnIndex: 0, questIds: [] },
    };
    const spec = aggregateGlyph(aggregate, DEFAULT_MAP_PALETTE);
    expect(spec).toMatchObject({ shape: 'aggregate', text: '4.3k', fill: DEFAULT_MAP_PALETTE.aggregateFill });
    expect(spec.size).toBeGreaterThan(aggregateGlyph({ ...aggregate, count: 5 }, DEFAULT_MAP_PALETTE).size);
  });
});
