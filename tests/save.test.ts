import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSave, writeSave } from '../src/app/save';

afterEach(() => vi.unstubAllGlobals());

function savedGame(value: unknown): void {
  let raw = JSON.stringify(value);
  vi.stubGlobal('localStorage', {
    getItem: () => raw,
    setItem: (_key: string, next: string) => { raw = next; },
  });
}

describe('box cosmetics in saves', () => {
  it('adds classic boxes to an old save without losing purchases or progress', () => {
    savedGame({
      v: 1, level: 19, coins: 420, stars: { 18: 3 },
      looks: { house: 'mushroom', hat: 'party', owned: ['house:mushroom', 'hat:party'] },
    });
    const save = loadSave();
    expect(save.looks).toEqual({ house: 'mushroom', hat: 'party', box: 'classic', owned: ['house:mushroom', 'hat:party'] });
    expect([save.level, save.coins, save.stars[18]]).toEqual([19, 420, 3]);
  });

  it('restores the selected boxes and their ownership after saving', () => {
    savedGame({});
    const save = loadSave();
    save.looks.box = 'basket';
    save.looks.owned.push('box:basket');
    writeSave(save);
    const restored = loadSave();
    expect(restored.looks.box).toBe('basket');
    expect(restored.looks.owned).toEqual(['box:basket']);
  });
});

describe('companion selection in saves', () => {
  it('restores the chosen companion and keeps paid unlocks with the existing cosmetics', () => {
    savedGame({
      v: 1, level: 42, coins: 260, stars: { 35: 3 },
      settings: { creature: 'rabbit', night: 'on' },
      looks: { hat: 'flower', owned: ['hat:flower', 'creature:rabbit'] },
    });
    const save = loadSave();
    writeSave(save);
    const restored = loadSave();
    expect(restored.settings.creature).toBe('rabbit');
    expect(restored.looks.hat).toBe('flower');
    expect(restored.looks.owned).toEqual(['hat:flower', 'creature:rabbit']);
    expect([restored.level, restored.coins, restored.stars[35]]).toEqual([42, 260, 3]);
  });

  it('shows the initial choice for old or invalid companion settings', () => {
    savedGame({ settings: { music: 0.2, creature: 'unknown' } });
    const save = loadSave();
    expect(save.settings.creature).toBeUndefined();
    expect(save.settings.music).toBe(0.2);
    savedGame({});
    expect(loadSave().settings.creature).toBeUndefined();
  });
});

describe('manual speed in saves', () => {
  it.each([[1, 1], [2, 2], [3, 2], [5, 1], [0, 1]])('loads saved speed %s as %s without persisting finish speed', (saved, expected) => {
    savedGame({ level: 42, settings: { speed: saved } });
    const save = loadSave();
    expect(save.settings.speed).toBe(expected);
    expect(save.level).toBe(42);
    writeSave(save);
    expect(loadSave().settings.speed).toBe(expected);
  });
});
