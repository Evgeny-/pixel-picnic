import { Rng } from './rng';
import type { GenParams } from './generator';
import type { Side, Tier } from './types';

export type BoosterId = 'hint' | 'undo' | 'slot' | 'shuffle' | 'grab';
export const BOOSTERS: BoosterId[] = ['hint', 'undo', 'slot', 'shuffle', 'grab'];

export const BOOSTER_UNLOCK: Record<BoosterId, number> = { hint: 2, slot: 3, undo: 4, shuffle: 6, grab: 9 };
export const BOOSTER_PRICE: Record<BoosterId, number> = { hint: 30, undo: 40, shuffle: 50, slot: 70, grab: 80 };
/** Free boosters granted when a booster unlocks. */
export const BOOSTER_GIFT = 2;

export type MechanicId = 'hidden' | 'link' | 'top' | 'frozen' | 'sides';
export const MECHANIC_LEVEL: Record<MechanicId, number> = { hidden: 8, link: 12, top: 18, frozen: 25, sides: 34 };

export const LEVELS_PER_WORLD = 20;

export function worldOf(n: number): number {
  return Math.floor((n - 1) / LEVELS_PER_WORLD);
}

export function coinsFor(tier: Tier, stars: number): number {
  const base = tier === 'superhard' ? 35 : tier === 'hard' ? 20 : 10;
  return base + stars * 3;
}

export interface LevelPlan {
  gridSize: number;
  colors: number;
  background: boolean;
  params: GenParams;
}

/** Deterministic plan for level n: picture size, palette size and generator knobs. */
export function planLevel(n: number, tier: Tier): LevelPlan {
  const rng = new Rng(n * 2654435761);
  const w = worldOf(n);
  const hard = tier !== 'normal';
  const sh = tier === 'superhard';

  let gridSize: number;
  let colors: number;
  if (n <= 3) {
    gridSize = 14 + n;
    colors = n === 1 ? 3 : 4;
  } else if (n <= 10) {
    gridSize = rng.int(17, 20);
    colors = rng.int(4, 5);
  } else if (n <= 20) {
    gridSize = rng.int(20, 24);
    colors = rng.int(5, 6);
  } else {
    const base = Math.min(34, 22 + w * 2);
    gridSize = rng.int(base, base + 4);
    colors = Math.min(9, rng.int(5, 7) + (w >= 3 ? 1 : 0));
  }
  if (hard) gridSize += 2;
  if (sh) {
    gridSize += 2;
    colors = Math.min(9, colors + 1);
  }
  gridSize = Math.min(40, gridSize);
  const background = n >= 11 || (n >= 5 && rng.chance(0.5));

  // Roughly how many boxes the level should have.
  const approxPixels = background ? gridSize * gridSize : gridSize * gridSize * 0.62;
  const targetBoxes = n <= 3 ? 7 + n : n <= 10 ? rng.int(10, 14) : n <= 20 ? rng.int(14, 20) : rng.int(18, 28) + (sh ? 4 : 0);
  const avg = approxPixels / targetBoxes;
  const boxMin = Math.max(4, Math.round(avg * 0.6));
  const boxMax = Math.max(boxMin + 2, Math.round(avg * 1.45));

  // Extra entrances make levels easier, so super hard levels keep the single bottom entrance.
  const sides: Side[] = ['bottom'];
  if (n === MECHANIC_LEVEL.top || (n > MECHANIC_LEVEL.top && !sh && rng.chance(0.3))) sides.push('top');
  if (n === MECHANIC_LEVEL.sides || (n > MECHANIC_LEVEL.sides && !sh && rng.chance(0.18))) {
    sides.push(rng.chance(0.5) ? 'left' : 'right');
    if (rng.chance(0.4)) sides.push(sides.includes('left') ? 'right' : 'left');
  }
  if (sides.length > 1) colors = Math.min(9, colors + 1);

  const hiddenOn = n === MECHANIC_LEVEL.hidden || (n > MECHANIC_LEVEL.hidden && rng.chance(0.55));
  const linkOn = n === MECHANIC_LEVEL.link || (n > MECHANIC_LEVEL.link && rng.chance(0.55));
  const frozenOn = n === MECHANIC_LEVEL.frozen || (n > MECHANIC_LEVEL.frozen && rng.chance(0.4));

  const params: GenParams = {
    columns: n <= 2 ? 3 : sh && w >= 2 ? 5 : 4,
    slots: 5,
    sides,
    boxMin,
    boxMax,
    dig: sh ? 0.55 : hard ? 0.4 : n <= 10 ? 0.12 : 0.22,
    spread: sh ? 1 : hard ? 0.8 : n <= 10 ? 0.25 : 0.5,
    hiddenFrac: hiddenOn ? (n === MECHANIC_LEVEL.hidden ? 0.3 : rng.range(0.12, sh ? 0.2 : 0.3)) : 0,
    links: linkOn ? (n === MECHANIC_LEVEL.link ? 2 : rng.int(1, 3)) : 0,
    frozen: frozenOn ? (n === MECHANIC_LEVEL.frozen ? 2 : rng.int(1, 2)) : 0,
  };
  return { gridSize, colors, background, params };
}

export function mechanicsIntroducedAt(n: number): MechanicId[] {
  return (Object.keys(MECHANIC_LEVEL) as MechanicId[]).filter((m) => MECHANIC_LEVEL[m] === n);
}

export function boostersUnlockedAt(n: number): BoosterId[] {
  return BOOSTERS.filter((b) => BOOSTER_UNLOCK[b] === n);
}
