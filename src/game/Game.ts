import * as THREE from 'three';
import { Sim, type SimEvent } from '../core/sim';
import { Rng } from '../core/rng';
import { solve } from '../core/solver';
import type { LevelDef } from '../core/types';
import { GameView } from '../render/GameView';
import type { WorldTheme } from '../render/themes';
import { audio } from '../audio/audio';
import { DispatchQueue } from './DispatchQueue';

import type { BoosterId } from '../core/progression';
export type { BoosterId };

export interface GameHooks {
  onWin(g: Game): void;
  onStuck(g: Game): void;
  onProgress(eaten: number, total: number): void;
  onToast(text: 'blocked' | 'frozen' | 'slots' | 'link' | 'nohint' | 'grab' | 'queued' | 'unqueued'): void;
  onChange(g: Game): void;
}

/** Seconds between two dispatch rounds at 1x speed. */
/**
 * Seconds per dispatch round at 1x: every box lets one ant out per round, which leaves about an
 * ant's length between ants walking in a line.
 */
const ROUND = 0.4;

/**
 * Real-time driver: advances the deterministic simulation in rounds and lets the view
 * animate the resulting events.
 */
export class Game {
  readonly level: LevelDef;
  sim: Sim;
  readonly view: GameView;
  private hooks: GameHooks;
  private acc = 0;
  /** Player preference; the automatic finish never overwrites it. */
  speed: 1 | 2 = 1;
  paused = false;
  /** Seconds played (not paused), for the speed bonus. */
  playTime = 0;
  private history: Sim[] = [];
  private dispatch = new DispatchQueue();
  boostersUsed = 0;
  taps = 0;
  private finished: 'won' | 'stuck' | null = null;
  private stuckPending = false;
  private winPending = false;
  private total: number;
  private eaten = 0;
  grabMode = false;
  private hintId: number | null = null;
  private rng: Rng;
  private lastDeliverSfx = 0;

  constructor(view: GameView, level: LevelDef, theme: WorldTheme, hooks: GameHooks) {
    this.view = view;
    this.level = level;
    this.hooks = hooks;
    this.sim = Sim.fromLevel(level);
    this.total = this.sim.left;
    this.rng = new Rng(level.n * 7919 + 13);
    view.load(level, this.sim, theme);
  }

  get progress(): number {
    return this.total ? this.eaten / this.total : 0;
  }

  get canUndo(): boolean {
    return this.history.length > 0 && this.finished !== 'won';
  }

  get status(): 'playing' | 'won' | 'stuck' {
    return this.finished ?? 'playing';
  }

  /** Include deeper queue rows: a box marked for dispatch still needs to be opened. */
  get autoFinishing(): boolean {
    return this.taps > 0 && this.sim.queueSize() === 0 && this.sim.status !== 'stuck' && this.finished !== 'stuck';
  }

  get effectiveSpeed(): 1 | 2 | 5 {
    return this.autoFinishing ? 5 : this.speed;
  }

  /** Planned group positions, also useful to render an accessible queue summary. */
  get pendingBoxes(): ReadonlyMap<number, number> {
    return this.dispatch.positions(this.sim);
  }

  canSelectBox(id: number): boolean {
    return !this.paused && this.finished !== 'won' && this.dispatch.canSchedule(this.sim, id);
  }

  /** Visual callbacks from the ants. */
  onPick(): void {
    audio.play('pick');
  }

  onDeliver(): void {
    this.eaten++;
    this.view.nest.gulp();
    const now = performance.now();
    if (now - this.lastDeliverSfx > 70) {
      this.lastDeliverSfx = now;
      audio.play('deliver');
    }
    this.hooks.onProgress(this.eaten, this.total);
  }

  tap(x: number, y: number): void {
    if (this.paused || this.finished === 'won') return;
    const id = this.view.pickBox(x, y);
    if (id === null) return;
    audio.play('tap');
    if (this.grabMode) {
      this.doGrab(id);
      return;
    }
    if (this.dispatch.size === 0 && this.sim.canTake(id)) {
      this.takeBox(id);
      return;
    }
    const request = this.dispatch.toggle(this.sim, id);
    if (request.kind === 'rejected') {
      this.view.queue.shake(id);
      audio.play('invalid');
      if (request.reason !== 'gone') this.hooks.onToast(request.reason);
      return;
    }
    this.setHint(null);
    this.syncDispatch();
    this.hooks.onToast(request.kind === 'added' ? 'queued' : 'unqueued');
    this.hooks.onChange(this);
    this.drainDispatch();
  }

  /** Programmatic tap on a box (demo mode). Returns false if the box can't be taken now. */
  takeBox(id: number): boolean {
    if (this.paused || this.finished === 'won' || !this.sim.canTake(id)) return false;
    this.pushHistory();
    const ev: SimEvent[] = [];
    this.sim.take(id, ev);
    this.taps++;
    this.afterAction(ev);
    audio.play(this.sim.groupOf(id).length > 1 ? 'link' : 'place');
    return true;
  }

  /**
   * Debug auto-play: when the colony is idle, ask the solver for the next move and take it.
   * Returns 'moved', 'wait' (ants still busy) or 'stuck' (no solution from here).
   */
  autoStep(): 'moved' | 'wait' | 'stuck' | 'done' {
    if (this.finished === 'won' || this.sim.status === 'won') return 'done';
    if (this.paused || !this.sim.isQuiet()) return 'wait';
    const probe = this.sim.clone();
    probe.unstick();
    probe.settle();
    const res = solve(probe, 20000);
    if (res.status !== 'solved' || !res.moves.length) return res.status === 'solved' ? 'done' : 'stuck';
    if (this.finished === 'stuck') {
      this.finished = null;
      this.sim.unstick();
    }
    return this.takeBox(res.moves[0]) ? 'moved' : 'wait';
  }

  private pushHistory(): void {
    this.history.push(this.sim.clone());
    if (this.history.length > 60) this.history.shift();
  }

  private afterAction(ev: SimEvent[], drain = true): void {
    this.setHint(null);
    this.view.apply(ev);
    for (const e of ev) {
      if (e.t === 'reveal') {
        audio.play('reveal');
        this.sparkleBox(e.box, '#ffffff');
      } else if (e.t === 'thaw') {
        audio.play('thaw');
        const p = this.view.queue.boxTop(e.box, new THREE.Vector3());
        this.view.fx.shards(p.x, p.y, p.z);
      }
    }
    if (this.finished === 'stuck') {
      this.finished = null;
      this.sim.unstick();
    }
    this.stuckPending = false;
    this.syncDispatch();
    this.hooks.onChange(this);
    if (drain) this.drainDispatch();
  }

  private syncDispatch(): void {
    this.view.queue.setPending(this.dispatch.positions(this.sim));
  }

  /** Dispatch before stuck detection, as soon as the required slots become available. */
  private drainDispatch(): void {
    // While the player aims the magnet, reserve the free slots for that explicit choice.
    if (this.paused || this.finished === 'won' || this.grabMode) return;
    let id: number | null;
    while ((id = this.dispatch.next(this.sim)) !== null) {
      this.pushHistory();
      const ev: SimEvent[] = [];
      if (!this.sim.take(id, ev)) break;
      this.taps++;
      this.afterAction(ev, false);
      audio.play(this.sim.groupOf(id).length > 1 ? 'link' : 'place');
    }
    this.syncDispatch();
  }

  private sparkleBox(id: number, color: string): void {
    const p = this.view.queue.boxTop(id, new THREE.Vector3());
    this.view.fx.sparkle(p.x, p.y + 0.2, p.z, color, 12, 1);
  }

  update(dt: number, time: number): void {
    if (!this.paused && this.sim.status === 'playing') {
      this.playTime += dt;
      this.acc += dt * this.effectiveSpeed;
      let guard = 0;
      while (this.acc >= ROUND && guard++ < 8) {
        this.acc -= ROUND;
        const ev: SimEvent[] = [];
        const sent = this.sim.round(ev);
        if (ev.length) this.handleRound(ev);
        this.drainDispatch();
        if (sent === 0) {
          this.acc = 0;
          if (!this.grabMode && this.sim.checkStuck()) this.stuckPending = true;
          break;
        }
      }
    }
    this.view.ants.speed = this.effectiveSpeed;
    this.view.update(this.paused ? 0 : dt, time);
    if (this.winPending && this.view.isIdle()) {
      this.winPending = false;
      this.finished = 'won';
      this.hooks.onWin(this);
    }
    if (!this.grabMode && this.stuckPending && this.view.isIdle() && this.sim.status === 'stuck') {
      this.stuckPending = false;
      this.finished = 'stuck';
      this.view.queue.pulseSlots();
      this.hooks.onStuck(this);
    }
  }

  private handleRound(ev: SimEvent[]): void {
    this.view.apply(ev, ROUND);
    let outs = 0;
    for (const e of ev) {
      if (e.t === 'ant') outs++;
      else if (e.t === 'boxDone') {
        audio.play('boxDone');
        const p = this.view.layout.slot[e.slot];
        this.view.fx.sparkle(p.x, 0.8, p.z, this.view.queue.boxColor(e.box), 14, 1.1);
        this.hooks.onChange(this);
      } else if (e.t === 'won') {
        this.winPending = true;
        this.hooks.onChange(this);
      }
    }
    if (outs) audio.play('antOut');
  }

  // ---------------------------------------------------------------- boosters

  canUse(b: BoosterId): boolean {
    if (this.finished === 'won') return false;
    switch (b) {
      case 'undo':
        return this.history.length > 0;
      case 'slot':
        return this.sim.slots.length < 7;
      case 'shuffle':
        return this.sim.queueSize() > 1;
      case 'grab':
        return this.sim.queueSize() > 0 && this.sim.freeSlots() > 0;
      case 'hint':
        return this.sim.queueSize() > 0;
    }
  }

  use(b: BoosterId): boolean {
    if (!this.canUse(b)) return false;
    let ok = true;
    switch (b) {
      case 'undo':
        ok = this.undo();
        break;
      case 'slot':
        this.sim.addSlot();
        this.view.relayout(true);
        this.view.queue.syncFromSim(false);
        this.afterAction([]);
        break;
      case 'shuffle':
        ok = this.smartShuffle();
        break;
      case 'grab':
        this.grabMode = true;
        // A stuck result may be waiting for returning ants. A magnet can still rescue it.
        this.sim.unstick();
        this.stuckPending = false;
        this.hooks.onToast('grab');
        this.hooks.onChange(this);
        return true;
      case 'hint':
        ok = this.hint();
        break;
    }
    if (ok) {
      this.boostersUsed++;
      audio.play(b === 'undo' ? 'undo' : b === 'shuffle' ? 'shuffle' : b === 'hint' ? 'hint' : 'booster');
    }
    return ok;
  }

  cancelGrab(): void {
    this.grabMode = false;
    this.hooks.onChange(this);
    this.drainDispatch();
  }

  private doGrab(id: number): void {
    this.pushHistory();
    const ev: SimEvent[] = [];
    if (!this.sim.grab(id, ev)) {
      this.history.pop();
      this.view.queue.shake(id);
      audio.play('invalid');
      return;
    }
    this.grabMode = false;
    this.boostersUsed++;
    audio.play('booster');
    this.sparkleBox(id, '#fff6a8');
    this.afterAction(ev);
  }

  private undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    // Undo must not immediately repeat the move through a leftover queued intention.
    this.dispatch.clear();
    this.syncDispatch();
    // Rewind: ants vanish; cubes that were already on their way are simply gone.
    this.sim = prev;
    this.sim.flushPending();
    this.view.ants.fadeAll();
    this.rebindView();
    this.finished = null;
    this.stuckPending = false;
    this.winPending = false;
    this.eaten = this.total - this.sim.left;
    this.hooks.onProgress(this.eaten, this.total);
    this.hooks.onChange(this);
    return true;
  }

  private rebindView(): void {
    const v = this.view;
    v.setSim(this.sim);
    v.board.syncFrom(this.sim, true);
    v.queue.syncFromSim(true);
    v.relayout(true);
    v.queue.syncFromSim(false);
    this.syncDispatch();
  }

  /** Shuffle the queue; prefer arrangements the solver can finish from. */
  private smartShuffle(): boolean {
    this.pushHistory();
    const base = this.sim.clone();
    base.unstick();
    let best: Sim | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const cand = base.clone();
      cand.shuffle(this.rng);
      const probe = cand.clone();
      const res = solve(probe, 1500);
      const score = (res.status === 'solved' ? 1000 : res.status === 'unknown' ? 200 : 0) + cand.legalMoves().length * 10 + this.rng.next();
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
      if (res.status === 'solved' && i >= 3) break;
    }
    const ev: SimEvent[] = [];
    this.sim = best!;
    this.rebindView();
    this.afterAction(ev);
    return true;
  }

  private hint(): boolean {
    const probe = this.sim.clone();
    probe.unstick();
    probe.settle();
    const res = solve(probe, 4000);
    if (res.status === 'solved' && res.moves.length) {
      this.setHint(res.moves[0]);
      return true;
    }
    // Fallback: best-looking legal move, but tell the player the position looks lost.
    this.hooks.onToast('nohint');
    return false;
  }

  setHint(id: number | null): void {
    this.hintId = id;
    this.view.queue.setHint(id);
  }

  get hinted(): number | null {
    return this.hintId;
  }

  /** Stars: 3 without boosters, 2 with boosters, 1 if the colony got stuck and was rescued. */
  stars(rescued: boolean): number {
    if (rescued) return 1;
    return this.boostersUsed === 0 ? 3 : 2;
  }

  celebrate(): number {
    const l = this.view.layout;
    const cx = l.picX0 + l.picW / 2;
    const cz = l.picZ0 + l.picH / 2;
    this.view.fx.confetti(cx, 1.5, cz, 180, 5);
    this.view.punch();
    return this.view.board.rebuild();
  }

  dispose(): void {
    this.view.unload();
  }
}
