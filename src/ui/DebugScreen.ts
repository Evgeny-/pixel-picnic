import { h } from './dom';
import { emoji, lineIcon } from './icons';
import { t, loc } from '../app/i18n';
import { pictureCanvas } from './pictureCanvas';
import { THEMES } from '../render/themes';
import { LEVELS_PER_WORLD, worldOf } from '../core/progression';
import type { LevelDef, Tier } from '../core/types';
import { audio } from '../audio/audio';

const pct = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v * 100)}%`);

/** Debug: every level with its picture and difficulty numbers; tap one to play it. */
export class DebugScreen {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private top: HTMLElement;
  private summary: HTMLElement;

  constructor(root: HTMLElement, onBack: () => void, private onPlay: (n: number) => void) {
    this.el = h('div', { class: 'album debug-list hidden' });
    const back = h('button', { class: 'btn round white', html: lineIcon('back', 26), attrs: { 'aria-label': 'back' } });
    back.addEventListener('click', () => {
      audio.play('button');
      onBack();
    });
    this.summary = h('div', { class: 'pill debug-pill' });
    this.top = h('div', { class: 'topbar album-top hidden' }, back, this.summary);
    this.list = h('div');
    this.el.append(this.list);
    root.append(this.el, this.top);
  }

  show(levels: LevelDef[], stars: Record<number, number>): void {
    this.el.classList.remove('hidden');
    this.top.classList.remove('hidden');
    this.list.innerHTML = '';
    const byTier: Record<Tier, number[]> = { normal: [], hard: [], superhard: [] };
    for (const lv of levels) if (lv.stats) byTier[lv.tier].push(lv.stats.casual);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
    this.summary.innerHTML =
      `${emoji('lady-beetle', 28)} ${levels.length} · ` +
      `<span class="tier-dot normal"></span>${pct(avg(byTier.normal))} ` +
      `<span class="tier-dot hard"></span>${pct(avg(byTier.hard))} ` +
      `<span class="tier-dot superhard"></span>${pct(avg(byTier.superhard))}`;
    this.list.append(
      h('p', {
        class: 'debug-legend',
        html:
          'casual / greedy — доля побед симулированных игроков (случайный разумный / жадный). ' +
          'Чем меньше, тем сложнее уровень. casual / greedy — win rate of simulated players; lower = harder.',
      }),
    );
    const worlds = Math.ceil(levels.length / LEVELS_PER_WORLD);
    for (let w = 0; w < worlds; w++) {
      const th = THEMES[w % THEMES.length];
      this.list.append(h('h2', { text: `${t('world', { n: w + 1 })} · ${loc(th.name)}` }));
      const grid = h('div', { class: 'debug-grid' });
      for (const lv of levels.filter((l) => worldOf(l.n) === w)) grid.append(this.card(lv, stars[lv.n] ?? 0));
      this.list.append(grid);
    }
    this.el.scrollTop = 0;
  }

  private card(lv: LevelDef, stars: number): HTMLElement {
    const st = lv.stats;
    const hidden = lv.boxes.filter((b) => b.hidden).length;
    const links = new Set(lv.boxes.filter((b) => b.link !== undefined).map((b) => b.link)).size;
    const frozen = lv.boxes.filter((b) => b.frozen).length;
    const mech = [
      hidden ? `❓${hidden}` : '',
      links ? `🔗${links}` : '',
      frozen ? `❄️${frozen}` : '',
      lv.sides.length > 1 ? `🚪${lv.sides.map((s) => s[0].toUpperCase()).join('')}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const pic = h('div', { class: 'pic' });
    const c = pictureCanvas(lv.picture, 120, { rounded: true });
    c.style.width = c.style.height = '';
    pic.append(c);
    const card = h(
      'button',
      { class: `debug-card ${lv.tier}` },
      h('div', { class: 'debug-head', html: `<b>#${lv.n}</b> <span class="tier-dot ${lv.tier}"></span> ${loc(lv.name)}${stars ? ' ' + '★'.repeat(stars) : ''}` }),
      pic,
      h('div', {
        class: 'debug-stats',
        html:
          `<b>casual ${pct(st?.casual)}</b> · greedy ${pct(st?.greedy)}<br>` +
          `${lv.picture.w}×${lv.picture.h} · ${st?.pixels ?? '?'} cubes · ${lv.picture.palette.length} col<br>` +
          `${lv.boxes.length} boxes · ${lv.columns.length} columns · ${lv.slots} slots` +
          (mech ? `<br>${mech}` : ''),
      }),
    );
    card.addEventListener('click', () => {
      audio.unlock();
      audio.play('button');
      this.onPlay(lv.n);
    });
    return card;
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.top.classList.add('hidden');
  }
}
