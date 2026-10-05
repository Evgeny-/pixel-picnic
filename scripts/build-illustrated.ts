/**
 * Builds levels of the illustrated campaign from prepared pictures (scripts/art/pictures.py).
 * Every level is written to .cache/art/levels/<n>.json so several builders can run in parallel;
 * `bun scripts/build-illustrated.ts merge` assembles src/data/levels-illustrated.json.
 *
 *   bun scripts/build-illustrated.ts 2-40          build levels 2..40 (skips finished ones)
 *   REBUILD=1 bun scripts/build-illustrated.ts 7   rebuild level 7 even if it exists
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { ensureCritical, generateLevel, objective, tierTarget, tuneLevel } from '../src/core/generator';
import { plannerRate } from '../src/core/solver';
import { buildFences, MECHANIC_LEVEL, planLevel, worldOf, type FenceSpec } from '../src/core/progression';
import { decodeCells, encodeCells, tierForLevel, type LevelDef, type Localized, type PictureDef } from '../src/core/types';
import { colorOklab } from '../src/render/palette';
import { createIntroLevel } from './lib/intro-level';

const PICTURES = '.cache/art/pictures.json';
const DIR = '.cache/art/levels';
const OUT = 'src/data/levels-illustrated.json';
const COUNT = 280;

interface Prepared extends PictureDef {
  n: number;
  name: Localized;
  /** Source image, relative to .cache/art. */
  src: string;
}

function merge(): void {
  const levels: LevelDef[] = [];
  const missing: number[] = [];
  for (let n = 1; n <= COUNT; n++) {
    const f = `${DIR}/${n}.json`;
    if (n === 1) levels.push(createIntroLevel());
    else if (existsSync(f)) {
      const { cands: _c, src: _s, dist: _d, variant: _v, ...lv } = JSON.parse(readFileSync(f, 'utf8'));
      levels.push(lv);
    }
    else missing.push(n);
  }
  if (missing.length) {
    console.log(`missing ${missing.length} levels: ${missing.slice(0, 20).join(',')}${missing.length > 20 ? '…' : ''}`);
    // The campaign must stay contiguous; stop at the first gap.
    levels.length = Math.min(levels.length, missing[0] - 1);
  }
  writeFileSync(OUT + '.tmp', JSON.stringify(levels));
  renameSync(OUT + '.tmp', OUT);
  console.log(`wrote ${levels.length} levels to ${OUT}`);
}

interface Variant {
  fences: FenceSpec[];
  /** 0: the scene as drawn; 1: a one-piece border around it; 2: a two-color dashed border. */
  frame: 0 | 1 | 2;
}

const FRAME_COLORS = ['#f4ead2', '#5a3d2b', '#ffffff', '#27324a', '#c9dfa8', '#e9b8c8', '#8e6bbf'];

/**
 * Full-frame scenes touch the frame with almost every color, so ants can start anywhere and a
 * random tapper rarely gets stuck. A border (one color, or two alternating ones) that has to be
 * eaten first brings back the "work your way in" structure of the classic pictures.
 */
function framed(p: PictureDef, kind: 1 | 2): PictureDef {
  const cells = decodeCells(p);
  const labs = p.palette.map(colorOklab);
  const sep = (hex: string) => {
    const c = colorOklab(hex);
    return Math.min(...labs.map((l) => Math.hypot(l[0] - c[0], l[1] - c[1], l[2] - c[2])));
  };
  const [c1, c2] = [...FRAME_COLORS].sort((a, b) => sep(b) - sep(a));
  const palette = [...p.palette, c1, ...(kind === 2 ? [c2] : [])];
  const W = p.w + 2;
  const H = p.h + 2;
  const out = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      out[y * W + x] = border ? (kind === 2 && ((x + y) >> 1) % 2 ? p.palette.length + 1 : p.palette.length) : cells[(y - 1) * p.w + x - 1];
    }
  }
  return { id: p.id, w: W, h: H, palette, cells: encodeCells(out) };
}

/** Ways to make a too-easy scene harder, mildest first. Mechanic intro levels keep their fences. */
function variants(n: number, planFences: FenceSpec[]): Variant[] {
  const v: Variant[] = [{ fences: planFences, frame: 0 }];
  if (n < MECHANIC_LEVEL.fence || n === MECHANIC_LEVEL.fence || n === MECHANIC_LEVEL.gate) {
    v.push({ fences: planFences, frame: 1 }, { fences: planFences, frame: 2 });
    return v;
  }
  const three: FenceSpec[] = [{ side: 'top' }, { side: 'left' }, { side: 'right' }];
  if (new Set(planFences.map((f) => f.side)).size < 2) v.push({ fences: [{ side: 'top' }, { side: n % 2 ? 'left' : 'right' }], frame: 0 });
  v.push({ fences: three, frame: 0 }, { fences: three, frame: 1 });
  return v;
}

type Built = { lv: LevelDef; pic: Prepared; dist: number; variant: Variant };

/** Candidates in order of preference; the first picture that (nearly) lands on the target wins. */
function buildBest(n: number, cands: Prepared[]): Built | null {
  let best: Built | null = null;
  const planFences = planLevel(n, tierForLevel(n)).fences;
  for (const pic of cands.slice(0, 4)) {
    let mine: Built | null = null;
    for (const variant of variants(n, planFences)) {
      const r = build(n, pic, variant);
      if (r && (!mine || r.dist < mine.dist - 1e-9)) mine = { lv: r.lv, pic, dist: r.dist, variant };
      if (mine && mine.dist === 0) break;
    }
    if (mine && (!best || mine.dist < best.dist - 1e-9)) best = mine;
    // Keep the preferred artwork when it is close enough.
    if (best && best.dist <= 0.05) break;
  }
  return best;
}

function build(n: number, pic: Prepared, variant: Variant): { lv: LevelDef; dist: number } | null {
  const tier = tierForLevel(n);
  const plan = planLevel(n, tier);
  const plain: PictureDef = { id: pic.id, w: pic.w, h: pic.h, palette: pic.palette, cells: pic.cells };
  const picture = variant.frame ? framed(plain, variant.frame) : plain;
  const pixels = decodeCells(picture).reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  // Bigger pictures get bigger boxes instead of an endless queue.
  const base = tierTarget(tier, n);
  const maxBox = Math.min(110, Math.max(base.maxBox ?? 70, Math.round(pixels / 22)));
  const target = { ...base, maxBox };
  const k = pixels / (plan.gridSize * plan.gridSize);
  const params = {
    ...plan.params,
    fences: buildFences(variant.fences, picture.w, picture.h, n),
    boxMin: Math.min(Math.round(maxBox * 0.6), Math.max(3, Math.round(plan.params.boxMin * k))),
    boxMax: Math.min(maxBox, Math.max(6, Math.round(plan.params.boxMax * k))),
  };
  let res = generateLevel(picture, params, target, n * 1013 + 7, tier === 'superhard' ? 30 : 22, 100);
  if (!res) res = generateLevel(picture, { ...params, links: 0, frozen: 0 }, target, n * 1013 + 8, 30, 80);
  if (!res) return null;
  const iters = tier === 'superhard' ? 260 : tier === 'hard' ? 200 : 140;
  if (objective(res.diff, target) > 0) {
    const tuned = tuneLevel(res.level, res.diff, target, n * 7717 + 3, iters, 90, n > 140 ? 3000 : 12000);
    res = { ...res, level: tuned.level, diff: tuned.diff };
  }
  const crit = ensureCritical(res.level, res.diff, target, n * 3571 + 11, Math.round(iters * 0.6), n > 140 ? 3000 : 12000);
  res = { ...res, level: crit.level, diff: crit.diff };
  const planner = plannerRate(res.level, 8, n * 17 + 1);
  res.diff = { ...res.diff, planner };
  const dist = objective(res.diff, target) + Math.max(0, (target.minCritical ?? 0) - crit.critical) * 0.05;
  const lv: LevelDef = {
    ...res.level,
    n,
    world: worldOf(n),
    tier,
    name: pic.name,
    shape: 'cube',
    queueHint: plan.queueHint,
    stats: {
      casual: +res.diff.casual.toFixed(3),
      greedy: +res.diff.greedy.toFixed(3),
      random: +res.diff.random.toFixed(3),
      planner: +planner.toFixed(3),
      nodes: res.nodes,
      critical: crit.critical,
      decisions: crit.decisions,
      pixels,
      boxes: res.level.boxes.length,
      colors: picture.palette.length,
    },
  };
  return { lv, dist };
}

const arg = process.argv[2] ?? `2-${COUNT}`;
if (arg === 'merge') {
  merge();
} else {
  const [a, b] = arg.split('-').map(Number);
  const pics = new Map<number, Prepared[]>();
  for (const p of JSON.parse(readFileSync(PICTURES, 'utf8')) as Prepared[]) pics.set(p.n, [...(pics.get(p.n) ?? []), p]);
  mkdirSync(DIR, { recursive: true });
  for (let n = a; n <= (b || a); n++) {
    const f = `${DIR}/${n}.json`;
    const cands = pics.get(n);
    if (n === 1 || !cands?.length) continue;
    const key = cands.slice(0, 4).map((c) => c.src).join('|');
    if (existsSync(f) && process.env.REBUILD !== '1') {
      // Keep a finished level unless its candidate list changed and it missed the target.
      const old = JSON.parse(readFileSync(f, 'utf8')) as LevelDef & { cands?: string; dist?: number };
      if (old.cands === key || (old.dist ?? 1) === 0) continue;
    }
    const t0 = performance.now();
    const best = buildBest(n, cands);
    if (!best) {
      console.log(`#${n} FAILED ${cands[0].id}`);
      continue;
    }
    const lv = best.lv;
    const pic = best.pic;
    writeFileSync(f + '.tmp', JSON.stringify({ ...lv, cands: key, src: pic.src, dist: +best.dist.toFixed(3), variant: best.variant }));
    renameSync(f + '.tmp', f);
    const st = lv.stats!;
    console.log(`#${String(n).padStart(3)} ${lv.tier.padEnd(9)} ${pic.id.padEnd(22)} ${lv.picture.w}x${lv.picture.h} px=${st.pixels} col=${st.colors} boxes=${st.boxes} ` +
      `max=${Math.max(...lv.boxes.map((x) => x.count))} rnd=${st.random!.toFixed(2)} cas=${st.casual.toFixed(2)} plan=${st.planner!.toFixed(2)} crit=${st.critical} ` +
      `${pic.src} f${best.variant.fences.length}${best.variant.frame ? ' frame' + best.variant.frame : ''} ${best.dist === 0 ? 'ok' : 'OFF ' + best.dist.toFixed(2)} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
}
