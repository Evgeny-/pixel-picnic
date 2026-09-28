import { h } from './dom';
import { emoji, lineIcon } from './icons';
import { openDialog, toast } from './dialogs';
import { boosterIcon } from './Hud';
import { t, loc } from '../app/i18n';
import { writeSave, type SaveData } from '../app/save';
import { BOOSTERS, BOOSTER_PRICE } from '../core/progression';
import { BOX_LOOKS, HAT_LOOKS, HOUSE_LOOKS, lookKey, type LookItem } from '../core/looks';
import { CREATURES } from '../core/creatures';
import { lookPreview, creaturePreview } from '../render/preview';
import type { HatId } from '../render/hats';
import { audio } from '../audio/audio';
import { CreatureTurntable } from '../render/CreatureTurntable';
import { ShopPurchaseSession } from './ShopPurchaseSession';

export type ShopTab = LookItem['kind'] | 'booster' | 'creature';

/** Keep tabs and selected items stable while purchases update the balance. */
export function openLooksShop(save: SaveData, tab: ShopTab, onSave: () => void, ui: HTMLElement): void {
    const turntable = new CreatureTurntable();
    const purchases = new ShopPurchaseSession(save);
    const coins = h('p', { class: 'shop-coins', attrs: { 'aria-live': 'polite' } });
    const tabs = h('div', { class: 'seg shop-tabs', attrs: { role: 'tablist', 'aria-label': t('shop') } });
    const grid = h('div', { class: 'shop-grid', attrs: { id: 'shop-items', role: 'tabpanel' } });
    const tabDefs: [typeof tab, string][] = [
      ['creature', t('shopCreatures')], ['house', t('shopHouses')], ['hat', t('shopAnts')], ['box', t('shopBoxes')], ['booster', t('shopBoosters')],
    ];
    const tabButtons = new Map<typeof tab, HTMLButtonElement>();
    const scrollTop = new Map<typeof tab, number>();
    let updates: (() => void)[] = [];
    const refresh = () => {
      coins.innerHTML = `${emoji('coin', 26)} ${save.coins}`;
      for (const update of updates) update();
    };
    const savePurchase = () => {
      writeSave(save);
      refresh();
      onSave();
    };
    const renderItems = () => {
      turntable.hide();
      grid.replaceChildren();
      updates = [];
      for (const [id, b] of tabButtons) {
        b.classList.toggle('on', id === tab);
        b.setAttribute('aria-selected', String(id === tab));
        b.tabIndex = id === tab ? 0 : -1;
      }
      grid.setAttribute('aria-labelledby', `shop-tab-${tab}`);
      if (tab === 'booster') {
        for (const b of BOOSTERS) {
          const price = h('span', { class: 'price' });
          const card = h('button', { class: 'look-card' },
            h('span', { class: 'look-pic booster-pic', html: boosterIcon(b, 84) }),
            h('span', { class: 'nm', text: t(`booster_${b}`) }), price,
          );
          updates.push(() => { price.innerHTML = `×${save.boosters[b]} · ${emoji('coin', 18)} ${BOOSTER_PRICE[b]}`; });
          card.addEventListener('click', () => {
            if (!purchases.buy(`booster:${b}`, BOOSTER_PRICE[b], () => { save.boosters[b]++; })) {
              audio.play('invalid');
              toast(ui, t('notEnough'));
              return;
            }
            audio.play('coin');
            savePurchase();
          });
          grid.append(card);
        }
      } else if (tab === 'creature') {
        for (const item of CREATURES) {
          const key = `creature:${item.id}`;
          const owned = () => item.price === 0 || save.looks.owned.includes(key);
          const price = h('span', { class: 'price' });
          const portrait = h('span', { class: 'look-pic' },
            h('img', { attrs: { src: creaturePreview(item.id, save.looks.hat as HatId), alt: '' } }));
          const card = h('button', { class: 'look-card' },
            portrait,
            h('span', { class: 'nm', text: loc(item.name) }), price,
          );
          const turn = () => turntable.set(item.id, save.looks.hat as HatId, portrait);
          card.addEventListener('pointerenter', turn);
          card.addEventListener('focus', turn);
          updates.push(() => {
            const worn = (save.settings.creature ?? 'ant') === item.id;
            card.classList.toggle('worn', worn);
            card.classList.toggle('owned', !worn && owned());
            card.setAttribute('aria-pressed', String(worn));
            if (worn) turn();
            price.innerHTML = worn ? `${lineIcon('check', 16)} ${t('worn')}`
              : item.price === 0 ? t('freeCreature') : owned() ? t('wear') : `${emoji('coin', 18)} ${item.price}`;
          });
          card.addEventListener('click', () => {
            if (!owned()) {
              if (!purchases.buy(key, item.price, () => { save.looks.owned.push(key); })) {
                audio.play('invalid');
                toast(ui, t('notEnough'));
                return;
              }
              audio.play('unlock');
              toast(ui, t('bought'));
            } else {
              purchases.reset();
              audio.play('button');
            }
            save.settings.creature = item.id;
            savePurchase();
          });
          grid.append(card);
        }
      } else {
        const items = tab === 'house' ? HOUSE_LOOKS : tab === 'hat' ? HAT_LOOKS : BOX_LOOKS;
        const looks = save.looks;
        for (const item of items) {
          const owned = () => item.price === 0 || looks.owned.includes(lookKey(item));
          const price = h('span', { class: 'price' });
          const portrait = h('span', { class: 'look-pic' },
            h('img', { attrs: { src: lookPreview(item.kind, item.id, undefined, save.settings.creature ?? 'ant'), alt: '' } }));
          const card = h('button', { class: 'look-card' },
            portrait,
            h('span', { class: 'nm', text: loc(item.name) }), price,
          );
          const turn = () => {
            if (item.kind === 'hat') turntable.set(save.settings.creature ?? 'ant', item.id as HatId, portrait);
          };
          card.addEventListener('pointerenter', turn);
          card.addEventListener('focus', turn);
          updates.push(() => {
            const worn = looks[item.kind] === item.id;
            if (worn) turn();
            card.classList.toggle('worn', worn);
            card.classList.toggle('owned', !worn && owned());
            card.setAttribute('aria-pressed', String(worn));
            price.innerHTML = worn ? `${lineIcon('check', 16)} ${t('worn')}`
              : owned() ? t('wear') : `${emoji('coin', 18)} ${item.price}`;
          });
          card.addEventListener('click', () => {
            if (looks[item.kind] === item.id) {
              purchases.reset();
              return;
            }
            if (owned()) purchases.reset();
            if (!owned()) {
              if (!purchases.buy(lookKey(item), item.price, () => { looks.owned.push(lookKey(item)); })) {
                audio.play('invalid');
                toast(ui, t('notEnough'));
                return;
              }
              audio.play('unlock');
              toast(ui, t('bought'));
            } else audio.play('button');
            looks[item.kind] = item.id;
            savePurchase();
          });
          grid.append(card);
        }
      }
      refresh();
      grid.scrollTop = scrollTop.get(tab) ?? 0;
    };
    for (const [id, label] of tabDefs) {
      const b = h('button', { text: label, attrs: { id: `shop-tab-${id}`, role: 'tab', 'aria-controls': 'shop-items' } });
      b.addEventListener('click', () => {
        if (tab === id) return;
        purchases.reset();
        scrollTop.set(tab, grid.scrollTop);
        tab = id;
        audio.play('button');
        renderItems();
      });
      b.addEventListener('keydown', (e) => {
        const index = tabDefs.findIndex(([key]) => key === id);
        const next = e.key === 'ArrowRight' ? (index + 1) % tabDefs.length
          : e.key === 'ArrowLeft' ? (index + tabDefs.length - 1) % tabDefs.length
            : e.key === 'Home' ? 0 : e.key === 'End' ? tabDefs.length - 1 : -1;
        if (next < 0) return;
        e.preventDefault();
        const button = tabButtons.get(tabDefs[next][0])!;
        button.focus();
        button.click();
      });
      tabButtons.set(id, b);
      tabs.append(b);
    }
    openDialog({ title: t('shop'), head: 'purple', body: [coins, tabs, grid], onClose: () => undefined,
      onDispose: () => { purchases.reset(); turntable.dispose(); }, cls: 'wide shop-dialog' });
    renderItems();
  }
