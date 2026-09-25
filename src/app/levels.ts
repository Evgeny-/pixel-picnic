import type { LevelDef } from '../core/types';

let campaign: LevelDef[] | null = null;
let worker: Worker | null = null;
const pending = new Map<number, (l: LevelDef) => void>();
const endlessCache = new Map<number, LevelDef>();

export async function loadCampaign(): Promise<LevelDef[]> {
  if (!campaign) {
    const mod = await import('../data/levels.json');
    campaign = (mod.default as unknown as LevelDef[]) ?? [];
  }
  return campaign;
}

export function campaignSync(): LevelDef[] {
  return campaign ?? [];
}

/** Campaign level, or a freshly generated endless level beyond the campaign. */
export async function getLevel(n: number): Promise<LevelDef> {
  const c = await loadCampaign();
  if (n <= c.length) return c[n - 1];
  const cached = endlessCache.get(n);
  if (cached) return cached;
  const level = await generateInWorker(n, c);
  endlessCache.set(n, level);
  return level;
}

function generateInWorker(n: number, c: LevelDef[]): Promise<LevelDef> {
  if (!worker) {
    worker = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ n: number; level: LevelDef }>) => {
      pending.get(e.data.n)?.(e.data.level);
      pending.delete(e.data.n);
    };
  }
  // Recycle a campaign picture (varied by n), with a fresh queue.
  const src = c[(n * 7919) % c.length];
  return new Promise((resolve) => {
    pending.set(n, resolve);
    worker!.postMessage({ n, picture: src.picture, name: src.name });
  });
}

/** Warm up the next endless level in the background. */
export function prefetch(n: number): void {
  const c = campaignSync();
  if (n > c.length && c.length && !endlessCache.has(n) && !pending.has(n)) {
    generateInWorker(n, c).then((l) => endlessCache.set(n, l));
  }
}
