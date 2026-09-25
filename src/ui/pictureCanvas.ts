import { decodeCells, type PictureDef } from '../core/types';

/** Draws a pixel-art picture into a canvas with small rounded "cubes". */
export function pictureCanvas(p: PictureDef, px: number, opts: { bg?: string; rounded?: boolean } = {}): HTMLCanvasElement {
  const cells = decodeCells(p);
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.max(p.w, p.h);
  const cell = Math.max(1, Math.floor((px * dpr) / size));
  c.width = p.w * cell;
  c.height = p.h * cell;
  c.style.width = `${(p.w * cell) / dpr}px`;
  c.style.height = `${(p.h * cell) / dpr}px`;
  const g = c.getContext('2d')!;
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.fillRect(0, 0, c.width, c.height);
  }
  const r = opts.rounded !== false && cell >= 5 ? cell * 0.22 : 0;
  const gap = cell >= 5 ? Math.max(0.5, cell * 0.06) : 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const v = cells[y * p.w + x];
      if (v < 0) continue;
      g.fillStyle = p.palette[v];
      if (r > 0) {
        g.beginPath();
        g.roundRect(x * cell + gap, y * cell + gap, cell - gap * 2, cell - gap * 2, r);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x * cell + gap + r * 0.5, y * cell + gap + r * 0.3, cell - gap * 2 - r, Math.max(1, cell * 0.12));
      } else g.fillRect(x * cell, y * cell, cell, cell);
    }
  return c;
}
