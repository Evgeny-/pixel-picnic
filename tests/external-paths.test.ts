import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/core/sim';
import type { LevelDef } from '../src/core/types';
import { AntsView } from '../src/render/AntsView';
import type { BoardView } from '../src/render/BoardView';
import { CreatureGrounding } from '../src/render/CreatureGrounding';
import { createCreatureRig } from '../src/render/creatureModel';
import { ExternalPathPlanner, queueObstacle, slotObstacle, type ObstacleRect } from '../src/render/ExternalPathPlanner';
import { computeLayout } from '../src/render/layout';
import { NestView } from '../src/render/NestView';

const inside = (r: ObstacleRect, x: number, z: number) =>
  x > r.x0 + 1e-5 && x < r.x1 - 1e-5 && z > r.z0 + 1e-5 && z < r.z1 - 1e-5;

function expectClear(points: number[], obstacles: ObstacleRect[]) {
  for (let i = 2; i < points.length; i += 2) {
    for (let k = 0; k <= 100; k++) {
      const t = k / 100;
      const x = points[i - 2] * (1 - t) + points[i] * t;
      const z = points[i - 1] * (1 - t) + points[i + 1] * t;
      for (const obstacle of obstacles) expect(inside(obstacle, x, z)).toBe(false);
    }
  }
}

afterEach(() => vi.restoreAllMocks());

describe('external creature routes', () => {
  it('walks around a solid tray and its overlapping queue in both directions', () => {
    const obstacles = [
      { x0: -3, x1: 3, z0: -1, z1: 1 },
      { x0: -2, x1: 2, z0: 0.5, z1: 5 },
    ];
    const planner = new ExternalPathPlanner();
    planner.setObstacles(obstacles);
    for (const [sx, sz, x, z] of [[0, -2, 0, 6], [0, 6, 0, -2], [-4, 0, 4, 0]]) {
      const path = planner.route(sx, sz, x, z)!;
      expect(path).not.toBeNull();
      expect(path.length).toBeGreaterThan(2);
      expect(path.slice(-2)).toEqual([x, z]);
      expectClear([sx, sz, ...path], obstacles);
    }
  });

  it('refuses invalid endpoints instead of silently ignoring a box', () => {
    const planner = new ExternalPathPlanner();
    planner.setObstacles([{ x0: -1, x1: 1, z0: -1, z1: 1 }]);
    expect(planner.route(0, 0, 0, 2)).toBeNull();
    expect(planner.route(0, 2, 0, 0)).toBeNull();
    expect(planner.route(2, -2, 2, 2)).toEqual([2, 2]);
  });

  it.each([
    { aspect: 0.42, w: 8, slots: 1 },
    { aspect: 0.75, w: 8, slots: 4 },
    { aspect: 0.42, w: 34, slots: 7 },
    { aspect: 1.8, w: 8, slots: 4 },
    { aspect: 1.8, w: 34, slots: 7 },
  ])('beavers leave their own boxes and return around the tray, $aspect aspect / $w cells / $slots slots', ({ aspect, w, slots }) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const target = w * (w - 2) + Math.floor(w / 2);
    const level: LevelDef = {
      n: 1, world: 0, tier: 'normal', slots, boxes: [], columns: [[], [], []],
      picture: { id: 'routes', w, h: w, palette: ['#f84'],
        cells: '.'.repeat(target) + '0' + '.'.repeat(w * w - target - 1) },
    };
    const layout = computeLayout({ aspect, w, h: w, slots, columns: 3, rows: 3 });
    const sim = Sim.fromLevel(level);
    const rig = createCreatureRig('beaver');
    const f = new CreatureGrounding(rig).footprint;
    const size = Math.max(0.46, Math.min(0.74, layout.cell * 1.9));
    const clearance = Math.hypot(Math.max(-f.minX, f.maxX), Math.max(-f.minZ, f.maxZ)) * size + 0.06;
    for (const geometry of [rig.body, rig.eyes, rig.pupils, rig.legs, rig.details, rig.tail?.geometry]) geometry?.dispose();
    const tray = slotObstacle(layout, clearance), queue = queueObstacle(layout, clearance);
    const nest = new NestView('#f84', 'igloo');
    nest.setLayout(layout);
    const door = nest.doorway(new THREE.Vector3());
    if (layout.mode === 'portrait') expect(door.z + 0.18).toBeLessThan(tray.z0);
    const matrix = new THREE.Matrix4();
    try {
      for (const slot of layout.slot) {
        let present = true;
        const cb = { onPick: vi.fn(), onDeliver: vi.fn() };
        const board = {
          cubeColor: () => new THREE.Color('#f84'),
          cubeWorld: (_: number, out: THREE.Vector3) => out.set(
            layout.picX0 + ((target % w) + 0.5) * layout.cell, 0.06 + 0.62 * layout.cell,
            layout.picZ0 + (Math.floor(target / w) + 0.5) * layout.cell),
          isPresent: (cell: number) => cell === target && present,
          remove: () => { present = false; },
          setPickupProgress: () => {},
        };
        const view = new AntsView(level.picture.palette, board as unknown as BoardView, sim, cb, 'cube', 'none', 'beaver');
        try {
          view.setLayout(layout);
          view.setHome(nest.footprint(), door);
          view.spawn(new THREE.Vector3(slot.x, 0.6, slot.z), target, 0);
          expect(view.count).toBe(1);
          view.pickup(target);
          const body = view.group.children[0] as THREE.InstancedMesh;
          let escaped = false, approachedDoor = false;
          for (let tick = 0; tick < 2400 && view.count; tick++) {
            view.update(1 / 120, tick / 120);
            if (!view.count) break;
            body.getMatrixAt(0, matrix);
            const x = matrix.elements[12], z = matrix.elements[14];
            if (!inside(tray, x, z)) escaped = true;
            if (escaped) {
              expect(inside(tray, x, z)).toBe(false);
              expect(inside(queue, x, z)).toBe(false);
            } else {
              // Leaving the own box must not cut sideways through neighbouring boxes.
              expect(x).toBeCloseTo(slot.x, 5);
            }
            if (Math.hypot(x - door.x, z - door.z) < 0.2) approachedDoor = true;
          }
          expect(escaped).toBe(true);
          expect(approachedDoor).toBe(true);
          expect(cb.onPick).toHaveBeenCalledTimes(1);
          expect(cb.onDeliver).toHaveBeenCalledTimes(1);
          expect(view.count).toBe(0);
        } finally {
          view.dispose();
        }
      }
    } finally {
      nest.dispose();
    }
  });
});
