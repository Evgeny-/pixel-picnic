/**
 * App icons (home screen / manifest) and the social preview image.
 * Run: bun scripts/build-app-icons.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { emojiSvg } from './lib/emoji';

const ant = emojiSvg('fluent', 'ant').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

function iconSvg(size: number, rounded: boolean): string {
  const r = rounded ? size * 0.22 : 0;
  const pad = size * 0.16;
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6e27a"/><stop offset="1" stop-color="#5fb83f"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="0 0 32 32">${ant}</svg>
</svg>`;
}

function png(svg: string, size: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

writeFileSync('public/apple-touch-icon.png', png(iconSvg(180, false), 180));
writeFileSync('public/icon-192.png', png(iconSvg(192, true), 192));
writeFileSync('public/icon-512.png', png(iconSvg(512, true), 512));
writeFileSync('public/favicon.svg', iconSvg(64, true));
console.log('icons written');

// Social preview: reuse the desktop screenshot if present (docs/desktop.jpg), cropped by the browser.
try {
  readFileSync('docs/desktop.jpg');
  console.log('social preview: use docs/desktop.jpg -> public/og.jpg (copied separately)');
} catch {
  /* optional */
}
