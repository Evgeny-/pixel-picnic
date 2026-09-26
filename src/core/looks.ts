import type { Localized } from './types';

/**
 * Cosmetics bought with coins: the ants' house, hats and boxes. Even the cheapest
 * takes about ten levels of savings; the fanciest ones are long-term goals.
 */
export interface LookItem {
  id: string;
  kind: 'house' | 'hat' | 'box';
  name: Localized;
  price: number;
}

export const HOUSE_LOOKS: LookItem[] = [
  { id: 'cottage', kind: 'house', name: { ru: 'Домик', en: 'Cottage' }, price: 0 },
  { id: 'mushroom', kind: 'house', name: { ru: 'Грибной домик', en: 'Mushroom House' }, price: 400 },
  { id: 'cabin', kind: 'house', name: { ru: 'Избушка', en: 'Log Cabin' }, price: 600 },
  { id: 'igloo', kind: 'house', name: { ru: 'Иглу', en: 'Igloo' }, price: 800 },
  { id: 'gingerbread', kind: 'house', name: { ru: 'Пряничный домик', en: 'Gingerbread House' }, price: 1200 },
  { id: 'pumpkin', kind: 'house', name: { ru: 'Тыква', en: 'Pumpkin House' }, price: 1800 },
  { id: 'tower', kind: 'house', name: { ru: 'Башня', en: 'Castle Tower' }, price: 3000 },
];

export const HAT_LOOKS: LookItem[] = [
  { id: 'none', kind: 'hat', name: { ru: 'Без шапки', en: 'No hat' }, price: 0 },
  { id: 'party', kind: 'hat', name: { ru: 'Колпак', en: 'Party Hat' }, price: 350 },
  { id: 'cap', kind: 'hat', name: { ru: 'Кепка', en: 'Cap' }, price: 450 },
  { id: 'bow', kind: 'hat', name: { ru: 'Бантик', en: 'Bow' }, price: 450 },
  { id: 'flower', kind: 'hat', name: { ru: 'Цветочек', en: 'Flower' }, price: 600 },
  { id: 'sunglasses', kind: 'hat', name: { ru: 'Очки', en: 'Sunglasses' }, price: 800 },
  { id: 'tophat', kind: 'hat', name: { ru: 'Цилиндр', en: 'Top Hat' }, price: 1200 },
  { id: 'santa', kind: 'hat', name: { ru: 'Новогодняя шапка', en: 'Santa Hat' }, price: 1200 },
  { id: 'crown', kind: 'hat', name: { ru: 'Корона', en: 'Crown' }, price: 2500 },
];

export const BOX_LOOKS: LookItem[] = [
  { id: 'classic', kind: 'box', name: { ru: 'Классика', en: 'Classic' }, price: 0 },
  { id: 'crate', kind: 'box', name: { ru: 'Деревянный ящик', en: 'Wooden Crate' }, price: 350 },
  { id: 'basket', kind: 'box', name: { ru: 'Корзинка', en: 'Picnic Basket' }, price: 550 },
  { id: 'metal', kind: 'box', name: { ru: 'Стальной ящик', en: 'Metal Case' }, price: 800 },
];

/** Save key of an item ("house:mushroom"). */
export function lookKey(item: LookItem): string {
  return `${item.kind}:${item.id}`;
}
