import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sim } from '../src/core/sim';
import type { BoxDef, LevelDef } from '../src/core/types';
import { computeLayout } from '../src/render/layout';
import { QueueLinks } from '../src/render/QueueLinks';
import { linkedTargets, queueCounterLayout } from '../src/render/chainRouting';
import { routeCords, type CordObstacle, type CordPoint } from '../src/render/cordRouting';
import levels from '../src/data/levels.json';

const box = (id: number, extra: Partial<BoxDef> = {}): BoxDef => ({ id, color: 0, count: 1, ...extra });
function makeSim(boxes: BoxDef[], columns: number[][]): Sim {
  return Sim.fromLevel({
    n: 1, world: 0, tier: 'normal', slots: 2, boxes, columns,
    picture: { id: 'links', w: 8, h: 1, palette: ['#d44'], cells: '00000000' },
  });
}
function expectOutsideBoxes(route: CordPoint[], obstacles: CordObstacle[]): void {
  expect(route.length).toBeGreaterThan(1);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeLessThan(1e-5);
    for (const box of obstacles) {
      const overlapsX = Math.max(a.x, b.x) > box.x - box.halfX + 1e-5 && Math.min(a.x, b.x) < box.x + box.halfX - 1e-5;
      const overlapsZ = Math.max(a.z, b.z) > box.z - box.halfZ + 1e-5 && Math.min(a.z, b.z) < box.z + box.halfZ - 1e-5;
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

describe('box-color cord routes', () => {
  it('connects neighboring boxes directly at the facing walls', () => {
    const obstacles = [{ id: 0, x: 0, z: 0, halfX: .5, halfZ: .5 }, { id: 1, x: 1.4, z: 0, halfX: .5, halfZ: .5 }];
    const route = routeCords(obstacles, [{ a: 0, b: 1 }], 1)[0];
    expect(route).toEqual([{ x: .5, z: 0 }, { x: .8999999999999999, z: 0 }]);
    expectOutsideBoxes(route, obstacles);
  });

  it('routes distant partners around an intervening lid', () => {
    const obstacles = [0, 1, 2].map(id => ({ id, x: id * 1.4, z: 0, halfX: .5, halfZ: .5 }));
    const route = routeCords(obstacles, [{ a: 0, b: 2 }], 1)[0];
    expectOutsideBoxes(route, obstacles);
    expect(route.some(p => Math.abs(p.z) >= .535)).toBe(true);
  });

  it('separates crowded connections and aligns their whole approach to shared counter pins', () => {
    const obstacles: CordObstacle[] = Array.from({ length: 9 }, (_, id) => ({
      id, x: (id % 3) * 1.5, z: Math.floor(id / 3) * 1.32, halfX: .49, halfZ: .47,
    }));
    obstacles.push({ id: -1, x: 3, z: 4.0123, halfX: .32, halfZ: .2 });
    const routes = routeCords(obstacles, [{ a: 0, b: 8 }, { a: 2, b: 6 }, { a: 1, b: -1 }, { a: 3, b: -1 }], 1);
    for (const route of routes) expectOutsideBoxes(route, obstacles);
    expect(routes[2].at(-1)).not.toEqual(routes[3].at(-1));
    for (const route of routes.slice(2)) {
      const p = route.at(-2)!, q = route.at(-1)!;
      expect(Math.min(Math.abs(p.x - q.x), Math.abs(p.z - q.z))).toBeLessThan(1e-7);
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(.07);
    }
  });

  function fixture(sim: Sim, aspect = .5) {
    const layout = computeLayout({ aspect, w: sim.s.w, h: sim.s.h, slots: sim.slots.length, columns: sim.columns.length, rows: 3 });
    const boxes = new Map(Array.from({ length: sim.boxIds }, (_, id) => {
      const column = sim.boxCol[id], row = sim.columns[column]?.indexOf(id) ?? -1;
      const slot = sim.slots.findIndex(s => s?.box === id);
      const to = slot >= 0 ? new THREE.Vector3(layout.slot[slot].x, .17, layout.slot[slot].z)
        : new THREE.Vector3(layout.queueCol[column], 0, layout.queueZ0 + row * layout.queueRow);
      const group = new THREE.Group();
      group.position.copy(to);
      group.scale.setScalar(layout.boxSize);
      group.visible = slot >= 0 || (row >= 0 && row < 3);
      return [id, { group, to, where: slot >= 0 ? 'slot' as const : row >= 0 ? 'queue' as const : 'gone' as const, fade: 1 }];
    }));
    const group = new THREE.Group();
    const links = new QueueLinks(sim, boxes, group, [new THREE.Color('#ff4422')]);
    links.sync(sim, layout, c => layout.queueCol[c]);
    links.update(layout.boxSize);
    return { layout, boxes, group, links };
  }

  it.each([.5, 1.6])('attaches to the actual hidden counter, without leaking its color (aspect %s)', aspect => {
    const sim = makeSim([box(0, { link: 8 }), box(1), box(2), box(3), box(4, { link: 8 })], [[0], [1, 2, 3, 4]]);
    const { layout, boxes, group, links } = fixture(sim, aspect);
    expect(group.children).toHaveLength(1);
    const cord = group.children[0] as THREE.Mesh;
    expect(cord.visible).toBe(true);
    expect(cord.userData.linkColors).toEqual(['ff4422', 'e5d9c1']);
    const geometry = cord.geometry;
    expect(geometry.index!.count / 3).toBeLessThan(500);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const version = position.version;
    links.update(layout.boxSize);
    links.sync(sim, layout, c => layout.queueCol[c]);
    links.update(layout.boxSize);
    expect(cord.geometry).toBe(geometry);
    expect(position.version).toBe(version);
    const counter = queueCounterLayout(layout, layout.queueCol[1]);
    // Last left/right vertices of the first ribbon average to the counter's boundary.
    const n = position.count / 3;
    const x = (position.getX(n - 1) + position.getX(n - 2)) / 2;
    const z = (position.getZ(n - 1) + position.getZ(n - 2)) / 2;
    const dz = (z - counter.z) * Math.cos(layout.tilt);
    expect(Math.min(Math.abs(Math.abs(x - counter.x) - counter.width * .49), Math.abs(Math.abs(dz) - counter.height * .49))).toBeLessThan(1e-5);
    boxes.get(0)!.group.position.y += 1;
    links.update(layout.boxSize);
    expect(position.version).toBeGreaterThan(version);
    links.dispose();
    expect(group.children).toHaveLength(0);
  });

  it.each([.5, 1.6])('keeps every starting campaign link visible (aspect %s)', aspect => {
    for (const level of levels as LevelDef[]) {
      const sim = Sim.fromLevel(level);
      const { group, links } = fixture(sim, aspect);
      expect(group.children.length, `level ${level.n}`).toBe(linkedTargets(sim, 3).length);
      for (const child of group.children) expect(child.visible, `level ${level.n}`).toBe(true);
      links.dispose();
    }
  }, 20000);

  it.each([14, 42, 180, 280])('retains links through dispatch, hidden reveals and completion on level %s', n => {
    const level = (levels as LevelDef[]).find(l => l.n === n)!;
    const sim = Sim.fromLevel(level);
    const check = () => {
      for (const aspect of [.5, 1.6]) {
        const { group, links } = fixture(sim, aspect);
        expect(group.children.length, `level ${n}, round ${sim.roundNo}`).toBe(linkedTargets(sim, 3).length);
        links.dispose();
      }
    };
    for (const id of level.solution!) {
      for (let wait = 0; !sim.canTake(id) && wait < 2000; wait++) sim.round();
      expect(sim.take(id)).toBe(true);
      check();
    }
    for (let wait = 0; sim.status === 'playing' && wait < 2000; wait++) sim.round();
    check();
    expect(linkedTargets(sim, 3)).toHaveLength(0);
  });

  it('keeps a mystery box neutral until it is revealed', () => {
    const sim = makeSim([box(0, { link: 8 }), box(1), box(2, { link: 8, hidden: true })], [[0], [1, 2]]);
    const { group, links, layout } = fixture(sim);
    expect(group.children[0].userData.linkColors).toEqual(['ff4422', 'e5d9c1']);
    sim.boxHidden[2] = 0;
    links.sync(sim, layout, c => layout.queueCol[c]);
    expect(group.children[0].userData.linkColors).toEqual(['ff4422', 'ff4422']);
    links.dispose();
  });
});
