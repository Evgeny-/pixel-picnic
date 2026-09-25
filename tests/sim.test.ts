import { describe, expect, it } from 'vitest';
import { Sim, type SimEvent } from '../src/core/sim';
import { solve, estimateDifficulty } from '../src/core/solver';
import { generateLevel, replay } from '../src/core/generator';
import { Rng } from '../src/core/rng';
import type { BoxDef, LevelDef, PictureDef, Side } from '../src/core/types';

// A=0, B=1. Row 0 is the top row.
const PIC: PictureDef = {
  id: 't',
  w: 4,
  h: 3,
  palette: ['#ff0000', '#0000ff'],
  cells: '0011' + '0110' + '1001',
};

function level(boxes: BoxDef[], columns: number[][], slots = 2, sides: Side[] = ['bottom'], picture = PIC): LevelDef {
  return { n: 1, world: 0, tier: 'normal', picture, slots, sides, boxes, columns };
}

describe('Sim', () => {
  it('eats columns from the bottom and wins', () => {
    const sim = Sim.fromLevel(level([{ id: 0, color: 0, count: 6 }, { id: 1, color: 1, count: 6 }], [[0], [1]]));
    expect(sim.left).toBe(12);
    const ev: SimEvent[] = [];
    expect(sim.take(0, ev)).toBe(true);
    sim.settle(ev);
    // Only the two bottom A cubes (columns 1 and 2) are reachable at first.
    const ants = ev.filter((e) => e.t === 'ant');
    expect(ants.length).toBe(2);
    expect(ants.map((a) => (a as { cell: number }).cell).sort((p, q) => p - q)).toEqual([9, 10]);
    expect(sim.slots[0]?.left).toBe(4);
    expect(sim.take(1, ev)).toBe(true);
    sim.settle(ev);
    expect(sim.status).toBe('won');
    expect(sim.left).toBe(0);
    expect(sim.slots.every((s) => s === null)).toBe(true);
  });

  it('gets stuck when the only slot waits for a buried color', () => {
    const sim = Sim.fromLevel(level([{ id: 0, color: 0, count: 6 }, { id: 1, color: 1, count: 6 }], [[0], [1]], 1));
    sim.take(0);
    sim.settle();
    expect(sim.status).toBe('stuck');
  });

  it('opening the top side exposes the top row too', () => {
    const sim = Sim.fromLevel(level([{ id: 0, color: 0, count: 6 }], [[0]], 1, ['bottom', 'top']));
    const exp = sim.exposedCounts();
    // bottom row: B A A B, top row: A A B B
    expect(exp[0]).toBe(4);
    expect(exp[1]).toBe(4);
  });

  it('ants can walk through free space to reach cubes from the side', () => {
    // A=0, B=1, '.' = empty. Row 0 is the top row.
    //   A A A
    //   A . A
    //   A . B
    const pic: PictureDef = { id: 'cave', w: 3, h: 3, palette: ['#f00', '#00f'], cells: 'AAA'.replace(/A/g, '0') + '0.0' + '0.1' };
    const sim = Sim.fromLevel(level([{ id: 0, color: 0, count: 6 }, { id: 1, color: 1, count: 1 }], [[0], [1]], 2, ['bottom'], pic));
    const exp = sim.exposedCounts();
    // Through the empty corridor the ants reach (0,2), (0,1), (2,1) and (1,0).
    expect(exp[0]).toBe(4);
    expect(exp[1]).toBe(1);
    sim.take(0);
    sim.settle();
    // Eating those opens the rest: all six A cubes get eaten.
    expect(sim.remaining[0]).toBe(0);
  });

  it('eating a cube opens the cubes around it, not only the one behind', () => {
    // bottom row: B B B, middle: A A A, top: A A A (bottom open)
    const pic: PictureDef = { id: 'rows', w: 3, h: 3, palette: ['#f00', '#00f'], cells: '000' + '000' + '111' };
    const sim = Sim.fromLevel(level([{ id: 0, color: 1, count: 1 }], [[0]], 1, ['bottom'], pic));
    sim.take(0);
    sim.settle();
    // One B eaten in the middle: the A above it becomes reachable, and so do its free-space neighbours.
    const exp = sim.exposedCounts();
    expect(exp[0]).toBe(1);
    expect(exp[1]).toBe(2);
  });

  it('left/right sides expose row ends', () => {
    const sim = Sim.fromLevel(level([{ id: 0, color: 0, count: 6 }], [[0]], 1, ['left']));
    const exp = sim.exposedCounts();
    // first cells of rows: A, A, B
    expect(exp[0]).toBe(2);
    expect(exp[1]).toBe(1);
  });

  it('linked boxes need to be taken together and need two slots', () => {
    const boxes: BoxDef[] = [
      { id: 0, color: 0, count: 3, link: 7 },
      { id: 1, color: 1, count: 6, link: 7 },
      { id: 2, color: 0, count: 3 },
    ];
    const sim = Sim.fromLevel(level(boxes, [[0, 2], [1]], 2));
    expect(sim.legalMoves()).toEqual([0]);
    expect(sim.whyNot(1)).toBe('ok');
    const ev: SimEvent[] = [];
    expect(sim.take(1, ev)).toBe(true);
    expect(ev.filter((e) => e.t === 'take').length).toBe(2);
    expect(sim.freeSlots()).toBe(0);
    expect(sim.taps).toBe(1);
  });

  it('stacked linked boxes are taken from the same column', () => {
    const boxes: BoxDef[] = [
      { id: 0, color: 0, count: 3, link: 1 },
      { id: 1, color: 0, count: 3, link: 1 },
      { id: 2, color: 1, count: 6 },
    ];
    const sim = Sim.fromLevel(level(boxes, [[0, 1], [2]], 3));
    expect(sim.canTake(0)).toBe(true);
    expect(sim.canTake(1)).toBe(true);
    sim.take(0);
    expect(sim.columns[0].length).toBe(0);
  });

  it('hidden boxes reveal at the front, frozen boxes thaw after taps', () => {
    const boxes: BoxDef[] = [
      { id: 0, color: 0, count: 2 },
      { id: 1, color: 0, count: 2, hidden: true },
      { id: 2, color: 1, count: 6, frozen: 2 },
      { id: 3, color: 0, count: 2 },
    ];
    const sim = Sim.fromLevel(level(boxes, [[0, 1], [2], [3]], 5));
    expect(sim.boxHidden[1]).toBe(1);
    expect(sim.canTake(2)).toBe(false);
    expect(sim.whyNot(2)).toBe('frozen');
    const ev: SimEvent[] = [];
    sim.take(0, ev);
    expect(ev.some((e) => e.t === 'reveal' && e.box === 1)).toBe(true);
    expect(sim.boxHidden[1]).toBe(0);
    sim.take(3, ev);
    expect(ev.some((e) => e.t === 'thaw' && e.box === 2)).toBe(true);
    expect(sim.canTake(2)).toBe(true);
  });

  it('clone is independent', () => {
    const sim = Sim.fromLevel(level([{ id: 0, color: 0, count: 6 }, { id: 1, color: 1, count: 6 }], [[0], [1]]));
    const c = sim.clone();
    c.take(0);
    c.settle();
    expect(sim.left).toBe(12);
    expect(sim.columns[0]).toEqual([0]);
    expect(c.left).toBe(10);
  });
});

describe('solver', () => {
  it('solves the 2-slot level and proves the 1-slot level unsolvable', () => {
    const boxes = [{ id: 0, color: 0, count: 6 }, { id: 1, color: 1, count: 6 }];
    expect(solve(Sim.fromLevel(level(boxes, [[0], [1]], 2))).status).toBe('solved');
    expect(solve(Sim.fromLevel(level(boxes, [[0], [1]], 1))).status).toBe('unsolvable');
  });

  it('difficulty estimate is 1 for a trivial level', () => {
    const boxes = [{ id: 0, color: 0, count: 6 }, { id: 1, color: 1, count: 6 }];
    const d = estimateDifficulty(level(boxes, [[0], [1]], 2), 20);
    expect(d.casual).toBe(1);
  });
});

describe('generator', () => {
  // A random blobby 16x16 picture with 5 colors.
  function blobPicture(seed: number, w = 16, h = 16, k = 5): PictureDef {
    const rng = new Rng(seed);
    const centers = Array.from({ length: 9 }, () => [rng.int(0, w - 1), rng.int(0, h - 1), rng.int(0, k - 1)]);
    let cells = '';
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = 0;
        let bd = 1e9;
        centers.forEach(([cx, cy], i) => {
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < bd) { bd = d; best = i; }
        });
        cells += centers[best][2].toString(36);
      }
    return { id: 'blob', w, h, palette: ['#e33', '#3a3', '#33e', '#ee3', '#e3e'], cells };
  }

  it('generates solvable levels whose reference solution replays', () => {
    for (let s = 1; s <= 4; s++) {
      const res = generateLevel(
        blobPicture(s),
        { columns: 4, slots: 5, sides: ['bottom'], boxMin: 8, boxMax: 20, dig: 0.3, spread: 0.5, hiddenFrac: 0.2, links: 2, frozen: 1 },
        { casual: [0.2, 0.9] },
        s,
        8,
        40,
      );
      expect(res).not.toBeNull();
      const lvl = res!.level;
      const total = lvl.boxes.reduce((a, b) => a + b.count, 0);
      expect(total).toBe(256);
      expect(replay(lvl, lvl.solution!)).toBe(true);
    }
  });
});
