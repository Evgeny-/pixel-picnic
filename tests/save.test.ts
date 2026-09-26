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
