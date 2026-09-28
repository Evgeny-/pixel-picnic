import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DigitAtlas, DigitLabel, layoutDigits, type DigitMetrics, type DigitStyle } from '../src/render/DigitLabel';

const light: DigitStyle = { fill: '#ffffff', stroke: '#503175', shadow: 'rgba(0,0,0,0.3)' };
const dark: DigitStyle = { fill: '#343434', stroke: '#ffffff', shadow: 'rgba(0,0,0,0.2)' };

function fakeCanvas() {
  const paint = vi.fn();
  const measure = vi.fn((text: string) => ({
    width: [...text].reduce((sum, char) => sum + (char === '1' ? 28 : 44), 0) - (text === '11' ? 2 : 0),
  }));
  const context = { fillText: paint, strokeText: paint, measureText: measure };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  return { paint, measure };
}

afterEach(() => vi.unstubAllGlobals());

describe('static digit atlas', () => {
  it('keeps counts changing without canvas calls, texture uploads, or new geometry buffers', () => {
    const { paint, measure } = fakeCanvas();
    const atlas = new DigitAtlas([light, dark]);
    const label = new DigitLabel(atlas);
    const version = atlas.texture.version;
    const sourceVersion = atlas.texture.source.version;
    const painted = paint.mock.calls.length, measured = measure.mock.calls.length;
    const positions = label.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uvs = label.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const style = atlas.styleId(light);
    for (let count = 70; count >= 0; count--) label.draw(String(count), style);
    expect(paint).toHaveBeenCalledTimes(painted);
    expect(measure).toHaveBeenCalledTimes(measured);
    expect(atlas.texture.version).toBe(version);
    expect(atlas.texture.source.version).toBe(sourceVersion);
    expect(label.geometry.getAttribute('position')).toBe(positions);
    expect(label.geometry.getAttribute('uv')).toBe(uvs);
    expect(positions.version).toBe(71);
    expect(uvs.version).toBe(71);
    expect(label.geometry.drawRange.count).toBe(6);
    label.draw('0', style);
    expect(uvs.version).toBe(71);
    label.dispose(); atlas.dispose();
  });

  it('selects prebuilt hidden and frozen styles through UVs without changing a shared atlas', () => {
    fakeCanvas();
    const atlas = new DigitAtlas([light, dark, { ...light }]);
    expect(atlas.styleId(light)).toBe(atlas.styleId({ ...light }));
    const label = new DigitLabel(atlas);
    label.draw('12', atlas.styleId(light));
    const first = Array.from(label.geometry.getAttribute('uv').array);
    const version = atlas.texture.version;
    label.draw('12', atlas.styleId(dark));
    expect(Array.from(label.geometry.getAttribute('uv').array)).not.toEqual(first);
    label.draw('?', atlas.styleId(dark));
    expect(label.geometry.drawRange.count).toBe(6);
    expect(atlas.texture.version).toBe(version);
    for (const char of '0123456789+?') {
      const uv = atlas.uv(char, atlas.styleId(dark));
      expect(Object.values(uv).every((value) => value >= 0 && value <= 1)).toBe(true);
    }
    expect(() => atlas.styleId({ ...light, fill: '#ff0000' })).toThrow('prepared');
    label.dispose(); atlas.dispose();
  });

  it('owns each counter geometry while the level owns the shared texture', () => {
    fakeCanvas();
    const atlas = new DigitAtlas([light]);
    const a = new DigitLabel(atlas), b = new DigitLabel(atlas);
    const textureDisposed = vi.fn();
    atlas.texture.addEventListener('dispose', textureDisposed);
    a.draw('7', 0);
    expect(a.geometry).not.toBe(b.geometry);
    expect((b.geometry.getAttribute('uv') as THREE.BufferAttribute).version).toBe(0);
    a.dispose(); b.dispose();
    expect(textureDisposed).not.toHaveBeenCalled();
    atlas.dispose();
    expect(textureDisposed).toHaveBeenCalledTimes(1);
  });
});

describe('digit layout', () => {
  const metrics: DigitMetrics = { size: 128,
    widths: new Map([['0', 44], ['1', 28], ['2', 44]]), kerning: new Map([['11', -2]]) };

  it('centres a kerned pair using measured font advances', () => {
    const pair = layoutDigits('11', metrics);
    expect(pair.scale).toBeCloseTo(0.52 / 0.6);
    expect(pair.glyphs[0].x).toBeCloseTo(-13 * pair.scale / 128);
    expect(pair.glyphs[1].x).toBeCloseTo(13 * pair.scale / 128);
  });

  it('keeps the old baseline and font sizes for one, two and three digits', () => {
    for (const [text, fontSize] of [['1', 0.6], ['12', 0.52], ['100', 0.42]] as const) {
      const layout = layoutDigits(text, metrics);
      expect(layout.scale * 0.6).toBeCloseTo(fontSize);
      expect(layout.y + (0.5 - 0.53) * layout.scale).toBeCloseTo(-0.03);
    }
    expect(layoutDigits('1', metrics).glyphs[0].x).toBe(0);
    expect(layoutDigits('', metrics).glyphs).toHaveLength(0);
  });
});
