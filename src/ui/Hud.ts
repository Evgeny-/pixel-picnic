import { h } from './dom';
import { emoji, lineIcon } from './icons';
import { t } from '../app/i18n';
import { BOOSTERS, type BoosterId } from '../core/progression';
import type { Tier } from '../core/types';
import type { EmojiName } from './emoji.generated';
import { audio } from '../audio/audio';
import type { CreatureId } from '../core/creatures';
import { creaturePreview } from '../render/preview';

export interface HudCallbacks {
  onPause(): void;
  /** Leave the level for the map. */
  onHome(): void;
  onSpeed(): void;
  onBooster(b: BoosterId): void;
}

export interface BoosterView {
  count: number;
  locked: boolean;
  unlockAt: number;
  active: boolean;
  usable: boolean;
}

/** Drawn icons for the boosters that have no fitting emoji. */
const UNDO_SVG =
  '<svg class="emo" width="SIZE" height="SIZE" viewBox="0 0 36 36" aria-hidden="true">' +
  '<path d="M27 24A10 10 0 0 0 10 13" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>' +
  '<path d="M27 24A10 10 0 0 0 10 13" fill="none" stroke="#ff8a3d" stroke-width="5" stroke-linecap="round"/>' +
  '<path d="M7.5 20.5L3.8 10.8 14.6 11.6Z" fill="#ff8a3d" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>' +
  '</svg>';
const SLOT_SVG =
  '<svg class="emo" width="SIZE" height="SIZE" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="1.5" y="10" width="33" height="17" rx="5" fill="#e9c58c" stroke="#fff" stroke-width="1.5"/>' +
  '<rect x="5" y="13.5" width="6.5" height="10" rx="2" fill="#c79a5b"/><rect x="13.5" y="13.5" width="6.5" height="10" rx="2" fill="#c79a5b"/>' +
  '<rect x="21.5" y="11.5" width="11" height="14" rx="3" fill="#45c03a" stroke="#fff" stroke-width="1.2"/>' +
  '<path d="M27 15v7M23.5 18.5h7" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' +
  '</svg>';

/** Illustrated icon for each booster: a light bulb, a back arrow, a new slot, a die, a magnet. */
export function boosterIcon(b: BoosterId, size = 34): string {
  if (b === 'undo') return UNDO_SVG.replaceAll('SIZE', String(size));
  if (b === 'slot') return SLOT_SVG.replaceAll('SIZE', String(Math.round(size * 1.06)));
  const name: Record<BoosterId, EmojiName> = { hint: 'light-bulb', undo: 'light-bulb', slot: 'light-bulb', shuffle: 'game-die', grab: 'magnet' };
  return emoji(name[b], size);
}

/** In-game overlay: title, progress, pause/speed buttons and the booster dock. */
export class Hud {
  readonly el: HTMLElement;
  private top: HTMLElement;
  private dock: HTMLElement;
  private title: HTMLElement;
  private tierEl: HTMLElement;
  private fill: HTMLElement;
  private progAnt: HTMLElement;
  private speedBtn: HTMLButtonElement;
  private boosterBtns = new Map<BoosterId, HTMLButtonElement>();
  private tutorialEl: HTMLElement | null = null;
  private debugEl!: HTMLElement;
  private handEl: HTMLElement | null = null;
  private sizeObserver: ResizeObserver | null = null;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    this.el = h('div', { class: 'hud' });
    const pause = h('button', { class: 'btn round', html: lineIcon('pause', 26), attrs: { 'aria-label': 'pause' } });
    pause.addEventListener('click', () => {
      audio.play('button');
      cb.onPause();
    });
    this.title = h('div', { class: 'level-name' });
    this.tierEl = h('div', { class: 'tier hidden' });
    this.fill = h('div', { class: 'progress-fill' });
    this.progAnt = h('span', { class: 'progress-mascot', html: emoji('ant', 28) });
    this.progAnt.style.left = '0%';
    const prog = h('div', { class: 'progress' }, this.fill, this.progAnt);
    this.progAnt.firstElementChild?.classList.add('prog-ant');
    this.speedBtn = h('button', { class: 'btn round white speed-btn', attrs: { 'aria-label': t('speed') } });
    this.speedBtn.addEventListener('click', () => {
      audio.play('button');
      cb.onSpeed();
    });
    // A visible way back to the level map (the pause menu has it too).
    const home = h('button', { class: 'btn round white home-btn', html: lineIcon('home', 24), attrs: { 'aria-label': t('toMap') } });
    home.addEventListener('click', () => {
      audio.play('button');
      cb.onHome();
    });
    this.debugEl = h('div', { class: 'hud-debug hidden' });
    this.top = h(
      'div',
      { class: 'hud-top' },
      h('div', { class: 'hud-left' }, pause, home),
      h('div', { class: 'hud-title' }, h('div', { class: 'title-row' }, this.title, this.tierEl), prog, this.debugEl),
      this.speedBtn,
    );
    this.dock = h('div', { class: 'boosters' });
    for (const b of BOOSTERS) {
      const btn = h('button', { class: 'booster', attrs: { 'aria-label': t(`booster_${b}`) } });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.unlock();
        cb.onBooster(b);
      });
      this.boosterBtns.set(b, btn);
      this.dock.append(btn);
    }
    this.el.append(this.top, this.dock);
    root.append(this.el);
    this.setSpeed(1);
  }

  setCreature(id: CreatureId): void {
    if (id === 'ant') {
      this.progAnt.innerHTML = emoji('ant', 28);
      return;
    }
    this.progAnt.replaceChildren(h('img', { class: 'prog-ant', attrs: { src: creaturePreview(id), alt: '', width: '40', height: '40' } }));
  }

  setLevel(n: number, tier: Tier): void {
    this.title.textContent = t('level', { n });
    this.tierEl.className = 'tier ' + tier + (tier === 'normal' ? ' hidden' : '');
    // Just the icon here; the full "hard / super hard" banner shows when the level starts.
    this.tierEl.innerHTML = tier === 'superhard' ? emoji('skull', 16) : emoji('fire', 16);
    this.tierEl.title = tier === 'superhard' ? t('superhard') : t('hard');
  }

  /** Debug line with the level's difficulty numbers (null hides it). */
  setDebug(text: string | null): void {
    this.debugEl.classList.toggle('hidden', !text);
    this.debugEl.textContent = text ?? '';
  }

  setProgress(eaten: number, total: number): void {
    const k = total ? eaten / total : 0;
    this.fill.style.width = `calc(${(k * 100).toFixed(2)}% - 4px)`;
    this.progAnt.style.left = `${(k * 100).toFixed(2)}%`;
  }

  setSpeed(s: number): void {
    this.speedBtn.innerHTML = `${lineIcon(s === 1 ? 'play' : 'ff', 22)}<span>${s}x</span>`;
  }

  setBoosters(state: Record<BoosterId, BoosterView>): void {
    for (const b of BOOSTERS) {
      const btn = this.boosterBtns.get(b)!;
      const s = state[b];
      btn.className = `booster b-${b}` + (s.locked ? ' locked' : '') + (s.active ? ' active' : '') + (!s.locked && !s.usable ? ' dim' : '');
      // A picture and a name, so every booster says what it does.
      const face = `<span class="bicon">${boosterIcon(b)}</span><span class="bname">${t(`booster_${b}`)}</span>`;
      if (s.locked) {
        btn.innerHTML = face + emoji('locked', 24, 'lock') + `<span class="lvl">${t('levelShort', { n: s.unlockAt })}</span>`;
      } else {
        btn.innerHTML = face + (s.count > 0 ? `<span class="count">${s.count}</span>` : `<span class="plus">+</span>`);
      }
    }
  }

  /** Screen-space rectangle of a booster button (for tutorials). */
  boosterRect(b: BoosterId): DOMRect {
    return this.boosterBtns.get(b)!.getBoundingClientRect();
  }

  insets(): { top: number; bottom: number } {
    const top = this.top.getBoundingClientRect();
    const dock = this.dock.getBoundingClientRect();
    return { top: top.bottom + 6, bottom: window.innerHeight - dock.top + 8 };
  }

  banner(text: string, tier: Tier): void {
    const b = h('div', { class: 'banner ' + tier, html: `${emoji(tier === 'superhard' ? 'skull' : 'fire', 34)} ${text}` });
    this.el.append(b);
    setTimeout(() => b.remove(), 2200);
  }

  showTutorial(text: string, y: number, hand?: { x: number; y: number }): void {
    this.hideTutorial();
    this.tutorialEl = h('div', { class: 'tutorial', text });
    this.tutorialEl.style.top = `${y}px`;
    this.el.append(this.tutorialEl);
    if (hand) {
      this.handEl = h('div', { class: 'hand', html: HAND_SVG });
      this.handEl.style.left = `${hand.x - 8}px`;
      this.handEl.style.top = `${hand.y - 4}px`;
      this.el.append(this.handEl);
    }
  }

  hideTutorial(): void {
    this.tutorialEl?.remove();
    this.handEl?.remove();
    this.tutorialEl = this.handEl = null;
  }

  /** Call `cb` whenever the top bar or the booster dock changes size (fonts, wrapped text). */
  observe(cb: () => void): void {
    this.sizeObserver?.disconnect();
    this.sizeObserver = new ResizeObserver(() => cb());
    this.sizeObserver.observe(this.top);
    this.sizeObserver.observe(this.dock);
  }

  destroy(): void {
    this.sizeObserver?.disconnect();
    this.el.remove();
  }
}

const HAND_SVG = `<svg viewBox="0 0 64 64" width="56" height="56"><path d="M22 30V12a5 5 0 0110 0v14l1-1a5 5 0 017 1l1 1a5 5 0 017 2 5 5 0 016 4v12c0 9-7 15-16 15h-4c-6 0-10-3-13-8l-7-12a4.5 4.5 0 017-5z" fill="#fff" stroke="#3b2a55" stroke-width="3.2" stroke-linejoin="round"/><path d="M33 26v8M41 28v7M48 32v5" stroke="#3b2a55" stroke-width="3" stroke-linecap="round"/></svg>`;
