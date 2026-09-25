/**
 * Emoji raster → clean, few-color pixel art (for the ant-colony picture levels).
 * Pure TypeScript, no Node/DOM dependencies (usable from build scripts and the browser).
 *
 * Pipeline (see pixelize()):
 *  1. crop to the content bounding box and fit it (aspect preserved, centered) into the grid;
 *     every source pixel maps to a target cell, which accumulates alpha coverage;
 *  2. the emoji's own flat colors are found with weighted k-means++ in OKLab over its unique colors
 *     (~24 "fine" colors), then merged bottom-up with Ward's criterion down to ≤ K colors;
 *  3. each cell takes the color covering most of its area (mode, not mean → no muddy blends);
 *  4. thin strokes (outlines, creases, stems, whiskers) are skeletonized and drawn as continuous
 *     1-cell lines; small enclosed blobs (eyes, nostrils, seeds) are redrawn as clean w×h blocks;
 *     high-contrast blobs that lost every vote get the cell they cover most;
 *  5. cleanup: colors used by ≤ 2 low-contrast cells are folded into neighbours, isolated speckles
 *     are recolored (strong features such as a single eye or a symmetric pair of eyes are kept);
 *  6. palette = dominant original member colors, slightly saturated; colors closer than
 *     minColorDistance are pushed apart in lightness when both regions matter, otherwise merged;
 *     palette sorted by frequency.
 */

export interface PixelGrid {
  w: number;
  h: number;
  palette: string[];
  cells: Int16Array;
}

export interface PixelizeOptions {
  gridW: number;
  gridH: number;
  colors: number;
  minColorDistance?: number;
  alphaThreshold?: number;
  cleanup?: boolean;
  padding?: number;
}

type Lab = [number, number, number];

// ---------------------------------------------------------------------------------------------
// Color math (sRGB ↔ linear ↔ OKLab)
// ---------------------------------------------------------------------------------------------

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb8(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function linearToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function rgb8ToOklab(r: number, g: number, b: number): Lab {
  return linearToOklab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b]);
}

function inGamut(lin: [number, number, number]): boolean {
  const e = 1e-4;
  return lin[0] >= -e && lin[0] <= 1 + e && lin[1] >= -e && lin[1] <= 1 + e && lin[2] >= -e && lin[2] <= 1 + e;
}

/** OKLab → sRGB hex, reducing chroma (keeping L and hue) until it fits the sRGB gamut. */
function oklabToHex(lab: Lab): string {
  let [L, a, b] = lab;
  L = Math.min(1, Math.max(0, L));
  let lin = oklabToLinear(L, a, b);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, a * mid, b * mid))) lo = mid;
      else hi = mid;
    }
    a *= lo;
    b *= lo;
    lin = oklabToLinear(L, a, b);
  }
  const hex = (v: number) => linearToSrgb8(v).toString(16).padStart(2, '0');
  return `#${hex(lin[0])}${hex(lin[1])}${hex(lin[2])}`;
}

function hexToOklab(hex: string): Lab {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return rgb8ToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

function dist2(p: Lab, q: Lab): number {
  const dL = p[0] - q[0];
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return dL * dL + da * da + db * db;
}

function dist(p: Lab, q: Lab): number {
  return Math.sqrt(dist2(p, q));
}

function chroma(p: Lab): number {
  return Math.hypot(p[1], p[2]);
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Color distance in OKLab between two '#rrggbb' strings. */
export function colorDistance(a: string, b: string): number {
  return dist(hexToOklab(a), hexToOklab(b));
}

// ---------------------------------------------------------------------------------------------
// Weighted k-means++ in OKLab
// ---------------------------------------------------------------------------------------------

function kmeans(points: Lab[], weights: number[], k: number, seed: number, iterations = 24): { centers: Lab[]; labels: Int32Array } {
  const n = points.length;
  const labels = new Int32Array(n);
  if (n === 0) return { centers: [], labels };
  if (n <= k) {
    for (let i = 0; i < n; i++) labels[i] = i;
    return { centers: points.map((p) => [...p] as Lab), labels };
  }
  const rand = rng(seed);
  const centers: Lab[] = [];
  // k-means++ seeding: first center ∝ weight, following ∝ weight · D².
  const d2 = new Float64Array(n).fill(Infinity);
  const pick = (scores: Float64Array | number[]): number => {
    let total = 0;
    for (let i = 0; i < n; i++) total += scores[i];
    if (total <= 0) return -1;
    let r = rand() * total;
    for (let i = 0; i < n; i++) {
      r -= scores[i];
      if (r <= 0) return i;
    }
    return n - 1;
  };
  let first = pick(weights);
  if (first < 0) first = 0;
  centers.push([...points[first]] as Lab);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    const scores = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = dist2(points[i], c);
      if (d < d2[i]) d2[i] = d;
      scores[i] = weights[i] * d2[i];
    }
    const idx = pick(scores);
    if (idx < 0) break; // all remaining points coincide with centers
    centers.push([...points[idx]] as Lab);
  }
  // Lloyd iterations.
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(points[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best || it === 0) {
        if (labels[i] !== best) changed = true;
        labels[i] = best;
      }
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const a = acc[labels[i]];
      const w = weights[i];
      a[0] += points[i][0] * w;
      a[1] += points[i][1] * w;
      a[2] += points[i][2] * w;
      a[3] += w;
    }
    for (let c = 0; c < centers.length; c++) {
      const a = acc[c];
      if (a[3] > 0) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    }
    if (!changed && it > 0) break;
  }
  return { centers, labels };
}

// ---------------------------------------------------------------------------------------------
// pixelize
// ---------------------------------------------------------------------------------------------

interface Cluster {
  w: number; // area (in cell units)
  lab: Lab; // weighted centroid
  members: number[]; // fine cluster ids
}

export function pixelize(rgba: { width: number; height: number; data: Uint8Array }, opts: PixelizeOptions): PixelGrid {
  const gridW = Math.max(1, Math.round(opts.gridW));
  const gridH = Math.max(1, Math.round(opts.gridH));
  const K = Math.max(1, Math.round(opts.colors));
  const minDist = opts.minColorDistance ?? 0.08;
  const alphaThreshold = opts.alphaThreshold ?? 0.5;
  const cleanup = opts.cleanup ?? true;
  const pad = Math.max(0, Math.floor(opts.padding ?? 0));
  const { width: W, height: H, data } = rgba;
  const N = gridW * gridH;

  // --- 1. content bounding box --------------------------------------------------------------
  let bx0 = W;
  let by0 = H;
  let bx1 = -1;
  let by1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 40) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  const empty: PixelGrid = { w: gridW, h: gridH, palette: [], cells: new Int16Array(N).fill(-1) };
  if (bx1 < 0) return empty;
  bx1 += 1;
  by1 += 1;
  const availW = Math.max(1, gridW - 2 * pad);
  const availH = Math.max(1, gridH - 2 * pad);
  const bw = bx1 - bx0;
  const bh = by1 - by0;
  const s = Math.min(availW / bw, availH / bh); // cells per source pixel
  const offX = pad + (availW - bw * s) / 2;
  const offY = pad + (availH - bh * s) / 2;
  const cellArea = 1 / (s * s); // source pixels per cell

  const colOf = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const c = Math.floor(offX + (x + 0.5 - bx0) * s);
    colOf[x] = c >= 0 && c < gridW ? c : -1;
  }
  const rowOf = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    const r = Math.floor(offY + (y + 0.5 - by0) * s);
    rowOf[y] = r >= 0 && r < gridH ? r : -1;
  }

  // --- 2. per-pixel cell index, coverage, unique colors ---------------------------------------
  const pixCell = new Int32Array(W * H).fill(-1);
  const pixColor = new Int32Array(W * H).fill(-1);
  const alphaSum = new Float64Array(N);
  const colorIndex = new Map<number, number>();
  const uLab: Lab[] = [];
  const uW: number[] = [];
  for (let y = 0; y < H; y++) {
    const r = rowOf[y];
    if (r < 0) continue;
    for (let x = 0; x < W; x++) {
      const c = colOf[x];
      if (c < 0) continue;
      const p = y * W + x;
      const a = data[p * 4 + 3];
      if (a === 0) continue;
      const cell = r * gridW + c;
      pixCell[p] = cell;
      const af = a / 255;
      alphaSum[cell] += af;
      if (a < 8) continue;
      const key = (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2];
      let ci = colorIndex.get(key);
      if (ci === undefined) {
        ci = uLab.length;
        colorIndex.set(key, ci);
        uLab.push(rgb8ToOklab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]));
        uW.push(0);
      }
      uW[ci] += af;
      pixColor[p] = ci;
    }
  }
  const coverage = new Float64Array(N);
  for (let i = 0; i < N; i++) coverage[i] = alphaSum[i] / cellArea;
  if (uLab.length === 0) return empty;

  // --- 3. fine palette (k-means++ over unique colors) → Ward merge into ≤ K colors ------------
  const FINE = 24;
  const fine = kmeans(uLab, uW, Math.min(FINE, uLab.length), 1234);
  const fineN = fine.centers.length;
  const fineW = new Float64Array(fineN);
  for (let i = 0; i < uLab.length; i++) fineW[fine.labels[i]] += uW[i] / cellArea;

  const clusters: Cluster[] = [];
  for (let f = 0; f < fineN; f++) if (fineW[f] > 0) clusters.push({ w: fineW[f], lab: fine.centers[f], members: [f] });

  const merge = (i: number, j: number) => {
    const A = clusters[i];
    const B = clusters[j];
    const w = A.w + B.w;
    const lab: Lab = [
      (A.lab[0] * A.w + B.lab[0] * B.w) / w,
      (A.lab[1] * A.w + B.lab[1] * B.w) / w,
      (A.lab[2] * A.w + B.lab[2] * B.w) / w,
    ];
    clusters[i] = { w, lab, members: [...A.members, ...B.members] };
    clusters.splice(j, 1);
  };
  const mergeDown = (limit: number, minD: number) => {
    for (;;) {
      const n = clusters.length;
      if (n <= 1) return;
      let bestI = -1;
      let bestJ = -1;
      let bestCost = Infinity;
      let closeI = -1;
      let closeJ = -1;
      let closeD = Infinity;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d2v = dist2(clusters[i].lab, clusters[j].lab);
          const cost = ((clusters[i].w * clusters[j].w) / (clusters[i].w + clusters[j].w)) * d2v;
          if (cost < bestCost) {
            bestCost = cost;
            bestI = i;
            bestJ = j;
          }
          if (d2v < closeD) {
            closeD = d2v;
            closeI = i;
            closeJ = j;
          }
        }
      }
      if (Math.sqrt(closeD) < minD) merge(closeI, closeJ);
      else if (n > limit) merge(bestI, bestJ);
      else return;
    }
  };
  // Near-duplicates always merge; moderately close colors are resolved later (push apart/merge).
  mergeDown(K, minDist * 0.5);

  // fine → coarse label
  const fineToCoarse = new Int32Array(fineN).fill(-1);
  clusters.forEach((c, ci) => c.members.forEach((f) => (fineToCoarse[f] = ci)));
  const C = clusters.length;

  // --- 4. per-cell histograms & mode assignment ----------------------------------------------
  const pixLabel = new Int32Array(W * H).fill(-1); // coarse label per pixel
  const hist = new Float64Array(N * C);
  for (let p = 0; p < W * H; p++) {
    const ci = pixColor[p];
    if (ci < 0) continue;
    const cl = fineToCoarse[fine.labels[ci]];
    pixLabel[p] = cl;
    hist[pixCell[p] * C + cl] += data[p * 4 + 3] / 255;
  }
  const cells = new Int16Array(N).fill(-1);
  const share = (cell: number, c: number) => (alphaSum[cell] > 0 ? hist[cell * C + c] / alphaSum[cell] : 0);
  for (let i = 0; i < N; i++) {
    if (coverage[i] < alphaThreshold) continue;
    let best = -1;
    let bestV = 0;
    for (let c = 0; c < C; c++) {
      const v = hist[i * C + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    cells[i] = best;
  }

  let labs: Lab[] = clusters.map((c) => c.lab);

  // --- 5. thin lines & small features ---------------------------------------------------------
  // Thin strokes (outlines, creases, stripes, stems) become continuous 1-cell pixel lines instead
  // of dotted fragments; small enclosed blobs (eyes, nostrils, seeds) become clean w×h blocks;
  // small high-contrast blobs that still own no cell get the cell they cover most.
  const comps = labelComponents(W, H, pixLabel, pixCell);
  const lineIds = drawThinLines(W, comps, pixCell, cells, coverage, labs, s);
  const keepCells = blockifyFeatures(comps, pixCell, cells, coverage, labs, hist, C, lineIds, {
    W,
    H,
    gridW,
    gridH,
    s,
    cellArea,
    offX: offX - bx0 * s,
    offY: offY - by0 * s,
  });
  for (const c of restoreFeatures(W, H, comps, pixCell, cells, coverage, labs, cellArea)) keepCells.add(c);

  // --- 6. fold tiny low-contrast colors into neighbours; speckle cleanup ----------------------
  // A color used by ≤ 2 cells costs a whole ant colony for almost nothing, unless it is a strong
  // feature (an eye) that contrasts with everything around it.
  const cnt = usedCounts(cells, C);
  for (let c = 0; c < C; c++) {
    if (cnt[c] === 0 || cnt[c] > 2) continue;
    let keep = false;
    for (let i = 0; i < N && !keep; i++) {
      if (cells[i] !== c) continue;
      if (keepCells.has(i)) keep = true;
      const around = neighborColors(cells, gridW, gridH, i).filter((o) => o !== c);
      const minD = around.length ? Math.min(...around.map((o) => (o < 0 ? 1 : dist(labs[c], labs[o])))) : 1;
      if (minD >= 0.3) keep = true;
    }
    if (keep) continue;
    for (let i = 0; i < N; i++) if (cells[i] === c) cells[i] = bestReplacement(cells, gridW, gridH, i, labs, hist, C, c);
  }
  if (cleanup) removeSpeckles(cells, gridW, gridH, labs, share, keepCells);

  // --- 7. final palette colors ---------------------------------------------------------------
  // Representative = members weighted by (area inside cells of that color)², so the dominant
  // original color wins but near-equal mixes average out.
  const memberW = new Float64Array(fineN);
  for (let p = 0; p < W * H; p++) {
    const ci = pixColor[p];
    if (ci < 0) continue;
    const cell = pixCell[p];
    if (cells[cell] !== pixLabel[p]) continue;
    memberW[fine.labels[ci]] += data[p * 4 + 3] / 255;
  }
  labs = clusters.map((cl, ci) => {
    let sw = 0;
    const acc: Lab = [0, 0, 0];
    for (const f of cl.members) {
      const w = memberW[f] * memberW[f];
      if (w <= 0) continue;
      sw += w;
      acc[0] += fine.centers[f][0] * w;
      acc[1] += fine.centers[f][1] * w;
      acc[2] += fine.centers[f][2] * w;
    }
    return sw > 0 ? ([acc[0] / sw, acc[1] / sw, acc[2] / sw] as Lab) : labs[ci];
  });
  labs = labs.map((l) => hexToOklab(oklabToHex(vivid(l))));

  // Colors closer than minDist: push significant regions apart in lightness (keeps e.g. a leaf
  // on a green apple), merge the rest.
  separateOrMerge(labs, cells, minDist, Math.max(3, Math.round(N * 0.006)));

  // --- 8. compact & sort palette by frequency --------------------------------------------------
  return compact({ w: gridW, h: gridH, palette: labs.map(oklabToHex), cells });
}

/** Slight saturation boost for a cleaner, more vivid look. */
function vivid(lab: Lab): Lab {
  const c = chroma(lab);
  if (c < 0.02) return lab;
  const k = 1.12;
  return [lab[0], lab[1] * k, lab[2] * k];
}

function usedCounts(cells: Int16Array, C: number): Int32Array {
  const cnt = new Int32Array(C);
  for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) cnt[cells[i]]++;
  return cnt;
}

/**
 * Enforce a minimum distance between all used palette colors. For a too-close pair, if the smaller
 * region is significant (≥ sigCells cells) the colors are pushed apart along lightness (like a pixel
 * artist darkening a leaf); otherwise the smaller region is merged into the larger.
 */
function separateOrMerge(labs: Lab[], cells: Int16Array, minDist: number, sigCells: number) {
  const C = labs.length;
  for (let guard = 0; guard < 64; guard++) {
    const cnt = usedCounts(cells, C);
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (let i = 0; i < C; i++) {
      if (!cnt[i]) continue;
      for (let j = i + 1; j < C; j++) {
        if (!cnt[j]) continue;
        const d = dist(labs[i], labs[j]);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || bd >= minDist) return;
    const [big, small] = cnt[bi] >= cnt[bj] ? [bi, bj] : [bj, bi];
    if (cnt[small] >= sigCells && bd >= 0.025) {
      const others = labs.filter((_, k) => k !== big && k !== small && cnt[k] > 0);
      const moved = pushApart(labs[big], labs[small], minDist * 1.2, minDist, others);
      if (moved) {
        labs[big] = moved[0];
        labs[small] = moved[1];
        continue;
      }
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === small) cells[i] = big;
  }
}

function pushApart(A: Lab, B: Lab, target: number, minDist: number, others: Lab[]): [Lab, Lab] | null {
  const dab = Math.hypot(B[1] - A[1], B[2] - A[2]);
  const need = Math.sqrt(Math.max(0, target * target - dab * dab));
  const dirs = B[0] > A[0] ? [1, -1] : B[0] < A[0] ? [-1, 1] : A[0] > 0.6 ? [-1, 1] : [1, -1];
  const valid = (a: Lab, b: Lab) =>
    dist(a, b) >= minDist && others.every((o) => dist(o, a) >= minDist && dist(o, b) >= minDist);
  const fix = (l: Lab) => hexToOklab(oklabToHex(l));
  for (const sgn of dirs) {
    // 1) move only the smaller region's color
    const Lb = A[0] + sgn * need;
    if (Lb >= 0.12 && Lb <= 0.97 && Math.abs(Lb - B[0]) <= 0.16) {
      const nb = fix([Lb, B[1], B[2]]);
      if (valid(A, nb)) return [A, nb];
    }
    // 2) move both halfway
    const m = (A[0] + B[0]) / 2;
    const La = m - (sgn * need) / 2;
    const Lb2 = m + (sgn * need) / 2;
    if (La >= 0.12 && La <= 0.97 && Lb2 >= 0.12 && Lb2 <= 0.97 && Math.abs(La - A[0]) <= 0.1 && Math.abs(Lb2 - B[0]) <= 0.16) {
      const na = fix([La, A[1], A[2]]);
      const nb = fix([Lb2, B[1], B[2]]);
      if (valid(na, nb)) return [na, nb];
    }
  }
  return null;
}

function neighborColors(cells: Int16Array, w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = (i - x) / w;
  const out: number[] = [];
  if (x > 0) out.push(cells[i - 1]);
  if (x < w - 1) out.push(cells[i + 1]);
  if (y > 0) out.push(cells[i - w]);
  if (y < h - 1) out.push(cells[i + w]);
  return out;
}

/** Best alternative color for a cell: most common different 8-neighbour color, tie → histogram. */
function bestReplacement(cells: Int16Array, w: number, h: number, i: number, labs: Lab[], hist: Float64Array, C: number, not: number): number {
  const x = i % w;
  const y = (i - x) / w;
  const score = new Map<number, number>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const v = cells[ny * w + nx];
      if (v < 0 || v === not) continue;
      const wgt = dx && dy ? 0.5 : 1;
      score.set(v, (score.get(v) ?? 0) + wgt + (hist.length ? hist[i * C + v] * 1e-3 : 0));
    }
  }
  let best = -1;
  let bestS = -1;
  for (const [v, sc] of score) {
    // prefer perceptually close colors on ties
    const adj = sc - dist(labs[v], labs[not]) * 0.01;
    if (adj > bestS) {
      bestS = adj;
      best = v;
    }
  }
  return best >= 0 ? best : not;
}

interface Components {
  comp: Int32Array; // component id per source pixel (-1 = none)
  label: number[]; // coarse color label per component
  area: number[]; // pixels
  perim: number[]; // boundary edge count (pixels)
  bbox: [number, number, number, number][]; // x0, y0, x1 (excl), y1 (excl)
  around: number[]; // dominant neighbouring label (-1 = transparent / none)
}

/** 4-connected components of equal coarse label on the high-res label image. */
function labelComponents(W: number, H: number, pixLabel: Int32Array, pixCell: Int32Array): Components {
  const comp = new Int32Array(W * H).fill(-1);
  const out: Components = { comp, label: [], area: [], perim: [], bbox: [], around: [] };
  const stack: number[] = [];
  for (let p = 0; p < W * H; p++) {
    if (pixLabel[p] < 0 || comp[p] >= 0 || pixCell[p] < 0) continue;
    const id = out.label.length;
    const lab = pixLabel[p];
    let area = 0;
    let perim = 0;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    const neighbours = new Map<number, number>();
    comp[p] = id;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      area++;
      const x = q % W;
      const y = (q - x) / W;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
      const nb = [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < H - 1 ? q + W : -1];
      for (const n of nb) {
        if (n >= 0 && pixLabel[n] === lab && pixCell[n] >= 0) {
          if (comp[n] < 0) {
            comp[n] = id;
            stack.push(n);
          }
        } else {
          perim++;
          const o = n >= 0 ? pixLabel[n] : -1;
          neighbours.set(o, (neighbours.get(o) ?? 0) + 1);
        }
      }
    }
    let around = -1;
    let best = 0;
    for (const [o, c] of neighbours) {
      if (o >= 0 && c > best) {
        best = c;
        around = o;
      }
    }
    // mostly surrounded by transparency → treat as floating
    if ((neighbours.get(-1) ?? 0) > best) around = -1;
    out.label.push(lab);
    out.area.push(area);
    out.perim.push(perim);
    out.bbox.push([x0, y0, x1, y1]);
    out.around.push(around);
  }
  return out;
}

/** Zhang–Suen thinning of a binary mask (1 = foreground); the mask must have a 1px empty border. */
function thin(img: Uint8Array, w: number, h: number): Uint8Array {
  let changed = true;
  const del: number[] = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const p2 = img[i - w];
          const p3 = img[i - w + 1];
          const p4 = img[i + 1];
          const p5 = img[i + w + 1];
          const p6 = img[i + w];
          const p7 = img[i + w - 1];
          const p8 = img[i - 1];
          const p9 = img[i - w - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A =
            (+!p2 & p3) + (+!p3 & p4) + (+!p4 & p5) + (+!p5 & p6) + (+!p6 & p7) + (+!p7 & p8) + (+!p8 & p9) + (+!p9 & p2);
          if (A !== 1) continue;
          if (step === 0 ? p2 & p4 & p6 || p4 & p6 & p8 : p2 & p4 & p8 || p2 & p6 & p8) continue;
          del.push(i);
        }
      }
      if (del.length) {
        changed = true;
        for (const i of del) img[i] = 0;
      }
    }
  }
  return img;
}

/**
 * Thin strokes → continuous pixel lines. A component whose mean thickness is below ~0.7 cells is
 * skeletonized; every cell its skeleton runs through (for ≥ 0.4 cell lengths) takes its color.
 */
function drawThinLines(
  W: number,
  comps: Components,
  pixCell: Int32Array,
  cells: Int16Array,
  coverage: Float64Array,
  labs: Lab[],
  s: number,
): Set<number> {
  const lines: { id: number; contrast: number; cells: Map<number, number> }[] = [];
  for (let id = 0; id < comps.label.length; id++) {
    const area = comps.area[id];
    const thickness = ((2 * area) / Math.max(1, comps.perim[id])) * s; // in cells
    if (thickness >= 0.7 || area * s * s < 0.35) continue;
    const label = comps.label[id];
    const around = comps.around[id];
    const contrast = around < 0 ? 0.3 : dist(labs[label], labs[around]);
    if (contrast < 0.12) continue;
    const [x0, y0, x1, y1] = comps.bbox[id];
    const w = x1 - x0 + 2;
    const h = y1 - y0 + 2;
    const mask = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) if (comps.comp[y * W + x] === id) mask[(y - y0 + 1) * w + (x - x0 + 1)] = 1;
    const sk = thin(mask, w, h);
    const perCell = new Map<number, number>();
    let length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!sk[y * w + x]) continue;
        length++;
        const cell = pixCell[(y - 1 + y0) * W + (x - 1 + x0)];
        if (cell >= 0) perCell.set(cell, (perCell.get(cell) ?? 0) + 1);
      }
    }
    if (length * s < 1.2) continue; // dots are handled by restoreFeatures
    lines.push({ id, contrast, cells: perCell });
  }
  lines.sort((a, b) => b.contrast - a.contrast);
  const claimed = new Set<number>();
  const minRun = 0.4 / s; // skeleton pixels needed inside a cell
  for (const ln of lines) {
    const label = comps.label[ln.id];
    for (const [cell, n] of ln.cells) {
      if (n < minRun || claimed.has(cell)) continue;
      if (cells[cell] < 0 && coverage[cell] < 0.25) continue;
      cells[cell] = label;
      claimed.add(cell);
    }
  }
  return new Set(lines.map((l) => l.id));
}

/**
 * Small enclosed features (eyes, nostrils, buttons, seeds: 0.3–4.5 cells, contrasting with the
 * color around them) are re-rasterized as a clean w×h block of cells, sized from the blob's
 * second moments and placed where it overlaps the blob most. Mode voting alone turns e.g. a
 * 1.4×2.1-cell capsule eye into a ragged 3-cell "L"; a pixel artist would draw a 1×2 bar.
 * Returns the cells of strong (high-contrast) features, which speckle cleanup must keep.
 */
function blockifyFeatures(
  comps: Components,
  pixCell: Int32Array,
  cells: Int16Array,
  coverage: Float64Array,
  labs: Lab[],
  hist: Float64Array,
  C: number,
  lineIds: Set<number>,
  g: { W: number; H: number; gridW: number; gridH: number; s: number; cellArea: number; offX: number; offY: number },
): Set<number> {
  const { W, H, gridW, gridH, s, cellArea } = g;
  const cand = new Map<number, number>(); // component id → index
  for (let id = 0; id < comps.label.length; id++) {
    const a = comps.area[id] / cellArea;
    if (a < 0.3 || a > 4.5 || lineIds.has(id)) continue;
    const around = comps.around[id];
    if (around < 0 || around === comps.label[id]) continue;
    if (dist(labs[comps.label[id]], labs[around]) < 0.15) continue;
    cand.set(id, cand.size);
  }
  if (!cand.size) return new Set();
  const mom = [...cand.keys()].map(() => ({ sx: 0, sy: 0, sxx: 0, syy: 0, n: 0, cells: new Map<number, number>() }));
  for (let p = 0; p < W * H; p++) {
    const id = comps.comp[p];
    if (id < 0) continue;
    const k = cand.get(id);
    if (k === undefined) continue;
    const x = p % W;
    const y = (p - x) / W;
    const m = mom[k];
    m.sx += x;
    m.sy += y;
    m.sxx += x * x;
    m.syy += y * y;
    m.n++;
    const cell = pixCell[p];
    if (cell >= 0) m.cells.set(cell, (m.cells.get(cell) ?? 0) + 1);
  }
  const items = [...cand.entries()]
    .map(([id, k]) => {
      const m = mom[k];
      const mx = m.sx / m.n;
      const my = m.sy / m.n;
      const vx = Math.max(0, m.sxx / m.n - mx * mx);
      const vy = Math.max(0, m.syy / m.n - my * my);
      return {
        id,
        m,
        cx: g.offX + (mx + 0.5) * s, // continuous cell coordinates
        cy: g.offY + (my + 0.5) * s,
        ew: Math.sqrt(14 * vx) * s, // blob extent in cells (≈ width for rectangles & ellipses)
        eh: Math.sqrt(14 * vy) * s,
        contrast: dist(labs[comps.label[id]], labs[comps.around[id]]),
        area: m.n / cellArea,
      };
    })
    .sort((a, b) => b.contrast * Math.min(1, b.area) - a.contrast * Math.min(1, a.area));

  const claimed = new Set<number>();
  const keep = new Set<number>();
  const clamp = (v: number) => Math.min(3, Math.max(1, v));
  for (const it of items) {
    const label = comps.label[it.id];
    const w = clamp(Math.round(it.ew - 0.1));
    const h = clamp(Math.round(it.eh - 0.1));
    const x0c = Math.round(it.cx - w / 2);
    const y0c = Math.round(it.cy - h / 2);
    let best: [number, number] | null = null;
    let bestScore = -1;
    let bestD = Infinity;
    for (let y0 = y0c - 1; y0 <= y0c + 1; y0++) {
      for (let x0 = x0c - 1; x0 <= x0c + 1; x0++) {
        if (x0 < 0 || y0 < 0 || x0 + w > gridW || y0 + h > gridH) continue;
        let score = 0;
        let blocked = false;
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const c = (y0 + yy) * gridW + x0 + xx;
            if (claimed.has(c)) blocked = true;
            score += (it.m.cells.get(c) ?? 0) / cellArea;
          }
        }
        if (blocked) continue;
        const d = Math.hypot(x0 + w / 2 - it.cx, y0 + h / 2 - it.cy);
        if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && d < bestD)) {
          best = [x0, y0];
          bestScore = score;
          bestD = d;
        }
      }
    }
    if (!best || bestScore < 0.18) continue;
    const block = new Set<number>();
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) block.add((best[1] + yy) * gridW + best[0] + xx);
    // Cells outside the block that got this color mainly because of this blob go back to the
    // best other color of that cell.
    for (const [cell, n] of it.m.cells) {
      if (block.has(cell) || claimed.has(cell) || cells[cell] !== label) continue;
      if (n < 0.5 * hist[cell * C + label]) continue;
      let alt = -1;
      let altV = 0;
      for (let c = 0; c < C; c++) {
        if (c === label) continue;
        const v = hist[cell * C + c];
        if (v > altV) {
          altV = v;
          alt = c;
        }
      }
      cells[cell] = alt >= 0 ? alt : bestReplacement(cells, gridW, gridH, cell, labs, hist, C, label);
    }
    for (const cell of block) {
      if (cells[cell] < 0 && coverage[cell] < 0.3) continue; // don't grow the silhouette
      cells[cell] = label;
      claimed.add(cell);
      if (it.contrast >= 0.3) keep.add(cell);
    }
  }
  return keep;
}

/**
 * Re-insert small, high-contrast features (eyes, noses, seeds, buttons) that disappeared in the
 * mode assignment: every blob of a coarse color with area ≥ ~0.3 cells that contrasts with its
 * surroundings but owns no cell gets the cell where its share is highest.
 */
function restoreFeatures(
  W: number,
  H: number,
  comps: Components,
  pixCell: Int32Array,
  cells: Int16Array,
  coverage: Float64Array,
  labs: Lab[],
  cellArea: number,
): Set<number> {
  const perCell = new Map<number, Map<number, number>>();
  for (let p = 0; p < W * H; p++) {
    const id = comps.comp[p];
    if (id < 0) continue;
    const a = comps.area[id] / cellArea;
    if (a < 0.3 || a > 6) continue;
    let m = perCell.get(id);
    if (!m) perCell.set(id, (m = new Map()));
    const cell = pixCell[p];
    m.set(cell, (m.get(cell) ?? 0) + 1);
  }
  const candidates: { cell: number; contrast: number; salience: number; label: number }[] = [];
  for (const [id, m] of perCell) {
    const label = comps.label[id];
    let owned = false;
    for (const cell of m.keys()) if (cells[cell] === label) owned = true;
    if (owned) continue;
    let bestCell = -1;
    let bestFrac = 0;
    for (const [cell, n] of m) {
      const frac = n / cellArea;
      if (frac > bestFrac) {
        bestFrac = frac;
        bestCell = cell;
      }
    }
    if (bestCell < 0 || bestFrac < 0.18) continue;
    const cur = cells[bestCell];
    if (cur < 0 && coverage[bestCell] < 0.3) continue;
    const contrast = cur < 0 ? 0.3 : dist(labs[label], labs[cur]);
    if (contrast < 0.18) continue;
    const a = comps.area[id] / cellArea;
    candidates.push({ cell: bestCell, contrast, salience: contrast * Math.min(1, a) * (0.5 + bestFrac), label });
  }
  candidates.sort((a, b) => b.salience - a.salience);
  const taken = new Set<number>();
  const keep = new Set<number>(); // strong features survive speckle cleanup (a single eye)
  for (const cand of candidates) {
    if (taken.has(cand.cell)) continue;
    taken.add(cand.cell);
    cells[cand.cell] = cand.label;
    if (cand.contrast >= 0.3) keep.add(cand.cell);
  }
  return keep;
}

/** True if one of the 4 diagonal neighbours of cell i has value v. */
function hasDiagonal(cells: Int16Array, w: number, h: number, i: number, v: number): boolean {
  const x = i % w;
  const y = (i - x) / w;
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && cells[ny * w + nx] === v) return true;
  }
  return false;
}

/**
 * Remove isolated single-cell speckles: a filled cell without any same-colored neighbour (diagonal
 * neighbours count, so pixel-art diagonal lines survive) whose 4-neighbours all share one other
 * color is recolored to it. High-contrast speckles that are part of a mirror-symmetric pair (eyes)
 * or strongly supported by the source are kept. Single-cell holes inside one color are filled.
 */
function removeSpeckles(
  cells: Int16Array,
  w: number,
  h: number,
  labs: Lab[],
  share: (cell: number, c: number) => number,
  keepCells: Set<number>,
) {
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = cells.slice();
    // horizontal extent of the content for symmetry checks
    let minX = w;
    let maxX = -1;
    for (let i = 0; i < w * h; i++) {
      if (snapshot[i] < 0) continue;
      const x = i % w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    for (let i = 0; i < w * h; i++) {
      const v = snapshot[i];
      const nb = neighborColors(snapshot, w, h, i);
      if (nb.includes(v)) continue;
      if (v < 0) {
        if (nb.length === 4 && nb.every((o) => o === nb[0] && o >= 0)) cells[i] = nb[0];
        continue;
      }
      if (hasDiagonal(snapshot, w, h, i, v)) continue;
      const uniq = [...new Set(nb)];
      if (uniq.length !== 1) continue;
      const o = uniq[0];
      if (o < 0) {
        cells[i] = -1; // floating pixel
        continue;
      }
      const contrast = dist(labs[v], labs[o]);
      const x = i % w;
      const y = (i - x) / w;
      let mirrored = false;
      for (let dx = -1; dx <= 1 && !mirrored; dx++) {
        const mx = minX + maxX - x + dx;
        if (mx === x || mx < 0 || mx >= w) continue;
        if (snapshot[y * w + mx] === v) mirrored = true;
      }
      const keep =
        (contrast >= 0.25 && mirrored) || (contrast >= 0.35 && share(i, v) >= 0.45) || (keepCells.has(i) && contrast >= 0.3);
      if (!keep) cells[i] = o;
    }
  }
}

/** Drop unused palette entries and sort by frequency (most frequent first). */
function compact(grid: PixelGrid): PixelGrid {
  const cnt = new Array(grid.palette.length).fill(0);
  for (const v of grid.cells) if (v >= 0) cnt[v]++;
  const order = grid.palette
    .map((_, i) => i)
    .filter((i) => cnt[i] > 0)
    .sort((a, b) => cnt[b] - cnt[a] || a - b);
  const remap = new Int16Array(grid.palette.length).fill(-1);
  order.forEach((old, nu) => (remap[old] = nu));
  const cells = new Int16Array(grid.cells.length);
  for (let i = 0; i < cells.length; i++) cells[i] = grid.cells[i] >= 0 ? remap[grid.cells[i]] : -1;
  return { w: grid.w, h: grid.h, palette: order.map((i) => grid.palette[i]), cells };
}

// ---------------------------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------------------------

/**
 * Curated background colors: [background, pattern color, preference weight]. Pastels/brights are
 * preferred; deep colors are used when a picture is too light for a pastel background.
 * Every pattern color is ≥ 0.17 OKLab away from its background.
 */
const BACKGROUNDS: [string, string, number][] = [
  ['#6fd3f2', '#ffffff', 1.3], // sky cyan
  ['#8be0b4', '#ffffff', 1], // mint
  ['#f9a8c9', '#ffffff', 1], // bubblegum pink
  ['#b9a6f2', '#ffffff', 1], // lavender
  ['#ffc38f', '#ffffff', 0.9], // peach
  ['#ffe066', '#ffffff', 0.9], // lemon
  ['#4fc7bd', '#e8fffb', 1], // teal
  ['#ff9189', '#ffffff', 0.9], // coral
  ['#8ea9ff', '#ffffff', 1], // periwinkle
  ['#c7ec7c', '#ffffff', 0.9], // lime
  ['#e3a6f0', '#ffffff', 0.9], // lilac
  ['#7fdcdc', '#ffffff', 0.9], // aqua
  ['#5b9cf5', '#ffffff', 0.8], // cornflower
  ['#6cc56c', '#ffffff', 0.7], // grass
  ['#4d8ef7', '#ffffff', 0.7], // bright blue
  ['#3fbf7f', '#ffffff', 0.7], // emerald
  ['#b36bff', '#ffffff', 0.7], // violet
  ['#ff7aa8', '#ffffff', 0.7], // hot pink
  ['#20b2aa', '#ffffff', 0.7], // sea green
  ['#ff9f45', '#ffffff', 0.6], // tangerine
  ['#2e3f7a', '#ffe98a', 0.4], // night navy + star yellow
  ['#51389a', '#f4d8ff', 0.35], // deep purple
  ['#2f7d6d', '#c9f5de', 0.3], // deep teal
];

export function pickBackground(grid: PixelGrid, seed: number): { color: string; patternColor: string } {
  const labs = grid.palette.map(hexToOklab);
  const cnt = gridStats(grid).perColor;
  // Colors on the silhouette matter most: they touch the background.
  const edge = new Array(grid.palette.length).fill(0);
  for (let i = 0; i < grid.cells.length; i++) {
    const v = grid.cells[i];
    if (v < 0) continue;
    const x = i % grid.w;
    const y = (i - x) / grid.w;
    if (neighborColors(grid.cells, grid.w, grid.h, i).includes(-1) || x === 0 || y === 0 || x === grid.w - 1 || y === grid.h - 1) edge[v]++;
  }
  const totalEdge = edge.reduce((a, b) => a + b, 0) || 1;
  const scored = BACKGROUNDS.map(([bg, pat, pref]) => {
    const b = hexToOklab(bg);
    const p = hexToOklab(pat);
    let minAll = 1;
    let minEdge = 1;
    let edgeLow = 0; // share of the silhouette that is low-contrast against this background
    labs.forEach((l, i) => {
      if (!cnt[i]) return;
      const d = dist(l, b);
      minAll = Math.min(minAll, d);
      if (edge[i] > 0) {
        minEdge = Math.min(minEdge, d);
        if (d < 0.2) edgeLow += edge[i] / totalEdge;
      }
    });
    // pattern color should either match a palette color (it gets merged) or be clearly different
    let patOk = true;
    for (const l of labs) {
      const d = dist(l, p);
      if (d > 0.04 && d < 0.1) patOk = false;
    }
    const ok = minAll >= 0.12 && minEdge >= 0.15 && edgeLow < 0.25 && patOk;
    const quality = Math.min(minAll, 0.3) + Math.min(minEdge, 0.4) - edgeLow * 0.5;
    return { bg, pat, pref, ok, quality };
  });
  const eligible = scored.filter((s) => s.ok);
  if (!eligible.length) {
    scored.sort((a, b) => b.quality - a.quality);
    return { color: scored[0].bg, patternColor: scored[0].pat };
  }
  // Seeded weighted choice among the eligible backgrounds (variety across levels).
  const rand = rng((seed * 2654435761) ^ 0x5bd1e995);
  rand();
  const weights = eligible.map((e) => e.pref * (0.6 + Math.min(e.quality, 0.5)));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) return { color: eligible[i].bg, patternColor: eligible[i].pat };
  }
  const last = eligible[eligible.length - 1];
  return { color: last.bg, patternColor: last.pat };
}

export function fillBackground(
  grid: PixelGrid,
  opts: {
    color: string;
    pattern?: 'none' | 'sparkles' | 'dots' | 'stripes' | 'checker';
    patternColor?: string;
    seed?: number;
    margin?: number;
  },
): PixelGrid {
  const margin = Math.max(0, Math.floor(opts.margin ?? 0));
  const pattern = opts.pattern ?? 'none';
  const seed = opts.seed ?? 1;
  const w = grid.w + 2 * margin;
  const h = grid.h + 2 * margin;
  const cells = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) cells[(y + margin) * w + x + margin] = grid.cells[y * grid.w + x];
  const palette = [...grid.palette];
  const labs = palette.map(hexToOklab);
  const MIN_BG = 0.12;

  // Background color: nudge its lightness/chroma until it is clearly different from every color.
  const bgLab = separateFrom(hexToOklab(opts.color), labs, MIN_BG);
  let bgIndex: number;
  if (bgLab) {
    bgIndex = palette.length;
    palette.push(oklabToHex(bgLab));
    labs.push(bgLab);
  } else {
    // impossible to separate: merge with the nearest color
    const target = hexToOklab(opts.color);
    bgIndex = labs.reduce((best, l, i) => (dist(l, target) < dist(labs[best], target) ? i : best), 0);
  }

  const isBg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (cells[i] < 0) {
      cells[i] = bgIndex;
      isBg[i] = 1;
    }
  }

  if (pattern !== 'none') {
    const bg = labs[bgIndex];
    let patLab = hexToOklab(opts.patternColor ?? (bg[0] > 0.6 ? '#ffffff' : '#fff4b0'));
    let patIndex = -1;
    // merge into an existing (non-background) palette color when close enough
    for (let i = 0; i < labs.length; i++) {
      if (i === bgIndex) continue;
      if (dist(labs[i], patLab) < MIN_BG) {
        patIndex = i;
        break;
      }
    }
    if (patIndex < 0) {
      if (dist(patLab, bg) < MIN_BG) patLab = separateFrom(patLab, [bg], MIN_BG * 1.5) ?? patLab;
      patIndex = palette.length;
      palette.push(oklabToHex(patLab));
      labs.push(patLab);
    }
    const rand = rng(seed * 2654435761 + 1);
    const free = (x: number, y: number, clearance: number) => {
      for (let dy = -clearance; dy <= clearance; dy++) {
        for (let dx = -clearance; dx <= clearance; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; // off-grid counts as free
          const j = ny * w + nx;
          if (!isBg[j] || cells[j] !== bgIndex) return false;
        }
      }
      return true;
    };
    const set = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const j = y * w + x;
      if (isBg[j]) cells[j] = patIndex;
    };
    if (pattern === 'sparkles') {
      // plus-shaped sparkles (radius 1, sometimes 2) and a few single dots; never touching the
      // picture or each other.
      const bgCount = isBg.reduce((a, b) => a + b, 0);
      const target = Math.max(1, Math.round(bgCount / 55));
      let placed = 0;
      for (let attempt = 0; attempt < 400 && placed < target; attempt++) {
        const x = 1 + Math.floor(rand() * (w - 2));
        const y = 1 + Math.floor(rand() * (h - 2));
        const big = rand() < 0.3;
        const r = big ? 2 : 1;
        if (x - r < 0 || y - r < 0 || x + r >= w || y + r >= h) continue;
        if (!free(x, y, r + 1)) continue;
        // arms only (plus shape)
        set(x, y);
        for (let k = 1; k <= r; k++) {
          set(x - k, y);
          set(x + k, y);
          set(x, y - k);
          set(x, y + k);
        }
        placed++;
      }
      for (let attempt = 0; attempt < 200 && placed < target * 1.6; attempt++) {
        const x = Math.floor(rand() * w);
        const y = Math.floor(rand() * h);
        if (!free(x, y, 1)) continue;
        set(x, y);
        placed++;
      }
    } else if (pattern === 'dots') {
      const step = 4;
      for (let y = 1; y < h; y += step) {
        const shift = ((y - 1) / step) % 2 ? step / 2 : 0;
        for (let x = 1 + shift; x < w; x += step) if (free(x, y, 1)) set(x, y);
      }
    } else if (pattern === 'stripes') {
      const period = 6;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if ((x + y) % period < 2 && isBg[y * w + x]) cells[y * w + x] = patIndex;
    } else if (pattern === 'checker') {
      const size = 3;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 && isBg[y * w + x]) cells[y * w + x] = patIndex;
    }
  }
  return compact({ w, h, palette, cells });
}

/** Move `lab` (mostly in lightness) until its distance to all `others` is ≥ minD. */
function separateFrom(lab: Lab, others: Lab[], minD: number): Lab | null {
  const ok = (l: Lab) => others.every((o) => dist(l, o) >= minD);
  if (ok(lab)) return lab;
  const tries: Lab[] = [];
  for (let step = 1; step <= 12; step++) {
    const dL = step * 0.025;
    for (const sign of lab[0] > 0.55 ? [1, -1] : [-1, 1]) {
      for (const cs of [1, 1.3, 0.7]) tries.push([lab[0] + sign * dL, lab[1] * cs, lab[2] * cs]);
    }
  }
  for (const t of tries) {
    if (t[0] < 0.08 || t[0] > 0.98) continue;
    const hex = oklabToHex(t);
    const back = hexToOklab(hex);
    if (ok(back)) return back;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Stats & previews
// ---------------------------------------------------------------------------------------------

export function gridStats(grid: PixelGrid): { filled: number; empty: number; perColor: number[]; speckles: number } {
  const perColor = new Array(grid.palette.length).fill(0);
  let filled = 0;
  let speckles = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    const v = grid.cells[i];
    if (v < 0) continue;
    filled++;
    perColor[v]++;
    if (!neighborColors(grid.cells, grid.w, grid.h, i).includes(v) && !hasDiagonal(grid.cells, grid.w, grid.h, i, v)) speckles++;
  }
  return { filled, empty: grid.cells.length - filled, perColor, speckles };
}

export function gridToSvg(grid: PixelGrid, cellPx: number): string {
  const W = grid.w * cellPx;
  const H = grid.h * cellPx;
  const inset = cellPx >= 6 ? Math.max(0.3, cellPx * 0.04) : 0;
  const rx = cellPx >= 6 ? cellPx * 0.18 : 0;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  let hasEmpty = false;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] < 0) hasEmpty = true;
  if (hasEmpty) {
    const c = cellPx;
    parts.push(
      `<defs><pattern id="chk" width="${2 * c}" height="${2 * c}" patternUnits="userSpaceOnUse">` +
        `<rect width="${2 * c}" height="${2 * c}" fill="#dde3ea"/><rect width="${c}" height="${c}" fill="#cbd3dd"/>` +
        `<rect x="${c}" y="${c}" width="${c}" height="${c}" fill="#cbd3dd"/></pattern></defs>`,
      `<rect width="${W}" height="${H}" fill="url(#chk)"/>`,
    );
  }
  // group cells by color to keep the SVG compact
  const byColor = new Map<number, string[]>();
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const v = grid.cells[y * grid.w + x];
      if (v < 0) continue;
      let arr = byColor.get(v);
      if (!arr) byColor.set(v, (arr = []));
      const px = x * cellPx + inset;
      const py = y * cellPx + inset;
      const sz = cellPx - 2 * inset;
      arr.push(`<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${sz.toFixed(2)}" height="${sz.toFixed(2)}"${rx ? ` rx="${rx.toFixed(2)}"` : ''}/>`);
    }
  }
  for (const [v, rects] of byColor) parts.push(`<g fill="${grid.palette[v]}">${rects.join('')}</g>`);
  parts.push('</svg>');
  return parts.join('');
}
