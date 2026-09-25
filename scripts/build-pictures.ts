/**
 * Pixelizes every manifest entry at two presets and writes per-theme contact sheets:
 *   .cache/sheets/<theme>-A.png   20x20, ≤5 colors, transparent background
 *   .cache/sheets/<theme>-B.png   32x32, ≤8 colors + background with sparkles
 * plus .cache/sheets/stats.json. Prints stats and quality warnings.
 *
 * Run: bun scripts/build-pictures.ts [--only=<id,id,...>]   (--only writes only-<theme>-*.png)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { hasEmoji, renderEmojiRGBA } from './lib/emoji.ts';
import { fillBackground, gridStats, gridToSvg, pickBackground, pixelize, type PixelGrid } from './lib/pixelart.ts';
import { PICTURES, THEMES, type PictureEntry } from './pictures-manifest.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.cache', 'sheets');

const PRESET_A = { gridW: 20, gridH: 20, colors: 5 };
const PRESET_B = { gridW: 32, gridH: 32, colors: 8, padding: 3 };
const RENDER_SIZE = 512;

/** FNV-1a hash → stable per-picture seed. */
function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Result {
  entry: PictureEntry;
  a: PixelGrid;
  b: PixelGrid;
  warnings: string[];
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const entries = only ? PICTURES.filter((p) => only.includes(p.id)) : PICTURES;

const warnings: string[] = [];
const grouped: Record<string, string[]> = {};
const results: Result[] = [];
const seen = new Set<string>();
const t0 = performance.now();

for (const entry of entries) {
  if (seen.has(entry.id)) warnings.push(`${entry.id}: duplicate id`);
  seen.add(entry.id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) warnings.push(`${entry.id}: id is not kebab-case`);
  if (!hasEmoji(entry.source, entry.icon)) {
    warnings.push(`${entry.id}: MISSING icon ${entry.source}:${entry.icon}`);
    continue;
  }
  const rgba = renderEmojiRGBA(entry.source, entry.icon, RENDER_SIZE);
  const a = pixelize(rgba, PRESET_A);
  const b0 = pixelize(rgba, PRESET_B);
  const seed = seedOf(entry.id);
  const bg = pickBackground(b0, seed);
  const b = fillBackground(b0, { color: bg.color, patternColor: bg.patternColor, pattern: 'sparkles', seed });

  const w: string[] = [];
  const sa = gridStats(a);
  const sb0 = gridStats(b0);
  const warn = (kind: string, detail: string) => {
    w.push(`${kind} (${detail})`);
    (grouped[kind] ??= []).push(`${entry.id} ${detail}`);
  };
  if (a.palette.length < 3) warn('< 3 colors at 20x20', `${a.palette.length}`);
  if (b.palette.length < 3) warn('< 3 colors at 32x32+bg', `${b.palette.length}`);
  if (sa.speckles > Math.max(6, sa.filled * 0.04)) warn('many speckles at 20x20', `${sa.speckles}`);
  if (sb0.speckles > Math.max(8, sb0.filled * 0.04)) warn('many speckles at 32x32', `${sb0.speckles}`);
  if (sa.filled < a.w * a.h * 0.3) warn('mostly empty at 20x20', `${Math.round((100 * sa.filled) / (a.w * a.h))}%`);
  results.push({ entry, a, b, warnings: w });
}

// ---------------------------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

function embed(svg: string, x: number, y: number): string {
  return svg.replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `<svg x="${x}" y="${y}"`);
}

function sheet(theme: string, preset: 'A' | 'B', items: Result[]): Buffer {
  const cols = 6;
  const thumb = 160;
  const cellPx = preset === 'A' ? thumb / PRESET_A.gridW : thumb / PRESET_B.gridW;
  const pad = 14;
  const labelH = 38;
  const headerH = 44;
  const tileW = thumb + pad * 2;
  const tileH = thumb + labelH + pad;
  const rows = Math.ceil(items.length / cols);
  const W = cols * tileW + pad;
  const H = headerH + rows * tileH + pad;
  const title =
    preset === 'A'
      ? `${theme} — A: ${PRESET_A.gridW}x${PRESET_A.gridH}, ≤${PRESET_A.colors} colors`
      : `${theme} — B: ${PRESET_B.gridW}x${PRESET_B.gridH}, ≤${PRESET_B.colors} colors + background`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${pad + 4}" y="29" font-family="${FONT}" font-size="20" font-weight="bold" fill="#222">${esc(title)} (${items.length})</text>`,
  ];
  items.forEach((r, i) => {
    const grid = preset === 'A' ? r.a : r.b;
    const x = pad + (i % cols) * tileW + pad / 2;
    const y = headerH + Math.floor(i / cols) * tileH;
    parts.push(embed(gridToSvg(grid, cellPx), x, y));
    const st = gridStats(grid);
    const warn = r.warnings.length > 0;
    parts.push(
      `<text x="${x + thumb / 2}" y="${y + thumb + 16}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${warn ? '#c0392b' : '#222'}">${esc(r.entry.id)}</text>`,
      `<text x="${x + thumb / 2}" y="${y + thumb + 31}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#888">${r.entry.source === 'fluent' ? 'Fluent' : 'Twemoji'} · c${r.entry.complexity} · ${grid.palette.length} colors · ${st.speckles} sp</text>`,
    );
  });
  parts.push('</svg>');
  return new Resvg(parts.join(''), { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng();
}

mkdirSync(OUT, { recursive: true });
for (const theme of THEMES) {
  const items = results.filter((r) => r.entry.theme === theme);
  if (!items.length) continue;
  // --only runs write separate files so they never clobber the full sheets
  for (const preset of ['A', 'B'] as const)
    writeFileSync(join(OUT, `${only ? 'only-' : ''}${theme}-${preset}.png`), sheet(theme, preset, items));
}

// ---------------------------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------------------------

const stats = results.map((r) => {
  const sa = gridStats(r.a);
  const sb = gridStats(r.b);
  return {
    id: r.entry.id,
    theme: r.entry.theme,
    source: r.entry.source,
    icon: r.entry.icon,
    complexity: r.entry.complexity,
    A: { colors: r.a.palette.length, palette: r.a.palette, filled: sa.filled, speckles: sa.speckles, perColor: sa.perColor },
    B: { colors: r.b.palette.length, palette: r.b.palette, filled: sb.filled, speckles: sb.speckles, perColor: sb.perColor },
    warnings: r.warnings,
  };
});
writeFileSync(join(OUT, only ? 'only-stats.json' : 'stats.json'), JSON.stringify(stats, null, 1));

console.log(`Pixelized ${results.length}/${entries.length} pictures in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
console.log('theme      total  c1  c2  c3  fluent  twemoji  avgColorsA  avgColorsB  avgSpecklesA');
for (const theme of THEMES) {
  const rs = results.filter((r) => r.entry.theme === theme);
  if (!rs.length) continue;
  const c = (k: number) => rs.filter((r) => r.entry.complexity === k).length;
  const avg = (f: (r: Result) => number) => (rs.reduce((s, r) => s + f(r), 0) / rs.length).toFixed(1);
  console.log(
    `${theme.padEnd(10)} ${String(rs.length).padStart(5)} ${String(c(1)).padStart(3)} ${String(c(2)).padStart(3)} ${String(c(3)).padStart(3)}` +
      `  ${String(rs.filter((r) => r.entry.source === 'fluent').length).padStart(6)}  ${String(rs.filter((r) => r.entry.source === 'twemoji').length).padStart(7)}` +
      `  ${avg((r) => r.a.palette.length).padStart(10)}  ${avg((r) => r.b.palette.length).padStart(10)}  ${avg((r) => gridStats(r.a).speckles).padStart(12)}`,
  );
  if (!only) {
    if (rs.length < 28) warnings.push(`theme ${theme}: only ${rs.length} pictures (< 28)`);
    if (c(1) < 8) warnings.push(`theme ${theme}: only ${c(1)} complexity-1 pictures (< 8)`);
  }
}
console.log(`total      ${String(results.length).padStart(5)}`);
const nWarn = warnings.length + Object.values(grouped).reduce((n, g) => n + g.length, 0);
if (nWarn) {
  console.log(`\n${nWarn} warning(s):`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const [kind, list] of Object.entries(grouped)) console.log(`  ⚠ ${kind} [${list.length}]: ${list.join(', ')}`);
} else console.log('\nNo warnings.');
console.log(`\nSheets: ${OUT}/<theme>-{A,B}.png`);
