/**
 * Everything audible is synthesized with the Web Audio API: soft cozy SFX and a small
 * generative music engine (per-world scale, tempo and instrument colors).
 */

export type SfxName =
  | 'tap' | 'place' | 'invalid' | 'antOut' | 'pick' | 'deliver' | 'boxDone' | 'reveal' | 'thaw' | 'link'
  | 'win' | 'lose' | 'star' | 'coin' | 'button' | 'booster' | 'shuffle' | 'undo' | 'hint' | 'unlock' | 'whoosh' | 'pop';

export interface PlayOpts {
  pitch?: number;
  volume?: number;
  pan?: number;
}

export interface Audio {
  unlock(): void;
  play(name: SfxName, opts?: PlayOpts): void;
  startMusic(theme: number): void;
  stopMusic(fadeSec?: number): void;
  setSfxVolume(v: number): void;
  setMusicVolume(v: number): void;
  duck(amount: number, sec: number): void;
  readonly ready: boolean;
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Minimum gap between two plays of very frequent sounds (seconds). */
const RATE: Partial<Record<SfxName, number>> = { antOut: 0.07, pick: 0.05, deliver: 0.06, tap: 0.03, pop: 0.04 };

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  decay?: number;
  glide?: number;
  pan?: number;
  wet?: number;
  detune?: number;
  filter?: number;
}

interface Theme {
  bpm: number;
  root: number;
  /** chord progression: arrays of semitone offsets from root (4 chords, 1 bar each) */
  chords: number[][];
  scale: number[];
  lead: 'marimba' | 'kalimba' | 'bell' | 'pluck' | 'harp' | 'flute';
  pad: OscillatorType;
  padCut: number;
  density: number;
  sparkle: number;
  swing: number;
}

const THEMES: Theme[] = [
  // 0 meadow — bright C major, marimba
  { bpm: 92, root: 60, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], scale: [0, 2, 4, 7, 9], lead: 'marimba', pad: 'triangle', padCut: 1400, density: 0.62, sparkle: 0.1, swing: 0.06 },
  // 1 forest — A minor, kalimba
  { bpm: 80, root: 57, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], scale: [0, 3, 5, 7, 10], lead: 'kalimba', pad: 'sawtooth', padCut: 900, density: 0.52, sparkle: 0.05, swing: 0.08 },
  // 2 sea — D major, soft flute-like lead
  { bpm: 84, root: 62, chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], scale: [0, 2, 4, 7, 9], lead: 'flute', pad: 'triangle', padCut: 1200, density: 0.5, sparkle: 0.08, swing: 0.1 },
  // 3 sweets — F major, bouncy pluck
  { bpm: 104, root: 65, chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], scale: [0, 2, 4, 7, 9], lead: 'pluck', pad: 'square', padCut: 1000, density: 0.72, sparkle: 0.12, swing: 0.12 },
  // 4 space — E minor with maj7 colors, bells
  { bpm: 72, root: 64, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]], scale: [0, 2, 3, 7, 10], lead: 'bell', pad: 'sawtooth', padCut: 700, density: 0.42, sparkle: 0.25, swing: 0 },
  // 5 winter — G major, celesta bells
  { bpm: 76, root: 67, chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], scale: [0, 2, 4, 7, 9], lead: 'bell', pad: 'triangle', padCut: 1100, density: 0.5, sparkle: 0.3, swing: 0.04 },
  // 6 fantasy — D dorian, harp arpeggios
  { bpm: 84, root: 62, chords: [[0, 3, 7], [-2, 2, 5], [-5, -2, 2], [-7, -3, 0]], scale: [0, 2, 3, 5, 7, 9], lead: 'harp', pad: 'sawtooth', padCut: 1000, density: 0.66, sparkle: 0.2, swing: 0.05 },
];

// The journey continues with new arrangements using the same lightweight instruments.
THEMES.push(
  { ...THEMES[0], bpm: 86, root: 65, lead: 'pluck', swing: 0.09 }, // harvest
  { ...THEMES[1], bpm: 94, root: 60, lead: 'marimba', pad: 'triangle', density: 0.58 }, // safari
  { ...THEMES[2], bpm: 78, root: 67, lead: 'kalimba', swing: 0.08 }, // harbor
  { ...THEMES[3], bpm: 98, root: 62, lead: 'pluck', density: 0.6 }, // market
  { ...THEMES[0], bpm: 90, root: 69, lead: 'kalimba', sparkle: 0.16 }, // workshop
  { ...THEMES[5], bpm: 70, root: 65, lead: 'flute', density: 0.4 }, // sky
  { ...THEMES[6], bpm: 88, root: 67, lead: 'harp', pad: 'triangle', sparkle: 0.24 }, // festival
);

class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s ^= this.s << 13;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5;
    return (this.s >>> 0) / 4294967296;
  }
}

class Song {
  readonly out: GainNode;
  private timer = 0;
  private nextBar: number;
  private bar = 0;
  private lastNote = 0;
  private rng: Rand;
  private stopped = false;

  constructor(private eng: AudioEngine, private th: Theme, seed: number) {
    const ctx = eng.ctx!;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    this.out.connect(eng.musicBus!);
    this.rng = new Rand(seed);
    this.nextBar = ctx.currentTime + 0.15;
    this.timer = window.setInterval(() => this.schedule(), 60);
    this.schedule();
  }

  private get barLen(): number {
    return (60 / this.th.bpm) * 4;
  }

  private schedule(): void {
    const ctx = this.eng.ctx;
    if (!ctx || this.stopped) return;
    while (this.nextBar < ctx.currentTime + 0.35) {
      this.playBar(this.nextBar, this.bar);
      this.nextBar += this.barLen;
      this.bar++;
    }
  }

  private playBar(t0: number, bar: number): void {
    const th = this.th;
    const beat = 60 / th.bpm;
    const chord = th.chords[bar % th.chords.length];
    const r = th.root;
    // Pad: whole-bar chord, gently swelling.
    for (const iv of chord) this.eng.padVoice(this.out, mtof(r + iv - 12), t0, this.barLen, th.pad, th.padCut);
    // Bass on beats 1 and 3.
    this.eng.bassNote(this.out, mtof(r + chord[0] - 24), t0, beat * 1.6);
    if (bar % 2 === 1 || this.rng.next() < 0.5) this.eng.bassNote(this.out, mtof(r + chord[0] - 24 + (this.rng.next() < 0.3 ? 7 : 0)), t0 + beat * 2, beat * 1.4);
    // Melody: seeded phrase over 8 eighth notes, rests by density; every 4th bar is sparser.
    const phraseDensity = bar % 4 === 3 ? th.density * 0.55 : th.density;
    const scale = th.scale;
    for (let i = 0; i < 8; i++) {
      if (this.rng.next() > phraseDensity) continue;
      // stay near chord tones on strong beats
      let deg: number;
      if (i % 4 === 0 && this.rng.next() < 0.7) {
        const ct = chord[Math.floor(this.rng.next() * chord.length)];
        deg = ct;
      } else {
        const step = Math.round((this.rng.next() - 0.5) * 3);
        this.lastNote = Math.max(0, Math.min(scale.length * 2 - 1, this.lastNote + step));
        deg = scale[this.lastNote % scale.length] + 12 * Math.floor(this.lastNote / scale.length);
      }
      const swing = i % 2 === 1 ? th.swing * beat : 0;
      const t = t0 + i * (beat / 2) + swing;
      const note = r + deg + (th.lead === 'bell' ? 12 : 0);
      this.eng.leadNote(this.out, th.lead, mtof(note), t, beat * (0.4 + this.rng.next() * 0.5));
      if (th.lead === 'harp' && this.rng.next() < 0.35) this.eng.leadNote(this.out, 'harp', mtof(note + 7), t + beat / 4, beat * 0.4);
    }
    // Occasional high sparkles.
    if (this.rng.next() < th.sparkle * 3) {
      const t = t0 + Math.floor(this.rng.next() * 8) * (beat / 2);
      this.eng.sparkleNote(this.out, mtof(r + 24 + scale[Math.floor(this.rng.next() * scale.length)]), t);
    }
  }

  stop(fade: number): void {
    const ctx = this.eng.ctx;
    this.stopped = true;
    clearInterval(this.timer);
    if (!ctx) return;
    const g = this.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + fade);
    setTimeout(() => this.out.disconnect(), (fade + 0.5) * 1000);
  }
}

export class AudioEngine implements Audio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private sfxReverb: ConvolverNode | null = null;
  private musicReverb: ConvolverNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  private sfxVol = 0.8;
  private musicVol = 0.5;
  private wantTheme: number | null = null;
  private song: Song | null = null;
  private songTheme = -1;
  private suspendedByHide = false;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      if (this.wantTheme !== null && !this.song) this.startMusic(this.wantTheme);
    } catch {
      /* no audio */
    }
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol * 0.42;
    this.musicBus.connect(this.duckGain);
    // Keep effect tails inside their own volume control, including music ducking.
    // Mixing them into one reverb would make independent music/SFX muting impossible.
    const impulse = this.impulse(2.4, 2.6);
    const reverbFor = (bus: GainNode) => {
      const reverb = ctx.createConvolver();
      reverb.buffer = impulse;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      reverb.connect(wet);
      wet.connect(bus);
      return reverb;
    };
    this.sfxReverb = reverbFor(this.sfxBus);
    this.musicReverb = reverbFor(this.musicBus);
    // Noise buffer.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this.suspendedByHide = true;
          void this.ctx.suspend();
        }
      } else if (this.suspendedByHide) {
        this.suspendedByHide = false;
        void this.ctx.resume();
      }
    });
  }

  private impulse(sec: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setSfxVolume(v: number): void {
    this.sfxVol = v;
    this.fadeVolume(this.sfxBus, v);
  }

  setMusicVolume(v: number): void {
    this.musicVol = v;
    this.fadeVolume(this.musicBus, v * 0.42);
  }

  private fadeVolume(bus: GainNode | null, volume: number): void {
    if (!bus || !this.ctx) return;
    const now = this.ctx.currentTime, gain = bus.gain, current = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(current, now);
    // A short finite ramp avoids clicks and reaches exact silence at zero.
    gain.linearRampToValueAtTime(volume, now + 0.02);
  }

  duck(amount: number, sec: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.duckGain) return;
    const g = this.duckGain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.15);
    g.setValueAtTime(amount, t + sec);
    g.linearRampToValueAtTime(1, t + sec + 1.2);
  }

  startMusic(theme: number): void {
    this.wantTheme = theme;
    if (!this.ctx || !this.musicBus) return;
    if (this.song && this.songTheme === theme) return;
    this.song?.stop(1.5);
    this.songTheme = theme;
    this.song = new Song(this, THEMES[((theme % THEMES.length) + THEMES.length) % THEMES.length], 1234 + theme * 77 + Math.floor(Math.random() * 1000));
  }

  stopMusic(fadeSec = 1): void {
    this.wantTheme = null;
    this.song?.stop(fadeSec);
    this.song = null;
    this.songTheme = -1;
  }

  // ---------------------------------------------------------------- building blocks

  private dest(pan: number, wet: number, bus: AudioNode): AudioNode {
    const ctx = this.ctx!;
    let node: AudioNode = bus;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(bus);
      node = p;
    }
    const reverb = bus === this.sfxBus ? this.sfxReverb : this.musicReverb;
    if (wet > 0 && reverb) {
      const s = ctx.createGain();
      s.gain.value = wet;
      s.connect(reverb);
      const split = ctx.createGain();
      split.connect(node);
      split.connect(s);
      return split;
    }
    return node;
  }

  tone(freq: number, t: number, dur: number, o: ToneOpts = {}, bus?: AudioNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t + dur * 0.8);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    const a = o.attack ?? 0.005;
    const dcy = o.decay ?? dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
    let src: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      osc.connect(f);
      src = f;
    }
    src.connect(g);
    g.connect(this.dest(o.pan ?? 0, o.wet ?? 0, bus ?? this.sfxBus!));
    osc.start(t);
    osc.stop(t + a + dcy + 0.05);
  }

  noise(t: number, dur: number, o: { type?: BiquadFilterType; freq?: number; freqTo?: number; q?: number; gain?: number; attack?: number; pan?: number; wet?: number } = {}): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.01));
    src.connect(f);
    f.connect(g);
    g.connect(this.dest(o.pan ?? 0, o.wet ?? 0, this.sfxBus!));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Simple 2-operator FM voice: bells, marimba, kalimba. */
  fm(freq: number, t: number, dur: number, ratio: number, index: number, gain: number, wet: number, bus?: AudioNode, pan = 0): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    modGain.gain.setValueAtTime(freq * index, t);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, freq * index * 0.02), t + dur * 0.6);
    mod.connect(modGain);
    modGain.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g);
    g.connect(this.dest(pan, wet, bus ?? this.sfxBus!));
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- music instruments

  padVoice(bus: AudioNode, freq: number, t: number, len: number, type: OscillatorType, cut: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cut * 0.6, t);
    f.frequency.linearRampToValueAtTime(cut, t + len * 0.5);
    f.frequency.linearRampToValueAtTime(cut * 0.7, t + len);
    const g = ctx.createGain();
    const peak = type === 'sawtooth' || type === 'square' ? 0.028 : 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + len * 0.3);
    g.gain.linearRampToValueAtTime(peak * 0.7, t + len * 0.85);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.25);
    f.connect(g);
    g.connect(this.dest(0, 0.5, bus));
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.3);
    }
  }

  bassNote(bus: AudioNode, freq: number, t: number, len: number): void {
    this.tone(freq, t, len, { type: 'triangle', gain: 0.13, attack: 0.02, decay: len, filter: 600 }, bus);
  }

  leadNote(bus: AudioNode, kind: Theme['lead'], freq: number, t: number, len: number): void {
    const pan = (Math.random() - 0.5) * 0.5;
    switch (kind) {
      case 'marimba':
        this.fm(freq, t, 0.55, 4, 0.9, 0.11, 0.25, bus, pan);
        break;
      case 'kalimba':
        this.fm(freq, t, 0.8, 5.4, 0.6, 0.1, 0.3, bus, pan);
        break;
      case 'bell':
        this.fm(freq, t, 1.6, 3.5, 1.2, 0.06, 0.5, bus, pan);
        break;
      case 'harp':
        this.tone(freq, t, 0.9, { type: 'triangle', gain: 0.09, attack: 0.004, decay: 0.9, pan, wet: 0.4, filter: 3000 }, bus);
        break;
      case 'pluck':
        this.tone(freq, t, 0.25, { type: 'square', gain: 0.05, attack: 0.003, decay: 0.22, pan, wet: 0.2, filter: 1800 }, bus);
        break;
      case 'flute':
        this.tone(freq, t, len, { type: 'sine', gain: 0.075, attack: 0.06, decay: len + 0.2, pan, wet: 0.45 }, bus);
        break;
    }
  }

  sparkleNote(bus: AudioNode, freq: number, t: number): void {
    this.fm(freq, t, 1.2, 7.1, 0.4, 0.03, 0.8, bus, (Math.random() - 0.5) * 0.8);
  }

  // ---------------------------------------------------------------- sfx

  play(name: SfxName, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.sfxVol <= 0.001) return;
    const now = ctx.currentTime;
    const gap = RATE[name];
    if (gap) {
      const last = this.last.get(name) ?? 0;
      if (now - last < gap) return;
    }
    this.last.set(name, now);
    try {
      this.sfx(name, now + 0.005, opts);
    } catch {
      /* never break the game because of audio */
    }
  }

  private sfx(name: SfxName, t: number, o: PlayOpts): void {
    const v = o.volume ?? 1;
    const p = o.pan ?? 0;
    const rnd = (a: number) => 1 + (Math.random() - 0.5) * a;
    switch (name) {
      case 'tap':
        this.tone(760 * rnd(0.1), t, 0.07, { gain: 0.16 * v, glide: 520, pan: p });
        this.noise(t, 0.025, { type: 'highpass', freq: 3000, gain: 0.05 * v });
        break;
      case 'button':
        this.tone(1100, t, 0.05, { gain: 0.1 * v, glide: 800 });
        this.noise(t, 0.02, { type: 'highpass', freq: 4000, gain: 0.04 * v });
        break;
      case 'place':
        this.tone(250 * rnd(0.08), t, 0.16, { type: 'sine', gain: 0.32 * v, glide: 120, pan: p });
        this.noise(t, 0.08, { type: 'lowpass', freq: 900, gain: 0.12 * v });
        this.tone(1320, t + 0.02, 0.1, { type: 'sine', gain: 0.03 * v, wet: 0.3 });
        break;
      case 'invalid':
        this.tone(210, t, 0.09, { type: 'triangle', gain: 0.16 * v, filter: 700 });
        this.tone(170, t + 0.09, 0.12, { type: 'triangle', gain: 0.16 * v, filter: 600 });
        break;
      case 'antOut':
        this.noise(t, 0.012, { type: 'highpass', freq: 5000 * rnd(0.3), gain: 0.025 * v, pan: (Math.random() - 0.5) * 0.6 });
        break;
      case 'pick':
        this.noise(t, 0.035, { type: 'bandpass', freq: 2200 * rnd(0.5), q: 3, gain: 0.07 * v, pan: (Math.random() - 0.5) * 0.8 });
        this.tone(1100 * rnd(0.3), t, 0.03, { gain: 0.025 * v });
        break;
      case 'deliver':
        this.tone(620 * rnd(0.25), t, 0.07, { gain: 0.045 * v, glide: 980, wet: 0.1 });
        break;
      case 'boxDone': {
        // A soft wooden "bloop" and a warm two-note pluck: no bell partials, nothing metallic.
        this.tone(300 * rnd(0.08), t, 0.13, { type: 'sine', gain: 0.15 * v, glide: 560, attack: 0.006 });
        this.noise(t, 0.05, { type: 'lowpass', freq: 700, gain: 0.05 * v });
        const root = [67, 69, 72, 74][Math.floor(Math.random() * 4)];
        this.tone(mtof(root), t + 0.06, 0.55, { type: 'triangle', gain: 0.075 * v, attack: 0.006, decay: 0.5, filter: 1500, wet: 0.25 });
        this.tone(mtof(root + 7), t + 0.12, 0.6, { type: 'sine', gain: 0.05 * v, attack: 0.008, decay: 0.55, wet: 0.3 });
        break;
      }
      case 'reveal':
        [84, 88, 91, 96].forEach((m, i) => this.fm(mtof(m), t + i * 0.045, 0.6, 5.1, 0.5, 0.05 * v, 0.6));
        break;
      case 'thaw':
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.025 + Math.random() * 0.02, 0.03, { type: 'highpass', freq: 3500 + Math.random() * 3000, gain: 0.08 * v });
        [91, 96, 100].forEach((m, i) => this.fm(mtof(m), t + 0.12 + i * 0.05, 0.5, 6, 0.4, 0.035 * v, 0.6));
        break;
      case 'link':
        this.fm(1250, t, 0.25, 3.47, 1.4, 0.07 * v, 0.2);
        this.fm(1580, t + 0.06, 0.3, 3.47, 1.4, 0.06 * v, 0.2);
        this.tone(230, t, 0.14, { gain: 0.2 * v, glide: 120 });
        break;
      case 'win': {
        const seq = [72, 76, 79, 84];
        seq.forEach((m, i) => this.fm(mtof(m), t + i * 0.12, 0.7, 4, 0.9, 0.12 * v, 0.3));
        const ct = t + 0.55;
        [60, 64, 67, 72, 76].forEach((m) => this.tone(mtof(m), ct, 1.8, { type: 'triangle', gain: 0.06 * v, attack: 0.05, decay: 1.8, wet: 0.5, filter: 2500 }));
        [88, 91, 96].forEach((m, i) => this.fm(mtof(m), ct + 0.1 + i * 0.09, 1.2, 3.5, 0.9, 0.05 * v, 0.6));
        break;
      }
      case 'lose':
        [67, 64, 60, 55].forEach((m, i) => this.tone(mtof(m), t + i * 0.22, 0.4, { type: 'triangle', gain: 0.12 * v, attack: 0.02, decay: 0.45, filter: 1200, wet: 0.3 }));
        break;
      case 'star': {
        const m = [88, 91, 95][Math.max(0, Math.min(2, Math.round(o.pitch ?? 0)))];
        this.fm(mtof(m), t, 1.1, 3.5, 1, 0.1 * v, 0.5);
        this.tone(mtof(m + 12), t, 0.4, { gain: 0.03 * v, wet: 0.5 });
        break;
      }
      case 'coin':
        this.tone(mtof(95), t, 0.08, { type: 'square', gain: 0.045 * v, filter: 4000 });
        this.tone(mtof(100), t + 0.07, 0.3, { type: 'square', gain: 0.045 * v, filter: 4000, wet: 0.3 });
        break;
      case 'booster':
        this.noise(t, 0.35, { type: 'bandpass', freq: 500, freqTo: 5000, q: 2, gain: 0.08 * v, attack: 0.1 });
        [84, 88, 91, 96, 100].forEach((m, i) => this.fm(mtof(m), t + 0.1 + i * 0.04, 0.5, 5, 0.4, 0.04 * v, 0.6));
        break;
      case 'shuffle':
        for (let i = 0; i < 7; i++) this.noise(t + i * 0.045, 0.04, { type: 'bandpass', freq: 1800 + Math.random() * 1500, q: 1.5, gain: 0.09 * v });
        break;
      case 'undo':
        this.noise(t, 0.3, { type: 'bandpass', freq: 4000, freqTo: 400, q: 1.5, gain: 0.1 * v, attack: 0.22 });
        this.tone(900, t + 0.05, 0.25, { gain: 0.05 * v, glide: 300 });
        break;
      case 'hint':
        this.fm(mtof(81), t, 1.4, 3.5, 1, 0.08 * v, 0.6);
        this.fm(mtof(88), t + 0.15, 1.4, 3.5, 1, 0.06 * v, 0.6);
        break;
      case 'unlock':
        [79, 84, 88, 91, 96].forEach((m, i) => this.fm(mtof(m), t + i * 0.07, 0.8, 4, 0.8, 0.08 * v, 0.4));
        break;
      case 'whoosh':
        this.noise(t, 0.25, { type: 'bandpass', freq: 300, freqTo: 2400, q: 0.8, gain: 0.05 * v, attack: 0.08 });
        break;
      case 'pop':
        this.tone(420 * rnd(0.2), t, 0.08, { gain: 0.14 * v, glide: 950 });
        break;
    }
  }
}

export const audio: Audio = new AudioEngine();
