import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import campaign from '../src/data/levels.json';
import { replay, tierTarget } from '../src/core/generator';
import { planLevel, worldOf } from '../src/core/progression';
import { tierForLevel, type LevelDef } from '../src/core/types';
import { CAMPAIGN_LEVELS, WORLD_IDS } from '../src/core/worlds';
import { THEMES } from '../src/render/themes';
import { PICTURES } from '../scripts/pictures-manifest';
import { hasEmoji } from '../scripts/lib/emoji';

const levels = campaign as LevelDef[];

describe('campaign', () => {
  it('continues through 280 levels and 14 worlds without changing the published puzzles', () => {
    expect(levels).toHaveLength(CAMPAIGN_LEVELS);
    expect(CAMPAIGN_LEVELS).toBe(280);
    expect(levels.map(l => l.n)).toEqual(Array.from({ length: 280 }, (_, i) => i + 1));
    expect(THEMES.map(t => t.id)).toEqual(WORLD_IDS);
    expect(createHash('sha256').update(JSON.stringify(levels.slice(0, 140))).digest('hex'))
      .toBe('69056472ae5f454038b48a5b8f109aaecf26c96aed476d44124174185f223064');
  });

  it('uses fresh, attributable artwork for each new puzzle', () => {
    const sources = new Set<string>();
    const ids = new Set<string>();
    for (const l of levels) {
      const art = PICTURES.find(p => p.id === l.picture.id);
      expect(art, `missing source for level ${l.n}`).toBeDefined();
      const source = `${art!.source}:${art!.icon}`;
      if (l.n > 140) {
        expect(sources.has(source), `repeated art at ${l.n}`).toBe(false);
        expect(art!.theme).toBe(WORLD_IDS[l.world]);
        expect(hasEmoji(art!.source, art!.icon)).toBe(true);
      }
      expect(ids.has(l.picture.id), `duplicate picture id at ${l.n}`).toBe(false);
      ids.add(l.picture.id);
      sources.add(source);
    }
  });

  it.each(levels)('level $n has balanced boxes and a complete booster-free solution', l => {
    expect(l.world).toBe(worldOf(l.n));
    expect(l.tier).toBe(tierForLevel(l.n));
    expect(l.picture.cells).toHaveLength(l.picture.w * l.picture.h);
    const totals = new Array(l.picture.palette.length).fill(0);
    for (const ch of l.picture.cells) {
      if (ch === '.') continue;
      const color = parseInt(ch, 36);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThan(totals.length);
      totals[color]++;
    }
    for (const box of l.boxes) {
      expect(box.count).toBeGreaterThan(0);
      expect(Number.isInteger(box.count)).toBe(true);
      totals[box.color] -= box.count;
    }
    expect(totals).toEqual(totals.map(() => 0));
    expect(l.columns.flat().sort((a, b) => a - b)).toEqual(l.boxes.map(b => b.id).sort((a, b) => a - b));
    expect(new Set(l.columns.flat()).size).toBe(l.boxes.length);
    expect(l.solution?.length).toBeGreaterThan(0);
    expect(replay(l, l.solution!), `solution of level ${l.n}`).toBe(true);
    if (l.n > 140) {
      expect(Math.max(l.picture.w, l.picture.h)).toBeLessThanOrEqual(34);
      expect(l.slots).toBe(4);
      expect(Math.max(...l.boxes.map(b => b.count))).toBeLessThanOrEqual(tierTarget(l.tier, l.n).maxBox!);
    }
  });

  it('keeps advanced plans bounded and never completely closes the board', () => {
    for (let n = 141; n <= 320; n++) {
      const plan = planLevel(n, tierForLevel(n));
      expect(plan.gridSize).toBeLessThanOrEqual(30);
      expect(plan.params.slots).toBe(4);
      expect(plan.params.visibleRows).toBe(3);
      expect(plan.fences.length < 4 || plan.fences.some(f => (f.gate ?? 0) >= 4)).toBe(true);
    }
    for (const tier of ['normal', 'hard', 'superhard'] as const) {
      expect(tierTarget(tier, 280).minCritical!).toBeGreaterThan(tierTarget(tier, 141).minCritical!);
    }
  });
});
