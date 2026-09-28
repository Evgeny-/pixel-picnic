import type { LevelDef } from '../../src/core/types';

/** Authored opening: every front box starts collecting, and every tap order can win. */
export function createIntroLevel(): LevelDef {
  return {
    n: 1,
    world: 0,
    tier: 'normal',
    name: { en: 'Frog', ru: 'Лягушка' },
    picture: {
      id: 'frog',
      w: 12,
      h: 12,
      palette: ['#ffd51e', '#00d26a', '#1c1c1c'],
      // Fluent Emoji frog, pixelized at 12×12 with three colors and no filled background.
      cells: [
        '...1....1...',
        '.1001..1001.',
        '.0220110220.',
        '.1220110221.',
        '.1101111011.',
        '111111111111',
        '111100001111',
        '110000000011',
        '000000000000',
        '.0000000000.',
        '..00000000..',
        '....0000....',
      ].join(''),
    },
    shape: 'cube',
    slots: 5,
    fences: [],
    visibleRows: 3,
    queueHint: 'count',
    boxes: [
      { id: 0, color: 0, count: 29 },
      { id: 1, color: 1, count: 22 },
      { id: 2, color: 0, count: 29 },
      { id: 3, color: 1, count: 22 },
      { id: 4, color: 2, count: 8 },
    ],
    // Both main colors are exposed. Eyes follow the green boxes that uncover them.
    columns: [[0, 2], [1, 3, 4]],
    solution: [0, 1, 2, 3, 4],
  };
}
