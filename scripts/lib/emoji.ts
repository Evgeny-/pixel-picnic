/**
 * Emoji sources (Iconify JSON sets) → SVG strings → straight-alpha RGBA rasters.
 *
 * Sources:
 *  - Microsoft Fluent Emoji Flat (MIT)      @iconify-json/fluent-emoji-flat, 32x32 viewBox
 *  - Twemoji (CC BY 4.0)                    @iconify-json/twemoji,           36x36 viewBox
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';

export type EmojiSource = 'fluent' | 'twemoji';

export const SOURCE_INFO: Record<EmojiSource, { title: string; license: string; url: string; author: string }> = {
  fluent: {
    title: 'Fluent Emoji Flat',
    license: 'MIT',
    url: 'https://github.com/microsoft/fluentui-emoji',
    author: 'Microsoft Corporation',
  },
  twemoji: {
    title: 'Twemoji',
    license: 'CC BY 4.0',
    url: 'https://github.com/jdecked/twemoji',
    author: 'Twitter, Inc and other contributors',
  },
};

const PACKAGE: Record<EmojiSource, string> = {
  fluent: '@iconify-json/fluent-emoji-flat/icons.json',
  twemoji: '@iconify-json/twemoji/icons.json',
};

interface IconifyIcon {
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  hidden?: boolean;
  hFlip?: boolean;
  vFlip?: boolean;
  rotate?: number;
}
interface IconifyAlias extends Omit<IconifyIcon, 'body'> {
  parent: string;
}
interface IconifySet {
  prefix: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, IconifyAlias>;
}

const require = createRequire(import.meta.url);
const sets = new Map<EmojiSource, IconifySet>();

function loadSet(source: EmojiSource): IconifySet {
  let set = sets.get(source);
  if (!set) {
    const file = require.resolve(PACKAGE[source]);
    set = JSON.parse(readFileSync(file, 'utf8')) as IconifySet;
    sets.set(source, set);
  }
  return set;
}

interface ResolvedIcon {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
  hFlip: boolean;
  vFlip: boolean;
  rotate: number;
}

function resolveIcon(source: EmojiSource, icon: string): ResolvedIcon | null {
  const set = loadSet(source);
  let name = icon;
  let hFlip = false;
  let vFlip = false;
  let rotate = 0;
  const overrides: Partial<Pick<IconifyIcon, 'width' | 'height' | 'left' | 'top'>> = {};
  // Follow alias chain (guard against cycles). Transformations compose; the
  // outermost alias wins for explicit dimensions.
  for (let depth = 0; depth < 8; depth++) {
    const direct = set.icons[name];
    if (direct) {
      const width = overrides.width ?? direct.width ?? set.width ?? 16;
      const height = overrides.height ?? direct.height ?? set.height ?? 16;
      return {
        body: direct.body,
        left: overrides.left ?? direct.left ?? set.left ?? 0,
        top: overrides.top ?? direct.top ?? set.top ?? 0,
        width,
        height,
        hFlip: hFlip !== !!direct.hFlip,
        vFlip: vFlip !== !!direct.vFlip,
        rotate: (rotate + (direct.rotate ?? 0)) % 4,
      };
    }
    const alias = set.aliases?.[name];
    if (!alias) return null;
    if (alias.hFlip) hFlip = !hFlip;
    if (alias.vFlip) vFlip = !vFlip;
    if (alias.rotate) rotate += alias.rotate;
    for (const k of ['width', 'height', 'left', 'top'] as const) {
      if (alias[k] !== undefined && overrides[k] === undefined) overrides[k] = alias[k];
    }
    name = alias.parent;
  }
  return null;
}

export function hasEmoji(source: EmojiSource, icon: string): boolean {
  return resolveIcon(source, icon) !== null;
}

/** Standalone SVG document for an icon (aliases and flips resolved). Throws if missing. */
export function emojiSvg(source: EmojiSource, icon: string): string {
  const r = resolveIcon(source, icon);
  if (!r) throw new Error(`Emoji "${icon}" not found in ${source}`);
  let { body } = r;
  const { left, top, width, height } = r;
  const transforms: string[] = [];
  if (r.hFlip) transforms.push(`translate(${2 * left + width} 0) scale(-1 1)`);
  if (r.vFlip) transforms.push(`translate(0 ${2 * top + height}) scale(1 -1)`);
  if (r.rotate) transforms.push(`rotate(${r.rotate * 90} ${left + width / 2} ${top + height / 2})`);
  if (transforms.length) body = `<g transform="${transforms.join(' ')}">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${body}</svg>`;
}

/**
 * Rasterize an emoji into a square `size`x`size` straight-alpha RGBA image.
 * Non-square icons are centered inside a square box.
 */
export function renderEmojiRGBA(
  source: EmojiSource,
  icon: string,
  size: number,
): { width: number; height: number; data: Uint8Array } {
  const r = resolveIcon(source, icon);
  if (!r) throw new Error(`Emoji "${icon}" not found in ${source}`);
  // Square-ify the viewBox so the output is always size x size.
  const side = Math.max(r.width, r.height);
  const vbLeft = r.left - (side - r.width) / 2;
  const vbTop = r.top - (side - r.height) / 2;
  const svg = emojiSvg(source, icon).replace(
    /width="[^"]*" height="[^"]*" viewBox="[^"]*"/,
    `width="${side}" height="${side}" viewBox="${vbLeft} ${vbTop} ${side} ${side}"`,
  );
  const img = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
    shapeRendering: 2,
  }).render();
  const w = img.width;
  const h = img.height;
  const src = img.pixels;
  const data = new Uint8Array(w * h * 4);
  // resvg returns premultiplied RGBA → convert to straight alpha.
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = src[i + 3];
    if (a === 0) continue;
    if (a === 255) {
      data[i] = src[i];
      data[i + 1] = src[i + 1];
      data[i + 2] = src[i + 2];
    } else {
      data[i] = Math.min(255, Math.round((src[i] * 255) / a));
      data[i + 1] = Math.min(255, Math.round((src[i + 1] * 255) / a));
      data[i + 2] = Math.min(255, Math.round((src[i + 2] * 255) / a));
    }
    data[i + 3] = a;
  }
  return { width: w, height: h, data };
}

/** All icon names (including aliases) of a source; handy for curation tooling. */
export function listEmoji(source: EmojiSource): string[] {
  const set = loadSet(source);
  return [...Object.keys(set.icons), ...Object.keys(set.aliases ?? {})];
}
