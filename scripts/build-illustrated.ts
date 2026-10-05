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
import { colorOklab, hexFromLch, pairReadability, PICTURE_READABILITY as READABLE } from '../src/render/palette';
import { createIllustratedIntro } from './lib/intro-illustrated';
import { fillBackground } from './lib/pixelart';
import { Rng } from '../src/core/rng';

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
    if (n === 1) levels.push(createIllustratedIntro());
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
  slots: 4 | 5;
  /** Sparkles or dots sprinkled over a plain background. */
  decor: boolean;
}

/** Pastel grounds for scenes drawn on plain white or grey (the AI's default for simple subjects). */
const TINTS = ['#9fd8ff', '#b8f0c8', '#ffd8b0', '#e3cdfd', '#fff0a0', '#ffc8dc', '#c8f0f0', '#d8f5a8', '#f8d0a0', '#c0d8ff'];

/** The plain background: cells of the most common border color connected to the border. */
function backgroundRegion(p: PictureDef): { bg: number; mask: Uint8Array; area: number } {
  const cells = decodeCells(p);
  const { w, h } = p;
  const border = new Array(p.palette.length).fill(0);
  for (let x = 0; x < w; x++) { border[cells[x]]++; border[cells[(h - 1) * w + x]]++; }
  for (let y = 0; y < h; y++) { border[cells[y * w]]++; border[cells[y * w + w - 1]]++; }
  const bg = border.indexOf(Math.max(...border));
  const mask = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i - x) / w;
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && cells[i] === bg) { mask[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const j = ny * w + nx;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && !mask[j] && cells[j] === bg) { mask[j] = 1; stack.push(j); }
    }
  }
  return { bg, mask, area: mask.reduce((a, v) => a + v, 0) };
}

/**
 * A plain white or grey background becomes a pastel (different from level to level), so the
 * early pictures don't all sit on the same white. Only the outside region changes: white parts
 * of the subject itself stay white.
 */
function tinted(p: PictureDef, n: number): PictureDef {
  const { bg, mask, area } = backgroundRegion(p);
  if (area < p.w * p.h * 0.2) return p;
  const [L, A, B] = colorOklab(p.palette[bg]);
  if (Math.hypot(A, B) > 0.03 || L < 0.7) return p;
  const others = p.palette.filter((_, i) => i !== bg);
  for (let k = 0; k < TINTS.length; k++) {
    const tint = TINTS[(n * 7 + k) % TINTS.length];
    if (!others.every((q) => pairReadability(tint, q) >= READABLE)) continue;
    const cells = decodeCells(p);
    const palette = [...p.palette, tint];
    const out = Int16Array.from(cells, (c, i) => (mask[i] ? palette.length - 1 : c));
    return separate({ id: p.id, w: p.w, h: p.h, palette, cells: encodeCells(out) });
  }
  return p;
}

const DECOR_COLORS = ['#ffffff', '#fff4c2', '#d6ecff', '#ffd6e8', '#e3f7d0', '#2b2b44', '#5a3d2b'];

/**
 * Scenes with a big plain background get a sprinkle pattern in a second color, like the classic
 * emoji levels: the two background colors interleave, so the outside can no longer be eaten by
 * any box at all. Returns null when the picture has no large flat background.
 */
function decorated(p: PictureDef, seed: number): PictureDef | null {
  const cells = decodeCells(p);
  const { w, h } = p;
  const border = new Array(p.palette.length).fill(0);
  for (let x = 0; x < w; x++) { border[cells[x]]++; border[cells[(h - 1) * w + x]]++; }
  for (let y = 0; y < h; y++) { border[cells[y * w]]++; border[cells[y * w + w - 1]]++; }
  const bg = border.indexOf(Math.max(...border));
  const mask = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i - x) / w;
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && cells[i] === bg) { mask[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const j = ny * w + nx;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && !mask[j] && cells[j] === bg) { mask[j] = 1; stack.push(j); }
    }
  }
  const area = mask.reduce((a, v) => a + v, 0);
  if (area < w * h * 0.25) return null;
  const bgHex = p.palette[bg];
  const others = p.palette.filter((_, i) => i !== bg);
  const pat = DECOR_COLORS
    .filter((c) => pairReadability(c, bgHex) >= READABLE && others.every((q) => pairReadability(c, q) >= READABLE))
    .sort((a, b) => pairReadability(a, bgHex) - pairReadability(b, bgHex))[0];
  if (!pat) return null;
  const grid = { w, h, palette: [...p.palette], cells: Int16Array.from(cells, (c, i) => (mask[i] ? -1 : c)) };
  const pattern = new Rng(seed).next() < 0.5 ? 'sparkles' : 'dots';
  const out = fillBackground(grid, { color: bgHex, pattern, patternColor: pat, seed, margin: 0 });
  return separate({ id: p.id, w: out.w, h: out.h, palette: out.palette, cells: encodeCells(out.cells) });
}

/** Borders are a last resort; build-illustrated frames hands them out to a limited set of levels. */
const FRAMES = process.env.FRAMES === '1';

/** Merges colors that players could confuse: the rarer one of the closest pair joins the other. */
function separate(p: PictureDef): PictureDef {
  const cells = Int16Array.from(decodeCells(p));
  const used = () => {
    const counts = p.palette.map(() => 0);
    for (const c of cells) if (c >= 0) counts[c]++;
    return counts;
  };
  for (;;) {
    const counts = used();
    let worst: [number, number, number] | null = null;
    for (let a = 0; a < p.palette.length; a++) {
      if (!counts[a]) continue;
      for (let b = a + 1; b < p.palette.length; b++) {
        if (!counts[b]) continue;
        const r = pairReadability(p.palette[a], p.palette[b]);
        if (r < READABLE && (!worst || r < worst[2])) worst = [a, b, r];
      }
    }
    if (!worst) break;
    const [a, b] = worst;
    const [from, to] = counts[a] < counts[b] ? [a, b] : [b, a];
    // Like a pixel artist: first try a lighter or darker shade of the rarer color (same hue),
    // and only merge the two when no shade is clearly different from every other color.
    const [L, A, B] = colorOklab(p.palette[from]);
    const away = L >= colorOklab(p.palette[to])[0] ? 1 : -1;
    let shade: string | null = null;
    for (let d = 0.04; d <= 0.161 && !shade; d += 0.02) {
      for (const sign of [away, -away]) {
        const hex = hexFromLch(Math.min(0.97, Math.max(0.12, L + sign * d)), Math.hypot(A, B), Math.atan2(B, A));
        if (p.palette.every((q, i) => i === from || !counts[i] || pairReadability(hex, q) >= READABLE)) { shade = hex; break; }
      }
    }
    if (shade) {
      p = { ...p, palette: p.palette.map((q, i) => (i === from ? shade! : q)) };
      continue;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === from) cells[i] = to;
  }
  // Drop unused entries, most frequent color first.
  const counts = used();
  const order = counts.map((c, i) => [c, i]).filter(([c]) => c > 0).sort((x, y) => y[0] - x[0]).map(([, i]) => i);
  const remap = new Map(order.map((old, i) => [old, i]));
  return { id: p.id, w: p.w, h: p.h, palette: order.map((i) => p.palette[i]), cells: encodeCells(cells.map((c) => (c >= 0 ? remap.get(c)! : -1))) };
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
  const [c1, c2] = [...FRAME_COLORS]
    .filter((c) => p.palette.every((q) => pairReadability(c, q) >= READABLE))
    .sort((a, b) => sep(b) - sep(a));
  if (!c1 || (kind === 2 && (!c2 || pairReadability(c1, c2) < READABLE))) return p;
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

type Built = { lv: LevelDef; pic: Prepared; dist: number; variant: Variant };

const key = (v: Variant) => JSON.stringify([v.fences.map((f) => f.side + (f.gate ?? '')).join(), v.frame, v.slots, v.decor]);

/** Next variant to try after `v` came out too easy or too hard, or null when nothing is left. */
function nextVariant(n: number, v: Variant, easy: boolean, canDecor: boolean, tried: Set<string>): Variant | null {
  const fixedFences = n < MECHANIC_LEVEL.fence || n === MECHANIC_LEVEL.fence || n === MECHANIC_LEVEL.gate;
  const sides = new Set(v.fences.map((f) => f.side));
  const options: Variant[] = easy
    ? [
        { ...v, slots: 4 },
        { ...v, decor: canDecor },
        ...(fixedFences ? [] : [
          { ...v, fences: [{ side: 'top' as const }, { side: (n % 2 ? 'left' : 'right') as 'left' | 'right' }] },
          { ...v, fences: [{ side: 'top' as const }, { side: 'left' as const }, { side: 'right' as const }] },
        ].filter((x) => x.fences.length > sides.size)),
        ...(FRAMES ? [{ ...v, frame: 1 as const }, ...(fixedFences ? [{ ...v, frame: 2 as const }] : [])] : []),
      ]
    : [{ ...v, slots: 5 }, { ...v, decor: false }, { ...v, frame: 0 as const }];
  return options.find((o) => !tried.has(key(o))) ?? null;
}

/** Candidates in order of preference; the first picture that (nearly) lands on the target wins. */
function buildBest(n: number, cands: Prepared[]): Built | null {
  let best: Built | null = null;
  const tier = tierForLevel(n);
  const plan = planLevel(n, tier);
  const target = tierTarget(tier, n);
  // Variety: from level 12 every fourth level starts with five slots (and a nastier queue).
  const start: Variant = { fences: plan.fences, frame: 0, slots: n <= 2 || (n >= 12 && n % 4 === 3) ? 5 : 4, decor: false };
  for (const pic of cands.slice(0, 4)) {
    let mine: Built | null = null;
    const tried = new Set<string>();
    // Paintings stay as painted; only generated scenes get background sprinkles.
    const canDecor = !pic.src.startsWith('fixed/') && decorated(tinted(separate(pic), n), n) !== null;
    let v: Variant | null = start;
    while (v && tried.size < 6) {
      tried.add(key(v));
      const r = build(n, pic, v);
      if (!r) {
        // The generator found no queue at all: loosen up (a fifth slot first).
        v = nextVariant(n, v, false, canDecor, tried);
        continue;
      }
      if (!mine || r.dist < mine.dist - 1e-9) mine = { lv: r.lv, pic, dist: r.dist, variant: v };
      if (r.dist === 0) break;
      const st = r.lv.stats!;
      const easy = st.casual > target.casual[1] || (st.random ?? 0) > (target.random?.[1] ?? 1) || (st.planner ?? 0) > (target.planner?.[1] ?? 1);
      v = nextVariant(n, v, easy, canDecor, tried);
    }
    if (mine && (!best || mine.dist < best.dist - 1e-9)) best = mine;
    if (best && best.dist <= 0.05) break;
  }
  return best;
}

function build(n: number, pic: Prepared, variant: Variant): { lv: LevelDef; dist: number } | null {
  const tier = tierForLevel(n);
  const plan = planLevel(n, tier);
  let picture = separate({ id: pic.id, w: pic.w, h: pic.h, palette: pic.palette, cells: pic.cells });
  if (!pic.src.startsWith('fixed/')) picture = tinted(picture, n);
  if (variant.decor) picture = decorated(picture, n) ?? picture;
  if (variant.frame) picture = framed(picture, variant.frame);
  const pixels = decodeCells(picture).reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  // Bigger pictures get bigger boxes instead of an endless queue.
  const base = tierTarget(tier, n);
  const maxBox = Math.min(110, Math.max(base.maxBox ?? 70, Math.round(pixels / 22)));
  const target = { ...base, maxBox };
  const k = pixels / (plan.gridSize * plan.gridSize);
  const params = {
    ...plan.params,
    slots: variant.slots,
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

/** Picks the levels that may get a border: the furthest from their target, at most a fifth of all. */
function frameCandidates(): number[] {
  const built: { n: number; dist: number }[] = [];
  for (let n = 2; n <= COUNT; n++) {
    const f = `${DIR}/${n}.json`;
    if (existsSync(f)) built.push({ n, dist: JSON.parse(readFileSync(f, 'utf8')).dist ?? 0 });
  }
  const budget = Math.floor(COUNT * 0.2);
  const perWorld = new Map<number, number>();
  const out: number[] = [];
  for (const { n } of built.filter((b) => b.dist > 0.1).sort((a, b) => b.dist - a.dist)) {
    const w = worldOf(n);
    const cap = n <= 10 ? 3 : 5;
    const used = n <= 10 ? out.filter((x) => x <= 10).length : perWorld.get(w) ?? 0;
    if (used >= cap || out.length >= budget) continue;
    out.push(n);
    perWorld.set(w, (perWorld.get(w) ?? 0) + 1);
  }
  return out.sort((a, b) => a - b);
}

const arg = process.argv[2] ?? `2-${COUNT}`;
if (arg === 'merge') {
  merge();
} else if (arg === 'frames') {
  console.log(frameCandidates().join(' '));
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
      `${pic.src} f${best.variant.fences.length} s${best.variant.slots}${best.variant.decor ? ' decor' : ''}${best.variant.frame ? ' frame' + best.variant.frame : ''} ${best.dist === 0 ? 'ok' : 'OFF ' + best.dist.toFixed(2)} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
}
