import * as THREE from 'three';
import { FONT } from './textures';

export interface DigitStyle {
  fill: string;
  stroke: string;
  shadow: string;
}

const GLYPHS = '0123456789+?';
const FONT_SCALE = 0.6;
const BASELINE = 0.53;

export interface DigitMetrics {
  widths: ReadonlyMap<string, number>;
  kerning: ReadonlyMap<string, number>;
  size: number;
}

/** Glyph centres in the same unit square previously occupied by a 128px label canvas. */
export function layoutDigits(text: string, metrics: DigitMetrics): { glyphs: { char: string; x: number }[]; scale: number; y: number } {
  const scale = (text.length >= 3 ? 0.42 : text.length === 2 ? 0.52 : FONT_SCALE) / FONT_SCALE;
  let width = 0;
  const glyphs: { char: string; x: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const advance = metrics.widths.get(char);
    if (advance === undefined) throw new Error(`Unsupported digit-label character: ${char}`);
    if (i) width += metrics.kerning.get(text[i - 1] + char) ?? 0;
    glyphs.push({ char, x: width + advance / 2 });
    width += advance;
  }
  for (const glyph of glyphs) glyph.x = (glyph.x - width / 2) * scale / metrics.size;
  // Scale around the text baseline, keeping its original slight downward offset.
  return { glyphs, scale, y: (0.5 - BASELINE) * (1 - scale) };
}

/** Created after loadFonts, painted once per level, and shared by all live box counters. */
export class DigitAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly metrics: DigitMetrics;
  private readonly styleIds = new Map<string, number>();
  private readonly columns: number;
  private readonly rows: number;

  constructor(styles: readonly DigitStyle[], size = 128) {
    const unique: DigitStyle[] = [];
    for (const style of styles) {
      const key = JSON.stringify(style);
      if (this.styleIds.has(key)) continue;
      this.styleIds.set(key, unique.length);
      unique.push(style);
    }
    if (!unique.length) throw new Error('A digit atlas needs at least one style');
    const count = unique.length * GLYPHS.length;
    this.columns = Math.min(16, Math.ceil(Math.sqrt(count)));
    this.rows = Math.ceil(count / this.columns);
    const canvas = document.createElement('canvas');
    canvas.width = this.columns * size;
    canvas.height = this.rows * size;
    const ctx = canvas.getContext('2d')!;
    const fontSize = size * FONT_SCALE;
    ctx.font = `900 ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.09;

    const widths = new Map<string, number>();
    const kerning = new Map<string, number>();
    for (const char of GLYPHS) widths.set(char, ctx.measureText(char).width);
    for (const left of GLYPHS) {
      for (const right of GLYPHS) {
        kerning.set(left + right, ctx.measureText(left + right).width - widths.get(left)! - widths.get(right)!);
      }
    }
    this.metrics = { widths, kerning, size };

    unique.forEach((style, styleId) => {
      for (let glyph = 0; glyph < GLYPHS.length; glyph++) {
        const tile = styleId * GLYPHS.length + glyph;
        const x = (tile % this.columns + 0.5) * size;
        const y = (Math.floor(tile / this.columns) + BASELINE) * size;
        const char = GLYPHS[glyph];
        ctx.fillStyle = style.shadow;
        ctx.fillText(char, x, y + fontSize * 0.07);
        ctx.strokeStyle = style.stroke;
        ctx.strokeText(char, x, y);
        ctx.fillStyle = style.fill;
        ctx.fillText(char, x, y);
      }
    });
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  styleId(style: DigitStyle): number {
    const id = this.styleIds.get(JSON.stringify(style));
    if (id === undefined) throw new Error('Digit-label styles must be prepared before the level starts');
    return id;
  }

  /** Normalized atlas rectangle. Transparent space inside each cell separates mip levels. */
  uv(char: string, style: number): { left: number; right: number; top: number; bottom: number } {
    const glyph = GLYPHS.indexOf(char);
    if (glyph < 0 || style < 0 || style >= this.styleIds.size) throw new Error('Unknown atlas glyph or style');
    const tile = style * GLYPHS.length + glyph;
    const column = tile % this.columns, row = Math.floor(tile / this.columns);
    return { left: column / this.columns, right: (column + 1) / this.columns,
      top: 1 - row / this.rows, bottom: 1 - (row + 1) / this.rows };
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** One mesh per count, with every digit in the same geometry and material draw call. */
export class DigitLabel {
  readonly geometry = new THREE.BufferGeometry();
  private lastText = '';
  private lastStyle = -1;
  private capacity = 0;

  constructor(private readonly atlas: DigitAtlas) {
    this.allocate(4);
    this.geometry.setDrawRange(0, 0);
  }

  private allocate(capacity: number): void {
    this.capacity = capacity;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(capacity * 8), 2).setUsage(THREE.DynamicDrawUsage));
    const normals = new Float32Array(capacity * 12);
    const indices: number[] = [];
    for (let i = 0; i < capacity; i++) {
      for (let vertex = 0; vertex < 4; vertex++) normals[i * 12 + vertex * 3 + 2] = 1;
      const k = i * 4;
      indices.push(k, k + 2, k + 1, k + 2, k + 3, k + 1);
    }
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setIndex(indices);
  }

  draw(text: string, style: number): void {
    if (text === this.lastText && style === this.lastStyle) return;
    const layout = layoutDigits(text, this.atlas.metrics);
    if (text.length > this.capacity) this.allocate(text.length);
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uvs = this.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const half = layout.scale / 2;
    layout.glyphs.forEach((glyph, i) => {
      const uv = this.atlas.uv(glyph.char, style);
      const k = i * 4;
      positions.setXYZ(k, glyph.x - half, layout.y + half, 0);
      positions.setXYZ(k + 1, glyph.x + half, layout.y + half, 0);
      positions.setXYZ(k + 2, glyph.x - half, layout.y - half, 0);
      positions.setXYZ(k + 3, glyph.x + half, layout.y - half, 0);
      uvs.setXY(k, uv.left, uv.top);
      uvs.setXY(k + 1, uv.right, uv.top);
      uvs.setXY(k + 2, uv.left, uv.bottom);
      uvs.setXY(k + 3, uv.right, uv.bottom);
    });
    positions.needsUpdate = true;
    uvs.needsUpdate = true;
    this.geometry.setDrawRange(0, text.length * 6);
    this.geometry.computeBoundingSphere();
    this.lastText = text;
    this.lastStyle = style;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
