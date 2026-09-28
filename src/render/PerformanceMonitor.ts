import './performanceMonitor.css';

export type PerformanceSection = 'paths' | 'animation' | 'renderSubmit';
export interface PerformanceContext {
  creature: string;
  level: number;
  agents: number;
  calls: number;
  triangles: number;
  programs?: number;
  dpr: number;
}
export interface FrameSample {
  frame: number;
  cpu: number;
  paths: number;
  animation: number;
  renderSubmit: number;
}
export interface TimingSummary {
  mean: number;
  p95: number;
  p99: number;
  max: number;
}
export interface ThresholdCount { count: number; percent: number }
export interface CompletedTask {
  name: string;
  startMs: number;
  durationMs: number;
}
export interface SlowFrameRecord {
  atMs: number;
  frameMs: number;
  previousCpuMs: number;
  /** Includes unmeasured browser/GPU scheduling/GC/idle time; this is not a GPU or GC measurement. */
  unattributedMs: number;
  sectionsMs: Record<PerformanceSection, number>;
  context: PerformanceContext;
  tasks: CompletedTask[];
}
export interface PerformanceSummary {
  samples: number;
  windowMs: number;
  fps: number;
  frame: TimingSummary;
  cpu: TimingSummary;
  paths: TimingSummary;
  animation: TimingSummary;
  renderSubmit: TimingSummary;
  stalls: { over33ms: ThresholdCount; over50ms: ThresholdCount; over100ms: ThresholdCount };
}
export interface PerformanceSnapshot extends PerformanceSummary {
  slowFrames: SlowFrameRecord[];
  completedTasks: CompletedTask[];
}
interface CompletedFrame {
  cpu: number;
  sections: Record<PerformanceSection, number>;
  context: PerformanceContext;
}

const KEYS = ['frame', 'cpu', 'paths', 'animation', 'renderSubmit'] as const;
const CAPACITY = 240;

function timing(values: Float64Array): TimingSummary {
  if (!values.length) return { mean: 0, p95: 0, p99: 0, max: 0 };
  let sum = 0;
  for (const value of values) sum += value;
  values.sort();
  return { mean: sum / values.length, p95: values[Math.ceil(values.length * 0.95) - 1], p99: values[Math.ceil(values.length * 0.99) - 1], max: values[values.length - 1] };
}

/** Fixed memory, with sorting deferred to the once-a-second presentation update. */
export class PerformanceHistory {
  private readonly values: Record<keyof FrameSample, Float64Array>;
  private cursor = 0;
  private count = 0;

  constructor(private readonly capacity = CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Performance history capacity must be positive');
    this.values = Object.fromEntries(KEYS.map((key) => [key, new Float64Array(capacity)])) as Record<keyof FrameSample, Float64Array>;
  }

  get size(): number { return this.count; }

  push(sample: FrameSample): void {
    if (!Number.isFinite(sample.frame) || sample.frame <= 0 || KEYS.some((key) => !Number.isFinite(sample[key]) || sample[key] < 0)) return;
    for (const key of KEYS) this.values[key][this.cursor] = sample[key];
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  clear(): void {
    this.cursor = this.count = 0;
  }

  snapshot(): PerformanceSummary {
    const measured = Object.fromEntries(KEYS.map((key) => [key, timing(this.values[key].slice(0, this.count))])) as Record<keyof FrameSample, TimingSummary>;
    const over = (threshold: number): ThresholdCount => {
      let count = 0;
      for (let i = 0; i < this.count; i++) if (this.values.frame[i] > threshold) count++;
      return { count, percent: this.count ? count / this.count * 100 : 0 };
    };
    return { samples: this.count, windowMs: measured.frame.mean * this.count,
      fps: measured.frame.mean > 0 ? 1000 / measured.frame.mean : 0, ...measured,
      stalls: { over33ms: over(33.3), over50ms: over(50), over100ms: over(100) } };
  }
}

function enabledFromLocation(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1';
}
function clockNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
const one = (value: number) => Math.round(value * 10) / 10;
const countText = (value: number) => value >= 10000 ? `${one(value / 1000)}k` : String(Math.round(value));

/**
 * Opt-in local diagnostics. No observers, DOM nodes or console output are created without perf=1.
 * beginFrame uses the RAF timestamp for frame cadence and an internal clock for CPU time.
 * Explicit pause/visibility transitions reset cadence instead of counting their gaps as stalls.
 * Real slow foreground frames are retained, including long ones.
 */
export class PerformanceMonitor {
  readonly enabled: boolean;
  private readonly history = new PerformanceHistory();
  private context: PerformanceContext | null = null;
  private sections: Record<PerformanceSection, number> = { paths: 0, animation: 0, renderSubmit: 0 };
  private previousFrame: number | null = null;
  private interval: number | null = null;
  private cpuStart: number | null = null;
  private paused = false;
  private disposed = false;
  private listening = false;
  private presentedAt: number | null = null;
  private loggedAt: number | null = null;
  private overlay: HTMLDivElement | null = null;
  private lines: HTMLElement[] = [];
  private summary: PerformanceSummary | null = null;
  private completed: CompletedFrame | null = null;
  private slowRecords: SlowFrameRecord[] = [];
  private slowLoggedAt: number | null = null;
  private completedTasks: CompletedTask[] = [];

  constructor(enabled = enabledFromLocation()) {
    this.enabled = enabled;
  }

  beginFrame(now: number): void {
    if (!this.enabled || this.disposed) return;
    this.listen();
    if (this.suspended() || !Number.isFinite(now)) {
      this.resetCadence();
      return;
    }
    this.interval = this.previousFrame === null || now <= this.previousFrame ? null : now - this.previousFrame;
    this.previousFrame = now;
    this.cpuStart = clockNow();
    this.sections.paths = this.sections.animation = this.sections.renderSubmit = 0;
  }

  /** Repeated path calculations/animation updates within the same frame are added together. */
  record(section: PerformanceSection, milliseconds: number): void {
    if (!this.enabled || this.cpuStart === null || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.sections[section] += milliseconds;
  }

  /** Measure synchronous UI/solver work outside RAF without changing its return/throw behaviour. */
  task<T>(name: string, fn: () => T): T {
    if (!this.enabled || this.disposed) return fn();
    const startMs = clockNow();
    try {
      return fn();
    } finally {
      this.completedTasks.push({ name: name.slice(0, 80), startMs, durationMs: Math.max(0, clockNow() - startMs) });
      if (this.completedTasks.length > 20) this.completedTasks.shift();
    }
  }

  endFrame(context: PerformanceContext): void {
    if (!this.enabled || this.disposed) return;
    const now = clockNow();
    const changed = this.context !== null && (this.context.level !== context.level || this.context.creature !== context.creature || this.context.dpr !== context.dpr);
    if (changed) {
      this.history.clear();
      this.summary = null;
      this.interval = null;
    }
    this.context = { ...context };
    if (this.cpuStart !== null && !this.suspended()) {
      // RAF n-1 -> n includes work submitted by n-1. Never blame the current frame's work for
      // a stall that has already happened before its callback started.
      if (this.interval !== null && this.completed && !changed) {
        this.history.push({ frame: this.interval, cpu: this.completed.cpu, ...this.completed.sections });
        if (this.interval > 33.3) this.recordSlowFrame(this.interval, this.completed, now);
      }
      this.completed = { cpu: Math.max(0, now - this.cpuStart), sections: { ...this.sections }, context: { ...context } };
    } else this.completed = null;
    this.cpuStart = null;
    if (this.presentedAt === null || now - this.presentedAt >= 1000) {
      this.summary = this.history.snapshot();
      this.present(now);
    }
    if (this.loggedAt === null) this.loggedAt = now;
    else if (now - this.loggedAt >= 5000 && !this.suspended() && this.history.size) {
      this.loggedAt = now;
      this.log(this.summary ?? this.history.snapshot());
    }
  }

  /** Call when gameplay pauses, including dialogs, to exclude time spent away from the game. */
  setPaused(paused: boolean): void {
    if (!this.enabled || this.disposed || paused === this.paused) return;
    this.paused = paused;
    this.resetCadence();
    this.loggedAt = clockNow();
    if (this.overlay) this.present(clockNow());
  }

  /** Optional manual reset. Level, creature and DPR changes also start a new measurement window. */
  reset(): void {
    if (!this.enabled || this.disposed) return;
    this.history.clear();
    this.summary = null;
    this.slowRecords = [];
    this.completedTasks = [];
    this.slowLoggedAt = null;
    this.resetCadence();
    this.presentedAt = this.loggedAt = null;
  }

  /** Read current measurements without logging or modifying the history. */
  snapshot(): PerformanceSnapshot {
    return { ...this.history.snapshot(), slowFrames: this.slowRecords.map((record) => ({
      ...record, context: { ...record.context }, sectionsMs: { ...record.sectionsMs }, tasks: record.tasks.map((task) => ({ ...task })),
    })), completedTasks: this.completedTasks.map((task) => ({ ...task })) };
  }

  private suspended(): boolean {
    return this.paused || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
  }

  private resetCadence(): void {
    this.previousFrame = this.interval = this.cpuStart = null;
    this.completed = null;
  }

  private listen(): void {
    if (this.listening || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.listening = true;
  }

  private readonly visibilityChanged = (): void => {
    this.resetCadence();
    // Do not immediately log a stale pre-background summary after returning to the tab.
    this.loggedAt = clockNow();
  };

  private present(now: number): void {
    this.presentedAt = now;
    if (typeof document === 'undefined' || !document.body || !this.context) return;
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'performance-monitor';
      // A diagnostic changing each second should not repeatedly interrupt a screen reader.
      this.overlay.setAttribute('aria-hidden', 'true');
      this.lines = Array.from({ length: 10 }, (_, index) => {
        const line = document.createElement(index === 1 ? 'strong' : 'span');
        if (index >= 8) line.className = index === 8 ? 'performance-spike-main' : 'performance-spike-detail';
        this.overlay!.append(line);
        return line;
      });
      document.body.append(this.overlay);
    }
    const c = this.context;
    const stats = this.summary ?? this.history.snapshot();
    this.lines[0].textContent = `PERF · L${c.level} · ${c.creature}${this.paused ? ' · paused' : ''}`;
    this.lines[1].textContent = stats.samples ? `${Math.round(stats.fps)} FPS · ${one(stats.frame.mean)} ms/frame` : 'Collecting frames…';
    this.lines[2].textContent = `p95 ${one(stats.frame.p95)} · p99 ${one(stats.frame.p99)} · max ${one(stats.frame.max)} ms`;
    this.lines[3].textContent = `CPU ${one(stats.cpu.mean)} · path ${one(stats.paths.mean)} · anim ${one(stats.animation.mean)} · submit ${one(stats.renderSubmit.mean)} ms`;
    const stalls = stats.stalls;
    this.lines[4].textContent = `>33ms: ${stalls.over33ms.count} (${one(stalls.over33ms.percent)}%) · >50ms: ${stalls.over50ms.count} (${one(stalls.over50ms.percent)}%)`;
    this.lines[5].textContent = `>100ms: ${stalls.over100ms.count} (${one(stalls.over100ms.percent)}%)`;
    this.lines[6].textContent = `${countText(c.agents)} agents · DPR ${one(c.dpr)}`;
    this.lines[7].textContent = `${countText(c.calls)} calls · ${countText(c.triangles)} triangles`;
    const spike = this.slowRecords.slice().reverse().find((record) => record.frameMs > 100 &&
      record.context.level === c.level && record.context.creature === c.creature && record.context.dpr === c.dpr);
    this.lines[8].hidden = this.lines[9].hidden = !spike;
    if (spike) {
      this.lines[8].textContent = `Last spike ${one(spike.frameMs)}ms · CPU ${one(spike.previousCpuMs)} · submit ${one(spike.sectionsMs.renderSubmit)}`;
      if (spike.tasks.length) {
        const tasks = spike.tasks.slice().sort((a, b) => b.durationMs - a.durationMs);
        const detail = tasks.slice(0, 2).map((task) => `${task.name.slice(0, 18)} ${one(task.durationMs)}ms`).join(' · ');
        this.lines[9].textContent = `Tasks: ${detail}${tasks.length > 2 ? ` · +${tasks.length - 2}` : ''}`;
      } else this.lines[9].textContent = `Gap ${one(spike.unattributedMs)}ms · unmeasured`;
    }

    this.overlay.dataset.pace = !stats.samples || this.paused ? 'idle' : stats.fps >= 50 ? 'good' : stats.fps >= 30 ? 'fair' : 'slow';
    // Explicit local diagnostic data on the visible overlay, readable by browser tools without
    // exposing an app-state API. Reuse the already computed statistics instead of sorting twice.
    this.overlay.dataset.report = JSON.stringify({ atMs: now, paused: this.paused, context: c, ...stats,
      slowFrames: this.slowRecords, completedTasks: this.completedTasks });
  }

  private log(stats: PerformanceSummary): void {
    // renderSubmit is CPU submission time. It does not claim to measure asynchronous GPU work.
    console.info('[Pixel Picnic perf]', JSON.stringify({
      ...this.context, samples: stats.samples, windowMs: Math.round(stats.windowMs), fps: one(stats.fps),
      frameMs: { mean: one(stats.frame.mean), p95: one(stats.frame.p95), p99: one(stats.frame.p99), max: one(stats.frame.max) },
      cpuMs: { mean: one(stats.cpu.mean), p95: one(stats.cpu.p95), p99: one(stats.cpu.p99), max: one(stats.cpu.max) },
      stalls: stats.stalls,
      sectionsMs: { paths: one(stats.paths.mean), animation: one(stats.animation.mean), renderSubmit: one(stats.renderSubmit.mean) },
      completedTasks: this.completedTasks,
    }));
  }

  private recordSlowFrame(frameMs: number, previous: CompletedFrame, now: number): void {
    const endMs = this.previousFrame ?? now;
    const startMs = endMs - frameMs;
    const record: SlowFrameRecord = {
      atMs: endMs, frameMs, previousCpuMs: previous.cpu,
      unattributedMs: Math.max(0, frameMs - previous.cpu),
      sectionsMs: { ...previous.sections }, context: { ...previous.context },
      // Current callback tasks start at/after endMs and cannot explain this previous interval.
      tasks: this.completedTasks.filter((task) => task.startMs < endMs && task.startMs + task.durationMs > startMs)
        .map((task) => ({ ...task })),
    };
    this.slowRecords.push(record);
    if (this.slowRecords.length > 20) this.slowRecords.shift();
    if (this.slowLoggedAt === null || now - this.slowLoggedAt >= 1000) {
      this.slowLoggedAt = now;
      console.info('[Pixel Picnic slow frame]', JSON.stringify({
        atMs: Math.round(record.atMs), frameMs: one(frameMs), previousCpuMs: one(previous.cpu),
        unattributedMs: one(record.unattributedMs),
        sectionsMs: { paths: one(previous.sections.paths), animation: one(previous.sections.animation), renderSubmit: one(previous.sections.renderSubmit) },
        ...previous.context, tasks: record.tasks,
      }));
    }
  }

  dispose(): void {
    if (this.listening && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.listening = false;
    this.disposed = true;
    this.resetCadence();
    this.overlay?.remove();
    this.overlay = null;
    this.lines = [];
    this.history.clear();
    this.slowRecords = [];
    this.completedTasks = [];
  }
}

export const perf = new PerformanceMonitor();
