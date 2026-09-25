import { h } from './dom';
import { emoji, lineIcon } from './icons';
import { t, loc } from '../app/i18n';
import { pictureCanvas } from './pictureCanvas';
import { THEMES } from '../render/themes';
import { LEVELS_PER_WORLD, worldOf } from '../core/progression';
import type { LevelDef } from '../core/types';
import { audio } from '../audio/audio';

/** Collection of every picture the colony has eaten (and silhouettes of the rest). */
export class AlbumScreen {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private countEl: HTMLElement;

  constructor(root: HTMLElement, onBack: () => void) {
    this.el = h('div', { class: 'album hidden' });
    const back = h('button', { class: 'btn round white', html: lineIcon('back', 26), attrs: { 'aria-label': 'back' } });
    back.addEventListener('click', () => {
      audio.play('button');
      onBack();
    });
    this.countEl = h('span');
    const top = h('div', { class: 'topbar' }, back, h('div', { class: 'pill', html: emoji('framed-picture', 32) }, this.countEl));
    this.list = h('div');
    this.el.append(this.list);
    root.append(this.el, top);
    top.classList.add('album-top', 'hidden');
    this.top = top;
  }

  private top: HTMLElement;

  show(levels: LevelDef[], stars: Record<number, number>): void {
    this.el.classList.remove('hidden');
    this.top.classList.remove('hidden');
    this.list.innerHTML = '';
    let got = 0;
    const worlds = Math.ceil(levels.length / LEVELS_PER_WORLD);
    for (let w = 0; w < worlds; w++) {
      const th = THEMES[w % THEMES.length];
      this.list.append(h('h2', { text: `${t('world', { n: w + 1 })} · ${loc(th.name)}` }));
      const grid = h('div', { class: 'album-grid' });
      for (const lv of levels.filter((l) => worldOf(l.n) === w)) {
        const have = (stars[lv.n] ?? 0) > 0;
        if (have) got++;
        const card = h('div', { class: 'album-card' + (have ? '' : ' missing') });
        const pic = h('div', { class: 'pic' });
        if (have) {
          const c = pictureCanvas(lv.picture, 110, { rounded: true });
          c.style.width = c.style.height = '';
          pic.append(c);
        } else pic.textContent = '?';
        card.append(pic, h('span', { class: 'nm', text: have ? loc(lv.name) || `#${lv.n}` : `#${lv.n}` }));
        grid.append(card);
      }
      this.list.append(grid);
    }
    this.countEl.textContent = `${got} / ${levels.length}`;
    this.el.scrollTop = 0;
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.top.classList.add('hidden');
  }
}
