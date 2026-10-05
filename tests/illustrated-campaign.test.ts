import { describe, expect, it } from 'vitest';
import campaign from '../src/data/levels-illustrated.json';
import { replay } from '../src/core/generator';
import { worldOf } from '../src/core/progression';
import { decodeCells, tierForLevel, type LevelDef } from '../src/core/types';
import { CAMPAIGN_LEVELS } from '../src/core/worlds';
import { pairReadability, PICTURE_READABILITY } from '../src/render/palette';

const levels = campaign as LevelDef[];

describe('illustrated campaign', () => {
  it('has 280 numbered levels in 14 worlds with the usual tiers', () => {
    expect(levels).toHaveLength(CAMPAIGN_LEVELS);
    for (const l of levels) {
      expect(l.world).toBe(worldOf(l.n));
      expect(l.tier).toBe(tierForLevel(l.n));
    }
    expect(levels.map((l) => l.n)).toEqual(Array.from({ length: CAMPAIGN_LEVELS }, (_, i) => i + 1));
  });

  it('opens with a three-color tutorial that every tap order wins', () => {
    const intro = levels[0];
    expect([intro.picture.palette.length, intro.boxes.length, intro.slots]).toEqual([3, 5, 5]);
    const orders: number[][] = [];
    const walk = (a: number[], b: number[], acc: number[]): void => {
      if (!a.length && !b.length) orders.push(acc);
      if (a.length) walk(a.slice(1), b, [...acc, a[0]]);
      if (b.length) walk(a, b.slice(1), [...acc, b[0]]);
    };
    walk(intro.columns[0], intro.columns[1], []);
    expect(orders).toHaveLength(10);
    for (const order of orders) expect(replay(intro, order), `order ${order}`).toBe(true);
  });

  it('keeps every pair of colors in a picture easy to tell apart', () => {
    for (const l of levels) {
      const p = l.picture.palette;
      for (let a = 0; a < p.length; a++) for (let b = a + 1; b < p.length; b++) {
        expect(pairReadability(p[a], p[b]), `level ${l.n}: ${p[a]} / ${p[b]}`).toBeGreaterThanOrEqual(PICTURE_READABILITY);
      }
    }
  });

  it('uses every picture once and fills every box from its picture', () => {
    expect(new Set(levels.map((l) => l.picture.id)).size).toBe(levels.length);
    for (const l of levels) {
      const cells = decodeCells(l.picture);
      expect(cells.length).toBe(l.picture.w * l.picture.h);
      const need = new Array(l.picture.palette.length).fill(0);
      for (const c of cells) if (c >= 0) need[c]++;
      const got = new Array(l.picture.palette.length).fill(0);
      for (const b of l.boxes) got[b.color] += b.count;
      expect(got, `boxes of level ${l.n}`).toEqual(need);
      expect(Math.max(l.picture.w, l.picture.h), `size of level ${l.n}`).toBeLessThanOrEqual(60);
      expect(l.name?.ru && l.name?.en, `name of level ${l.n}`).toBeTruthy();
    }
  });

  it('can be finished without boosters by its stored solution', () => {
    for (const l of levels) expect(replay(l, l.solution!), `solution of level ${l.n}`).toBe(true);
  });
});
