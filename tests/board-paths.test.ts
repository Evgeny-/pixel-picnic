import { describe, expect, it } from 'vitest';
import { Sim } from '../src/core/sim';
import { SIDES, type LevelDef, type Side } from '../src/core/types';
import { BoardPathPlanner } from '../src/render/BoardPathPlanner';
import { computeLayout } from '../src/render/layout';

function board(side: Side, target: number, cells?: string) {
  const w = 8, h = 8, gate = 1;
  const level: LevelDef = {
    n: 1, world: 0, tier: 'normal', slots: 1, boxes: [], columns: [[]],
    picture: { id: 'gate', w, h, palette: ['#d34f32'], cells: cells ?? Array.from({ length: w * h }, (_, i) => i === target ? '0' : '.').join('') },
    fences: [
      ...SIDES.filter((s) => s !== side).map((s) => ({ side: s, from: 0, to: 8 })),
      { side, from: 0, to: gate }, { side, from: gate + 1, to: 8 },
    ],
  };
  const sim = Sim.fromLevel(level);
  const layout = computeLayout({ aspect: 0.5, w, h, slots: 1, columns: 1, rows: 3 });
  const pad = layout.cell * 0.35 + layout.frame;
  const rect = { x0: layout.picX0 - pad, x1: layout.picX0 + layout.picW + pad, z0: layout.picZ0 - pad, z1: layout.picZ0 + layout.picH + pad };
  return { sim, layout, rect, gate };
}

describe('character routes through fences', () => {
  it.each(SIDES)('preserves the narrow %s gate when smoothing a mostly empty board', (side) => {
    const { sim, layout: l, rect, gate } = board(side, 6 * 8 + 6);
    const plan = new BoardPathPlanner().plan(sim, l, rect, 0.46, 54, 0, 20)!;
    expect(plan).not.toBeNull();
    const [ax, az, bx, bz] = plan.inside;
    const horizontal = side === 'bottom' || side === 'top';
    const base = horizontal ? l.picX0 : l.picZ0;
    const from = base + gate * l.cell, to = from + l.cell;
    // Both endpoints of the locked entrance segment align with the actual opening.
    expect(horizontal ? ax : az).toBeGreaterThan(from);
    expect(horizontal ? ax : az).toBeLessThan(to);
    expect(horizontal ? bx : bz).toBeCloseTo((from + to) / 2);
    expect(plan.inside.length).toBeGreaterThanOrEqual(6);
    // Walking home reverses these same inside waypoints, preserving the gate in both directions.
    const home = Array.from({ length: plan.inside.length / 2 }, (_, i) => plan.inside.slice(i * 2, i * 2 + 2)).reverse();
    expect(home.at(-1)).toEqual([ax, az]);
  });

  it('does not invent a straight route when the target is unreachable', () => {
    const { sim, layout, rect } = board('bottom', 0, '0'.repeat(64));
    expect(new BoardPathPlanner().plan(sim, layout, rect, 0.46, 0, 0, 20)).toBeNull();
  });

  it('can approach a cube occupying the gate itself', () => {
    const target = 7 * 8 + 1;
    const { sim, layout: l, rect } = board('bottom', target, '0'.repeat(64));
    const plan = new BoardPathPlanner().plan(sim, l, rect, 0.46, target, 0, 20)!;
    expect(plan).not.toBeNull();
    expect(plan.inside[0]).toBeGreaterThan(l.picX0 + l.cell);
    expect(plan.inside[0]).toBeLessThan(l.picX0 + l.cell * 2);
    expect(plan.block).toEqual([]);
  });

  it('does not backtrack at a narrow gate when the character is larger than a cell', () => {
    const target = 6 * 8 + 1;
    const { sim, layout: l, rect } = board('bottom', target);
    const plan = new BoardPathPlanner().plan(sim, l, rect, l.cell * 1.9, target, 0, 20)!;
    const z = plan.inside.filter((_, i) => i % 2 === 1);
    expect(z.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < z.length; i++) expect(z[i]).toBeLessThan(z[i - 1]);
  });
});
