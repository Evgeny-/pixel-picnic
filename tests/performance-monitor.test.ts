import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceHistory, PerformanceMonitor, perf, type FrameSample, type PerformanceContext } from '../src/render/PerformanceMonitor';

const sample = (frame: number, cpu = 2): FrameSample => ({ frame, cpu, paths: 0.5, animation: 1, renderSubmit: 0.5 });
const context: PerformanceContext = { creature: 'mouse', level: 35, agents: 80, calls: 14, triangles: 17000, dpr: 1.6 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('performance statistics', () => {
  it('uses elapsed time for FPS, preserving the impact of slow frames', () => {
    const history = new PerformanceHistory();
    for (const ms of [10, 10, 100]) history.push(sample(ms));
    const stats = history.snapshot();
    expect(stats.fps).toBe(25);
    expect(stats.windowMs).toBe(120);
    expect(stats.frame).toEqual({ mean: 40, p95: 100, p99: 100, max: 100 });
  });

  it('retains only the most recent bounded window and does not mutate it while summarising', () => {
    const history = new PerformanceHistory(3);
    for (const ms of [10, 20, 30, 40, 50]) history.push(sample(ms));
    const first = history.snapshot();
    expect(first.samples).toBe(3);
    expect(first.frame).toEqual({ mean: 40, p95: 50, p99: 50, max: 50 });
    expect(history.snapshot()).toEqual(first);
    history.push(sample(60));
    expect(history.snapshot().frame.mean).toBe(50);
    history.clear();
    history.push(sample(12));
    expect(history.snapshot().frame).toEqual({ mean: 12, p95: 12, p99: 12, max: 12 });
  });

  it('reports rare stutters even when p95 and average cadence look healthy', () => {
    const history = new PerformanceHistory();
    for (let i = 0; i < 197; i++) history.push(sample(16));
    history.push(sample(40)); history.push(sample(80)); history.push(sample(160));
    const stats = history.snapshot();
    expect(stats.frame).toMatchObject({ p95: 16, p99: 40, max: 160 });
    expect(stats.stalls).toEqual({
      over33ms: { count: 3, percent: 1.5 },
      over50ms: { count: 2, percent: 1 },
      over100ms: { count: 1, percent: 0.5 },
    });
  });

  it('ignores invalid measurements and leaves an empty window well defined', () => {
    const history = new PerformanceHistory();
    history.push(sample(0)); history.push(sample(-10)); history.push(sample(NaN));
    history.push({ ...sample(16), animation: Infinity });
    expect(history.size).toBe(0);
    expect(history.snapshot()).toMatchObject({ samples: 0, fps: 0, windowMs: 0, cpu: { mean: 0, p95: 0, max: 0 } });
  });
});

describe('opt-in performance monitor', () => {
  it('enables diagnostics only for an explicit perf=1 query', () => {
    vi.stubGlobal('window', { location: { search: '?level=35&perf=1' } });
    expect(new PerformanceMonitor().enabled).toBe(true);
    vi.stubGlobal('window', { location: { search: '?perf=0' } });
    expect(new PerformanceMonitor().enabled).toBe(false);
    vi.stubGlobal('window', { location: { search: '?perf' } });
    expect(new PerformanceMonitor().enabled).toBe(false);
  });

  it('imports safely without browser globals and does no recording or logging when disabled', () => {
    expect(typeof window).toBe('undefined');
    expect(perf.enabled).toBe(false);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const monitor = new PerformanceMonitor(false);
    monitor.beginFrame(0); monitor.record('paths', 3); monitor.endFrame(context);
    monitor.beginFrame(10000); monitor.endFrame(context);
    expect(monitor.snapshot().samples).toBe(0);
    expect(log).not.toHaveBeenCalled();
    monitor.dispose();
  });

  it('adds repeated section measurements and distinguishes CPU work from frame cadence', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const monitor = new PerformanceMonitor(true);
    monitor.beginFrame(0);
    monitor.record('paths', 1.5); monitor.record('paths', 2.5);
    monitor.record('animation', 2); monitor.record('renderSubmit', 1);
    wall = 8; monitor.endFrame(context);
    wall = 16; monitor.beginFrame(16);
    wall = 17; monitor.endFrame(context);
    expect(monitor.snapshot()).toMatchObject({ samples: 1, frame: { mean: 16 }, cpu: { mean: 8 }, paths: { mean: 4 }, animation: { mean: 2 }, renderSubmit: { mean: 1 } });
    monitor.dispose();
  });

  it('excludes paused gaps, while repeated setPaused(false) still allows measurements', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const monitor = new PerformanceMonitor(true);
    const frame = (at: number) => {
      wall = at; monitor.beginFrame(at); wall += 2; monitor.endFrame(context);
    };
    monitor.setPaused(false); frame(0);
    monitor.setPaused(false); frame(16);
    monitor.setPaused(true); frame(10000);
    monitor.setPaused(true); frame(20000);
    monitor.setPaused(false); frame(30000);
    monitor.setPaused(false); frame(30016);
    expect(monitor.snapshot()).toMatchObject({ samples: 2, frame: { mean: 16, max: 16 } });
    monitor.dispose();
  });

  it('drops visibility-transition gaps without hiding genuine slow foreground frames', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const add = vi.fn();
    const fakeDocument = { visibilityState: 'visible', addEventListener: add, removeEventListener: vi.fn() };
    vi.stubGlobal('document', fakeDocument);
    const monitor = new PerformanceMonitor(true);
    const frame = (at: number) => {
      wall = at; monitor.beginFrame(at); wall += 2; monitor.endFrame(context);
    };
    frame(0); frame(16);
    const visibilityChanged = add.mock.calls[0][1] as () => void;
    fakeDocument.visibilityState = 'hidden'; visibilityChanged();
    frame(20000);
    fakeDocument.visibilityState = 'visible'; visibilityChanged();
    frame(40000); frame(40016); frame(42016);
    expect(monitor.snapshot()).toMatchObject({ samples: 3, frame: { max: 2000 } });
    monitor.dispose();
    expect(fakeDocument.removeEventListener).toHaveBeenCalledWith('visibilitychange', visibilityChanged);
  });

  it('starts a fresh window for a different level, creature or pixel ratio', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const monitor = new PerformanceMonitor(true);
    const frame = (at: number, c = context) => {
      wall = at; monitor.beginFrame(at); wall += 2; monitor.endFrame(c);
    };
    frame(0); frame(16);
    expect(monitor.snapshot().samples).toBe(1);
    frame(32, { ...context, creature: 'beaver' });
    expect(monitor.snapshot().samples).toBe(0);
    frame(48, { ...context, creature: 'beaver' });
    expect(monitor.snapshot().samples).toBe(1);
    frame(64, { ...context, creature: 'beaver', level: 42 });
    expect(monitor.snapshot().samples).toBe(0);
    frame(80, { ...context, creature: 'beaver', level: 42, dpr: 1 });
    expect(monitor.snapshot().samples).toBe(0);
    monitor.dispose();
  });

  it('logs at most once every five active seconds and never during a pause', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const monitor = new PerformanceMonitor(true);
    for (let i = 0; i <= 320; i++) {
      wall = i * 16; monitor.beginFrame(wall); wall += 2; monitor.endFrame(context);
    }
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][1])).toMatchObject({ creature: 'mouse', level: 35, samples: 240, sectionsMs: { renderSubmit: 0 } });
    monitor.setPaused(true);
    wall = 20000; monitor.beginFrame(wall); monitor.endFrame(context);
    expect(log).toHaveBeenCalledTimes(1);
    monitor.setPaused(false);
    monitor.beginFrame(wall); monitor.endFrame(context);
    expect(log).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });
});


describe('slow-frame attribution', () => {
  it('attributes a long RAF interval to the previous CPU work, including its previous renderer context', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const monitor = new PerformanceMonitor(true);
    monitor.beginFrame(0);
    monitor.record('paths', 0.1); monitor.record('animation', 0.5); monitor.record('renderSubmit', 3.9);
    wall = 5; monitor.endFrame({ ...context, agents: 37 });
    wall = 120; monitor.beginFrame(120);
    monitor.record('paths', 50); monitor.record('renderSubmit', 20);
    wall = 200; monitor.endFrame({ ...context, agents: 80 });
    const record = monitor.snapshot().slowFrames[0];
    expect(record).toEqual({ atMs: 120, frameMs: 120, previousCpuMs: 5, unattributedMs: 115,
      sectionsMs: { paths: 0.1, animation: 0.5, renderSubmit: 3.9 }, context: { ...context, agents: 37 }, tasks: [] });
    expect(monitor.snapshot().cpu.mean).toBe(5);
    const detail = log.mock.calls.find((call) => call[0] === '[Pixel Picnic slow frame]')![1];
    expect(typeof detail).toBe('string');
    expect(JSON.parse(detail)).toMatchObject({ frameMs: 120, previousCpuMs: 5, agents: 37 });
    monitor.dispose();
  });

  it('keeps only twenty slow records and rate-limits their console output', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const monitor = new PerformanceMonitor(true);
    for (let i = 0; i <= 30; i++) {
      wall = i * 40; monitor.beginFrame(wall); wall += 2; monitor.endFrame({ ...context, agents: i });
    }
    const snapshot = monitor.snapshot();
    expect(snapshot.slowFrames).toHaveLength(20);
    expect(snapshot.slowFrames[0].atMs).toBe(440);
    expect(snapshot.slowFrames[19].atMs).toBe(1200);
    expect(snapshot.stalls.over33ms.count).toBe(30);
    expect(log.mock.calls.filter((call) => call[0] === '[Pixel Picnic slow frame]')).toHaveLength(2);
    snapshot.slowFrames[0].context.agents = -999;
    expect(monitor.snapshot().slowFrames[0].context.agents).toBe(10);
    monitor.dispose();
  });

  it('does not attribute paused/background gaps to the last active frame', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const monitor = new PerformanceMonitor(true);
    monitor.beginFrame(0); wall = 5; monitor.endFrame(context);
    monitor.setPaused(true);
    wall = 10000; monitor.setPaused(false);
    monitor.beginFrame(wall); wall += 5; monitor.endFrame(context);
    expect(monitor.snapshot().slowFrames).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    monitor.dispose();
  });
});


describe('named work outside RAF', () => {
  it('keeps return values and exceptions intact while measuring both outcomes', () => {
    let wall = 10;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const monitor = new PerformanceMonitor(true);
    const value = { selected: 8 };
    expect(monitor.task('tap', () => { wall = 35; return value; })).toBe(value);
    const failure = new Error('expected');
    expect(() => monitor.task('autoStep', () => { wall = 80; throw failure; })).toThrow(failure);
    expect(monitor.snapshot().completedTasks).toEqual([
      { name: 'tap', startMs: 10, durationMs: 25 },
      { name: 'autoStep', startMs: 35, durationMs: 45 },
    ]);
    monitor.dispose();
    expect(monitor.task('disposed', () => 7)).toBe(7);
    expect(monitor.snapshot().completedTasks).toEqual([]);
    const disabled = new PerformanceMonitor(false);
    expect(disabled.task('disabled', () => value)).toBe(value);
    expect(disabled.snapshot().completedTasks).toEqual([]);
  });

  it('attaches only tasks overlapping the previous RAF interval, excluding current-frame work', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const monitor = new PerformanceMonitor(true);
    monitor.task('older', () => { wall = 5; });
    wall = 10; monitor.beginFrame(10); wall = 12; monitor.endFrame(context);
    wall = 20; monitor.task('tap', () => { wall = 100; });
    wall = 120; monitor.beginFrame(120);
    monitor.task('current-frame autoStep', () => { wall = 150; });
    wall = 155; monitor.endFrame(context);
    const slow = monitor.snapshot().slowFrames[0];
    expect(slow).toMatchObject({ atMs: 120, frameMs: 110, previousCpuMs: 2,
      tasks: [{ name: 'tap', startMs: 20, durationMs: 80 }] });
    const logged = JSON.parse(log.mock.calls.find((call) => call[0] === '[Pixel Picnic slow frame]')![1]);
    expect(logged.tasks).toEqual(slow.tasks);
    slow.tasks[0].name = 'changed by reader';
    expect(monitor.snapshot().slowFrames[0].tasks[0].name).toBe('tap');
    monitor.dispose();
  });

  it('bounds task history to twenty records and returns independent snapshots', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const monitor = new PerformanceMonitor(true);
    for (let i = 0; i < 25; i++) monitor.task(`action-${i}`, () => { wall++; });
    const tasks = monitor.snapshot().completedTasks;
    expect(tasks).toHaveLength(20);
    expect(tasks[0].name).toBe('action-5');
    expect(tasks[19].name).toBe('action-24');
    tasks[0].name = 'reader edit';
    expect(monitor.snapshot().completedTasks[0].name).toBe('action-5');
    monitor.reset();
    expect(monitor.snapshot().completedTasks).toEqual([]);
    monitor.dispose();
  });

  it('publishes a serializable report on the visible overlay at most once a second', () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const elements: { dataset: Record<string, string> }[] = [];
    const createElement = () => {
      const element = { dataset: {} as Record<string, string>, className: '', textContent: '',
        setAttribute: vi.fn(), append: vi.fn(), remove: vi.fn() };
      elements.push(element);
      return element;
    };
    vi.stubGlobal('document', { visibilityState: 'visible', body: { append: vi.fn() }, createElement,
      addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const monitor = new PerformanceMonitor(true);
    monitor.beginFrame(0); wall = 2; monitor.endFrame(context);
    const overlay = elements[0];
    const firstReport = overlay.dataset.report;
    wall = 10; monitor.task('tap', () => { wall = 50; });
    wall = 100; monitor.beginFrame(100); wall = 102; monitor.endFrame(context);
    expect(overlay.dataset.report).toBe(firstReport);
    wall = 1100; monitor.beginFrame(1100); wall = 1102; monitor.endFrame(context);
    const report = JSON.parse(overlay.dataset.report);
    expect(report).toMatchObject({ atMs: 1102, context, samples: 2,
      completedTasks: [{ name: 'tap', startMs: 10, durationMs: 40 }] });
    expect(report.slowFrames[0].tasks[0].name).toBe('tap');
    expect(report.frame.max).toBe(1000);
    monitor.dispose();
  });
});

describe('screenshot-friendly spike diagnostics', () => {
  for (const withTask of [false, true]) {
    it(`shows the last foreground spike with ${withTask ? 'overlapping named work' : 'an honestly labelled unmeasured gap'}`, () => {
      let wall = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => wall);
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const nodes: { dataset: Record<string, string>; className: string; textContent: string; hidden: boolean }[] = [];
      const createElement = () => {
        const element = { dataset: {} as Record<string, string>, className: '', textContent: '', hidden: false,
          setAttribute: vi.fn(), append: vi.fn(), remove: vi.fn() };
        nodes.push(element);
        return element;
      };
      vi.stubGlobal('document', { visibilityState: 'visible', body: { append: vi.fn() }, createElement,
        addEventListener: vi.fn(), removeEventListener: vi.fn() });
      const monitor = new PerformanceMonitor(true);
      monitor.beginFrame(0); monitor.record('renderSubmit', 3); wall = 4; monitor.endFrame(context);
      if (withTask) {
        wall = 10;
        monitor.task('tap', () => { wall = 100; });
      }
      wall = 120; monitor.beginFrame(120); wall = 122; monitor.endFrame(context);
      for (let frame = 136; frame <= 1048; frame += 16) {
        wall = frame; monitor.beginFrame(frame); wall += 2; monitor.endFrame(context);
      }
      const main = nodes.find((node) => node.className === 'performance-spike-main')!;
      const detail = nodes.find((node) => node.className === 'performance-spike-detail')!;
      expect(main.hidden).toBe(false);
      expect(main.textContent).toBe('Last spike 120ms · CPU 4 · submit 3');
      expect(detail.textContent).toBe(withTask ? 'Tasks: tap 90ms' : 'Gap 116ms · unmeasured');
      expect(monitor.snapshot().frame.p95).toBe(16);
      // A spike from a previous character must not be presented as evidence for the new one.
      wall = 2064; monitor.beginFrame(2064); wall += 2; monitor.endFrame({ ...context, creature: 'beaver' });
      expect(main.hidden).toBe(true);
      expect(detail.hidden).toBe(true);
      monitor.dispose();
    });
  }
});
