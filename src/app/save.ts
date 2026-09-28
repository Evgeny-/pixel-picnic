import type { BoosterId } from '../game/Game';
import type { Lang } from './i18n';
import { isCreatureId, type CreatureId } from '../core/creatures';

export interface Settings {
  music: number;
  sfx: number;
  lang: Lang | null;
  speed: number;
  /** Debug mode: every level unlocked, difficulty stats visible. */
  debug: boolean;
  /** Night mode: follow the system (auto), always on or always off. */
  night?: 'auto' | 'on' | 'off';
  /** Absent until the free companion picker has been seen. */
  creature?: CreatureId;
}

export interface SaveData {
  v: 1;
  /** Next level to play (highest unlocked). */
  level: number;
  stars: Record<number, number>;
  coins: number;
  boosters: Record<BoosterId, number>;
  seen: string[];
  settings: Settings;
  /** Cosmetics bought with coins and the ones in use. */
  looks: Looks;
}

export interface Looks {
  house: string;
  hat: string;
  box: string;
  /** Bought items as "house:mushroom", "hat:crown"… */
  owned: string[];
}

const KEY = 'pixel-picnic-save-v1';

function defaults(): SaveData {
  return {
    v: 1,
    level: 1,
    stars: {},
    coins: 50,
    boosters: { hint: 0, undo: 0, slot: 0, shuffle: 0, grab: 0 },
    seen: [],
    settings: { music: 0.5, sfx: 0.8, lang: null, speed: 1, debug: false },
    looks: { house: 'cottage', hat: 'none', box: 'classic', owned: [] },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = JSON.parse(raw) as Partial<SaveData>;
    const base = defaults();
    return {
      ...base,
      ...d,
      boosters: { ...base.boosters, ...(d.boosters ?? {}) },
      settings: { ...base.settings, ...(d.settings ?? {}), creature: isCreatureId(d.settings?.creature) ? d.settings.creature : undefined },
      looks: { ...base.looks, ...(d.looks ?? {}) },
      stars: d.stars ?? {},
      seen: d.seen ?? [],
    };
  } catch {
    return defaults();
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode / quota: progress just won't persist */
  }
}

export function resetSave(): SaveData {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return defaults();
}
