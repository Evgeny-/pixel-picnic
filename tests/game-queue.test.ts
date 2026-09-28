import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Game, type GameHooks } from '../src/game/Game';
import { Where } from '../src/core/sim';
import type { LevelDef } from '../src/core/types';
import type { GameView } from '../src/render/GameView';
import type { WorldTheme } from '../src/render/themes';

vi.mock('../src/audio/audio', () => ({ audio: { play: vi.fn() } }));

function setup(levelOverride?: LevelDef) {
  const level: LevelDef = levelOverride ?? {
    n: 1, world: 0, tier: 'normal', slots: 1,
    picture: { id: 'driver', w: 6, h: 1, palette: ['#f44'], cells: '000000' },
    boxes: Array.from({ length: 3 }, (_, id) => ({ id, color: 0, count: 2 })), columns: [[0], [1], [2]],
  };
  const pending: Map<number, number>[] = [];
  const view = {
    load: vi.fn(), apply: vi.fn(), update: vi.fn(), isIdle: () => true,
    pickBox: (id: number) => id,
    queue: {
      setPending: (positions: Map<number, number>) => pending.push(new Map(positions)),
      setHint: vi.fn(), shake: vi.fn(), pulseSlots: vi.fn(),
      boxColor: () => new THREE.Color('#f44'), boxTop: (_: number, out: THREE.Vector3) => out.set(0, 0, 0),
      syncFromSim: vi.fn(),
    },
    board: { syncFrom: vi.fn() },
    layout: { slot: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
    ants: { speed: 1, fadeAll: vi.fn() },
    fx: { sparkle: vi.fn(), shards: vi.fn() },
    setSim: vi.fn(), relayout: vi.fn(),
  };
  const hooks: GameHooks = { onWin: vi.fn(), onStuck: vi.fn(), onProgress: vi.fn(), onToast: vi.fn(), onChange: vi.fn() };
  return { game: new Game(view as unknown as GameView, level, {} as WorldTheme, hooks), pending, hooks };
}

describe('Game queued dispatch', () => {
  it('queues at capacity, cancels by tapping again, and dispatches when a round frees a slot', () => {
    const { game, hooks } = setup();
    game.tap(0, 0);
    game.tap(1, 0);
    game.tap(2, 0);
    expect([...game.pendingBoxes]).toEqual([[1, 1], [2, 2]]);
    game.tap(1, 0);
    expect([...game.pendingBoxes]).toEqual([[2, 1]]);
    expect(hooks.onToast).toHaveBeenLastCalledWith('unqueued');
    game.update(0.4, 0.4);
    expect(game.sim.boxWhere[2]).toBe(Where.Queue);
    game.update(0.4, 0.8);
    expect(game.sim.boxWhere[2]).toBe(Where.Slot);
    expect(game.pendingBoxes.size).toBe(0);
    expect(hooks.onStuck).not.toHaveBeenCalled();
  });

  it('undo cancels planned dispatches so the undone move does not instantly repeat', () => {
    const { game } = setup();
    game.tap(0, 0); game.tap(1, 0); game.tap(2, 0);
    game.update(0.8, 0.8);
    expect(game.sim.boxWhere[1]).toBe(Where.Slot);
    expect(game.pendingBoxes.size).toBe(1);
    expect(game.use('undo')).toBe(true);
    expect(game.pendingBoxes.size).toBe(0);
    expect(game.sim.boxWhere[1]).toBe(Where.Queue);
    game.update(0.4, 1.2);
    expect(game.sim.boxWhere[1]).toBe(Where.Queue);
  });

  it('an extra slot immediately dispatches the first planned box', () => {
    const { game } = setup();
    game.tap(0, 0); game.tap(1, 0); game.tap(2, 0);
    expect(game.use('slot')).toBe(true);
    expect(game.sim.boxWhere[1]).toBe(Where.Slot);
    expect([...game.pendingBoxes]).toEqual([[2, 1]]);
  });

  it('pausing stops both rounds and planned moves; resuming continues the plan', () => {
    const { game } = setup();
    game.tap(0, 0); game.tap(1, 0);
    game.paused = true;
    game.update(5, 5);
    expect(game.sim.boxWhere[1]).toBe(Where.Queue);
    expect(game.sim.roundNo).toBe(0);
    game.paused = false;
    game.update(0.8, 5.8);
    expect(game.sim.boxWhere[1]).toBe(Where.Slot);
  });
});


function magnetQueue() {
  return setup({
    n: 1, world: 0, tier: 'normal', slots: 2,
    picture: { id: 'magnet-plan', w: 8, h: 1, palette: ['#f44'], cells: '00000000' },
    boxes: [
      { id: 0, color: 0, count: 1 },
      { id: 1, color: 0, count: 2, link: 1 },
      { id: 2, color: 0, count: 2, link: 1 },
      { id: 3, color: 0, count: 3 },
    ],
    columns: [[0], [1], [2], [3]],
  });
}

describe('magnet and planned dispatches', () => {
  it('reserves slots while aiming the magnet and resumes after a successful grab', () => {
    const { game } = magnetQueue();
    game.tap(0, 0);
    game.tap(1, 0);
    expect(game.use('grab')).toBe(true);
    game.update(0.4, 0.4);
    expect(game.grabMode).toBe(true);
    expect(game.sim.freeSlots()).toBe(2);
    expect([...game.pendingBoxes]).toEqual([[1, 1], [2, 1]]);
    game.tap(3, 0);
    expect(game.grabMode).toBe(false);
    expect(game.sim.boxWhere[3]).toBe(Where.Slot);
    expect(game.sim.boxWhere[1]).toBe(Where.Queue);
    for (let i = 0; i < 3; i++) game.update(0.4, 0.8 + i * 0.4);
    expect(game.sim.boxWhere[1]).toBe(Where.Slot);
    expect(game.sim.boxWhere[2]).toBe(Where.Slot);
    expect(game.pendingBoxes.size).toBe(0);
  });

  it('dispatches the waiting pair immediately when the magnet is cancelled', () => {
    const { game } = magnetQueue();
    game.tap(0, 0);
    game.tap(1, 0);
    game.use('grab');
    game.update(0.4, 0.4);
    game.cancelGrab();
    expect(game.grabMode).toBe(false);
    expect(game.sim.slots.map((slot) => slot?.box)).toEqual([1, 2]);
    expect(game.pendingBoxes.size).toBe(0);
  });

  it('does not declare a loss while the player is choosing a magnet rescue', () => {
    const { game, hooks } = setup({
      n: 1, world: 0, tier: 'normal', slots: 2,
      picture: { id: 'magnet-rescue', w: 1, h: 2, palette: ['#f44', '#44f'], cells: '01' },
      fences: ['top', 'left', 'right'].map((side) => ({ side: side as 'top' | 'left' | 'right', from: 0, to: 2 })),
      boxes: [{ id: 0, color: 0, count: 1 }, { id: 1, color: 1, count: 1, frozen: 2 }, { id: 2, color: 1, count: 1 }],
      columns: [[0], [1, 2]],
    });
    game.tap(0, 0);
    // The simulation can know it is stuck before the visual lose dialog has appeared.
    expect(game.sim.checkStuck()).toBe(true);
    expect(game.use('grab')).toBe(true);
    game.update(2, 2);
    expect(game.sim.status).toBe('playing');
    expect(hooks.onStuck).not.toHaveBeenCalled();
    game.cancelGrab();
    game.update(0.4, 2.4);
    expect(game.sim.status).toBe('stuck');
    expect(hooks.onStuck).toHaveBeenCalledOnce();
  });
});
