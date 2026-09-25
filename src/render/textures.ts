import * as THREE from 'three';

export const FONT = '"Nunito Variable", "Nunito", system-ui, sans-serif';

export async function loadFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`900 64px ${FONT}`), document.fonts.load(`800 32px ${FONT}`)]);
  } catch {
    /* fall back to system font */
  }
}

/** A small canvas texture with a big outlined number (or glyph), redrawn on demand. */
export class LabelTexture {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private last = '';

  constructor(size = 128) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  draw(text: string, opts: { fill?: string; stroke?: string; scale?: number } = {}): void {
    const key = text + (opts.fill ?? '') + (opts.stroke ?? '') + (opts.scale ?? 1);
    if (key === this.last) return;
    this.last = key;
    const { ctx, canvas } = this;
    const s = canvas.width;
    ctx.clearRect(0, 0, s, s);
    if (!text) {
      this.texture.needsUpdate = true;
      return;
    }
    const len = text.length;
    const fontSize = s * (len >= 3 ? 0.46 : len === 2 ? 0.58 : 0.66) * (opts.scale ?? 1);
    ctx.font = `900 ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = s * 0.54;
    ctx.lineJoin = 'round';
    ctx.lineWidth = fontSize * 0.2;
    ctx.strokeStyle = opts.stroke ?? 'rgba(38, 28, 60, 0.92)';
    ctx.strokeText(text, s / 2, y);
    ctx.fillStyle = opts.fill ?? '#ffffff';
    ctx.fillText(text, s / 2, y);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Soft radial blob used for shadows, glows and particles. */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Four-point sparkle star texture. */
export function sparkleTexture(size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(m, 0);
  g.quadraticCurveTo(m, m, size, m);
  g.quadraticCurveTo(m, m, m, size);
  g.quadraticCurveTo(m, m, 0, m);
  g.quadraticCurveTo(m, m, m, 0);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dashed "mystery" pattern for hidden boxes. */
export function mysteryTexture(size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8f8aa3';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = size * 0.06;
  for (let i = -size; i < size * 2; i += size * 0.22) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + size, size);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
