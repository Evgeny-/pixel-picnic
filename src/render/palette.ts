/**
 * Display palettes, separate from logical color ids and picture data.
 *
 * Distance is Euclidean OKLab (L is 0..1), not an RGB percentage or a WCAG
 * contrast ratio. Conversion matrices: https://bottosson.github.io/posts/oklab/
 * We also check a warm display and a bright, Neutral-tone-mapped surface:
 * the latter is important because the game's sunlight compresses pale greys.
 * These are explicit stress models, not a promise about every screen/filter
 * setting or every form of color vision. Material highlights are not measured.
 */
type Triple = readonly [number, number, number];
type Profile = readonly Triple[];
interface Candidate { hex: string; lab: Triple; profile: Profile; cost: number }

/** Preserve the picture's light tones while keeping a useful gap after compression. */
export const PALETTE_DISTANCE_TARGETS = [0.10, 0.085, 0.065, 0.06] as const;
export const MIN_PALETTE_DISTANCE = Math.min(...PALETTE_DISTANCE_TARGETS);
const cache = new Map<string, readonly string[]>();
const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const linear = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number): number => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

function rgb(hex: string): Triple {
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function lab([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function unlab([L, a, b]: Triple): Triple {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
export function colorOklab(hex: string): Triple {
  return lab(rgb(hex).map(linear) as unknown as Triple);
}
function distance(a: Triple, b: Triple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
/** Warm stress model: display-linear R/G/B gains 1 / 0.72 / 0.38. */
function warm([r, g, b]: Triple): Triple { return [r, g * 0.72, b * 0.38]; }
/** Same curve as THREE.NeutralToneMapping, with a 1.7 diffuse/exposure gain. */
function lit(source: Triple): Triple {
  const color = source.map((x) => x * 1.7);
  const x = Math.min(...color);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  for (let i = 0; i < 3; i++) color[i] -= offset;
  const peak = Math.max(...color);
  if (peak < 0.76) return color as unknown as Triple;
  const newPeak = 1 - 0.24 ** 2 / (peak + 0.24 - 0.76);
  const blend = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return color.map((v) => v * newPeak / peak * (1 - blend) + newPeak * blend) as unknown as Triple;
}
function profile(hex: string): Profile {
  const color = rgb(hex).map(linear) as unknown as Triple;
  const bright = lit(color);
  return [lab(color), lab(warm(color)), lab(bright), lab(warm(bright))];
}
function separated(a: Profile, b: Profile): boolean {
  return PALETTE_DISTANCE_TARGETS.every((target, i) => distance(a[i], b[i]) >= target);
}
/** Worst pair in each model: normal, warm, lit, lit+warm (same order as targets). */
export function paletteDistances(colors: readonly string[]): number[] {
  const profiles = colors.map(profile);
  const minimum = PALETTE_DISTANCE_TARGETS.map(() => Infinity);
  for (let a = 0; a < profiles.length; a++) for (let b = a + 1; b < profiles.length; b++) {
    for (let model = 0; model < minimum.length; model++) {
      minimum[model] = Math.min(minimum[model], distance(profiles[a][model], profiles[b][model]));
    }
  }
  return minimum;
}
/** Generated pictures keep every pair of colors at least this far apart (see pairReadability). */
export const PICTURE_READABILITY = 1.25;
/** Gap between two colors relative to the readability targets: 1 means just readable in every model. */
export function pairReadability(a: string, b: string): number {
  const pa = profile(a);
  const pb = profile(b);
  return Math.min(...PALETTE_DISTANCE_TARGETS.map((target, i) => distance(pa[i], pb[i]) / target));
}
export function paletteSeparation(colors: readonly string[]): number {
  return Math.min(...paletteDistances(colors));
}
export function hexFromLch(L: number, C: number, h: number): string {
  // Preserve hue when crossing the sRGB gamut by reducing chroma, never clipping
  // individual channels into an unrelated hue.
  let color = unlab([L, C * Math.cos(h), C * Math.sin(h)]);
  for (let n = 0; n < 30 && color.some((v) => v < -0.00001 || v > 1.00001); n++) {
    C *= 0.9;
    color = unlab([L, C * Math.cos(h), C * Math.sin(h)]);
  }
  return '#' + color.map((v) => Math.round(clamp(gamma(clamp(v))) * 255).toString(16).padStart(2, '0')).join('');
}
function candidates(original: string, hueFreedom: 0 | 1 | 2): Candidate[] {
  const source = colorOklab(original);
  const C = Math.hypot(source[1], source[2]);
  const h = Math.atan2(source[2], source[1]);
  const colors = new Set([original.toLowerCase()]);
  const neutral = C < 0.035;
  const turns = neutral || hueFreedom === 0 ? [0]
    : hueFreedom === 1 ? [0, -12, 12]
      : [0, -15, 15, -30, 30, -50, 50, -90, 90];
  for (const turn of turns) for (const chroma of neutral ? [C] : [C * 0.75, C, C * 1.25]) {
    for (let i = 0; i <= 56; i++) {
      colors.add(hexFromLch(0.14 + i * 0.015, chroma, h + turn * Math.PI / 180));
    }
  }
  if (neutral && source[0] > 0.8) {
    // A faint cool cast distinguishes light-grey fur from pure white without
    // forcing the fur several steps down the grey ladder under bright light.
    for (const chroma of [0.005, 0.01, 0.015, 0.02]) for (let i = 0; i <= 36; i++) {
      colors.add(hexFromLch(0.7 + i * 0.0075, chroma, 250 * Math.PI / 180));
    }
  }
  return [...colors].map((hex) => {
    const l = colorOklab(hex);
    // Hue/chroma changes are more expensive than lightness changes.
    const cost = (l[0] - source[0]) ** 2 + 2 * ((l[1] - source[1]) ** 2 + (l[2] - source[2]) ** 2);
    return { hex, lab: l, profile: profile(hex), cost };
  }).sort((a, b) => a.cost - b.cost || a.hex.localeCompare(b.hex));
}

/**
 * Keep the same array order/color ids. Greedily try several deterministic anchor
 * orders and choose the least altered feasible palette, comparing original hues
 * with modest hue shifts so saturated colors need not become muddy. Optional
 * picture cells weight common colors above small shading regions. Pale/dark
 * anchors and neutral-order constraints keep greys a recognizable lightness ladder.
 * Cached per source palette, and returned as a fresh array to avoid shared edits.
 */
export function readablePalette(palette: readonly string[], cells = ''): string[] {
  const counts = palette.map(() => 0);
  for (const char of cells) if (char !== '.') counts[parseInt(char, 36)]++;
  const key = palette.join(',') + ':' + counts.join(',');
  const cached = cache.get(key);
  if (cached) return [...cached];
  if (paletteDistances(palette).every((gap, i) => gap >= PALETTE_DISTANCE_TARGETS[i])) {
    cache.set(key, [...palette]);
    return [...palette];
  }
  const originals = palette.map(colorOklab);
  const ids = palette.map((_, i) => i);
  const maxCount = Math.max(1, ...counts);
  const neutral = originals.map((c) => Math.hypot(c[1], c[2]) < 0.035);
  // Common chromatic colors define the picture (a crab should stay orange).
  // Tiny shading regions can absorb more change; neutral ladders remain even.
  const weights = counts.map((count, i) => neutral[i] ? 1 : 1 + 10 * count / maxCount);
  const priority = (i: number): number => Math.abs(originals[i][0] - 0.55) + (Math.hypot(originals[i][1], originals[i][2]) < 0.035 ? 0.2 : 0);
  const anchorOrder = [...ids].sort((a, b) => priority(b) - priority(a) || a - b);
  const orders = [anchorOrder, [...ids].sort((a, b) => originals[b][0] - originals[a][0]),
    [...ids].sort((a, b) => originals[a][0] - originals[b][0]), ids, [...ids].reverse()];
  orders.push([...ids].sort((a, b) => counts[b] - counts[a] || a - b));
  for (let i = 1; i < ids.length; i++) orders.push([...anchorOrder.slice(i), ...anchorOrder.slice(0, i)]);
  let best: Candidate[] | undefined;
  let bestCost = Infinity;
  for (const hueFreedom of [0, 1, 2] as const) {
    if (hueFreedom === 2 && best) break;
    const options = palette.map((color) => candidates(color, hueFreedom));
    for (const order of orders) {
      const chosen: Candidate[] = new Array(palette.length);
      let cost = 0;
      for (const id of order) {
        const next = options[id].find((candidate) => chosen.every((previous, other) =>
          !previous || (separated(candidate.profile, previous.profile)
            && (!neutral[id] || !neutral[other]
              || (candidate.lab[0] - previous.lab[0]) * (originals[id][0] - originals[other][0]) >= 0))));
        if (!next) { cost = Infinity; break; }
        chosen[id] = next;
        cost += next.cost * weights[id];
      }
      if (cost < bestCost) { bestCost = cost; best = chosen; }
    }
  }
  // This guard is intentional: a new picture with an impossible palette should
  // fail campaign validation instead of silently weakening the distance target.
  if (!best) throw new Error(`Cannot separate ${palette.length} picture colors`);
  const result = best.map((color) => color.hex);
  cache.set(key, result);
  return [...result];
}
