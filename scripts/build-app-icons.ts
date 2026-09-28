/**
 * Generate app icons from the shared basket logo in public/logo.svg.
 * Run: bun scripts/build-app-icons.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const publicFile = (name: string) => new URL(`../public/${name}`, import.meta.url);
const logo = readFileSync(publicFile('logo.svg'), 'utf8');

function iconSvg(size: number, shape: 'rounded' | 'square' | 'maskable'): string {
  let svg = logo.replace(/(<svg\b[^>]*\bwidth=")\d+(" height=")\d+("[^>]*>)/,
    (_, before, between, after) => `${before}${size}${between}${size}${after}`);
  if (shape !== 'rounded') {
    // Apple and Android apply their own mask, so the background fills every corner.
    svg = svg.replace(/(<rect\b[^>]*id="icon-background"[^>]*\brx=")[^"]*(")/,
      (_, before, after) => `${before}0${after}`);
  }
  if (shape === 'maskable') {
    // Keep the basket inside the central 80% safe circle used by launcher masks.
    svg = svg.replace('<g id="icon-art">', '<g id="icon-art" transform="translate(6.4 6.4) scale(.9)">');
  }
  return svg;
}

function png(svg: string, size: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

writeFileSync(publicFile('apple-touch-icon.png'), png(iconSvg(180, 'square'), 180));
writeFileSync(publicFile('icon-192.png'), png(iconSvg(192, 'rounded'), 192));
writeFileSync(publicFile('icon-512.png'), png(iconSvg(512, 'rounded'), 512));
writeFileSync(publicFile('icon-maskable-512.png'), png(iconSvg(512, 'maskable'), 512));
writeFileSync(publicFile('favicon.svg'), iconSvg(64, 'rounded'));
console.log('icons written');

// Social preview: reuse the desktop screenshot if present (docs/desktop.jpg), cropped by the browser.
try {
  readFileSync('docs/desktop.jpg');
  console.log('social preview: use docs/desktop.jpg -> public/og.jpg (copied separately)');
} catch {
  /* optional */
}
