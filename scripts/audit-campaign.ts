/** Independent difficulty samples, source inventory and contact sheets for the playable campaign. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { replay, tierTarget } from '../src/core/generator';
import { estimateDifficulty, plannerRate } from '../src/core/solver';
import { decodeCells, type LevelDef } from '../src/core/types';
import { THEMES } from '../src/render/themes';
import { readablePalette } from '../src/render/palette';
import { gridToSvg } from './lib/pixelart';
import { PICTURES } from './pictures-manifest';
import { SOURCE_INFO } from './lib/emoji';

const file = process.argv[2] ?? 'src/data/levels.json';
const out = process.argv[3] ?? '.cache/campaign-audit';
const levels = (JSON.parse(readFileSync(file, 'utf8')) as LevelDef[]).filter(l => l.n > 140);
mkdirSync(out, { recursive: true });
const measure = !process.argv.includes('--pictures-only');
const previous: { n: number; fingerprint?: string; holdout?: unknown }[] = process.argv.includes('--resume') && existsSync(`${out}/report.json`)
  ? JSON.parse(readFileSync(`${out}/report.json`, 'utf8')) : [];
const reports = [];
for (const l of levels) {
  if (!replay(l, l.solution ?? [])) throw new Error(`Level ${l.n}: solution failed`);
  const art = PICTURES.find(p => p.id === l.picture.id);
  if (!art) throw new Error(`Level ${l.n}: missing source`);
  const fingerprint = createHash('sha256').update('audit-v2:' + JSON.stringify(l)).digest('hex');
  const cached = previous.find(r => r.n === l.n && r.fingerprint === fingerprint && r.holdout);
  if (measure && cached) { reports.push(cached); continue; }
  const report = {
    n: l.n, fingerprint, name: l.name?.en, world: THEMES[l.world].name.en, tier: l.tier,
    picture: l.picture.id, source: { ...SOURCE_INFO[art.source], icon: art.icon },
    pixels: l.picture.cells.replaceAll('.', '').length, boxes: l.boxes.length,
    solutionVerified: true, generation: l.stats, target: tierTarget(l.tier, l.n),
    ...(measure ? { holdout: { ...estimateDifficulty(l, 96, 638003 + l.n * 37), planner: plannerRate(l, 12, 438029 + l.n * 23) } } : {}),
  };
  reports.push(report);
  writeFileSync(`${out}/report.json`, JSON.stringify(reports, null, 2));
  if (measure) console.log(`${l.n} ${l.tier} ${l.name?.en}: ${JSON.stringify(report.holdout)}`);
}
writeFileSync(`${out}/report.json`, JSON.stringify(reports, null, 2));
const esc = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (const world of [...new Set(levels.map(l => l.world))]) {
  const group = levels.filter(l => l.world === world);
  const width = 1000, height = 60 + Math.ceil(group.length / 5) * 220;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff9ed"/><text x="20" y="34" font-size="24" font-family="sans-serif">${esc(THEMES[world].name.en)}</text>`;
  group.forEach((l, i) => {
    const x = (i % 5) * 200 + 12, y = Math.floor(i / 5) * 220 + 55;
    const p = l.picture;
    const grid = { w: p.w, h: p.h, palette: readablePalette(p.palette, p.cells), cells: decodeCells(p) };
    const px = 176 / Math.max(p.w, p.h);
    svg += gridToSvg(grid, px).replace('<svg ', `<svg x="${x + (176 - p.w * px) / 2}" y="${y}" `);
    svg += `<text x="${x}" y="${y + 192}" font-family="sans-serif" font-size="12">${l.n} · ${esc(l.name?.en ?? p.id)}</text>`;
    svg += `<text x="${x}" y="${y + 208}" font-family="sans-serif" font-size="11" fill="#666">${l.tier} · ${l.boxes.length} boxes · ${l.stats?.critical ?? '?'} decisions</text>`;
  });
  svg += '</svg>';
  writeFileSync(`${out}/world-${world + 1}.png`, new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
}
console.log(`Verified ${levels.length} solutions. Report and contact sheets: ${out}`);
