import { Sim } from './sim';
import { Rng } from './rng';
import type { LevelDef } from './types';

export interface SolveResult {
  status: 'solved' | 'unsolvable' | 'unknown';
  /** Box ids to tap, in order (from the given position). */
  moves: number[];
  nodes: number;
}

/**
 * Heuristic value of taking box `id` now: boxes that can finish right away are best
 * (they free their slot), then boxes whose color is reachable, then "parking" moves.
 */
export function moveScore(sim: Sim, id: number, exposed: Int32Array, waiting?: Int32Array): number {
  let score = 0;
  for (const m of sim.groupOf(id)) {
    const c = sim.boxColor(m);
    const free = exposed[c] - (waiting ? waiting[c] : 0);
    const count = sim.boxCount(m);
    if (free >= count) score += 3000 + count;
    else if (free > 0) score += 1000 + free * 8 - count;
    else score += 100 - count - (waiting && waiting[c] > 0 ? 50 : 0);
  }
  return score;
}

/** Ants already sitting in slots, per color. */
export function waitingAnts(sim: Sim, out?: Int32Array): Int32Array {
  const res = out ?? new Int32Array(sim.s.colors);
  res.fill(0);
  for (const sl of sim.slots) if (sl) res[sim.boxColor(sl.box)] += sl.left;
  return res;
}

/**
 * Depth-first search over tap sequences with memoization of failed positions.
 * Positions are always evaluated after `settle()` (no ant can move), which makes
 * the search deterministic and replayable by a human who waits for the ants.
 */
export function solve(start: Sim, maxNodes = 60000): SolveResult {
  const failed = new Set<string>();
  const path: number[] = [];
  const exposed = new Int32Array(start.s.colors);
  const waiting = new Int32Array(start.s.colors);
  let nodes = 0;
  let aborted = false;

  const dfs = (sim: Sim): boolean => {
    sim.settle();
    if (sim.status === 'won') return true;
    if (sim.status === 'stuck') return false;
    const key = sim.key();
    if (failed.has(key)) return false;
    if (++nodes > maxNodes) {
      aborted = true;
      return false;
    }
    const moves = sim.legalMoves();
    sim.exposedCounts(exposed);
    waitingAnts(sim, waiting);
    const scored = moves.map((m) => [m, moveScore(sim, m, exposed, waiting)] as const);
    scored.sort((a, b) => b[1] - a[1]);
    for (const [m] of scored) {
      const next = sim.clone();
      next.take(m);
      path.push(m);
      if (dfs(next)) return true;
      path.pop();
      if (aborted) return false;
    }
    failed.add(key);
    return false;
  };

  const root = start.clone();
  if (root.status === 'stuck') root.unstick();
  const ok = dfs(root);
  return { status: ok ? 'solved' : aborted ? 'unknown' : 'unsolvable', moves: ok ? path.slice() : [], nodes };
}

export type Policy = 'casual' | 'greedy' | 'random';

/**
 * Simulated player. 'casual' taps a random box whose color is currently reachable
 * (and sometimes a random one); 'greedy' takes the best-looking box by moveScore.
 */
export function playout(start: Sim, rng: Rng, policy: Policy): boolean {
  const sim = start.clone();
  const exposed = new Int32Array(sim.s.colors);
  const waiting = new Int32Array(sim.s.colors);
  for (let guard = 0; guard < 10000; guard++) {
    sim.settle();
    if (sim.status !== 'playing') return sim.status === 'won';
    const moves = sim.legalMoves();
    if (!moves.length) return false;
    let pick = moves[0];
    if (policy === 'random') {
      pick = rng.pick(moves);
    } else {
      sim.exposedCounts(exposed);
      if (policy === 'casual') {
        const sensible = moves.filter((m) => sim.groupOf(m).every((b) => exposed[sim.boxColor(b)] > 0));
        pick = sensible.length && rng.chance(0.9) ? rng.pick(sensible) : rng.pick(moves);
      } else {
        waitingAnts(sim, waiting);
        if (rng.chance(0.08)) pick = rng.pick(moves);
        else {
          let best = -Infinity;
          for (const m of moves) {
            const s = moveScore(sim, m, exposed, waiting) + rng.next() * 5;
            if (s > best) { best = s; pick = m; }
          }
        }
      }
    }
    sim.take(pick);
  }
  return false;
}

export interface Difficulty {
  casual: number;
  greedy: number;
  /** Win rate of a player tapping any available box at random. */
  random: number;
  /** Random player's win rate from a third of the way through the solution (if measured). */
  phase?: number;
}

/**
 * How much thinking a level takes: walks the solution and counts the decision points where at
 * least one other available box leads into a dead end (proved or at least not solvable within
 * the solver budget). A level with 0 critical decisions can be won by tapping anything.
 */
export function criticalDecisions(level: LevelDef, budget = 1500, maxProbes = 60): { critical: number; decisions: number } {
  const sim = Sim.fromLevel(level);
  const moves = level.solution?.length ? level.solution : solve(sim.clone()).moves;
  let critical = 0;
  let decisions = 0;
  let probes = 0;
  for (const m of moves) {
    sim.settle();
    if (sim.status !== 'playing') break;
    const legal = sim.legalMoves();
    if (legal.length > 1) {
      decisions++;
      const good = new Set(sim.groupOf(m));
      for (const alt of legal) {
        if (good.has(alt) || probes >= maxProbes) continue;
        probes++;
        const probe = sim.clone();
        probe.take(alt);
        if (solve(probe, budget).status !== 'solved') {
          critical++;
          break;
        }
      }
    }
    if (!sim.take(m)) break;
  }
  return { critical, decisions };
}

export function estimateDifficulty(level: LevelDef | Sim, runs = 160, seed = 12345): Difficulty {
  const sim = level instanceof Sim ? level : Sim.fromLevel(level);
  const rng = new Rng(seed);
  let casual = 0;
  let greedy = 0;
  let random = 0;
  for (let i = 0; i < runs; i++) {
    if (playout(sim, rng, 'casual')) casual++;
    if (playout(sim, rng, 'greedy')) greedy++;
    if (playout(sim, rng, 'random')) random++;
  }
  return { casual: casual / runs, greedy: greedy / runs, random: random / runs };
}

/**
 * Win rates of the random and casual players starting later in the level: after the given
 * fractions of the reference solution. Shows whether the thinking is spread over the level or only
 * needed at the start.
 */
export function phaseDifficulty(level: LevelDef, at = [1 / 3, 2 / 3], runs = 80, seed = 777): { random: number[]; casual: number[] } {
  const sol = level.solution ?? [];
  const sim = Sim.fromLevel(level);
  const rng = new Rng(seed);
  const random: number[] = [];
  const casual: number[] = [];
  let done = 0;
  for (const f of at) {
    const upto = Math.floor(sol.length * f);
    for (; done < upto; done++) {
      sim.settle();
      sim.take(sol[done]);
    }
    sim.settle();
    let r = 0;
    let c = 0;
    for (let i = 0; i < runs; i++) {
      if (playout(sim, rng, 'random')) r++;
      if (playout(sim, rng, 'casual')) c++;
    }
    random.push(r / runs);
    casual.push(c / runs);
  }
  return { random, casual };
}
