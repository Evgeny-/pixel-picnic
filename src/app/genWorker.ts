/// <reference lib="webworker" />
import { ensureCritical, generateLevel, tierTarget, tuneLevel } from '../core/generator';
import { buildFences, planLevel, shapeFor, worldOf } from '../core/progression';
import { decodeCells, tierForLevel, type Localized, type PictureDef } from '../core/types';

interface Req {
  n: number;
  picture: PictureDef;
  name?: Localized;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { n, picture, name } = e.data;
  const tier = tierForLevel(n);
  const plan = planLevel(n, tier);
  const pixels = decodeCells(picture).reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
  const targetBoxes = Math.round(22 + (tier === 'superhard' ? 6 : tier === 'hard' ? 3 : 0));
  const avg = pixels / targetBoxes;
  const params = {
    ...plan.params,
    fences: buildFences(plan.fences, picture.w, picture.h, n),
    boxMin: Math.max(6, Math.round(avg * 0.6)),
    boxMax: Math.max(10, Math.round(avg * 1.45)),
  };
  // Big illustrated pictures get bigger boxes rather than an endless queue (as in the builder).
  const base = tierTarget(tier, n);
  const target = { ...base, maxBox: Math.min(110, Math.max(base.maxBox ?? 70, Math.round(pixels / 22))) };
  let res = generateLevel(picture, params, target, n * 31 + 7, 16, 90);
  if (!res) res = generateLevel(picture, { ...params, links: 0, frozen: 0 }, { casual: [0, 1], maxBox: target.maxBox }, n * 31 + 8, 30, 40);
  if (!res) {
    // The main thread falls back to replaying the campaign level of this picture.
    (self as unknown as Worker).postMessage({ n, level: null });
    return;
  }
  let level = res.level;
  let diff = res.diff;
  const tuned = tuneLevel(level, diff, target, n * 131 + 5, tier === 'normal' ? 25 : 45, 70);
  const crit = ensureCritical(tuned.level, tuned.diff, target, n * 137 + 9, 25);
  level = crit.level;
  diff = crit.diff;
  const out = {
    ...level,
    n,
    world: worldOf(n),
    tier,
    name,
    shape: shapeFor(n),
    queueHint: plan.queueHint,
    stats: {
      casual: diff.casual,
      greedy: diff.greedy,
      random: diff.random,
      nodes: 0,
      critical: crit.critical,
      decisions: crit.decisions,
      pixels,
      boxes: level.boxes.length,
      colors: picture.palette.length,
    },
  };
  (self as unknown as Worker).postMessage({ n, level: out });
};
