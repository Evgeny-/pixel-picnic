import { Rng } from '../core/rng';
import type { WorldTheme } from './themes';

type Ctx = CanvasRenderingContext2D;

/** Draw something at (x, y) and at wrapped copies near the edges, so the texture tiles. */
function wrap(size: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [0, -size, size]) {
    if (dx !== 0 && (dx < 0 ? x < size - r : x > r)) continue;
    for (const dy of [0, -size, size]) {
      if (dy !== 0 && (dy < 0 ? y < size - r : y > r)) continue;
      fn(x + dx, y + dy);
    }
  }
}

function blobs(g: Ctx, rng: Rng, size: number, colors: string[], n: number, rMin: number, rMax: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = rng.range(rMin, rMax);
    const c = rng.pick(colors);
    wrap(size, x, y, r, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, hexA(c, alpha));
      grad.addColorStop(1, hexA(c, 0));
      g.fillStyle = grad;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function blades(g: Ctx, rng: Rng, size: number, colors: string[], n: number, len: [number, number], width: [number, number], dir = -Math.PI / 2, spread = 1.1): void {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const a = dir + (rng.next() - 0.5) * spread * 2;
    const l = rng.range(len[0], len[1]);
    const bend = (rng.next() - 0.5) * l * 0.6;
    g.strokeStyle = rng.pick(colors);
    g.globalAlpha = rng.range(0.55, 0.95);
    g.lineWidth = rng.range(width[0], width[1]);
    wrap(size, x, y, l + 2, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      const ex = px + Math.cos(a) * l;
      const ey = py + Math.sin(a) * l;
      g.quadraticCurveTo((px + ex) / 2 + bend, (py + ey) / 2, ex, ey);
      g.stroke();
    });
  }
  g.globalAlpha = 1;
}

function shadowed(g: Ctx, fn: () => void, blur = 4, oy = 2, color = 'rgba(0,0,0,0.22)'): void {
  g.save();
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.shadowOffsetY = oy;
  fn();
  g.restore();
}

function flower(g: Ctx, x: number, y: number, r: number, petal: string, center: string, petals = 5, rot = 0): void {
  shadowed(g, () => {
    g.fillStyle = petal;
    for (let i = 0; i < petals; i++) {
      const a = rot + (i / petals) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r * 0.75, r * 0.55, a, 0, Math.PI * 2);
      g.fill();
    }
  });
  g.fillStyle = center;
  g.beginPath();
  g.arc(x, y, r * 0.5, 0, Math.PI * 2);
  g.fill();
}

function clover(g: Ctx, x: number, y: number, r: number, color: string, rot: number): void {
  g.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * Math.PI * 2;
    g.beginPath();
    g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r, 0, Math.PI * 2);
    g.fill();
  }
}

function pebble(g: Ctx, x: number, y: number, r: number, color: string, rng: Rng): void {
  shadowed(g, () => {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, r, r * rng.range(0.6, 0.9), rng.next() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }, 3, 2);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.2, -0.6, 0, Math.PI * 2);
  g.fill();
}

function leaf(g: Ctx, x: number, y: number, len: number, color: string, rot: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  shadowed(g, () => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(0, -len * 0.42, len / 2, 0);
    g.quadraticCurveTo(0, len * 0.42, -len / 2, 0);
    g.fill();
  }, 5, 3);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = Math.max(1, len * 0.04);
  g.beginPath();
  g.moveTo(-len / 2, 0);
  g.lineTo(len / 2, 0);
  g.stroke();
  g.restore();
}

function sparkle(g: Ctx, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
}

function glowDot(g: Ctx, x: number, y: number, r: number, color: string): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r * 4);
  grad.addColorStop(0, hexA(color, 0.9));
  grad.addColorStop(0.25, hexA(color, 0.35));
  grad.addColorStop(1, hexA(color, 0));
  g.fillStyle = grad;
  g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x, y, r * 0.6, 0, Math.PI * 2);
  g.fill();
}

function scatter(size: number, rng: Rng, n: number, r: number, fn: (x: number, y: number) => void): void {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    wrap(size, x, y, r, fn);
  }
}

/** Paints a seamless top-down ground texture for a world theme. */
export function paintGround(theme: WorldTheme, size = 1024, seed = 7): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rng = new Rng(seed);
  const gr = theme.ground;
  const k = size / 1024;
  g.fillStyle = gr.base;
  g.fillRect(0, 0, size, size);
  blobs(g, rng, size, gr.tints, 70, 90 * k, 260 * k, 0.45);
  blobs(g, rng, size, gr.tints, 160, 25 * k, 70 * k, 0.35);

  switch (gr.kind) {
    case 'grass': {
      blades(g, rng, size, gr.detail, 14000, [7 * k, 15 * k], [1.4 * k, 2.8 * k]);
      scatter(size, rng, 70, 20 * k, (x, y) => clover(g, x, y, rng.range(4, 6.5) * k, rng.pick(['#6fb34a', '#5ea43f', '#7fc257']), rng.next() * 6));
      blades(g, rng, size, gr.detail, 3000, [6 * k, 12 * k], [1.2 * k, 2.2 * k]);
      scatter(size, rng, 34, 18 * k, (x, y) => flower(g, x, y, rng.range(4.5, 7) * k, rng.pick(gr.accents), '#ffd23f', 5, rng.next() * 6));
      scatter(size, rng, 14, 16 * k, (x, y) => pebble(g, x, y, rng.range(5, 10) * k, rng.pick(['#bfb6a8', '#a89f90', '#d2cabc']), rng));
      break;
    }
    case 'forest': {
      blades(g, rng, size, gr.detail, 9000, [5 * k, 11 * k], [1.2 * k, 2.4 * k], 0, Math.PI);
      scatter(size, rng, 90, 30 * k, (x, y) => leaf(g, x, y, rng.range(18, 34) * k, rng.pick(gr.accents), rng.next() * 6));
      g.strokeStyle = '#6b4a2b';
      g.lineWidth = 1.2 * k;
      scatter(size, rng, 260, 14 * k, (x, y) => {
        const a = rng.next() * 6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * 12 * k, y + Math.sin(a) * 12 * k);
        g.stroke();
      });
      scatter(size, rng, 12, 16 * k, (x, y) => {
        const r = rng.range(7, 11) * k;
        shadowed(g, () => {
          g.fillStyle = '#d64933';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        });
        g.fillStyle = '#fff4e6';
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.arc(x + rng.range(-r * 0.5, r * 0.5), y + rng.range(-r * 0.5, r * 0.5), r * 0.18, 0, Math.PI * 2);
          g.fill();
        }
      });
      scatter(size, rng, 18, 14 * k, (x, y) => pebble(g, x, y, rng.range(5, 9) * k, rng.pick(['#8b8f7a', '#9aa08a']), rng));
      break;
    }
    case 'sand': {
      // Short, shaded wind ridges instead of bright lines spanning the texture:
      // full-width highlights read as water once the sunlight washes them out.
      for (let i = 0; i < 32; i++) {
        const x = rng.next() * size;
        const y = rng.next() * size;
        const length = rng.range(95, 230) * k;
        const depth = rng.range(8, 21) * k;
        const bend = rng.range(9, 27) * k;
        const angle = rng.range(-0.42, -0.12);
        wrap(size, x, y, length * 0.6, (px, py) => {
          g.save();
          g.translate(px, py);
          g.rotate(angle);
          const shade = g.createLinearGradient(0, -bend, 0, depth);
          shade.addColorStop(0, hexA('#a78855', 0.22));
          shade.addColorStop(0.5, hexA('#b59662', 0.11));
          shade.addColorStop(1, hexA('#b59662', 0));
          g.fillStyle = shade;
          g.beginPath();
          g.moveTo(-length / 2, 0);
          g.bezierCurveTo(-length * 0.25, -bend, length * 0.18, -bend, length / 2, 0);
          g.bezierCurveTo(length * 0.18, depth, -length * 0.2, depth, -length / 2, 0);
          g.fill();
          g.strokeStyle = hexA('#fff0cc', 0.32);
          g.lineWidth = 1.8 * k;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(-length * 0.4, -1.5 * k);
          g.bezierCurveTo(-length * 0.2, -bend - k, length * 0.13, -bend - k, length * 0.4, -1.5 * k);
          g.stroke();
          g.restore();
        });
      }
      // Two grain scales survive texture minification on a phone: fine warm
      // grains make the surface dry, sparse larger flecks keep it from blurring.
      for (let i = 0; i < 31000; i++) {
        const x = rng.next() * size;
        const y = rng.next() * size;
        const r = rng.range(0.65, 1.8) * k;
        const color = rng.pick(gr.detail);
        g.fillStyle = color;
        g.globalAlpha = rng.range(0.2, 0.55);
        wrap(size, x, y, r * 2, (px, py) => g.fillRect(px, py, r, r * 0.8));
      }
      for (let i = 0; i < 1900; i++) {
        const x = rng.next() * size;
        const y = rng.next() * size;
        const r = rng.range(1.6, 3.1) * k;
        const color = rng.pick(['#a98c5b', '#c0a675', '#ead3ab', '#f3e2c0']);
        g.fillStyle = color;
        g.globalAlpha = rng.range(0.22, 0.4);
        wrap(size, x, y, r * 2, (px, py) => {
          g.beginPath();
          g.ellipse(px, py, r, r * 0.65, -0.25, 0, Math.PI * 2);
          g.fill();
        });
      }
      g.globalAlpha = 1;
      scatter(size, rng, 12, 12 * k, (x, y) => pebble(g, x, y, rng.range(3, 6) * k, rng.pick(['#b4a084', '#cfb89a', '#e3ceb0']), rng));
      scatter(size, rng, 16, 20 * k, (x, y) => {
        const r = rng.range(8, 13) * k;
        const rot = rng.next() * 6;
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        shadowed(g, () => {
          g.fillStyle = rng.pick(gr.accents);
          g.beginPath();
          g.moveTo(0, r * 0.6);
          g.arc(0, 0, r, Math.PI * 1.1, Math.PI * 1.9);
          g.closePath();
          g.fill();
        });
        g.strokeStyle = 'rgba(160,110,80,0.4)';
        g.lineWidth = 1.2 * k;
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (1.15 + i * 0.17);
          g.beginPath();
          g.moveTo(0, r * 0.55);
          g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
          g.stroke();
        }
        g.restore();
      });
      scatter(size, rng, 6, 20 * k, (x, y) => {
        const r = rng.range(10, 15) * k;
        g.save();
        g.translate(x, y);
        g.rotate(rng.next() * 6);
        shadowed(g, () => {
          g.fillStyle = '#ff8c69';
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const rr = i % 2 === 0 ? r : r * 0.42;
            g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          g.closePath();
          g.fill();
        });
        g.restore();
      });
      break;
    }
    case 'frosting': {
      g.strokeStyle = hexA('#ffffff', 0.35);
      g.lineWidth = 10 * k;
      g.lineCap = 'round';
      for (let i = 0; i < 40; i++) {
        const x = rng.next() * size;
        const y = rng.next() * size;
        const r = rng.range(30, 70) * k;
        g.beginPath();
        g.arc(x, y, r, rng.next() * 6, rng.next() * 6 + 2.5);
        g.stroke();
      }
      scatter(size, rng, 700, 8 * k, (x, y) => {
        g.save();
        g.translate(x, y);
        g.rotate(rng.next() * Math.PI);
        g.fillStyle = rng.pick(gr.accents);
        const l = rng.range(7, 11) * k;
        const w = 2.6 * k;
        g.beginPath();
        g.roundRect(-l / 2, -w / 2, l, w, w / 2);
        g.fill();
        g.restore();
      });
      scatter(size, rng, 60, 8 * k, (x, y) => {
        const r = rng.range(3, 5) * k;
        shadowed(g, () => {
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }, 3, 1);
      });
      break;
    }
    case 'night': {
      blades(g, rng, size, gr.detail, 9000, [6 * k, 13 * k], [1.3 * k, 2.4 * k]);
      scatter(size, rng, 50, 16 * k, (x, y) => glowDot(g, x, y, rng.range(1.5, 3) * k, rng.pick(gr.accents)));
      scatter(size, rng, 30, 10 * k, (x, y) => sparkle(g, x, y, rng.range(3, 6) * k, hexA('#fff7c2', 0.7)));
      scatter(size, rng, 10, 14 * k, (x, y) => pebble(g, x, y, rng.range(5, 9) * k, '#46507a', rng));
      break;
    }
    case 'snow': {
      blobs(g, rng, size, ['#c9dcef', '#ffffff'], 50, 30 * k, 90 * k, 0.5);
      scatter(size, rng, 160, 8 * k, (x, y) => sparkle(g, x, y, rng.range(2, 4.5) * k, hexA('#ffffff', 0.95)));
      scatter(size, rng, 10, 12 * k, (x, y) => {
        g.fillStyle = hexA('#9fbad3', 0.35);
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.ellipse(x + i * 14 * k, y + (i % 2) * 9 * k, 3.5 * k, 5 * k, 0.3, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    }
    case 'magic': {
      blades(g, rng, size, gr.detail, 11000, [6 * k, 13 * k], [1.3 * k, 2.5 * k]);
      scatter(size, rng, 40, 18 * k, (x, y) => flower(g, x, y, rng.range(4, 6) * k, rng.pick(gr.accents), '#ffffff', 6, rng.next() * 6));
      scatter(size, rng, 26, 16 * k, (x, y) => {
        const r = rng.range(5, 9) * k;
        shadowed(g, () => {
          g.fillStyle = rng.pick(['#bdf4ff', '#ffc6ff', '#fff3b0']);
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 1.3);
          }
          g.closePath();
          g.fill();
        });
      });
      scatter(size, rng, 60, 10 * k, (x, y) => sparkle(g, x, y, rng.range(2, 5) * k, hexA('#ffffff', 0.85)));
      break;
    }
  }
  return c;
}
