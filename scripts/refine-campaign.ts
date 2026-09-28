/** Re-deal outlier queues while keeping their art, fences, level numbers and world progression. */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateLevel, replay, tierTarget } from '../src/core/generator';
import { criticalDecisions, estimateDifficulty, plannerRate } from '../src/core/solver';
import { planLevel } from '../src/core/progression';
import type { LevelDef } from '../src/core/types';

const file = process.argv[2] ?? 'src/data/levels.json';
const output = process.argv[3] ?? file;
const only = new Set((process.env.LEVELS ?? '').split(',').map(Number));
const levels: LevelDef[] = JSON.parse(readFileSync(file, 'utf8'));

function measure(l: LevelDef) {
  const n = l.n;
  const d = estimateDifficulty(l, 96, 918001 + n * 31);
  const planner = plannerRate(l, 12, 718041 + n * 17);
  const confirmation = plannerRate(l, 12, 518003 + n * 19);
  return { ...d, planner: (planner + confirmation) / 2 };
}
function penalty(l: LevelDef, d: ReturnType<typeof measure>, critical: number) {
  const t = tierTarget(l.tier, l.n);
  const low = l.tier === 'normal' ? 0.5 : l.tier === 'hard' ? 0.25 : 1 / 24;
  const high = l.tier === 'normal' ? 1 : l.tier === 'hard' ? 0.85 : 0.65;
  return Math.max(0, low - d.planner) * 3 + Math.max(0, d.planner - high)
    + Math.max(0, (t.minCritical ?? 0) - critical) * 0.08
    + Math.max(0, d.casual - t.casual[1] - 0.035)
    + Math.max(0, d.random - 0.04)
    + Math.max(0, d.greedy - (t.greedy?.[1] ?? 1) - 0.08) * 0.5;
}
for (let i = 0; i < levels.length; i++) {
  const original = levels[i];
  if (original.n <= 140 || (process.env.LEVELS && !only.has(original.n))) continue;
  const n = original.n;
  let best = original;
  let measured = measure(best);
  let crit = { critical: best.stats?.critical ?? 0, decisions: best.stats?.decisions ?? 0 };
  let cost = penalty(best, measured, crit.critical);
  // Sampling noise of a few wins is not a reason to replace an otherwise good puzzle.
  if (cost <= 0.08) continue;
  console.log(`Refining ${n}: planner=${measured.planner.toFixed(2)}, critical=${crit.critical}, cost=${cost.toFixed(2)}`);
  const target = tierTarget(original.tier, n);
  const plan = planLevel(n, original.tier);
  const pixels = original.picture.cells.replaceAll('.', '').length;
  const scale = pixels / (plan.gridSize * plan.gridSize);
  for (let attempt = 0; attempt < 20 && cost > 0.08; attempt++) {
    const generated = generateLevel(original.picture, {
      ...plan.params, fences: original.fences ?? [],
      boxMin: Math.max(4, Math.round(plan.params.boxMin * scale)),
      boxMax: Math.max(8, Math.round(plan.params.boxMax * scale)),
    }, target, n * 8191 + attempt * 101 + 47, 12, 64);
    if (!generated) continue;
    const candidate: LevelDef = { ...original, ...generated.level, n, world: original.world, tier: original.tier };
    const d = measure(candidate);
    // Expensive branch probing only for candidates whose player samples are competitive.
    if (penalty(candidate, d, target.minCritical ?? 0) >= cost) continue;
    const c = criticalDecisions(candidate);
    if (c.critical < (target.minCritical ?? 0)) continue;
    const score = penalty(candidate, d, c.critical);
    if (score >= cost) continue;
    if (!replay(candidate, candidate.solution ?? [])) throw new Error(`Invalid solution at ${n}`);
    best = candidate;
    measured = d;
    crit = c;
    cost = score;
    best.stats = { casual: +d.casual.toFixed(3), greedy: +d.greedy.toFixed(3), random: +d.random.toFixed(3),
      planner: +d.planner.toFixed(3), ...c, nodes: generated.nodes, pixels, boxes: best.boxes.length, colors: best.picture.palette.length };
    levels[i] = best;
    writeFileSync(output, JSON.stringify(levels));
    console.log(`  ${attempt + 1}: planner=${d.planner.toFixed(2)}, critical=${c.critical}, cost=${cost.toFixed(2)}`);
  }
  if (cost > 0.08) console.log(`  review ${n}: residual cost ${cost.toFixed(3)}`);
}
writeFileSync(output, JSON.stringify(levels));
