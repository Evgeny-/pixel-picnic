import { Sim } from './sim';
import { Rng } from './rng';
import { estimateDifficulty, solve, type Difficulty } from './solver';
import type { BoxDef, LevelDef, PictureDef, Side, Tier } from './types';

export interface GenParams {
  columns: number;
  slots: number;
  sides: Side[];
  boxMin: number;
  boxMax: number;
  /** Probability that the reference solution "parks" a box whose color isn't reachable yet. */
  dig: number;
  /** 0 = boxes dealt evenly (fronts show the next needed boxes); 1 = random columns (more decoys). */
  spread: number;
  hiddenFrac: number;
  links: number;
  frozen: number;
}

interface SeqBox {
  color: number;
  count: number;
}

function emptyLevel(picture: PictureDef, p: GenParams): LevelDef {
  return { n: 0, world: 0, tier: 'normal', picture, slots: p.slots, sides: p.sides, boxes: [], columns: [] };
}

/**
 * Simulates a sensible player who also decides the box contents: at every decision point it
 * creates a box of a color that is (mostly) reachable right now. The resulting sequence is a
 * valid solution by construction.
 */
function buildSequence(picture: PictureDef, p: GenParams, rng: Rng): SeqBox[] | null {
  const base = Sim.fromLevel(emptyLevel(picture, p));
  const colors = picture.palette.length;
  const unassigned = Int32Array.from(base.remaining);
  const slots: ({ color: number; left: number } | null)[] = new Array(p.slots).fill(null);
  const seq: SeqBox[] = [];
  const exposed = new Int32Array(colors);
  const waiting = new Int32Array(colors);

  for (let guard = 0; guard < 4000; guard++) {
    for (;;) {
      let sent = 0;
      for (let s = 0; s < slots.length; s++) {
        const sl = slots[s];
        if (!sl) continue;
        const t = base.findTarget(sl.color);
        if (t < 0) continue;
        base.eatCell(t >> 2);
        sl.left--;
        sent++;
        if (sl.left === 0) slots[s] = null;
      }
      if (!sent) break;
    }
    if (base.left === 0) return seq;
    const free = slots.findIndex((s) => !s);
    if (free < 0) return null;

    base.exposedCounts(exposed);
    waiting.fill(0);
    for (const sl of slots) if (sl) waiting[sl.color] += sl.left;
    const avail: number[] = [];
    const parked: number[] = [];
    const weights: number[] = [];
    for (let c = 0; c < colors; c++) {
      if (unassigned[c] <= 0) continue;
      const a = exposed[c] - waiting[c];
      if (a > 0) {
        avail.push(c);
        weights.push(Math.pow(a, 1.2) + 2);
      } else parked.push(c);
    }
    let c: number;
    const freeCount = slots.filter((s) => !s).length;
    const mayPark = parked.length > 0 && freeCount >= 2;
    if (avail.length && !(mayPark && rng.chance(p.dig))) c = avail[rng.weighted(weights)];
    else if (parked.length) c = rng.pick(parked);
    else return null;

    const u = unassigned[c];
    let size = rng.int(p.boxMin, p.boxMax);
    if (size >= u) size = u;
    else if (u - size < p.boxMin) size = u <= p.boxMax * 1.25 ? u : u - p.boxMin;
    unassigned[c] -= size;
    slots[free] = { color: c, left: size };
    seq.push({ color: c, count: size });
  }
  return null;
}

function dealColumns(n: number, p: GenParams, rng: Rng): number[][] {
  const cols: number[][] = Array.from({ length: p.columns }, () => []);
  for (let i = 0; i < n; i++) {
    let c: number;
    const minLen = Math.min(...cols.map((x) => x.length));
    if (rng.chance(p.spread)) {
      // Random column, but keep columns within a few boxes of each other.
      const cand = cols.map((x, k) => (x.length <= minLen + 2 ? k : -1)).filter((k) => k >= 0);
      c = rng.pick(cand);
    } else {
      const cand = cols.map((x, k) => (x.length === minLen ? k : -1)).filter((k) => k >= 0);
      c = rng.pick(cand);
    }
    cols[c].push(i);
  }
  return cols;
}

/** Replays taps in order, settling between them. */
export function replay(level: LevelDef, taps: number[]): boolean {
  const sim = Sim.fromLevel(level);
  for (const id of taps) {
    sim.settle();
    if (sim.status !== 'playing') break;
    if (!sim.take(id)) return false;
  }
  sim.settle();
  return sim.status === 'won';
}

interface Candidate {
  level: LevelDef;
  diff: Difficulty;
  nodes: number;
}

function assemble(picture: PictureDef, seq: SeqBox[], p: GenParams, rng: Rng): Candidate | null {
  const cols = dealColumns(seq.length, p, rng);
  const colOf = new Int16Array(seq.length);
  const idxOf = new Int16Array(seq.length);
  cols.forEach((col, ci) => col.forEach((id, k) => { colOf[id] = ci; idxOf[id] = k; }));
  const boxes: BoxDef[] = seq.map((b, id) => ({ id, color: b.color, count: b.count }));

  // Linked pairs: consecutive boxes of the solution in neighbouring columns (or stacked).
  let links = 0;
  const linkedStart = new Set<number>();
  if (p.links > 0) {
    const cand: number[] = [];
    for (let i = 2; i + 1 < seq.length; i++) {
      // Only neighbours: adjacent columns at most one row apart, or directly stacked.
      const d = Math.abs(colOf[i] - colOf[i + 1]);
      const dr = Math.abs(idxOf[i] - idxOf[i + 1]);
      const stacked = d === 0 && idxOf[i + 1] === idxOf[i] + 1;
      if ((d === 1 && dr <= 1) || stacked) cand.push(i);
    }
    rng.shuffle(cand);
    for (const i of cand) {
      if (links >= p.links) break;
      if (linkedStart.has(i - 1) || linkedStart.has(i) || linkedStart.has(i + 1)) continue;
      linkedStart.add(i);
      boxes[i].link = links;
      boxes[i + 1].link = links;
      links++;
    }
  }

  // Tap order of the reference solution (a linked pair is one tap).
  const solution: number[] = [];
  const tapOf = new Int16Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    tapOf[i] = solution.length;
    if (linkedStart.has(i - 1)) {
      tapOf[i] = tapOf[i - 1];
      continue;
    }
    solution.push(i);
  }

  if (p.hiddenFrac > 0) {
    for (let i = 0; i < seq.length; i++) {
      if (idxOf[i] > 0 && rng.chance(p.hiddenFrac)) boxes[i].hidden = true;
    }
  }

  if (p.frozen > 0) {
    const cand = boxes.filter((b) => b.link === undefined && tapOf[b.id] >= 3).map((b) => b.id);
    rng.shuffle(cand);
    for (const id of cand.slice(0, p.frozen)) {
      boxes[id].frozen = Math.max(2, tapOf[id] - rng.int(0, 2));
      boxes[id].hidden = undefined;
    }
  }

  const level: LevelDef = { ...emptyLevel(picture, p), boxes, columns: cols, solution };
  let nodes = 0;
  if (!replay(level, solution)) {
    const res = solve(Sim.fromLevel(level), 30000);
    if (res.status !== 'solved') return null;
    level.solution = res.moves;
    nodes = res.nodes;
  }
  return { level, diff: { casual: 0, greedy: 0 }, nodes };
}

export interface GenTarget {
  /** Accepted range for the casual win rate. */
  casual: [number, number];
}

export interface GenResult {
  level: LevelDef;
  diff: Difficulty;
  attempts: number;
  nodes: number;
}

/**
 * Generates a solvable level for `picture` whose simulated casual-player win rate falls into
 * `target.casual`, adapting a hardness knob between attempts.
 */
export function generateLevel(
  picture: PictureDef,
  base: GenParams,
  target: GenTarget,
  seed: number,
  maxAttempts = 24,
  runs = 120,
): GenResult | null {
  const rng = new Rng(seed);
  // hardness knob: 0..1 scales digging/spread, 1..2 additionally makes boxes bigger and adds mechanics
  let hard = 0.5;
  let easyAt = -1;
  let hardAt = 3;
  let best: (Candidate & { dist: number }) | null = null;
  let attempts = 0;
  for (; attempts < maxAttempts; attempts++) {
    const h1 = Math.min(1, hard);
    const h2 = Math.max(0, hard - 1);
    const grow = 1 + h2 * 0.5;
    const p: GenParams = {
      ...base,
      dig: Math.min(0.9, base.dig * (0.4 + h1 * 1.2) + h2 * 0.3),
      spread: Math.min(1, base.spread * (0.3 + h1 * 1.4) + h2 * 0.5),
      boxMin: Math.min(60, Math.round(base.boxMin * grow)),
      boxMax: Math.min(90, Math.round(base.boxMax * grow)),
      hiddenFrac: base.hiddenFrac > 0 ? Math.min(0.45, base.hiddenFrac + h2 * 0.15) : 0,
      links: base.links > 0 ? base.links + Math.round(h2 * 2) : 0,
    };
    let seq: SeqBox[] | null = null;
    for (let k = 0; k < 20 && !seq; k++) seq = buildSequence(picture, p, rng);
    if (!seq) continue;
    const cand = assemble(picture, seq, p, rng);
    if (!cand) continue;
    cand.diff = estimateDifficulty(cand.level, runs, seed + attempts);
    const [lo, hi] = target.casual;
    const c = cand.diff.casual;
    const dist = c < lo ? lo - c : c > hi ? c - hi : 0;
    if (!best || dist < best.dist) best = { ...cand, dist };
    if (dist === 0) break;
    // Bisection on the hardness knob once both a too-easy and a too-hard setting are known.
    if (c > hi) easyAt = Math.max(easyAt, hard);
    else hardAt = Math.min(hardAt, hard);
    if (easyAt >= 0 && hardAt <= 2) hard = (easyAt + hardAt) / 2 + (rng.next() - 0.5) * 0.06;
    else {
      const step = (0.15 + Math.min(0.35, dist)) * (0.7 + rng.next() * 0.6);
      hard = Math.max(0, Math.min(2, hard + (c > hi ? step : -step)));
    }
    if (hardAt - easyAt < 0.03) {
      // Converged on a noisy boundary: re-sample around it.
      easyAt = Math.max(-1, easyAt - 0.15);
      hardAt = Math.min(3, hardAt + 0.15);
    }
  }
  if (!best) return null;
  return { level: best.level, diff: best.diff, attempts: attempts + 1, nodes: best.nodes };
}

export function tierTarget(tier: Tier, n: number): GenTarget {
  if (n <= 3) return { casual: [0.85, 1] };
  if (n <= 8 && tier === 'normal') return { casual: [0.65, 1] };
  if (n < 10 && tier === 'hard') return { casual: [0.2, 0.6] };
  if (n < 20 && tier === 'superhard') return { casual: [0.04, 0.2] };
  switch (tier) {
    case 'normal':
      return { casual: [0.35, 0.8] };
    case 'hard':
      return { casual: [0.1, 0.32] };
    case 'superhard':
      return { casual: [0.015, 0.1] };
  }
}
