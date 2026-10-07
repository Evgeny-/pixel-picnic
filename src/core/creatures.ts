import type { Localized } from './types';

/** A visual choice. It never changes the puzzle or bought accessories. */
export type CreatureId = 'ant' | 'beaver' | 'dog' | 'mouse' | 'fox' | 'rabbit' | 'human';

export interface CreatureDef {
  id: CreatureId;
  name: Localized;
  /** Natural coat or clothing colour, used in previews and play; ants use their box's colour. */
  color: string;
  /** In-game coins; the original four companions are always free. */
  price: number;
}

export const CREATURES: readonly CreatureDef[] = [
  { id: 'ant', name: { ru: 'Муравьи', en: 'Ants' }, color: '#df6336', price: 0 },
  { id: 'beaver', name: { ru: 'Бобры', en: 'Beavers' }, color: '#ad774b', price: 0 },
  { id: 'dog', name: { ru: 'Собачки', en: 'Dogs' }, color: '#f8f1e7', price: 0 },
  { id: 'mouse', name: { ru: 'Мышки', en: 'Mice' }, color: '#a59cb7', price: 0 },
  { id: 'fox', name: { ru: 'Лисички', en: 'Foxes' }, color: '#e77a38', price: 900 },
  { id: 'rabbit', name: { ru: 'Кролики', en: 'Rabbits' }, color: '#c5afbc', price: 1200 },
  { id: 'human', name: { ru: 'Человечки', en: 'Little People' }, color: '#64a9d0', price: 3000 },
];

export function isCreatureId(value: unknown): value is CreatureId {
  return CREATURES.some((creature) => creature.id === value);
}
