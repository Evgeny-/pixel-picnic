import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/core/sim';
import type { CreatureId } from '../src/core/creatures';
import type { LevelDef } from '../src/core/types';
import { AntsView } from '../src/render/AntsView';
import type { BoardView } from '../src/render/BoardView';
import { computeLayout } from '../src/render/layout';
import { PIECE_H } from '../src/render/pieces';

const views: AntsView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.dispose()); vi.restoreAllMocks(); });

function setup(creature: CreatureId, speed: number) {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const target = 126;
  const level: LevelDef = {
    n: 1, world: 0, tier: 'normal', slots: 1, columns: [[]], boxes: [],
    picture: { id: 'pickup', w: 12, h: 12, palette: ['#fd4'],
      cells: '.'.repeat(target) + '0' + '.'.repeat(143 - target) },
  };
  const sim = Sim.fromLevel(level);
  const layout = computeLayout({ aspect: 0.6, w: 12, h: 12, slots: 1, columns: 1, rows: 3 });
  const centre = new THREE.Vector3(layout.picX0 + 6.5 * layout.cell,
    0.06 + PIECE_H * layout.cell / 2, layout.picZ0 + 10.5 * layout.cell);
  let present = true;
  const board = {
    cubeColor: () => new THREE.Color('#fd4'),
    cubeWorld: (_: number, out: THREE.Vector3) => out.copy(centre).add(new THREE.Vector3(0, PIECE_H * layout.cell / 2, 0)),
    isPresent: (cell: number) => cell === target && present,
    setPickupProgress: vi.fn(),
    remove: vi.fn(() => { present = false; }),
  };
  const cb = { onPick: vi.fn(), onDeliver: vi.fn() };
  const view = new AntsView(level.picture.palette, board as unknown as BoardView, sim, cb, 'cube', 'none', creature);
  views.push(view);
  view.speed = speed;
  view.setLayout(layout);
  view.setHome({ x0: -0.5, x1: 0.5, z0: layout.nest.z - 0.5, z1: layout.nest.z + 0.5 },
    { x: 0, z: layout.nest.z + 0.5 });
  view.spawn(new THREE.Vector3(layout.slot[0].x, 0.5, layout.slot[0].z), target, 0, 2);
  // These are the visible instance transforms; the test does not advance private animation state.
  const body = view.group.children[0] as THREE.InstancedMesh;
  const carried = view.group.children[4] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const pose = (mesh: THREE.InstancedMesh) => {
    mesh.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);
    return { position: position.clone(), scale: scale.x, pitch: new THREE.Euler().setFromQuaternion(rotation, 'YXZ').x };
  };
  let time = 0;
  const tick = () => { time += 1 / 120; view.update(1 / 120, time); };
  return { view, target, board, cb, centre, layout, body, carried, pose, tick };
}

describe('creature pickup handoff', () => {
  it.each(['ant', 'beaver', 'mouse'] as const)('%s waits still, lifts once, and delivers at 1× and automatic 5×', (creature) => {
    for (const speed of [1, 5]) {
      const s = setup(creature, speed);
      // Arrive long before the rules release the cube. Holding must not repeat the old nod.
      for (let i = 0; i < 600; i++) s.tick();
      expect(s.board.isPresent(s.target)).toBe(true);
      expect(s.cb.onPick).not.toHaveBeenCalled();
      expect(s.board.setPickupProgress).toHaveBeenCalled();
      const pulses = s.board.setPickupProgress.mock.calls.length;
      const hold = s.pose(s.body);
      expect(hold.pitch).toBeGreaterThan(0);
      for (let i = 0; i < 60; i++) {
        s.tick();
        const next = s.pose(s.body);
        expect(next.pitch).toBeCloseTo(hold.pitch, 5);
        expect(next.position.distanceTo(hold.position)).toBeLessThan(1e-5);
      }
      expect(s.board.setPickupProgress).toHaveBeenCalledTimes(pulses);

      s.view.pickup(s.target);
      s.tick();
      expect(s.board.remove).toHaveBeenCalledTimes(1);
      expect(s.cb.onPick).toHaveBeenCalledTimes(1);
      expect(s.carried.count).toBe(1);
      const firstCarry = s.pose(s.carried);
      expect(firstCarry.position.distanceTo(s.centre)).toBeLessThan(1e-5);
      expect(firstCarry.scale).toBeCloseTo(s.layout.cell, 5);
      expect(s.pose(s.body).pitch).toBeCloseTo(hold.pitch, 5);

      let pitch = hold.pitch;
      for (let i = 0; i < Math.ceil(0.3 * 120 / speed); i++) {
        s.tick();
        const next = s.pose(s.body).pitch;
        expect(next).toBeLessThanOrEqual(pitch + 1e-5);
        expect(next).toBeGreaterThanOrEqual(-1e-5);
        pitch = next;
      }
      expect(pitch).toBeCloseTo(0, 5);
      for (let i = 0; i < 2400 && s.view.count; i++) s.tick();
      expect(s.view.count).toBe(0);
      expect(s.cb.onPick).toHaveBeenCalledTimes(1);
      expect(s.cb.onDeliver).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps the board piece visible when the rules release it before the creature arrives', () => {
    const s = setup('beaver', 1);
    s.view.pickup(s.target);
    for (let i = 0; i < 12; i++) s.tick();
    expect(s.board.isPresent(s.target)).toBe(true);
    expect(s.cb.onPick).not.toHaveBeenCalled();
    for (let i = 0; i < 1200 && !s.cb.onPick.mock.calls.length; i++) s.tick();
    expect(s.cb.onPick).toHaveBeenCalledTimes(1);
    expect(s.carried.count).toBe(1);
    expect(s.pose(s.carried).position.distanceTo(s.centre)).toBeLessThan(1e-5);
  });
});
