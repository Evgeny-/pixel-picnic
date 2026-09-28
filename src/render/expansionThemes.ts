import type { WorldTheme } from './themes';

/** Painted textures keep each new world distinct without adding scene geometry. */
export const EXPANSION_THEMES: WorldTheme[] = [
  {
    id: 'harvest', name: { en: 'Harvest Hills', ru: 'Урожайные холмы' },
    bg: '#ad9a50', sky: '#fff4d9', bounce: '#a8914c', frame: '#f3d4a0', soil: '#956039', roof: '#bc593d',
    ground: { kind: 'forest', base: '#a89850', tints: ['#b5a663', '#c2ae6a', '#978b45', '#cab577'],
      detail: ['#b9a763', '#817c3b', '#d3be80', '#8d783d'], accents: ['#d77638', '#f0bf57', '#a95230', '#e5d18a'] },
    ui: { top: '#ffe7ac', bottom: '#b2a463', accent: '#c96e37', path: '#f4dbad' }, music: 7,
  },
  {
    id: 'safari', name: { en: 'Safari River', ru: 'Река сафари' },
    bg: '#538469', sky: '#f3ffe7', bounce: '#44795a', frame: '#e1c08b', soil: '#816040', roof: '#d99a38',
    ground: { kind: 'grass', base: '#51816b', tints: ['#65927a', '#467761', '#6c997e', '#3d6f60'],
      detail: ['#78a184', '#376754', '#82ad88', '#4b8160'], accents: ['#f3d573', '#ed9b69', '#f8efbd', '#e6a1ba'] },
    ui: { top: '#c0ead9', bottom: '#51816b', accent: '#e7ad41', path: '#e8d2a5' }, music: 8,
  },
  {
    id: 'harbor', name: { en: 'Harbor Lights', ru: 'Огни гавани' },
    bg: '#829ca5', sky: '#edfaff', bounce: '#7693a0', frame: '#e1ebeb', soil: '#9a8270', roof: '#d96654',
    ground: { kind: 'paving', base: '#859ca2', tints: ['#96adb2', '#829ba4', '#a7b9b9', '#75919a'],
      detail: ['#587882', '#b8caca'], accents: ['#d6e8dc', '#e8ce93', '#82b6b5'] },
    ui: { top: '#b5e6ef', bottom: '#859ca2', accent: '#3c94ad', path: '#e5e4d4' }, music: 9,
  },
  {
    id: 'market', name: { en: 'Market Square', ru: 'Рыночная площадь' },
    bg: '#c9a28b', sky: '#fff5e8', bounce: '#b8997f', frame: '#f8e0bc', soil: '#a57351', roof: '#65a18d',
    ground: { kind: 'paving', base: '#c7a18a', tints: ['#d5b199', '#bf9881', '#ddbaa0', '#cca58c'],
      detail: ['#a98470', '#efcdb2'], accents: ['#c0b178', '#edcf9a', '#adbd86'] },
    ui: { top: '#f6dfbe', bottom: '#c7a18a', accent: '#bf6472', path: '#fbe4be' }, music: 10,
  },
  {
    id: 'workshop', name: { en: 'Toy Workshop', ru: 'Мастерская игрушек' },
    bg: '#ba9875', sky: '#fff4dd', bounce: '#b08b62', frame: '#eee0b9', soil: '#896140', roof: '#789fbc',
    ground: { kind: 'planks', base: '#b49675', tints: ['#c3a380', '#b99672', '#ceb08a', '#ac8b68'],
      detail: ['#927453', '#dcc19b'], accents: ['#759bb3', '#c86e69', '#dfbd66'] },
    ui: { top: '#dae9ee', bottom: '#b49675', accent: '#6495b5', path: '#f2ddb9' }, music: 11,
  },
  {
    id: 'sky', name: { en: 'Skybound Trail', ru: 'Небесная тропа' },
    bg: '#719fb8', sky: '#eff9ff', bounce: '#86adc6', frame: '#edf4ff', soil: '#adc4d6', roof: '#d4a66c',
    ground: { kind: 'clouds', base: '#719fb8', tints: ['#88b1c9', '#6497b2', '#9bbcd1', '#7da7c1'],
      detail: ['#578ba8', '#ffffff'], accents: ['#ffffff', '#f4e6b9', '#d4c8ef'] },
    ui: { top: '#97cbea', bottom: '#e4eef6', accent: '#779ed2', path: '#ffffff' }, music: 12,
  },
  {
    id: 'festival', name: { en: 'Festival Gardens', ru: 'Праздничные сады' },
    bg: '#547b76', sky: '#fff0eb', bounce: '#587c72', frame: '#f2d7c5', soil: '#8d6554', roof: '#c76579',
    ground: { kind: 'magic', base: '#5d837b', tints: ['#6d9388', '#50746e', '#7a9e8e', '#466c68'],
      detail: ['#88ad96', '#446965', '#a3b9a1'], accents: ['#ffe19a', '#ffc7d8', '#e8d5ef', '#fff3e2'] },
    ui: { top: '#e8cbd8', bottom: '#5d837b', accent: '#cb7993', path: '#f3d8ca' }, music: 13,
  },
];
