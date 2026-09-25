import * as THREE from 'three';
import { Sim, type SimEvent } from '../core/sim';
import { Rng } from '../core/rng';
import { solve } from '../core/solver';
import type { LevelDef } from '../core/types';
import { GameView } from '../render/GameView';
import type { WorldTheme } from '../render/themes';
import { audio } from '../audio/audio';

import type { BoosterId } from '../core/progression';
export type { BoosterId };

export interface GameHooks {
  onWin(g: Game): void;
  onStuck(g: Game): void;
  onProgress(eaten: number, total: number): void;
  onToast(text: 'blocked' | 'frozen' | 'slots' | 'link' | 'nohint' | 'grab'): void;
  onChange(g: Game): void;
}

/** Seconds between two dispatch rounds at 1x speed. */
/** Seconds per dispatch round at 1x: every box lets one ant out per round. */
const ROUND = 0.16;

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
  speed = 1;
  paused = false;
  private history: Sim[] = [];
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
    const why = this.sim.whyNot(id);
    if (why !== 'ok') {
      this.view.queue.shake(id);
      audio.play('invalid');
      if (why !== 'gone') this.hooks.onToast(why);
      return;
    }
    this.pushHistory();
    const ev: SimEvent[] = [];
    this.sim.take(id, ev);
    this.taps++;
    this.afterAction(ev);
    const group = this.sim.groupOf(id);
    audio.play(group.length > 1 ? 'link' : 'place');
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

  private hoverId: number | null = null;

  /** Desktop hover: lift the cubes the hovered box's ants could reach right now. Returns the box id. */
  hover(x: number, y: number): number | null {
    const id = x < 0 || this.paused ? null : this.view.pickBox(x, y);
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.refreshHover();
    }
    return id;
  }

  private refreshHover(): void {
    const id = this.hoverId;
    if (id === null || this.sim.boxHidden[id]) {
      this.view.board.highlight(null);
      return;
    }
    const color = this.sim.boxColor(id);
    this.view.board.highlight(this.sim.exposedCells().filter((c) => this.sim.cellColor(c) === color && this.view.board.isPresent(c)));
  }

  private pushHistory(): void {
    this.history.push(this.sim.clone());
    if (this.history.length > 60) this.history.shift();
  }

  private afterAction(ev: SimEvent[]): void {
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
    this.hooks.onChange(this);
  }

  private sparkleBox(id: number, color: string): void {
    const p = this.view.queue.boxTop(id, new THREE.Vector3());
    this.view.fx.sparkle(p.x, p.y + 0.2, p.z, color, 12, 1);
  }

  update(dt: number, time: number): void {
    if (!this.paused && this.sim.status === 'playing') {
      this.acc += dt * this.speed;
      let guard = 0;
      while (this.acc >= ROUND && guard++ < 8) {
        this.acc -= ROUND;
        const ev: SimEvent[] = [];
        const sent = this.sim.round(ev);
        if (ev.length) this.handleRound(ev);
        if (sent === 0) {
          this.acc = 0;
          if (this.sim.checkStuck()) this.stuckPending = true;
          break;
        }
      }
    }
    this.view.ants.speed = this.speed;
    this.view.update(this.paused ? 0 : dt, time);
    if (this.winPending && this.view.isIdle()) {
      this.winPending = false;
      this.finished = 'won';
      this.hooks.onWin(this);
    }
    if (this.stuckPending && this.view.isIdle() && this.sim.status === 'stuck') {
      this.stuckPending = false;
      this.finished = 'stuck';
      this.view.queue.pulseSlots();
      this.hooks.onStuck(this);
    }
  }

  private handleRound(ev: SimEvent[]): void {
    this.view.apply(ev, ROUND);
    if (this.hoverId !== null) this.refreshHover();
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
