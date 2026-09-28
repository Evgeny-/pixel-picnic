import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sim } from '../src/core/sim';
import type { BoxDef, LevelDef } from '../src/core/types';
import { computeLayout } from '../src/render/layout';
import { QueueLinks } from '../src/render/QueueLinks';
import { hiddenChainEnd, linkedTargets, routeChain, type ChainObstacle, type ChainPoint } from '../src/render/chainRouting';
import levels from '../src/data/levels.json';

const box = (id: number, extra: Partial<BoxDef> = {}): BoxDef => ({ id, color: 0, count: 1, ...extra });
function makeSim(boxes: BoxDef[], columns: number[][]): Sim {
  return Sim.fromLevel({
    n: 1, world: 0, tier: 'normal', slots: 2, boxes, columns,
    picture: { id: 'links', w: 8, h: 1, palette: ['#d44'], cells: '00000000' },
  });
}
function expectOutsideBoxes(route: ChainPoint[], obstacles: ChainObstacle[]): void {
  expect(route.length).toBeGreaterThan(1);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeLessThan(1e-5);
    for (const box of obstacles) {
      const overlapsX = Math.max(a.x, b.x) > box.x - box.half + 1e-5 && Math.min(a.x, b.x) < box.x + box.half - 1e-5;
      const overlapsZ = Math.max(a.z, b.z) > box.z - box.half + 1e-5 && Math.min(a.z, b.z) < box.z + box.half - 1e-5;
      expect(overlapsX && overlapsZ).toBe(false);
    }
  }
}

describe('physical linked box targets', () => {
  it('keeps a visible link to the actual column of a hidden partner', () => {
    const sim = makeSim([box(0, { link: 8 }), box(1), box(2), box(3), box(4, { link: 8, hidden: true })], [[0], [1, 2, 3, 4]]);
    expect(sim.whyNot(0)).toBe('link');
    expect(linkedTargets(sim, 3)).toEqual([{
      a: { box: 0, column: 0, row: 0, visible: true },
      b: { box: 4, column: 1, row: 3, visible: false },
    }]);
    expect(sim.boxHidden[4]).toBe(1);
    sim.take(1);
    expect(linkedTargets(sim, 3)[0].b).toEqual({ box: 4, column: 1, row: 2, visible: true });
  });

  it('retains distant links after dispatch and removes completed ones', () => {
    const sim = makeSim([box(0, { link: 40 }), box(1, { link: 7 }), box(2, { link: 7 }), box(3, { link: 40 })], [[0], [1], [2], [3]]);
    expect(linkedTargets(sim, 3).map(({ a, b }) => [a.box, b.box])).toEqual([[0, 3], [1, 2]]);
    sim.take(0);
    expect(linkedTargets(sim, 3).filter(({ a }) => a.box === 0)).toHaveLength(1);
    sim.round();
    expect(linkedTargets(sim, 3).map(({ a, b }) => [a.box, b.box])).toEqual([[1, 2]]);
  });

  it('does not draw a chain when both partners are below the visible rows', () => {
    const sim = makeSim([box(0), box(1, { link: 1 }), box(2), box(3, { link: 1 })], [[0, 1], [2, 3]]);
    expect(linkedTargets(sim, 1)).toEqual([]);
  });

  it('reproduces level 42 hidden partner after the first two right-column moves', () => {
    const level = (levels as LevelDef[]).find((level) => level.n === 42)!;
    const sim = Sim.fromLevel(level);
    expect(sim.take(2)).toBe(true);
    expect(sim.take(5)).toBe(true);
    expect(linkedTargets(sim, 3)).toContainEqual({
      a: { box: 15, column: 2, row: 2, visible: true },
      b: { box: 16, column: 1, row: 5, visible: false },
    });
  });
});

describe('chain routes', () => {
  it('connects neighboring boxes at the facing walls', () => {
    const obstacles = [{ id: 0, x: 0, z: 0, half: 0.5 }, { id: 1, x: 1.4, z: 0, half: 0.5 }];
    const route = routeChain({ ...obstacles[0], box: 0 }, { ...obstacles[1], box: 1 }, obstacles, 0.12);
    expect(route).toEqual([{ x: 0.5, z: 0 }, { x: 0.8999999999999999, z: 0 }]);
    expectOutsideBoxes(route, obstacles);
  });

  it('routes distant partners around an intervening lid', () => {
    const obstacles = [0, 1, 2].map((id) => ({ id, x: id * 1.4, z: 0, half: 0.5 }));
    const route = routeChain({ ...obstacles[0], box: 0 }, { ...obstacles[2], box: 2 }, obstacles, 0.12);
    expectOutsideBoxes(route, obstacles);
    expect(route.some((p) => Math.abs(p.z) >= 0.62)).toBe(true);
  });

  it.each([0.5, 1.6])('ends a hidden continuation by +N within layout bounds (aspect %s)', (aspect) => {
    const layout = computeLayout({ aspect, w: 32, h: 32, slots: 4, columns: 3, rows: 3 });
    const end = hiddenChainEnd(layout, layout.queueCol[1], layout.queueCol[2]);
    const direction = Math.sign(layout.queueRow);
    const lastZ = layout.queueZ0 + (layout.queueRowsVisible - 1) * layout.queueRow;
    expect((end.z - lastZ) * direction).toBeGreaterThan(layout.boxSize * 0.5);
    expect(end.z).toBeGreaterThan(layout.bounds.minZ);
    expect(end.z).toBeLessThan(layout.bounds.maxZ);
    expect(end.x).toBeGreaterThan(layout.queueCol[1]);
    expect(end.x).toBeLessThan(layout.queueCol[2]);
    const obstacles = layout.queueCol.flatMap((x, c) => Array.from({ length: 3 }, (_, r) => ({
      id: c * 3 + r, x, z: layout.queueZ0 + r * layout.queueRow, half: layout.boxSize * 0.5,
    })));
    const route = routeChain({ ...obstacles[8], box: 8 }, end, obstacles, layout.boxSize * 0.12);
    expectOutsideBoxes(route, obstacles);
    expect(route.at(-1)!.x).toBeCloseTo(end.x, 5);
    expect(route.at(-1)!.z).toBeCloseTo(end.z, 5);
    for (const p of route) {
      expect(p.x).toBeGreaterThan(layout.bounds.minX);
      expect(p.x).toBeLessThan(layout.bounds.maxX);
      expect(p.z).toBeGreaterThan(layout.bounds.minZ);
      expect(p.z).toBeLessThan(layout.bounds.maxZ);
    }
  });

  it('renders a hidden continuation without rebuilding stationary geometry each frame or ant round', () => {
    const sim = makeSim([box(0, { link: 8 }), box(1), box(2), box(3), box(4, { link: 8 })], [[0], [1, 2, 3, 4]]);
    const layout = computeLayout({ aspect: 0.5, w: 32, h: 32, slots: 2, columns: 2, rows: 3 });
    const boxes = new Map(Array.from({ length: sim.boxIds }, (_, id) => {
      const column = sim.boxCol[id], row = sim.columns[column].indexOf(id);
      const to = new THREE.Vector3(layout.queueCol[column], 0, layout.queueZ0 + row * layout.queueRow);
      const group = new THREE.Group();
      group.position.copy(to);
      group.visible = row < 3;
      return [id, { group, to, where: 'queue' as const, fade: 1 }];
    }));
    const group = new THREE.Group();
    const links = new QueueLinks(sim, boxes, group);
    links.sync(sim, layout, (column) => layout.queueCol[column]);
    links.update(layout.boxSize);
    const chain = group.children[0] as THREE.InstancedMesh;
    expect(chain.visible).toBe(true);
    expect(chain.count).toBeGreaterThan(18);
    expect(chain.count).toBeLessThanOrEqual(144);
    const version = chain.instanceMatrix.version;
    links.update(layout.boxSize);
    links.sync(sim, layout, (column) => layout.queueCol[column]);
    links.update(layout.boxSize);
    expect(chain.instanceMatrix.version).toBe(version);
    links.dispose();
    expect(group.children).toHaveLength(0);
  });
});
