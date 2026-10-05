import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSave, switchCampaign, writeSave } from '../src/app/save';

afterEach(() => vi.unstubAllGlobals());

function savedGame(value: unknown | null): void {
  let raw = value === null ? null : JSON.stringify(value);
  vi.stubGlobal('localStorage', {
    getItem: () => raw,
    setItem: (_key: string, next: string) => { raw = next; },
    removeItem: () => { raw = null; },
  });
}

describe('classic and illustrated campaigns', () => {
  it('starts new players on the illustrated campaign', () => {
    savedGame(null);
    expect(loadSave().campaign).toBe('illustrated');
  });

  it('keeps players with old progress on the classic campaign', () => {
    savedGame({ v: 1, level: 37, coins: 300, stars: { 1: 3, 36: 2 } });
    const save = loadSave();
    expect([save.campaign, save.level, save.stars[36]]).toEqual(['classic', 37, 2]);
  });

  it('moves an old save without any finished level to the new campaign', () => {
    savedGame({ v: 1, level: 1, coins: 50, stars: {} });
    expect(loadSave().campaign).toBe('illustrated');
  });

  it('shelves progress when switching and restores it on the way back', () => {
    savedGame({ v: 1, level: 37, coins: 300, stars: { 36: 2 } });
    const save = loadSave();
    switchCampaign(save, 'illustrated');
    expect([save.campaign, save.level, save.stars]).toEqual(['illustrated', 1, {}]);
    save.level = 4;
    save.stars = { 1: 3, 2: 3, 3: 2 };
    writeSave(save);
    const again = loadSave();
    expect(again.coins).toBe(300);
    switchCampaign(again, 'classic');
    expect([again.level, again.stars[36]]).toEqual([37, 2]);
    switchCampaign(again, 'illustrated');
    expect([again.level, again.stars[3]]).toEqual([4, 2]);
  });
});
