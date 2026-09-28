import { describe, expect, it } from 'vitest';
import { Sim, Where } from '../src/core/sim';
import { Rng } from '../src/core/rng';
import type { BoxDef, LevelDef } from '../src/core/types';
import { DispatchQueue } from '../src/game/DispatchQueue';

function makeSim(boxes: BoxDef[], columns: number[][], slots = 2): Sim {
  const level: LevelDef = {
    n: 1, world: 0, tier: 'normal', slots, boxes, columns,
    picture: { id: 'queue', w: 8, h: 1, palette: ['#d44', '#44d'], cells: '00001111' },
  };
  return Sim.fromLevel(level);
}
const box = (id: number, extra: Partial<BoxDef> = {}): BoxDef => ({ id, color: 0, count: 1, ...extra });

describe('DispatchQueue', () => {
  it('remembers tap order at full capacity and dispatches only after a slot frees', () => {
    const sim = makeSim([box(0), box(1), box(2), box(3)], [[0], [1], [2], [3]], 1);
    sim.take(0);
    const plan = new DispatchQueue();
    expect(plan.toggle(sim, 2)).toEqual({ kind: 'added' });
    expect(plan.toggle(sim, 1)).toEqual({ kind: 'added' });
    expect(plan.next(sim)).toBeNull();
    expect([...plan.positions(sim)]).toEqual([[2, 1], [1, 2]]);
    sim.round();
    expect(plan.next(sim)).toBe(2);
    expect(sim.take(plan.next(sim)!)).toBe(true);
    expect(plan.next(sim)).toBeNull();
    sim.round();
    expect(plan.next(sim)).toBe(1);
    expect([...plan.positions(sim)]).toEqual([[1, 1]]);
  });

  it('selects and cancels a linked group by either member, without splitting it', () => {
    const sim = makeSim([box(0, { link: 7 }), box(1, { link: 7 }), box(2)], [[0], [1], [2]]);
    const plan = new DispatchQueue();
    plan.toggle(sim, 1);
    plan.toggle(sim, 2);
    expect([...plan.positions(sim)]).toEqual([[0, 1], [1, 1], [2, 2]]);
    expect(plan.toggle(sim, 0)).toEqual({ kind: 'removed' });
    expect([...plan.positions(sim)]).toEqual([[2, 1]]);
  });

  it('does not let a single box jump ahead while the first linked pair needs two slots', () => {
    const sim = makeSim([box(0, { count: 3 }), box(1, { link: 9 }), box(2, { link: 9 }), box(3)], [[0], [1], [2], [3]]);
    sim.take(0);
    const plan = new DispatchQueue();
    plan.toggle(sim, 1);
    plan.toggle(sim, 3);
    expect(sim.freeSlots()).toBe(1);
    expect(sim.canTake(3)).toBe(true);
    expect(plan.next(sim)).toBeNull();
    sim.round(); sim.round(); sim.round();
    expect(plan.next(sim)).toBe(1);
    sim.take(1);
    expect(sim.boxWhere[2]).toBe(Where.Slot);
  });

  it('permits deeper selections only after their blockers, without revealing hidden colours', () => {
    const sim = makeSim([box(0), box(1, { hidden: true }), box(2)], [[0, 1], [2]]);
    const plan = new DispatchQueue();
    expect(plan.toggle(sim, 1)).toEqual({ kind: 'rejected', reason: 'blocked' });
    plan.toggle(sim, 0);
    expect(plan.toggle(sim, 1)).toEqual({ kind: 'added' });
    expect(sim.boxHidden[1]).toBe(1);
    expect(sim.columns[0]).toEqual([0, 1]);
    plan.toggle(sim, 2);
    // Cancelling the prerequisite also unmarks its dependent; unrelated intentions survive.
    plan.toggle(sim, 0);
    expect(plan.ids).toEqual([2]);
  });

  it('retains the linked-partner restriction even while slots are full', () => {
    const sim = makeSim([box(0, { link: 1 }), box(1), box(2, { link: 1 })], [[0], [1, 2]]);
    const plan = new DispatchQueue();
    expect(plan.toggle(sim, 0)).toEqual({ kind: 'rejected', reason: 'link' });
    plan.toggle(sim, 1);
    expect(plan.toggle(sim, 0)).toEqual({ kind: 'added' });
    expect([...plan.positions(sim)]).toEqual([[1, 1], [0, 2], [2, 2]]);
  });

  it('respects freezing and counts a linked move as one thawing tap', () => {
    const sim = makeSim([box(0, { link: 1 }), box(1, { link: 1 }), box(2, { frozen: 2 }), box(3)], [[0], [1], [2], [3]], 4);
    const plan = new DispatchQueue();
    plan.toggle(sim, 0);
    expect(plan.toggle(sim, 2)).toEqual({ kind: 'rejected', reason: 'frozen' });
    plan.toggle(sim, 3);
    expect(plan.toggle(sim, 2)).toEqual({ kind: 'added' });
    sim.take(0);
    expect(sim.isFrozen(2)).toBe(true);
    sim.take(3);
    expect(sim.isFrozen(2)).toBe(false);
    expect(plan.next(sim)).toBe(2);
  });

  it('reconciles magnet removals and shuffle changes without holding stale box IDs', () => {
    const sim = makeSim([box(0), box(1), box(2), box(3)], [[0, 1], [2, 3]], 4);
    const plan = new DispatchQueue();
    plan.toggle(sim, 0); plan.toggle(sim, 1); plan.toggle(sim, 2);
    sim.grab(1);
    plan.reconcile(sim);
    expect(plan.ids).toEqual([0, 2]);
    sim.shuffle(new Rng(42));
    plan.reconcile(sim);
    const projected = sim.clone();
    for (const id of plan.ids) {
      expect(projected.canTake(id)).toBe(true);
      projected.take(id);
    }
    plan.clear();
    expect(plan.size).toBe(0);
  });

  it('does not suppress genuine stuck detection when a queued box cannot fit', () => {
    const sim = makeSim([box(0, { color: 1, count: 8 }), box(1)], [[0], [1]], 1);
    sim.take(0);
    const plan = new DispatchQueue();
    plan.toggle(sim, 1);
    sim.settle();
    expect(sim.status).toBe('stuck');
    expect(plan.next(sim)).toBeNull();
    expect(plan.ids).toEqual([1]);
    sim.addSlot();
    expect(plan.next(sim)).toBe(1);
  });
});
