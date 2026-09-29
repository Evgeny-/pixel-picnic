import levels from '../../src/data/levels.json';
import { readablePalette } from '../../src/render/palette.ts';

const colors = ['#ff6816', '#ffe244', '#4b8aff', '#191922', '#fffdf0', '#8c82a5', '#d382ee'];
export const MYSTERY = '#8c82a5';
const xs = [74, 180, 286];
const slot = (id, color, text, i) => ({ id, color, text, x: 48 + 88 * i, y: 56, size: 65, slot: true });
const box = (id, color, text, c, r) => ({ id, color, text, x: xs[c], y: 172 + 92 * r, size: 70 });
const hidden = (c, text = '+2') => ({ id: `h${c}`, color: null, text, x: xs[c], y: 431, hidden: true });
const base = () => [
  slot('s0', colors[0], '5', 0), slot('s1', colors[1], '61', 1),
  slot('s2', colors[1], '56', 2), slot('s3', colors[2], '32', 3),
  box('a', colors[0], '10', 0, 0), box('b', colors[1], '66', 1, 0), box('c', colors[2], '47', 2, 0),
  box('d', MYSTERY, '?', 0, 1), box('e', colors[6], '24', 1, 1), box('f', colors[3], '1', 2, 1),
  box('g', colors[4], '12', 0, 2), box('h', colors[0], '18', 1, 2), box('i', colors[1], '36', 2, 2),
  hidden(0, '+1'), hidden(1, '?'), hidden(2, '+2'),
];
const slotPairs = [['s0', 's1'], ['s2', 's3']];

function levelScene(n) {
  const level = levels.find((item) => item.n === n);
  const palette = readablePalette(level.picture.palette, level.picture.cells);
  const byId = new Map(level.boxes.map((item) => [item.id, item]));
  const boxes = [], positions = new Map(), groups = new Map();
  level.columns.forEach((column, c) => {
    column.forEach((id, r) => {
      const item = byId.get(id);
      positions.set(id, { c, r });
      if (r < 3) boxes.push(box(`b${id}`, item.hidden && r > 0 ? MYSTERY : palette[item.color], item.hidden && r > 0 ? '?' : String(item.count), c, r));
      if (item.link !== undefined) {
        if (!groups.has(item.link)) groups.set(item.link, []);
        groups.get(item.link).push(id);
      }
    });
    if (column.length > 3) boxes.push(hidden(c, level.queueHint === 'mystery' ? '?' : `+${column.length - 3}`));
  });
  const pairs = [];
  for (const ids of groups.values()) {
    if (ids.every((id) => positions.get(id).r >= 3)) continue;
    for (let i = 1; i < ids.length; i++) pairs.push([ids[i - 1], ids[i]].map((id) => {
      const { c, r } = positions.get(id);
      return r < 3 ? `b${id}` : `h${c}`;
    }));
  }
  return {
    boxes, pairs, title: `Level ${n} · actual starting queue`,
    note: 'Box order, links and mystery boxes come directly from this level. The slot tray starts empty.',
  };
}

export const scenes = {
  crowded: {
    boxes: base(), pairs: [...slotPairs, ['a', 'e'], ['b', 'h2'], ['c', 'f'], ['d', 'g'], ['h', 'i']],
    title: 'Busy neighbours · 7 visible connections',
    note: 'A stress layout with neighbouring pairs, a diagonal link and a partner below the visible rows.',
  },
  crossing: {
    boxes: base().map((item) => ['a', 'c', 'g', 'i'].includes(item.id) ? { ...item, color: colors[2] } : item),
    pairs: [...slotPairs, ['a', 'i'], ['c', 'g'], ['b', 'h0'], ['d', 'h2'], ['e', 'h'], ['f', 'h2']],
    title: 'Shared gaps · 8 visible connections',
    note: 'Some connected boxes have the same color. Two separate links lead to the same +2 stack.',
  },
  level14: levelScene(14),
  level180: levelScene(180),
};

export const boxColors = [...new Set(Object.values(scenes).flatMap((scene) => scene.boxes.filter((b) => !b.hidden).map((b) => b.color)))];
