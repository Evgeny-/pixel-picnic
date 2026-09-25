import type { Localized } from '../core/types';

export type GroundKind = 'grass' | 'forest' | 'sand' | 'frosting' | 'night' | 'snow' | 'magic';

export interface WorldTheme {
  id: string;
  name: Localized;
  /** clear color / fog */
  bg: string;
  sky: string;
  bounce: string;
  frame: string;
  soil: string;
  ground: {
    kind: GroundKind;
    base: string;
    tints: string[];
    detail: string[];
    accents: string[];
  };
  /** CSS colors for menus/map */
  ui: { top: string; bottom: string; accent: string; path: string };
  music: number;
}

export const THEMES: WorldTheme[] = [
  {
    id: 'meadow',
    name: { en: 'Sunny Meadow', ru: 'Солнечный луг' },
    bg: '#7fbf5a',
    sky: '#fffbea',
    bounce: '#6f9a4d',
    frame: '#f1d39c',
    soil: '#b07a4b',
    ground: {
      kind: 'grass',
      base: '#86c45b',
      tints: ['#9ad26a', '#77b64f', '#a7da78', '#6fae4a'],
      detail: ['#5f9f3e', '#a9dc7b', '#8fca60', '#4f8c34', '#b8e58a'],
      accents: ['#ffffff', '#ffe14d', '#ff8fb1', '#b9a3ff'],
    },
    ui: { top: '#bfe9ff', bottom: '#9edc6f', accent: '#ff9f1c', path: '#f3dfb4' },
    music: 0,
  },
  {
    id: 'forest',
    name: { en: 'Whispering Forest', ru: 'Шепчущий лес' },
    bg: '#3f6b3a',
    sky: '#f3ffe6',
    bounce: '#44613a',
    frame: '#d8b07a',
    soil: '#8a5a36',
    ground: {
      kind: 'forest',
      base: '#4f7d3e',
      tints: ['#5d8c47', '#436d35', '#6a8f45', '#3b5f2f'],
      detail: ['#7aa04f', '#35572a', '#8cae5b', '#2f4d25'],
      accents: ['#e0703a', '#f2b84b', '#c9502e', '#a7c957'],
    },
    ui: { top: '#cdeccf', bottom: '#4f7d3e', accent: '#f2b84b', path: '#d9c29a' },
    music: 1,
  },
  {
    id: 'sea',
    name: { en: 'Seashell Beach', ru: 'Пляж ракушек' },
    bg: '#f1dca8',
    sky: '#f4fbff',
    bounce: '#d9c28f',
    frame: '#ffffff',
    soil: '#c9a26b',
    ground: {
      kind: 'sand',
      base: '#f1dba6',
      tints: ['#f6e4b8', '#e9cf94', '#fbeac2', '#e3c686'],
      detail: ['#d8bb7e', '#fff4d6', '#cfae6d', '#e7cf9b'],
      accents: ['#ffb4a2', '#ffffff', '#9ad1d4', '#ffd6a5'],
    },
    ui: { top: '#8fd8f4', bottom: '#f1dba6', accent: '#ff7b7b', path: '#fff1cf' },
    music: 2,
  },
  {
    id: 'sweets',
    name: { en: 'Candy Town', ru: 'Конфетный город' },
    bg: '#f7c6dc',
    sky: '#fff5fb',
    bounce: '#e8a8c6',
    frame: '#fff0f6',
    soil: '#9c5b3b',
    ground: {
      kind: 'frosting',
      base: '#f9cfe2',
      tints: ['#fbdbe9', '#f5bfd7', '#fde6f0', '#f2b3cf'],
      detail: ['#ffffff', '#f7a8c9'],
      accents: ['#ff5d8f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#ffffff'],
    },
    ui: { top: '#ffd6e8', bottom: '#f9cfe2', accent: '#ff5d8f', path: '#fff7fb' },
    music: 3,
  },
  {
    id: 'space',
    name: { en: 'Starry Night', ru: 'Звёздная ночь' },
    bg: '#1d2340',
    sky: '#c9d4ff',
    bounce: '#2b2f55',
    frame: '#c7b8ff',
    soil: '#5b4a7a',
    ground: {
      kind: 'night',
      base: '#2a3358',
      tints: ['#303b66', '#232c4d', '#36427a', '#1f2745'],
      detail: ['#3d4a82', '#1b2240', '#4a5a96'],
      accents: ['#fff7c2', '#a0f0ff', '#ffc2f0'],
    },
    ui: { top: '#101631', bottom: '#2a3358', accent: '#ffd166', path: '#c7b8ff' },
    music: 4,
  },
  {
    id: 'winter',
    name: { en: 'Snowy Hills', ru: 'Снежные холмы' },
    bg: '#e9f3fb',
    sky: '#ffffff',
    bounce: '#b9d3e8',
    frame: '#cfe3f3',
    soil: '#8c6a55',
    ground: {
      kind: 'snow',
      base: '#eef5fb',
      tints: ['#f7fbff', '#e2edf7', '#ffffff', '#d9e7f3'],
      detail: ['#cfe0ee', '#ffffff'],
      accents: ['#ffffff', '#bfe3ff', '#ffd6e0'],
    },
    ui: { top: '#cfe9ff', bottom: '#eef5fb', accent: '#4ea8de', path: '#ffffff' },
    music: 5,
  },
  {
    id: 'fantasy',
    name: { en: 'Enchanted Glade', ru: 'Волшебная поляна' },
    bg: '#6c4fa3',
    sky: '#fff0ff',
    bounce: '#6a4f95',
    frame: '#f3d6ff',
    soil: '#7b4e8e',
    ground: {
      kind: 'magic',
      base: '#8a6cc2',
      tints: ['#9b7fd0', '#7c5db4', '#a78ad8', '#6f52a6'],
      detail: ['#b49be0', '#6a4c9c', '#c7b2ec'],
      accents: ['#fff3b0', '#ffc6ff', '#bdf4ff', '#ffffff'],
    },
    ui: { top: '#d7c2ff', bottom: '#8a6cc2', accent: '#ffcf56', path: '#f3e6ff' },
    music: 6,
  },
];

export function themeForWorld(world: number): WorldTheme {
  return THEMES[((world % THEMES.length) + THEMES.length) % THEMES.length];
}
