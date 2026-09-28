import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/core/sim';
import { BoardView } from '../src/render/BoardView';
import { computeLayout } from '../src/render/layout';

const boards: BoardView[] = [];
afterEach(() => {
  boards.splice(0).forEach((board) => board.dispose());
  vi.unstubAllGlobals();
});

function setup() {
  const context = { fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }) };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const palette = ['#6b3cd1', '#fff5de'];
  const sim = Sim.fromLevel({ n: 1, world: 0, tier: 'normal', boxes: [], columns: [[]], slots: 4,
    picture: { id: 'feedback', w: 2, h: 2, palette, cells: '0011' } });
  const layout = computeLayout({ aspect: 0.5, w: 2, h: 2, slots: 4, columns: 1, rows: 3 });
  const board = new BoardView(sim, palette);
  boards.push(board);
  board.setLayout(layout);
  const matrix = (i: number) => { const m = new THREE.Matrix4(); board.cubes.getMatrixAt(i, m); return m; };
  const color = (i: number) => { const c = new THREE.Color(); board.cubes.getColorAt(i, c); return c; };
  return { board, sim, layout, matrix, color };
}

describe('subtle pickup feedback', () => {
  it('pulses only the collected piece and returns to its original pose and palette', () => {
    const { board, matrix, color } = setup();
    const original = matrix(0), base = color(0), neighbor = color(1);
    const geometry = board.cubes.geometry, material = board.cubes.material;
    const originalCount = board.group.children.length;
    board.setPickupProgress(0, 0.5);
    expect(color(0).r).toBeGreaterThan(base.r);
    expect(color(1)).toEqual(neighbor);
    expect(board.cubeColor(0).getHexString()).toBe('6b3cd1');
    const pose = matrix(0);
    expect(pose.elements[0] / original.elements[0]).toBeCloseTo(1.035);
    expect(pose.elements.slice(12, 15)).toEqual(original.elements.slice(12, 15));
    board.setPickupProgress(0, 1.4);
    expect(color(0)).toEqual(base);
    expect(matrix(0)).toEqual(original);
    expect(board.cubes.geometry).toBe(geometry);
    expect(board.cubes.material).toBe(material);
    expect(board.group.children).toHaveLength(originalCount);
  });

  it('clears interrupted feedback on undo, removal and picture rebuild', () => {
    const { board, sim, matrix, color } = setup();
    const base = color(0), original = matrix(0);
    board.setPickupProgress(0, 0.5);
    board.syncFrom(sim, false);
    expect(color(0)).toEqual(base);
    expect(matrix(0)).toEqual(original);
    board.setPickupProgress(0, 0.5);
    board.remove(0);
    expect(color(0)).toEqual(base);
    expect(matrix(0).elements[0]).toBe(0);
    board.setPickupProgress(0, 0.5);
    expect(matrix(0).elements[0]).toBe(0);
    board.syncFrom(sim, false);
    expect(matrix(0)).toEqual(original);
    board.setPickupProgress(0, 0.5);
    board.rebuild();
    expect(color(0)).toEqual(base);
  });
});
