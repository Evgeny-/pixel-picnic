import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/core/sim';
import type { LevelDef } from '../src/core/types';
import levels from '../src/data/levels.json';
import { QueueView } from '../src/render/QueueView';
import { computeLayout } from '../src/render/layout';

const views: QueueView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.dispose());
  vi.unstubAllGlobals();
});

function setup(aspect: number) {
  const painted: string[] = [];
  const context = {
    fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, roundRect() {}, fill() {},
    fillText: (text: string) => painted.push(text), strokeText() {},
    measureText: (text: string) => ({ width: text.length * 42 }),
  };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const level = (levels as LevelDef[]).find((level) => level.n === 42)!;
  const sim = Sim.fromLevel(level);
  const layout = computeLayout({ aspect, w: sim.w, h: sim.h, slots: level.slots,
    columns: sim.columns.length, rows: level.visibleRows ?? 3 });
  const view = new QueueView(sim, level.picture.palette);
  views.push(view);
  const visible = () => {
    const ids: number[] = [];
    view.group.traverseVisible((object) => {
      if (typeof object.userData.boxId === 'number') ids.push(object.userData.boxId);
    });
    return ids.sort((a, b) => a - b);
  };
  const body = (id: number) => {
    let mesh!: THREE.Mesh;
    view.group.traverse((object) => { if (object.userData.boxId === id) mesh = object as THREE.Mesh; });
    return mesh;
  };
  return { view, sim, layout, visible, body, painted };
}

describe('queue visibility from the first frame', () => {
  it.each([0.5, 1.7])('starts with only visible rows and counters, without a collapse (%s aspect)', (aspect) => {
    const { view, sim, layout, visible, body, painted } = setup(aspect);
    expect(visible()).toEqual([]);
    view.setLayout(layout);
    const expected = sim.columns.flatMap((column) => column.slice(0, layout.queueRowsVisible)).sort((a, b) => a - b);
    expect(visible()).toEqual(expected);
    expect(view.isSettled()).toBe(true);
    for (const column of sim.columns) {
      const hidden = column.length - layout.queueRowsVisible;
      if (hidden > 0) expect(painted).toContain(`+${hidden}`);
    }
    for (const id of expected) expect(body(id).parent!.scale.x).toBe(layout.boxSize);
    for (const dt of [0, 1 / 120, 1 / 30, 0.5]) {
      view.update(dt, 0);
      expect(visible()).toEqual(expected);
    }
  });

  it('reveals a newly exposed row during play, then snaps back cleanly on restore', () => {
    const { view, sim, layout, visible, body } = setup(0.5);
    const original = sim.clone();
    view.setLayout(layout);
    const before = visible();
    const column = 2, next = sim.columns[column][layout.queueRowsVisible];
    expect(visible()).not.toContain(next);
    expect(sim.take(sim.columns[column][0])).toBe(true);
    view.syncFromSim(true);
    expect(visible()).not.toContain(next);
    view.update(1 / 60, 1 / 60);
    expect(visible()).toContain(next);
    expect(body(next).parent!.scale.x).toBeLessThan(layout.boxSize);
    view.setSim(original);
    view.syncFromSim(false);
    expect(visible()).toEqual(before);
    expect(view.isSettled()).toBe(true);
    view.update(1 / 60, 2 / 60);
    expect(visible()).toEqual(before);
    for (const id of before) expect(body(id).parent!.scale.x).toBe(layout.boxSize);
  });
});
