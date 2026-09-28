import { CREATURES, type CreatureId } from '../core/creatures';
import { creaturePreview } from '../render/preview';
import type { HatId } from '../render/hats';
import { audio } from '../audio/audio';
import { loc, t } from '../app/i18n';
import { h } from './dom';
import { openDialog } from './dialogs';
import './creatures.css';
import { CreatureTurntable } from '../render/CreatureTurntable';

/** Free companions share the same puzzle and every purchased hat. */
export function openCreaturePicker(current: CreatureId, hat: HatId, onChoose: (id: CreatureId) => void, onClose: () => void, firstRun = false): void {
  let selected = current;
  const turntable = new CreatureTurntable();
  const portraits = new Map<CreatureId, HTMLElement>();
  const grid = h('div', { class: 'creature-grid', attrs: { role: 'group', 'aria-label': t('creatures') } });
  const buttons = new Map<CreatureId, HTMLButtonElement>();
  const refresh = () => {
    for (const [id, btn] of buttons) {
      btn.classList.toggle('selected', id === selected);
      btn.setAttribute('aria-pressed', String(id === selected));
    }
  };
  for (const creature of CREATURES.filter((c) => c.price === 0)) {
    const portrait = h('span', { class: 'creature-portrait' },
      h('img', { attrs: { src: creaturePreview(creature.id, hat), alt: '', width: '180', height: '180' } }));
    portraits.set(creature.id, portrait);
    const btn = h('button', { class: 'creature-card', attrs: { type: 'button', 'aria-pressed': 'false' } },
      portrait,
      h('span', { text: loc(creature.name) }),
      h('span', { class: 'creature-check', text: '✓', attrs: { 'aria-hidden': 'true' } }),
    );
    btn.addEventListener('click', () => {
      audio.play('button');
      selected = creature.id;
      refresh();
      turntable.set(selected, hat, portrait);
    });
    btn.addEventListener('pointerenter', () => turntable.set(creature.id, hat, portrait));
    btn.addEventListener('focus', () => turntable.set(creature.id, hat, portrait));
    buttons.set(creature.id, btn);
    grid.append(btn);
  }
  refresh();
  openDialog({
    title: t('chooseCreature'), head: 'green', cls: 'utility-dialog creature-dialog',
    body: [h('div', { class: 'utility-content' }, h('p', { class: 'creature-hint', text: t('creatureHint') }), grid)],
    buttons: [{ label: t(firstRun ? 'play' : 'wear'), cls: 'green', onClick: () => onChoose(selected) }],
    onClose,
    onDispose: () => turntable.dispose(),
  });
  turntable.set(selected, hat, portraits.get(selected)!);
}
