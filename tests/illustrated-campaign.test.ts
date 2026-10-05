import { describe, expect, it } from 'vitest';
import campaign from '../src/data/levels-illustrated.json';
import classic from '../src/data/levels.json';
import { replay } from '../src/core/generator';
import { worldOf } from '../src/core/progression';
import { decodeCells, tierForLevel, type LevelDef } from '../src/core/types';
import { CAMPAIGN_LEVELS } from '../src/core/worlds';

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

  it('opens with the same tutorial level as the classic campaign', () => {
    expect(levels[0]).toEqual((classic as LevelDef[])[0]);
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
