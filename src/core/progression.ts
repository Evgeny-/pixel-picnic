import { Rng } from './rng';
import type { GenParams } from './generator';
import type { Fence, LevelDef, PieceShape, Side, Tier } from './types';

export type BoosterId = 'hint' | 'undo' | 'slot' | 'shuffle' | 'grab';
export const BOOSTERS: BoosterId[] = ['hint', 'undo', 'slot', 'shuffle', 'grab'];

export const BOOSTER_UNLOCK: Record<BoosterId, number> = { hint: 2, slot: 3, undo: 4, shuffle: 6, grab: 9 };
export const BOOSTER_PRICE: Record<BoosterId, number> = { hint: 30, undo: 40, shuffle: 50, slot: 70, grab: 80 };
/** Free boosters granted when a booster unlocks. */
export const BOOSTER_GIFT = 2;

export type MechanicId = 'hidden' | 'fence' | 'link' | 'frozen' | 'gate';
export const MECHANIC_LEVEL: Record<MechanicId, number> = { hidden: 7, fence: 11, link: 14, frozen: 22, gate: 31 };

export const LEVELS_PER_WORLD = 20;

export function worldOf(n: number): number {
  return Math.floor((n - 1) / LEVELS_PER_WORLD);
}

export interface Reward {
  /** For finishing the level (by tier). */
  base: number;
  /** For the stars (new stars only on a replay). */
  stars: number;
  /** For finishing within the par time (first clear only). */
  speed: number;
  total: number;
}

/** Seconds a level may take for the "quick" bonus: letting all the ants out at 1x plus some thinking. */
export function parTime(level: LevelDef): number {
  const ants = level.boxes.reduce((a, b) => a + b.count, 0);
  return Math.round(15 + (ants * 0.16) / level.slots + level.boxes.length * 3.5);
}

/**
 * Coins for a win. Harder tiers pay more, stars and speed add a bonus. Replays pay a third of
 * the base plus any newly earned stars, so old levels can't be farmed for cosmetics.
 */
export function coinsFor(tier: Tier, stars: number, fast: boolean, prevStars = 0): Reward {
  const base = tier === 'superhard' ? 50 : tier === 'hard' ? 25 : 10;
  const first = prevStars === 0;
  const r: Reward = {
    base: first ? base : Math.round(base / 3),
    stars: Math.max(0, stars - prevStars) * 5,
    speed: first && fast ? (tier === 'superhard' ? 25 : tier === 'hard' ? 15 : 10) : 0,
    total: 0,
  };
  r.total = r.base + r.stars + r.speed;
  return r;
}

/** A fenced side of the frame, optionally with a gate (an opening `gate` cells wide). */
export interface FenceSpec {
  side: Side;
  gate?: number;
}

export interface LevelPlan {
  gridSize: number;
  colors: number;
  background: boolean;
  fences: FenceSpec[];
  queueHint: 'count' | 'mystery';
  params: GenParams;
}

/** Concrete fences for a picture of w×h cells. */
export function buildFences(specs: FenceSpec[], w: number, h: number, seed: number): Fence[] {
  const rng = new Rng(seed * 7919 + 13);
  const out: Fence[] = [];
  for (const f of specs) {
    const len = f.side === 'top' || f.side === 'bottom' ? w : h;
    if (!f.gate || f.gate >= len - 2) {
      out.push({ side: f.side, from: 0, to: len });
      continue;
    }
    const at = rng.int(Math.min(2, len - f.gate), Math.max(0, len - f.gate - 2));
    if (at > 0) out.push({ side: f.side, from: 0, to: at });
    if (at + f.gate < len) out.push({ side: f.side, from: at + f.gate, to: len });
  }
  return out;
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
    gridSize = 15 + n;
    colors = n === 1 ? 4 : 5;
  } else if (n <= 10) {
    gridSize = rng.int(18, 21);
    colors = rng.int(5, 6);
  } else if (n <= 20) {
    gridSize = rng.int(20, 24);
    colors = rng.int(5, 7);
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
  // Big enough for detail, small enough that every piece stays easy to see on a phone
  // (the background frame adds up to four more cells).
  gridSize = Math.min(30, gridSize);
  const background = true;

  // Roughly how many boxes the level should have.
  const approxPixels = background ? gridSize * gridSize : gridSize * gridSize * 0.62;
  const targetBoxes = n <= 3 ? 9 + n * 2 : n <= 10 ? rng.int(13, 17) : n <= 20 ? rng.int(15, 21) : rng.int(18, 28) + (sh ? 4 : 0);
  const avg = approxPixels / targetBoxes;
  const boxMin = Math.max(4, Math.round(avg * 0.6));
  const boxMax = Math.max(boxMin + 2, Math.round(avg * 1.45));

  // Ants come from every side of the frame; fences close some of them (and gates open a gap in a
  // fence). Fewer entrances make the picture peel in a stricter order.
  const fences: FenceSpec[] = [];
  if (n === MECHANIC_LEVEL.fence) fences.push({ side: 'top' });
  else if (n === MECHANIC_LEVEL.gate) fences.push({ side: 'top' }, { side: 'left' }, { side: 'right' }, { side: 'bottom', gate: 5 });
  else if (n > MECHANIC_LEVEL.fence && rng.chance(sh ? 0.75 : hard ? 0.6 : 0.4)) {
    const sets: Side[][] = [['top'], ['left'], ['right'], ['top', 'left'], ['top', 'right'], ['left', 'right'], ['top', 'left', 'right']];
    const pick = sets[Math.min(sets.length - 1, rng.int(0, 3) + (sh ? 3 : hard ? 2 : 0))];
    for (const side of pick) fences.push({ side });
    if (n > MECHANIC_LEVEL.gate && rng.chance(0.45)) {
      // A gate in one of the fences, or in the bottom when every other side is closed.
      const f = pick.length === 3 && rng.chance(0.5) ? { side: 'bottom' as Side } : fences[rng.int(0, fences.length - 1)];
      if (!fences.includes(f)) fences.push(f);
      f.gate = rng.int(3, 6);
    }
  }

  const hiddenOn = n === MECHANIC_LEVEL.hidden || (n > MECHANIC_LEVEL.hidden && rng.chance(0.55));
  const linkOn = n === MECHANIC_LEVEL.link || (n > MECHANIC_LEVEL.link && rng.chance(0.55));
  const frozenOn = n === MECHANIC_LEVEL.frozen || (n > MECHANIC_LEVEL.frozen && rng.chance(0.4));

  // Fewer queue columns leave fewer ways out of a bad spot: a difficulty lever of its own.
  const columns = n <= 3 ? 4 : sh ? rng.pick([3, 3, 4]) : hard ? rng.pick([3, 3, 4]) : rng.pick([3, 4, 4, 5]);

  // Only the first rows of the queue are visible; deeper boxes appear as columns move up.
  // Seeing less means planning with less information: hard levels often show just three rows,
  // and sometimes only a "?" tells that a column hides more boxes.
  const visibleRows = n <= 4 ? 5 : sh ? (rng.chance(0.7) ? 3 : 4) : hard ? (rng.chance(0.5) ? 3 : 4) : n < 40 && rng.chance(0.2) ? 5 : 4;
  const queueHint: 'count' | 'mystery' = rng.chance(sh ? 0.7 : hard ? 0.5 : n > 30 ? 0.2 : 0) ? 'mystery' : 'count';

  const params: GenParams = {
    visibleRows,
    columns,
    slots: n <= 2 ? 5 : 4,
    fences: [],
    boxMin,
    boxMax,
    dig: sh ? 0.55 : hard ? 0.4 : n <= 10 ? 0.12 : 0.22,
    spread: sh ? 1 : hard ? 0.8 : n <= 10 ? 0.25 : 0.5,
    hiddenFrac: hiddenOn ? (n === MECHANIC_LEVEL.hidden ? 0.3 : rng.range(0.12, sh ? 0.2 : 0.3)) : 0,
    links: linkOn ? (n === MECHANIC_LEVEL.link ? 2 : rng.int(1, 3)) : 0,
    frozen: frozenOn ? (n === MECHANIC_LEVEL.frozen ? 2 : rng.int(1, 2)) : 0,
  };
  return { gridSize, colors, background, fences, queueHint, params };
}

/** Piece shape of level n: plain cubes first, then a different look for most pictures. */
export function shapeFor(n: number): PieceShape {
  if (n <= 3) return 'cube';
  const order: PieceShape[] = ['coin', 'cube', 'hex', 'candy', 'diamond', 'cube', 'hex', 'coin', 'diamond', 'candy'];
  const rng = new Rng(n * 40503 + 17);
  const pick = order[(n + rng.int(0, 2)) % order.length];
  // Never the same shape twice in a row.
  return n > 4 && pick === shapeFor(n - 1) ? order[(order.indexOf(pick) + 1) % order.length] : pick;
}

export function mechanicsIntroducedAt(n: number): MechanicId[] {
  return (Object.keys(MECHANIC_LEVEL) as MechanicId[]).filter((m) => MECHANIC_LEVEL[m] === n);
}

export function boostersUnlockedAt(n: number): BoosterId[] {
  return BOOSTERS.filter((b) => BOOSTER_UNLOCK[b] === n);
}
