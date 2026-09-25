/// <reference lib="webworker" />
import { generateLevel, tierTarget } from '../core/generator';
import { planLevel, worldOf } from '../core/progression';
import { decodeCells, tierForLevel, type Localized, type PictureDef, type Side } from '../core/types';

interface Req {
  n: number;
  picture: PictureDef;
  name?: Localized;
  sides: Side[];
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { n, picture, name } = e.data;
  const tier = tierForLevel(n);
  const plan = planLevel(n, tier);
  const pixels = decodeCells(picture).reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  const targetBoxes = Math.round(22 + (tier === 'superhard' ? 6 : tier === 'hard' ? 3 : 0));
  const avg = pixels / targetBoxes;
  const params = { ...plan.params, boxMin: Math.max(6, Math.round(avg * 0.6)), boxMax: Math.max(10, Math.round(avg * 1.45)) };
  let res = generateLevel(picture, params, tierTarget(tier, n), n * 31 + 7, 16, 90);
  if (!res) res = generateLevel(picture, { ...params, links: 0, frozen: 0, hiddenFrac: 0 }, { casual: [0, 1] }, n * 31 + 8, 30, 40);
  const level = { ...res!.level, n, world: worldOf(n), tier, name, stats: undefined };
  (self as unknown as Worker).postMessage({ n, level });
};
