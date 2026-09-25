import { h, button } from './dom';
import { emoji, lineIcon } from './icons';
import { t, loc } from '../app/i18n';
import { THEMES, themeForWorld } from '../render/themes';
import { paintGround } from '../render/groundPainter';
import { pictureCanvas } from './pictureCanvas';
import { LEVELS_PER_WORLD, worldOf } from '../core/progression';
import { tierForLevel, type LevelStats, type PictureDef } from '../core/types';
import type { EmojiName } from './emoji.generated';
import { audio } from '../audio/audio';

export interface MapData {
  unlocked: number;
  stars: Record<number, number>;
  coins: number;
  total: number;
  picture(n: number): PictureDef | null;
  debug: boolean;
  stats(n: number): LevelStats | undefined;
}

export interface MapCallbacks {
  onPlay(n: number): void;
  onSettings(): void;
  onAlbum(): void;
  onDebug(): void;
}

const STEP = 112;
const BANNER = 150;
const PAD_BOTTOM = 190;
const PAD_TOP = 150;

const DECOS: EmojiName[][] = [
  ['four-leaf-clover', 'tulip', 'lady-beetle', 'sunflower', 'honeybee', 'blossom', 'butterfly', 'seedling'],
  ['mushroom', 'evergreen-tree', 'deciduous-tree', 'fallen-leaf', 'maple-leaf', 'snail', 'chestnut', 'herb'],
  ['spiral-shell', 'tropical-fish', 'palm-tree', 'crab', 'sun'],
  ['lollipop', 'candy', 'doughnut', 'cupcake', 'shortcake', 'cookie', 'ice-cream'],
  ['crescent-moon', 'ringed-planet', 'rocket', 'comet', 'shooting-star', 'glowing-star'],
  ['snowman', 'christmas-tree', 'snowflake', 'cloud-with-snow', 'wrapped-gift'],
  ['crystal-ball', 'castle', 'unicorn', 'magic-wand', 'gem-stone', 'sparkles', 'crown'],
];

const bgCache = new Map<string, string>();

function worldBackground(world: number): string {
  const theme = themeForWorld(world);
  let url = bgCache.get(theme.id);
  if (!url) {
    url = paintGround(theme, 512, 99 + world).toDataURL('image/jpeg', 0.86);
    bgCache.set(theme.id, url);
  }
  return url;
}

/** Scrollable level map: a winding ant trail through the worlds, level 1 at the bottom. */
export class MapScreen {
  readonly el: HTMLElement;
  private scroll: HTMLElement;
  private inner: HTMLElement;
  private coinsEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private debugBtn: HTMLButtonElement;
  private cb: MapCallbacks;
  private data!: MapData;
  private width = 400;
  private height = 0;

  constructor(root: HTMLElement, cb: MapCallbacks) {
    this.cb = cb;
    this.el = h('div', { class: 'map' });
    this.scroll = h('div', { class: 'map-scroll' });
    this.inner = h('div', { class: 'map-inner' });
    this.scroll.append(this.inner);
    this.coinsEl = h('span');
    const coins = h('div', { class: 'pill', html: emoji('coin', 34) }, this.coinsEl);
    const album = h('button', { class: 'btn round white', html: emoji('framed-picture', 30), attrs: { 'aria-label': t('album') } });
    album.addEventListener('click', () => {
      audio.unlock();
      audio.play('button');
      cb.onAlbum();
    });
    const settings = h('button', { class: 'btn round white', html: emoji('gear', 30), attrs: { 'aria-label': t('settings') } });
    settings.addEventListener('click', () => {
      audio.unlock();
      audio.play('button');
      cb.onSettings();
    });
    this.debugBtn = h('button', { class: 'btn round white hidden', html: emoji('lady-beetle', 30), attrs: { 'aria-label': t('debugLevels') } });
    this.debugBtn.addEventListener('click', () => {
      audio.unlock();
      audio.play('button');
      cb.onDebug();
    });
    const top = h('div', { class: 'topbar' }, coins, h('div', { class: 'right' }, this.debugBtn, album, settings));
    this.playBtn = button('', 'big green', () => this.cb.onPlay(this.data.unlocked));
    const dock = h('div', { class: 'play-dock' }, this.playBtn);
    this.el.append(this.scroll, top, dock);
    root.append(this.el);
  }

  show(data: MapData): void {
    this.data = data;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  refreshTop(): void {
    this.coinsEl.textContent = String(this.data.coins);
  }

  /** Y (from the top of the inner area) of a level node. */
  private nodeY(n: number): number {
    const w = worldOf(n);
    const fromBottom = PAD_BOTTOM + (n - 1) * STEP + (w + 1) * BANNER - BANNER * 0.5;
    return this.height - fromBottom;
  }

  private nodeX(n: number): number {
    const amp = Math.min(120, this.width * 0.28);
    return this.width / 2 + Math.sin(n * 0.85) * amp + Math.sin(n * 0.31) * amp * 0.25;
  }

  render(): void {
    const d = this.data;
    this.refreshTop();
    this.debugBtn.classList.toggle('hidden', !d.debug);
    this.playBtn.innerHTML = `${lineIcon('play', 26)} ${t('level', { n: d.unlocked })}`;
    const shown = d.debug ? Math.max(d.total, d.unlocked + 6) : Math.max(d.unlocked + 6, Math.min(d.total, LEVELS_PER_WORLD));
    const worlds = worldOf(shown) + 1;
    const levels = Math.min(worlds * LEVELS_PER_WORLD, Math.max(shown, 1));
    this.width = Math.min(520, window.innerWidth);
    this.height = PAD_BOTTOM + levels * STEP + worlds * BANNER + PAD_TOP;
    const inner = this.inner;
    inner.innerHTML = '';
    inner.style.width = this.width + 'px';
    inner.style.height = this.height + 'px';
    this.el.style.background = themeForWorld(worldOf(d.unlocked)).bg;

    // World backgrounds (full screen width).
    for (let w = 0; w < worlds; w++) {
      const first = w * LEVELS_PER_WORLD + 1;
      const last = (w + 1) * LEVELS_PER_WORLD;
      const top = w === worlds - 1 ? 0 : this.nodeY(last) - STEP / 2 - BANNER * 0.5;
      const bottom = w === 0 ? this.height : this.nodeY(first) + STEP / 2 + BANNER * 0.5;
      const bg = h('div', { class: 'world-bg' });
      bg.style.top = top + 'px';
      bg.style.height = bottom - top + 'px';
      bg.style.left = `calc(50% - 50vw)`;
      bg.style.width = '100vw';
      bg.style.backgroundImage = `url(${worldBackground(w)})`;
      bg.style.backgroundColor = themeForWorld(w).ground.base;
      inner.append(bg);
      if (w > 0) {
        const fade = h('div', { class: 'world-fade' });
        fade.style.top = bottom - 80 + 'px';
        fade.style.left = `calc(50% - 50vw)`;
        fade.style.width = '100vw';
        fade.style.background = `linear-gradient(180deg, ${themeForWorld(w).ground.base}00, ${themeForWorld(w).ground.base}cc 50%, ${themeForWorld(w - 1).ground.base}00)`;
        inner.append(fade);
      }
      // banner
      const th = THEMES[w % THEMES.length];
      const endless = first > d.total && d.total > 0;
      const banner = h('div', {
        class: 'world-banner',
        html: `<small>${t('world', { n: w + 1 })}${endless ? ' · ∞' : ''}</small>${endless ? t('endless') : loc(th.name)}`,
      });
      banner.style.top = this.nodeY(first) + STEP * 0.5 + 18 + 'px';
      banner.style.background = `linear-gradient(180deg, ${th.ui.accent}, ${shade(th.ui.accent, -0.18)})`;
      inner.append(banner);
      // decorations
      const decos = DECOS[w % DECOS.length];
      for (let i = 0; i < 9; i++) {
        const n = first + Math.floor((i + 0.5) * (LEVELS_PER_WORLD / 9));
        const y = this.nodeY(n) + ((i * 37) % 60) - 30;
        const x = this.nodeX(n);
        const side = x > this.width / 2 ? -1 : 1;
        const dx = this.width / 2 + side * (this.width * 0.36 + ((i * 53) % 40));
        const size = 38 + ((i * 29) % 26);
        const el = h('div', { class: 'deco', html: emoji(decos[i % decos.length], size) });
        el.style.left = dx - size / 2 + 'px';
        el.style.top = y - size / 2 + 'px';
        el.style.transform = `rotate(${((i * 47) % 40) - 20}deg)`;
        inner.append(el);
      }
    }

    // Trail
    const pts: [number, number][] = [];
    for (let n = 1; n <= levels; n++) pts.push([this.nodeX(n), this.nodeY(n)]);
    const path = smoothPath(pts);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('trail');
    svg.setAttribute('width', String(this.width));
    svg.setAttribute('height', String(this.height));
    svg.innerHTML =
      `<path d="${path}" fill="none" stroke="rgba(90,60,30,0.25)" stroke-width="34" stroke-linecap="round" transform="translate(0 4)"/>` +
      `<path d="${path}" fill="none" stroke="#fff4dc" stroke-opacity="0.92" stroke-width="30" stroke-linecap="round"/>` +
      `<path d="${path}" fill="none" stroke="#c7a57a" stroke-opacity="0.55" stroke-width="5" stroke-dasharray="2 14" stroke-linecap="round"/>`;
    inner.append(svg);

    // Nodes
    for (let n = 1; n <= levels; n++) {
      const tier = tierForLevel(n);
      const done = (d.stars[n] ?? 0) > 0;
      const current = n === d.unlocked;
      const locked = n > d.unlocked && !d.debug;
      const node = h('button', {
        class: `node ${tier}` + (done ? ' done' : '') + (current ? ' current' : '') + (locked ? ' locked' : ''),
        attrs: { 'aria-label': t('level', { n }) },
      });
      node.style.left = this.nodeX(n) + 'px';
      node.style.top = this.nodeY(n) + 'px';
      const pic = done ? d.picture(n) : null;
      if (pic) {
        const c = pictureCanvas(pic, 44, { rounded: false });
        c.className = 'thumb';
        node.append(c, h('span', { class: 'num-small', text: String(n) }));
      } else node.append(String(n));
      if (done) {
        const s = d.stars[n];
        node.append(h('span', { class: 'nstars', html: [1, 2, 3].map((k) => emoji('star', 20, k <= s ? '' : 'off')).join('') }));
      }
      if (!locked && tier !== 'normal') node.append(h('span', { class: 'badge', html: emoji(tier === 'superhard' ? 'skull' : 'fire', 26) }));
      if (locked && n === d.unlocked + 1) node.append(h('span', { class: 'lockico', html: emoji('locked', 22) }));
      if (d.debug) {
        const st = d.stats(n);
        if (st) node.append(h('span', { class: 'dbg', text: `c${Math.round(st.casual * 100)} g${Math.round(st.greedy * 100)} 🧠${st.critical ?? '?'}` }));
      }
      node.addEventListener('click', () => {
        audio.unlock();
        if (locked) {
          audio.play('invalid');
          node.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
          return;
        }
        audio.play('button');
        this.cb.onPlay(n);
      });
      inner.append(node);
      if (current) {
        const ant = h('div', { class: 'map-ant', html: emoji('ant', 50) });
        ant.style.left = this.nodeX(n) + 'px';
        ant.style.top = this.nodeY(n) + 'px';
        inner.append(ant);
      }
    }
    requestAnimationFrame(() => {
      this.scroll.scrollTop = this.nodeY(d.unlocked) - this.scroll.clientHeight * 0.55;
    });
  }
}

function smoothPath(p: [number, number][]): string {
  if (p.length < 2) return '';
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
