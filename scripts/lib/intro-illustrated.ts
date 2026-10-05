import type { LevelDef } from '../../src/core/types';

/**
 * Authored opening of the illustrated campaign: a strawberry in three colors. Red and green touch
 * the outside, so both front boxes start collecting at once; the seeds sit inside the berry and
 * their box comes last, after the red boxes have uncovered them. Every tap order wins.
 */
export function createIllustratedIntro(): LevelDef {
  const rows = [
    '.....1..1.....',
    '...11111111...',
    '..1101111011..',
    '.000001100000.',
    '00020000002000',
    '00000020000000',
    '02000000000200',
    '00000200020000',
    '.000000000000.',
    '.002000002000.',
    '..0000020000..',
    '...00000000...',
    '....002000....',
    '.....0000.....',
  ];
  const cells = rows.join('');
  const count = (c: string) => [...cells].filter((x) => x === c).length;
  const red = count('0');
  const green = count('1');
  return {
    n: 1,
    world: 0,
    tier: 'normal',
    name: { en: 'Strawberry', ru: 'Клубничка' },
    picture: { id: 'intro-strawberry', w: 14, h: 14, palette: ['#ff4d5e', '#3ec45a', '#ffe066'], cells },
    shape: 'cube',
    slots: 5,
    fences: [],
    visibleRows: 3,
    queueHint: 'count',
    boxes: [
      { id: 0, color: 0, count: Math.ceil(red / 2) },
      { id: 1, color: 1, count: Math.ceil(green / 2) },
      { id: 2, color: 0, count: Math.floor(red / 2) },
      { id: 3, color: 1, count: Math.floor(green / 2) },
      { id: 4, color: 2, count: count('2') },
    ],
    columns: [[0, 2], [1, 3, 4]],
    solution: [0, 1, 2, 3, 4],
  };
}
