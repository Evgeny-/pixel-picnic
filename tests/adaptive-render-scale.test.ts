import { describe, expect, it } from 'vitest';
import { AdaptiveRenderScale } from '../src/render/AdaptiveRenderScale';

function run(scale: AdaptiveRenderScale, from: number, duration: number, frameMs: number): { time: number; dpr: number }[] {
  const changes: { time: number; dpr: number }[] = [];
  for (let now = from; now <= from + duration; now += frameMs) {
    const dpr = scale.sample(frameMs, now);
    if (dpr !== null) changes.push({ time: now, dpr });
  }
  return changes;
}

describe('adaptive render scale', () => {
  it('ignores startup and short spikes, then reduces sustained slow cadence', () => {
    const scale = new AdaptiveRenderScale(2);
    expect(run(scale, 0, 2990, 30)).toEqual([]);
    expect(run(scale, 3000, 1500, 30)).toEqual([]);
    const changes = run(scale, 4530, 1500, 30);
    expect(changes.map((change) => change.dpr)).toEqual([1.7]);
  });

  it('enforces a cooldown and never reduces below its floor', () => {
    const scale = new AdaptiveRenderScale(2, 1.4);
    const changes = run(scale, 0, 30000, 30);
    expect(changes.map((change) => change.dpr)).toEqual([1.7, 1.445, 1.4]);
    for (let i = 1; i < changes.length; i++) expect(changes[i].time - changes[i - 1].time).toBeGreaterThanOrEqual(5000);
    expect(scale.dpr).toBe(1.4);
  });

  it('does not chase isolated missed frames or ordinary 60Hz cadence', () => {
    const scale = new AdaptiveRenderScale(2);
    for (let frame = 0; frame < 2000; frame++) {
      expect(scale.sample(frame % 40 ? 16.67 : 100, frame * 16.67)).toBeNull();
    }
    expect(scale.dpr).toBe(2);
  });

  it('recovers by small steps after ten seconds of fast cadence, without exceeding the initial DPR', () => {
    const scale = new AdaptiveRenderScale(1.1, 1);
    const degraded = run(scale, 0, 6500, 30);
    expect(degraded[0].dpr).toBe(1);
    expect(run(scale, 6510, 9000, 8)).toEqual([]);
    const recovered = run(scale, 15518, 14000, 8);
    expect(recovered.map((change) => change.dpr)).toEqual([1.1]);
    expect(scale.dpr).toBe(1.1);
  });

  it('forgets pause/background gaps and warms up again while retaining the chosen quality', () => {
    const scale = new AdaptiveRenderScale(2);
    run(scale, 0, 6500, 30);
    expect(scale.dpr).toBe(1.7);
    scale.resetCadence();
    expect(scale.sample(120000, 200000)).toBeNull();
    expect(run(scale, 200030, 2970, 30)).toEqual([]);
    expect(scale.dpr).toBe(1.7);
    expect(run(scale, 203030, 3000, 30).map((change) => change.dpr)).toEqual([1.445]);
  });

  it('ignores invalid measurements and safely resets a clock discontinuity', () => {
    const scale = new AdaptiveRenderScale(1);
    for (const value of [0, -1, NaN, Infinity]) expect(scale.sample(value, 0)).toBeNull();
    expect(scale.sample(30, NaN)).toBeNull();
    run(scale, 10000, 1000, 30);
    expect(run(scale, 0, 4000, 30)).toEqual([]);
    expect(scale.dpr).toBe(1);
  });
});
