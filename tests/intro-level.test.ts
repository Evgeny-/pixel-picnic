import { describe, expect, it } from 'vitest';
import campaign from '../src/data/levels.json';
import { Sim, type SimEvent } from '../src/core/sim';
import type { LevelDef } from '../src/core/types';
import { createIntroLevel } from '../scripts/lib/intro-level';

const intro = campaign[0] as LevelDef;

describe('first level', () => {
  it('starts collecting on the first round whichever front box the player chooses', () => {
    const initial = Sim.fromLevel(intro);
    expect(initial.left).toBeLessThanOrEqual(128);
    expect(intro.boxes.length).toBeLessThanOrEqual(6);
    expect(intro.picture.palette.length).toBeLessThanOrEqual(3);
    const moves = initial.legalMoves();
    expect(moves.length).toBeGreaterThan(1);
    for (const id of moves) {
      const sim = initial.clone();
      const events: SimEvent[] = [];
      expect(sim.take(id)).toBe(true);
      sim.round(events);
      expect(events.some((event) => event.t === 'ant')).toBe(true);
      sim.settle();
      expect(initial.left - sim.left).toBeGreaterThanOrEqual(initial.left * 0.15);
      expect(sim.slots.every((slot) => slot === null)).toBe(true);
    }
  });

  it('finishes every possible order with useful activity after each tap', () => {
    let wins = 0;
    const play = (sim: Sim): void => {
      if (sim.status === 'won') { wins++; return; }
      expect(sim.status).toBe('playing');
      const moves = sim.legalMoves();
      expect(moves.length).toBeGreaterThan(0);
      for (const id of moves) {
        const next = sim.clone();
        expect(next.take(id)).toBe(true);
        next.settle();
        expect(next.left).toBeLessThan(sim.left);
        play(next);
      }
    };
    play(Sim.fromLevel(intro));
    expect(wins).toBeGreaterThan(1);
  });

  it('also completes when a beginner taps all front boxes without waiting', () => {
    const tap = (sim: Sim): void => {
      const moves = sim.legalMoves();
      if (!moves.length) {
        sim.settle();
        expect(sim.status).toBe('won');
        return;
      }
      for (const id of moves) {
        const next = sim.clone();
        expect(next.take(id)).toBe(true);
        tap(next);
      }
    };
    tap(Sim.fromLevel(intro));
  });

  it('preserves the authored opening when rebuilding the campaign', () => {
    expect(createIntroLevel()).toEqual(intro);
  });
});
