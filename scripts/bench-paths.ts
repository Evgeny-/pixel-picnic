/**
 * Deterministic CPU microbenchmark of level 35's paths at three stages.
 * Run from the repo: npm exec -- vite-node scripts/bench-paths.ts
 * This measures path planning only, without WebGL or a browser. It is not FPS.
 * Compare the same runtime/machine, and keep the route signatures unchanged.
 */
import { performance } from 'node:perf_hooks';
import campaign from '../src/data/levels.json';
import { Sim } from '../src/core/sim';
import { hashString, Rng } from '../src/core/rng';
import type { LevelDef } from '../src/core/types';
import { BoardPathPlanner } from '../src/render/BoardPathPlanner';
import { computeLayout } from '../src/render/layout';

const level = campaign[34] as LevelDef;
const layout = computeLayout({ aspect: 1.75, w: level.picture.w, h: level.picture.h,
  slots: level.slots, columns: level.columns.length, rows: level.visibleRows ?? 3 });
const pad = layout.cell * 0.35 + layout.frame;
const rect = { x0: layout.picX0 - pad, x1: layout.picX0 + layout.picW + pad,
  z0: layout.picZ0 - pad, z1: layout.picZ0 + layout.picH + pad };
const antSize = Math.max(0.46, Math.min(0.74, layout.cell * 1.9));
const originalRandom = Math.random;
const rows: { stage: string; remaining: number; medianUs: number; p95Us: number; routes: number; signature: string }[] = [];

try {
  for (const [stage, eaten] of [['initial', 0], ['half eaten', 0.5], ['mostly eaten', 0.85]] as const) {
    const sim = Sim.fromLevel(level);
    const left = Math.ceil(sim.left * (1 - eaten));
    // Remove reachable layers only, so the air graph remains a valid game state.
    while (sim.left > left) {
      const exposed = sim.exposedCells();
      if (!exposed.length) throw new Error('No reachable cells while preparing the benchmark');
      for (const cell of exposed) sim.eatCell(cell);
    }
    const exposed = sim.exposedCells();
    const planner = new BoardPathPlanner();
    const rng = new Rng(35);
    Math.random = () => rng.next();
    const plan = (index: number) => {
      const slot = layout.slot[index % layout.slot.length];
      return planner.plan(sim, layout, rect, antSize, exposed[index % exposed.length], slot.x, slot.z);
    };
    for (let i = 0; i < 2000; i++) plan(i);
    const batches: number[] = [];
    let routes = 0;
    for (let batch = 0; batch < 20; batch++) {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) if (plan(i)) routes++;
      batches.push(performance.now() - start);
    }
    // Milliseconds per 1000 calls are also microseconds per call.
    batches.sort((a, b) => a - b);
    const checkRng = new Rng(35);
    Math.random = () => checkRng.next();
    let signature = 0;
    for (let i = 0; i < 256; i++) signature = Math.imul(signature ^ hashString(JSON.stringify(plan(i))), 16777619);
    rows.push({ stage, remaining: sim.left, medianUs: +batches[10].toFixed(3),
      p95Us: +batches[18].toFixed(3), routes, signature: (signature >>> 0).toString(16) });
  }
} finally {
  Math.random = originalRandom;
}
console.log(`Level 35 · ${process.version} · 20 × 1000 plans after warmup · μs/plan`);
console.table(rows);
