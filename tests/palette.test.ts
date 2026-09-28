import { describe, expect, it } from 'vitest';
import campaign from '../src/data/levels.json';
import { colorOklab, MIN_PALETTE_DISTANCE, PALETTE_DISTANCE_TARGETS, paletteDistances, paletteSeparation, readablePalette } from '../src/render/palette';

describe('readable palettes', () => {
  it('uses published OKLab sRGB reference values', () => {
    expect(colorOklab('#000000')).toEqual([0, 0, 0]);
    const white = colorOklab('#ffffff');
    expect(white[0]).toBeCloseTo(1, 6);
    expect(white[1]).toBeCloseTo(0, 6);
    expect(white[2]).toBeCloseTo(0, 6);
    const red = colorOklab('#ff0000');
    expect(red[0]).toBeCloseTo(0.627955, 5);
    expect(red[1]).toBeCloseTo(0.224863, 5);
    expect(red[2]).toBeCloseTo(0.125846, 5);
  });

  it('keeps every campaign color distinct even in the warm, bright-surface stress model', () => {
    for (const level of campaign) {
      const before = [...level.picture.palette];
      const after = readablePalette(before, level.picture.cells);
      expect(after, `level ${level.n}`).toHaveLength(before.length);
      paletteDistances(after).forEach((gap, model) => {
        expect(gap, `level ${level.n}, model ${model}: ${after}`).toBeGreaterThanOrEqual(PALETTE_DISTANCE_TARGETS[model]);
      });
      expect(before).toEqual(level.picture.palette);
      expect(after.every((color) => /^#[a-f0-9]{6}$/i.test(color))).toBe(true);
      // Dark/light features of a monochrome picture must not get inverted.
      const neutralIds = before.map((color, id) => ({ id, lab: colorOklab(color) }))
        .filter(({ lab }) => Math.hypot(lab[1], lab[2]) < 0.035)
        .sort((a, b) => a.lab[0] - b.lab[0]).map(({ id }) => id);
      const lightness = neutralIds.map((id) => colorOklab(after[id])[0]);
      expect(lightness, `neutral order in level ${level.n}`).toEqual([...lightness].sort((a, b) => a - b));
    }
  }, 20000);

  it('separates level 35 white/grey without darkening its face or body', () => {
    const source = campaign[34].picture.palette;
    const fixed = readablePalette(source, campaign[34].picture.cells);
    expect(paletteSeparation(fixed)).toBeGreaterThan(paletteSeparation(source) * 2);
    for (const index of [0, 1, 3, 4, 5]) {
      const [, a, b] = colorOklab(fixed[index]);
      expect(Math.hypot(a, b)).toBeLessThan(0.025);
    }
    const greys = [5, 4, 0, 3, 1].map((id) => colorOklab(fixed[id])[0]);
    expect(greys).toEqual([...greys].sort((a, b) => a - b));
    expect(fixed[1]).toBe('#ffffff');
    expect(fixed[0]).toBe(source[0]); // Original mid-grey body stays recognizable.
    expect(fixed[2]).toBe(source[2]); // Keep the original sunny yellow background.
    expect(colorOklab(fixed[3])[0]).toBeGreaterThan(0.82); // Face stays pale.
    expect(fixed[4]).toBe(source[4]);
  });

  it('preserves level 42 dominant orange while separating its shading colors', () => {
    const source = campaign[41].picture.palette;
    const cells = campaign[41].picture.cells;
    const fixed = readablePalette(source, cells);
    expect(paletteSeparation(fixed)).toBeGreaterThanOrEqual(MIN_PALETTE_DISTANCE);
    expect(fixed[1]).toBe(source[1]); // The main crab body must stay bright orange.
    expect(fixed[2]).toBe(source[2]); // Keep the existing dark-red accents too.
    expect(readablePalette(source, cells)).toEqual(fixed);
    fixed[0] = '#000000';
    expect(readablePalette(source, cells)[0]).not.toBe('#000000');
  });
});
