/**
 * Builds the campaign: picks an emoji per level, turns it into pixel art, generates a box queue
 * with the solver-verified generator and writes src/data/levels.json.
 *
 * Run: bun scripts/build-levels.ts [count] [outPath]
 * Rebuild a few levels of an existing campaign in place (other levels and their pictures stay):
 *      REBUILD=1,2,3 bun scripts/build-levels.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PICTURES, type PictureEntry } from './pictures-manifest';
import { renderEmojiRGBA } from './lib/emoji';
import { pixelize, fillBackground, pickBackground, type PixelGrid } from './lib/pixelart';
import { ensureCritical, generateLevel, objective, tierTarget, tuneLevel } from '../src/core/generator';
import { phaseDifficulty } from '../src/core/solver';
import { buildFences, LEVELS_PER_WORLD, planLevel, shapeFor, worldOf } from '../src/core/progression';
import { encodeCells, tierForLevel, type LevelDef, type PictureDef } from '../src/core/types';
import { Rng, hashString } from '../src/core/rng';

const THEME_ORDER = ['meadow', 'forest', 'sea', 'sweets', 'space', 'winter', 'fantasy'] as const;
const COUNT = Number(process.argv[2] ?? THEME_ORDER.length * LEVELS_PER_WORLD);
const OUT = process.argv[3] ?? 'src/data/levels.json';
/** Optional comma separated level numbers to build (experiments); default: 1..COUNT. */
const ONLY = process.env.LEVELS ? new Set(process.env.LEVELS.split(',').map(Number)) : null;
/** Levels to regenerate inside the existing campaign file (OUT). */
const REBUILD = process.env.REBUILD ? new Set(process.env.REBUILD.split(',').map(Number)) : null;
const PATTERNS = ['sparkles', 'dots', 'none', 'stripes', 'sparkles', 'checker'] as const;

const used = new Set<string>();

/** Candidate pictures for level n, best first (not yet used). */
function pictureCandidates(n: number, tier: string): PictureEntry[] {
  const w = worldOf(n);
  const theme = THEME_ORDER[w % THEME_ORDER.length];
  const idx = (n - 1) % LEVELS_PER_WORLD;
  // Even the first levels use pictures with some detail: simple blobs make trivial puzzles.
  let want = n <= 20 ? (idx < 14 ? 2 : 3) : idx < 6 ? 2 : 3;
  if (tier !== 'normal') want = 3;
  const pool = PICTURES.filter((p) => p.theme === theme && !used.has(p.id));
  const fallback = PICTURES.filter((p) => !used.has(p.id));
  const list = pool.length >= 3 ? pool : fallback;
  // Nearest complexity first, then a stable pseudo-random order for variety.
  return [...list].sort(
    (a, b) => Math.abs(a.complexity - want) - Math.abs(b.complexity - want) || hashString(a.id + n) - hashString(b.id + n),
  );
}

/** Remove fully empty border rows/columns. */
function crop(g: PixelGrid): PixelGrid {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++)
      if (g.cells[y * g.w + x] >= 0) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  if (x1 < 0) return g;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const cells = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = g.cells[(y + y0) * g.w + x + x0];
  return { w, h, palette: g.palette, cells };
}

/** Drop palette entries that no cell uses and renumber. */
function compact(g: PixelGrid): PixelGrid {
  const counts = new Array(g.palette.length).fill(0);
  for (const c of g.cells) if (c >= 0) counts[c]++;
  const order = counts.map((c, i) => [c, i]).filter(([c]) => c > 0).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const remap = new Map(order.map((old, i) => [old, i]));
  const cells = g.cells.map((c) => (c >= 0 ? remap.get(c)! : -1));
  return { w: g.w, h: g.h, palette: order.map((i) => g.palette[i]), cells: Int16Array.from(cells) };
}

const levels: LevelDef[] = [];
const existing: LevelDef[] = REBUILD && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
if (REBUILD) for (const lv of existing) if (!REBUILD.has(lv.n)) used.add(lv.picture.id);
const t0 = performance.now();

interface Built {
  lv: LevelDef;
  entry: PictureEntry;
  dist: number;
  attempts: number;
  ms: number;
}

function buildWith(n: number, entry: PictureEntry): Built | null {
  const tier = tierForLevel(n);
  const plan = planLevel(n, tier);
  const rng = new Rng(n * 97 + 5);
  const rgba = renderEmojiRGBA(entry.source, entry.icon, 512);
  let grid = pixelize(rgba, { gridW: plan.gridSize, gridH: plan.gridSize, colors: plan.colors, minColorDistance: 0.1 });
  grid = crop(grid);
  // Every picture sits on a patterned background: it adds colors that interleave with the subject.
  const useBg = true;
  if (useBg) {
    const bg = pickBackground(grid, n);
    const pattern = n < 21 ? (rng.chance(0.55) ? 'sparkles' : 'dots') : PATTERNS[n % PATTERNS.length];
    grid = fillBackground(grid, { color: bg.color, pattern, patternColor: bg.patternColor, seed: n, margin: n < 21 ? 1 : 2 });
  }
  grid = compact(grid);
  const picture: PictureDef = { id: entry.id, w: grid.w, h: grid.h, palette: grid.palette, cells: encodeCells(grid.cells) };
  const pixels = [...grid.cells].filter((c) => c >= 0).length;
  // Re-derive box sizes from the real pixel count.
  const approx = useBg ? plan.gridSize * plan.gridSize : plan.gridSize * plan.gridSize * 0.62;
  const k = pixels / approx;
  const params = {
    ...plan.params,
    fences: buildFences(plan.fences, grid.w, grid.h, n),
    boxMin: Math.max(3, Math.round(plan.params.boxMin * k)),
    boxMax: Math.max(6, Math.round(plan.params.boxMax * k)),
  };
  const target = tierTarget(tier, n);
  const ts = performance.now();
  let res = generateLevel(picture, params, target, n * 1013 + 7, tier === 'superhard' ? 36 : 26, 140);
  if (!res) res = generateLevel(picture, { ...params, links: 0, frozen: 0 }, target, n * 1013 + 8, 40, 100);
  if (!res) return null;
  const iters = tier === 'superhard' ? 320 : tier === 'hard' ? 260 : 180;
  if (objective(res.diff, target) > 0) {
    // Fine-tune the queue layout with solver-checked local search.
    const tuned = tuneLevel(res.level, res.diff, target, n * 7717 + 3, iters, 90);
    res = { ...res, level: tuned.level, diff: tuned.diff };
  }
  // Every level must ask for real decisions; keep tuning until it does.
  const crit = ensureCritical(res.level, res.diff, target, n * 3571 + 11, Math.round(iters * 0.6));
  res = { ...res, level: crit.level, diff: crit.diff };
  const dist = objective(res.diff, target) + Math.max(0, (target.minCritical ?? 0) - crit.critical) * 0.05;
  const lv: LevelDef = {
    ...res.level,
    n,
    world: worldOf(n),
    tier,
    name: entry.name,
    shape: shapeFor(n),
    stats: {
      casual: +res.diff.casual.toFixed(3),
      greedy: +res.diff.greedy.toFixed(3),
      random: +res.diff.random.toFixed(3),
      nodes: res.nodes,
      critical: crit.critical,
      decisions: crit.decisions,
      pixels,
      boxes: res.level.boxes.length,
      colors: grid.palette.length,
    },
  };
  return { lv, entry, dist, attempts: res.attempts, ms: performance.now() - ts };
}

const fenceTag = (lv: LevelDef) =>
  (lv.fences ?? []).length ? [...new Set(lv.fences!.map((f) => f.side[0].toUpperCase()))].join('') + (lv.fences!.some((f) => f.from > 0 || f.to < (f.side === 'top' || f.side === 'bottom' ? lv.picture.w : lv.picture.h)) ? 'g' : '') : '-';

for (let n = 1; n <= COUNT; n++) {
  if (ONLY && !ONLY.has(n)) continue;
  if (REBUILD && !REBUILD.has(n) && existing[n - 1]) {
    levels.push(existing[n - 1]);
    continue;
  }
  const tier = tierForLevel(n);
  const tries = tier === 'normal' ? 4 : 5;
  let best: Built | null = null;
  let tried = 0;
  for (const entry of pictureCandidates(n, tier)) {
    // A few pictures normally; more when none of them lands near the target.
    if (tried >= tries && (!best || best.dist <= 0.1 || tried >= tries * 2)) break;
    tried++;
    const b = buildWith(n, entry);
    if (b && (!best || b.dist < best.dist)) best = b;
    if (best && best.dist === 0) break;
  }
  if (!best) throw new Error(`level ${n}: generation failed`);
  used.add(best.entry.id);
  const lv = best.lv;
  levels.push(lv);
  const st = lv.stats!;
  const ph = phaseDifficulty(lv, [1 / 3], 60);
  console.log(
    `#${String(n).padStart(3)} ${tier.padEnd(9)} ${best.entry.id.padEnd(22)} ${lv.picture.w}x${lv.picture.h} px=${String(st.pixels).padStart(4)} col=${st.colors} ` +
      `boxes=${String(st.boxes).padStart(2)} max=${String(Math.max(...lv.boxes.map((b) => b.count))).padStart(2)} q=${lv.columns.length}/${lv.slots} fence=${fenceTag(lv).padEnd(4)} ` +
      `rnd=${st.random!.toFixed(2)} cas=${st.casual.toFixed(2)} gr=${st.greedy.toFixed(2)} crit=${st.critical}/${st.decisions} ` +
      `@1/3 rnd=${ph.random[0].toFixed(2)} cas=${ph.casual[0].toFixed(2)} ${best.dist === 0 ? 'ok ' : 'OFF ' + best.dist.toFixed(2)} ${best.ms.toFixed(0)}ms`,
  );
}
mkdirSync('src/data', { recursive: true });
writeFileSync(OUT, JSON.stringify(levels));
console.log(`wrote ${levels.length} levels in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
