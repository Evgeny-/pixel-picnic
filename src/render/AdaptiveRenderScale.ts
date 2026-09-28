/** Conservative dynamic resolution. Only cadence is measured; gameplay speed never changes. */
export class AdaptiveRenderScale {
  readonly initialDpr: number;
  readonly minDpr: number;
  private current: number;
  private readonly frames = new Float64Array(90);
  private count = 0;
  private cursor = 0;
  private total = 0;
  private warmupAt: number | null = null;
  private firstSampleAt = 0;
  private lastAt: number | null = null;
  private checkedAt: number | null = null;
  private cooldownUntil = 0;
  private state: 'slow' | 'fast' | 'neutral' | null = null;
  private stateAt = 0;
  private stateFrame = 0;

  constructor(initialDpr: number, minDpr = Math.min(1, initialDpr)) {
    if (!Number.isFinite(initialDpr) || initialDpr <= 0 || !Number.isFinite(minDpr) || minDpr <= 0) {
      throw new RangeError('Render scale must be a positive finite number');
    }
    this.initialDpr = this.current = initialDpr;
    this.minDpr = Math.min(initialDpr, minDpr);
  }

  get dpr(): number { return this.current; }

  /** Forget timing around a pause/background gap, retaining the current quality and cooldown. */
  resetCadence(): void {
    this.warmupAt = this.lastAt = null;
    this.clearWindow();
  }

  /** Returns a new DPR only when quality should change. Call with an unclamped RAF interval. */
  sample(frameMs: number, nowMs: number): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || !Number.isFinite(nowMs)) return null;
    if (this.lastAt !== null && nowMs <= this.lastAt) {
      this.resetCadence();
      this.cooldownUntil = 0;
    }
    this.lastAt = nowMs;
    if (this.warmupAt === null) this.warmupAt = nowMs;
    if (nowMs - this.warmupAt < 3000) return null;
    if (!this.count) this.firstSampleAt = nowMs;
    this.frames[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % this.frames.length;
    this.count = Math.min(this.frames.length, this.count + 1);
    this.total++;
    if (this.count < this.frames.length || (this.checkedAt !== null && nowMs - this.checkedAt < 250)) return null;
    this.checkedAt = nowMs;
    const sorted = this.frames.slice().sort();
    const median = (sorted[44] + sorted[45]) / 2;
    const next = median > 22 ? 'slow' : median < 14 ? 'fast' : 'neutral';
    if (next !== this.state) {
      const first = this.state === null;
      this.state = next;
      this.stateAt = first ? this.firstSampleAt : nowMs;
      this.stateFrame = first ? 0 : this.total;
    }
    if (nowMs < this.cooldownUntil) return null;
    let target = this.current;
    if (next === 'slow' && nowMs - this.stateAt >= 2000 && this.total - this.stateFrame >= 90) {
      target = Math.max(this.minDpr, Math.round(this.current * 0.85 * 1000) / 1000);
    } else if (next === 'fast' && nowMs - this.stateAt >= 10000) {
      target = Math.min(this.initialDpr, Math.round((this.current + 0.1) * 1000) / 1000);
    }
    if (Math.abs(target - this.current) < 0.001) return null;
    this.current = target;
    this.cooldownUntil = nowMs + 5000;
    this.clearWindow();
    return target;
  }

  private clearWindow(): void {
    this.count = this.cursor = this.total = 0;
    this.checkedAt = null;
    this.state = null;
    this.stateAt = this.stateFrame = 0;
  }
}
