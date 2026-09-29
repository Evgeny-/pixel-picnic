import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio';

// A graph probe, not a synthesizer: parameters retain their scheduled endpoint values.
// This lets the tests inspect every dry/reverb path, including tails already in flight.
class Param {
  value = 1;
  events: { kind: string; value?: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'set', value, time }); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'linear', value, time }); return this; }
  exponentialRampToValueAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'exponential', value, time }); return this; }
  setTargetAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'target', value, time }); return this; }
  cancelScheduledValues(time: number) { this.events.push({ kind: 'cancel', time }); return this; }
}
class Node {
  readonly edges: (Node | Param)[] = [];
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  pan = new Param();
  playbackRate = new Param();
  Q = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  constructor(readonly kind: string) {}
  connect(other: Node | Param) { this.edges.push(other); return other; }
  disconnect() { this.edges.length = 0; }
  start() {}
  stop() {}
}
class Context {
  static latest: Context;
  readonly nodes: Node[] = [];
  currentTime = 10;
  sampleRate = 8000;
  state = 'running';
  destination = this.node('destination');
  constructor() { Context.latest = this; }
  node(kind: string) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createConvolver() { return this.node('reverb'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createOscillator() { return this.node('oscillator'); }
  createStereoPanner() { return this.node('panner'); }
  createBiquadFilter() { return this.node('filter'); }
  createBufferSource() { return this.node('source'); }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel: number) => data[channel] };
  }
}
function paths(node: Node, destination: Node, gain = 1): number[] {
  if (node === destination) return [gain];
  const level = gain * (node.kind === 'gain' ? node.gain.value : 1);
  return node.edges.flatMap(next => next instanceof Node ? paths(next, destination, level) : []);
}
function sourcePaths(nodes: Node[], ctx: Context): number[] {
  return nodes.filter(n => n.kind === 'oscillator' || n.kind === 'source').flatMap(n => paths(n, ctx.destination));
}
function expectSilent(levels: number[]): void {
  expect(levels.length).toBeGreaterThan(0);
  expect(levels.every(v => v === 0)).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { AudioContext: Context, setInterval });
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  const audio = new AudioEngine();
  audio.unlock();
  return { audio, ctx: Context.latest };
}

describe('audio volume routing', () => {
  it.each(Array.from({ length: 14 }, (_, i) => i))('mutes all music paths in world %s while keeping sound effects audible', theme => {
    const { audio, ctx } = setup();
    const first = ctx.nodes.length;
    audio.startMusic(theme);
    const music = ctx.nodes.slice(first);
    expect(sourcePaths(music, ctx).some(v => v > 0)).toBe(true);
    audio.setMusicVolume(0);
    expectSilent(sourcePaths(music, ctx));
    const sfxStart = ctx.nodes.length;
    audio.play('coin'); // Includes reverb.
    expect(sourcePaths(ctx.nodes.slice(sfxStart), ctx).every(v => v > 0)).toBe(true);
    audio.setMusicVolume(.5);
    expect(sourcePaths(music, ctx).every(v => v > 0)).toBe(true);
  });

  it('mutes ongoing sound effects and their tails without silencing music', () => {
    const { audio, ctx } = setup();
    const first = ctx.nodes.length;
    audio.play('win'); // Long, already-scheduled notes and reverb.
    const sfx = ctx.nodes.slice(first);
    expect(sourcePaths(sfx, ctx).some(v => v > 0)).toBe(true);
    audio.setSfxVolume(0);
    expectSilent(sourcePaths(sfx, ctx));
    const before = ctx.nodes.length;
    audio.play('coin');
    expect(ctx.nodes).toHaveLength(before);
    audio.startMusic(0);
    expect(sourcePaths(ctx.nodes.slice(before), ctx).some(v => v > 0)).toBe(true);
  });

  it('cuts both reverb returns at zero, including tails during a song change', () => {
    const { audio, ctx } = setup();
    audio.play('hint');
    audio.startMusic(0);
    audio.startMusic(1);
    audio.setSfxVolume(0);
    audio.setMusicVolume(0);
    for (const reverb of ctx.nodes.filter(n => n.kind === 'reverb')) expectSilent(paths(reverb, ctx.destination));
    expectSilent(sourcePaths(ctx.nodes, ctx));
  });

  it('preserves saved zero volumes when the audio context is first unlocked', () => {
    const audio = new AudioEngine();
    audio.setMusicVolume(0);
    audio.setSfxVolume(0);
    audio.startMusic(2);
    audio.unlock();
    const ctx = Context.latest;
    expectSilent(sourcePaths(ctx.nodes, ctx));
    const before = ctx.nodes.length;
    audio.play('button');
    expect(ctx.nodes).toHaveLength(before);
  });

  it('cancels earlier volume changes and reaches exact zero within 20 ms', () => {
    const { audio, ctx } = setup();
    audio.setMusicVolume(.8);
    ctx.currentTime += .005;
    audio.setMusicVolume(.2);
    ctx.currentTime += .005;
    audio.setMusicVolume(0);
    audio.setSfxVolume(0);
    const volumes = ctx.nodes.filter(n => n.kind === 'gain' && n.gain.events.some(e => e.kind === 'cancel'));
    expect(volumes).toHaveLength(2);
    for (const { gain } of volumes) {
      expect(gain.events.slice(-3)).toEqual([
        { kind: 'cancel', time: ctx.currentTime },
        { kind: 'set', value: expect.any(Number), time: ctx.currentTime },
        { kind: 'linear', value: 0, time: ctx.currentTime + .02 },
      ]);
      expect(gain.events.some(e => e.kind === 'target')).toBe(false);
    }
  });
});
