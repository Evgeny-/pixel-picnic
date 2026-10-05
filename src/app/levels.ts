import type { LevelDef } from '../core/types';
import type { CampaignId } from './save';

const campaigns: Partial<Record<CampaignId, LevelDef[]>> = {};
let active: CampaignId = 'illustrated';
let worker: Worker | null = null;
const pending = new Map<number, (l: LevelDef) => void>();
const endlessCache = new Map<number, LevelDef>();
/** Campaign level whose picture an endless level reuses; replayed as is if generation fails. */
const fallbacks = new Map<number, LevelDef>();

/** Selects the campaign that loadCampaign/getLevel serve; endless levels are per campaign. */
export function setCampaign(id: CampaignId): void {
  if (id === active) return;
  active = id;
  endlessCache.clear();
}

export async function loadCampaign(): Promise<LevelDef[]> {
  const id = active;
  if (!campaigns[id]) {
    const mod = id === 'classic' ? await import('../data/levels.json') : await import('../data/levels-illustrated.json');
    campaigns[id] = (mod.default as unknown as LevelDef[]) ?? [];
  }
  return campaigns[id]!;
}

export function campaignSync(): LevelDef[] {
  return campaigns[active] ?? [];
}

/** Campaign level, or a freshly generated endless level beyond the campaign. */
export async function getLevel(n: number): Promise<LevelDef> {
  const c = await loadCampaign();
  if (n <= c.length) return c[n - 1];
  const cached = endlessCache.get(n);
  if (cached) return cached;
  const id = active;
  const level = await generateInWorker(n, c);
  if (id === active) endlessCache.set(n, level);
  return level;
}

function generateInWorker(n: number, c: LevelDef[]): Promise<LevelDef> {
  if (!worker) {
    worker = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ n: number; level: LevelDef | null }>) => {
      const { n: num, level } = e.data;
      pending.get(num)?.(level ?? { ...fallbacks.get(num)!, n: num });
      pending.delete(num);
      fallbacks.delete(num);
    };
  }
  // Recycle a campaign picture (varied by n), with a fresh queue.
  const src = c[(n * 7919) % c.length];
  fallbacks.set(n, src);
  return new Promise((resolve) => {
    pending.set(n, resolve);
    worker!.postMessage({ n, picture: src.picture, name: src.name });
  });
}

/** Warm up the next endless level in the background. */
export function prefetch(n: number): void {
  const c = campaignSync();
  if (n > c.length && c.length && !endlessCache.has(n) && !pending.has(n)) {
    const id = active;
    generateInWorker(n, c).then((l) => {
      if (id === active) endlessCache.set(n, l);
    });
  }
}
