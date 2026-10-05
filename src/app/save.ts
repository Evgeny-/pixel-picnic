import type { BoosterId } from '../game/Game';
import type { Lang } from './i18n';
import { isCreatureId, type CreatureId } from '../core/creatures';

export interface Settings {
  music: number;
  sfx: number;
  lang: Lang | null;
  speed: 1 | 2;
  /** Debug mode: every level unlocked, difficulty stats visible. */
  debug: boolean;
  /** Night mode: follow the system (auto), always on or always off. */
  night?: 'auto' | 'on' | 'off';
  /** Absent until the free companion picker has been seen. */
  creature?: CreatureId;
}

/** The original emoji campaign and the illustrated one; each keeps its own progress. */
export type CampaignId = 'classic' | 'illustrated';

export interface CampaignProgress {
  level: number;
  stars: Record<number, number>;
}

export interface SaveData {
  v: 1;
  /** Campaign whose progress `level` and `stars` hold. */
  campaign: CampaignId;
  /** Next level to play in the active campaign (highest unlocked). */
  level: number;
  stars: Record<number, number>;
  /** Progress of campaigns that are not active, kept while the player is elsewhere. */
  shelved: Partial<Record<CampaignId, CampaignProgress>>;
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
    campaign: 'illustrated',
    level: 1,
    stars: {},
    shelved: {},
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
    const d = JSON.parse(raw) as Partial<Omit<SaveData, 'settings'>> & { settings?: Partial<Omit<Settings, 'speed'>> & { speed?: number } };
    const base = defaults();
    return {
      ...base,
      ...d,
      boosters: { ...base.boosters, ...(d.boosters ?? {}) },
      settings: {
        ...base.settings, ...(d.settings ?? {}),
        // Older versions offered 3×. Keep those players on the faster manual setting.
        speed: d.settings?.speed === 2 || d.settings?.speed === 3 ? 2 : 1,
        creature: isCreatureId(d.settings?.creature) ? d.settings.creature : undefined,
      },
      looks: { ...base.looks, ...(d.looks ?? {}) },
      stars: d.stars ?? {},
      seen: d.seen ?? [],
      // Saves from before the illustrated campaign: players with progress stay on the classic
      // levels, everyone else starts on the new ones.
      campaign: d.campaign === 'classic' || d.campaign === 'illustrated' ? d.campaign
        : hasProgress(d.level, d.stars) ? 'classic' : 'illustrated',
      shelved: d.shelved ?? {},
    };
  } catch {
    return defaults();
  }
}

export function hasProgress(level: number | undefined, stars: Record<number, number> | undefined): boolean {
  return (level ?? 1) > 1 || Object.keys(stars ?? {}).length > 0;
}

/** Makes `to` the active campaign; the current progress is shelved and comes back on return. */
export function switchCampaign(d: SaveData, to: CampaignId): void {
  if (d.campaign === to) return;
  d.shelved[d.campaign] = { level: d.level, stars: d.stars };
  const next = d.shelved[to] ?? { level: 1, stars: {} };
  delete d.shelved[to];
  d.campaign = to;
  d.level = next.level;
  d.stars = next.stars;
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
