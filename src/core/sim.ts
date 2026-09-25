import { decodeCells, SIDES, type LevelDef, type Side } from './types';
import type { Rng } from './rng';

/**
 * Deterministic game logic, shared by the game, the solver and the level generator.
 *
 * Rules:
 * - The picture is a grid of colored cubes inside a frame. Ants come in through the open sides of
 *   the frame (bottom by default) and walk over free space: empty cells and cells whose cube has
 *   already been eaten. A cube is reachable when an ant can walk up to it, i.e. it touches the
 *   outside through an open side or touches free space connected to the outside.
 * - The player taps boxes at the front of the queue columns; a box moves into the leftmost free slot.
 * - Every dispatch round, each occupied slot (left to right) sends one ant to the best reachable
 *   cube of its color (closest to an entrance). The cube is claimed immediately (logically eaten),
 *   which may open a way to the cubes behind it. A box whose ants are all out frees its slot.
 * - The level is won when every cube is eaten. It is stuck when nothing can be dispatched and no
 *   box can be taken (typically: every slot holds a color with no reachable cube).
 */

export const Where = { Queue: 0, Slot: 1, Done: 2 } as const;

export interface SlotState {
  box: number;
  left: number;
}

export type SimEvent =
  | { t: 'ant'; slot: number; box: number; cell: number; color: number; left: number }
  | { t: 'boxDone'; slot: number; box: number }
  | { t: 'take'; box: number; slot: number; col: number; index: number; grabbed?: boolean }
  | { t: 'reveal'; box: number }
  | { t: 'thaw'; box: number }
  | { t: 'won' }
  | { t: 'stuck' };

export type SimStatus = 'playing' | 'won' | 'stuck';

/** Immutable data shared between clones. */
interface Shared {
  w: number;
  h: number;
  colors: number;
  cell: Int16Array;
  zobA: Int32Array;
  zobB: Int32Array;
  /** Static preference of a cube: closest to an open side first, then closest to the middle. */
  prio: Int32Array;
  /** For border cells: bitmask of open sides they touch (1 bottom, 2 top, 4 left, 8 right). */
  edge: Uint8Array;
  /** Number of cubes of each color (heap capacity). */
  colorCount: Int32Array;
  boxColor: Int16Array;
  boxCount: Int16Array;
  boxLink: Int16Array;
  boxThaw: Int16Array;
  /** link id -> member box ids */
  groups: Map<number, number[]>;
  sides: Side[];
  open: boolean[];
}

export class Sim {
  readonly s: Shared;
  eaten: Uint8Array;
  /** Free cell (empty or eaten) connected to the outside. */
  air: Uint8Array;
  /** Uneaten cube an ant can walk up to. */
  reach: Uint8Array;
  /** Per color: binary min-heap of reachable cubes (lazy deletion of eaten ones). */
  heaps: Int32Array[];
  heapSize: Int32Array;
  reachCount: Int32Array;
  remaining: Int32Array;
  left: number;
  boxHidden: Uint8Array;
  boxWhere: Uint8Array;
  boxCol: Int16Array;
  columns: number[][];
  slots: (SlotState | null)[];
  taps: number;
  status: SimStatus;
  hashA: number;
  hashB: number;

  private constructor(s: Shared) {
    this.s = s;
    this.eaten = new Uint8Array(0);
    this.air = new Uint8Array(0);
    this.reach = new Uint8Array(0);
    this.heaps = [];
    this.heapSize = new Int32Array(0);
    this.reachCount = new Int32Array(0);
    this.remaining = new Int32Array(0);
    this.left = 0;
    this.boxHidden = new Uint8Array(0);
    this.boxWhere = new Uint8Array(0);
    this.boxCol = new Int16Array(0);
    this.columns = [];
    this.slots = [];
    this.taps = 0;
    this.status = 'playing';
    this.hashA = 0;
    this.hashB = 0;
  }

  static fromLevel(level: LevelDef): Sim {
    const pic = level.picture;
    const cell = decodeCells(pic);
    const w = pic.w;
    const h = pic.h;
    const colors = pic.palette.length;
    const n = w * h;
    const zobA = new Int32Array(n);
    const zobB = new Int32Array(n);
    let seed = 0x2545f491;
    for (let i = 0; i < n; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      zobA[i] = seed;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      zobB[i] = seed;
    }
    const sides = level.sides.length ? level.sides.slice() : (['bottom'] as Side[]);
    const open = SIDES.map((sd) => sides.includes(sd));

    const prio = new Int32Array(n);
    const edge = new Uint8Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let depth = 1 << 20;
        let center = 0;
        const consider = (d: number, c: number) => {
          if (d < depth || (d === depth && c < center)) {
            depth = d;
            center = c;
          }
        };
        const cx = Math.round(Math.abs(x - (w - 1) / 2) * 2);
        const cy = Math.round(Math.abs(y - (h - 1) / 2) * 2);
        if (open[0]) consider(h - 1 - y, cx);
        if (open[1]) consider(y, cx);
        if (open[2]) consider(x, cy);
        if (open[3]) consider(w - 1 - x, cy);
        prio[i] = depth * 256 + center;
        if (open[0] && y === h - 1) edge[i] |= 1;
        if (open[1] && y === 0) edge[i] |= 2;
        if (open[2] && x === 0) edge[i] |= 4;
        if (open[3] && x === w - 1) edge[i] |= 8;
      }

    const colorCount = new Int32Array(colors);
    for (let i = 0; i < n; i++) if (cell[i] >= 0) colorCount[cell[i]]++;

    const maxId = level.boxes.reduce((m, b) => Math.max(m, b.id), -1) + 1;
    const boxColor = new Int16Array(maxId).fill(-1);
    const boxCount = new Int16Array(maxId);
    const boxLink = new Int16Array(maxId).fill(-1);
    const boxThaw = new Int16Array(maxId);
    const groups = new Map<number, number[]>();
    for (const b of level.boxes) {
      boxColor[b.id] = b.color;
      boxCount[b.id] = b.count;
      boxThaw[b.id] = b.frozen ?? 0;
      if (b.link !== undefined && b.link >= 0) {
        boxLink[b.id] = b.link;
        const g = groups.get(b.link);
        if (g) g.push(b.id);
        else groups.set(b.link, [b.id]);
      }
    }

    const sim = new Sim({
      w, h, colors, cell, zobA, zobB, prio, edge, colorCount,
      boxColor, boxCount, boxLink, boxThaw, groups, sides, open,
    });
    sim.eaten = new Uint8Array(n);
    sim.air = new Uint8Array(n);
    sim.reach = new Uint8Array(n);
    sim.heaps = Array.from({ length: colors }, (_, c) => new Int32Array(Math.max(1, colorCount[c])));
    sim.heapSize = new Int32Array(colors);
    sim.reachCount = new Int32Array(colors);
    sim.remaining = Int32Array.from(colorCount);
    sim.left = colorCount.reduce((a, b) => a + b, 0);
    // Flood the free space from every open side.
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!edge[i]) continue;
      if (cell[i] < 0) {
        if (!sim.air[i]) {
          sim.air[i] = 1;
          queue.push(i);
        }
      } else sim.markReach(i);
    }
    sim.flood(queue);

    sim.boxHidden = new Uint8Array(maxId);
    sim.boxWhere = new Uint8Array(maxId).fill(Where.Done);
    sim.boxCol = new Int16Array(maxId).fill(-1);
    for (const b of level.boxes) sim.boxHidden[b.id] = b.hidden ? 1 : 0;
    sim.columns = level.columns.map((c) => c.slice());
    sim.columns.forEach((col, ci) => {
      for (const id of col) {
        sim.boxWhere[id] = Where.Queue;
        sim.boxCol[id] = ci;
      }
      if (col.length) sim.boxHidden[col[0]] = 0;
    });
    sim.slots = new Array(level.slots).fill(null);
    return sim;
  }

  clone(): Sim {
    const c = new Sim(this.s);
    c.eaten = this.eaten.slice();
    c.air = this.air.slice();
    c.reach = this.reach.slice();
    c.heaps = this.heaps.map((hp, k) => {
      const copy = new Int32Array(hp.length);
      copy.set(hp.subarray(0, this.heapSize[k]));
      return copy;
    });
    c.heapSize = this.heapSize.slice();
    c.reachCount = this.reachCount.slice();
    c.remaining = this.remaining.slice();
    c.left = this.left;
    c.boxHidden = this.boxHidden.slice();
    c.boxWhere = this.boxWhere.slice();
    c.boxCol = this.boxCol.slice();
    c.columns = this.columns.map((col) => col.slice());
    c.slots = this.slots.map((sl) => (sl ? { box: sl.box, left: sl.left } : null));
    c.taps = this.taps;
    c.status = this.status;
    c.hashA = this.hashA;
    c.hashB = this.hashB;
    return c;
  }

  // ---------------------------------------------------------------- picture

  get w(): number { return this.s.w; }
  get h(): number { return this.s.h; }

  cellColor(i: number): number { return this.s.cell[i]; }

  /** Free cell (no cube or eaten). */
  isFree(i: number): boolean {
    return this.s.cell[i] < 0 || this.eaten[i] === 1;
  }

  /** Bitmask of open sides a border cell touches. */
  edgeMask(i: number): number {
    return this.s.edge[i];
  }

  private less(a: number, b: number): boolean {
    const pa = this.s.prio[a];
    const pb = this.s.prio[b];
    return pa < pb || (pa === pb && a < b);
  }

  private markReach(i: number): void {
    if (this.reach[i]) return;
    this.reach[i] = 1;
    const color = this.s.cell[i];
    this.reachCount[color]++;
    // heap push
    const hp = this.heaps[color];
    let k = this.heapSize[color]++;
    hp[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.less(hp[k], hp[p])) break;
      const t = hp[k];
      hp[k] = hp[p];
      hp[p] = t;
      k = p;
    }
  }

  private heapPop(color: number): void {
    const hp = this.heaps[color];
    const size = --this.heapSize[color];
    if (size <= 0) return;
    hp[0] = hp[size];
    let k = 0;
    for (;;) {
      const l = k * 2 + 1;
      const r = l + 1;
      let m = k;
      if (l < size && this.less(hp[l], hp[m])) m = l;
      if (r < size && this.less(hp[r], hp[m])) m = r;
      if (m === k) break;
      const t = hp[k];
      hp[k] = hp[m];
      hp[m] = t;
      k = m;
    }
  }

  /** Spread "air" from the queued free cells and mark every cube it touches as reachable. */
  private flood(queue: number[]): void {
    const { w, h, cell } = this.s;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % w;
      const y = (i - x) / w;
      for (let d = 0; d < 4; d++) {
        let nx = x;
        let ny = y;
        if (d === 0) ny++;
        else if (d === 1) ny--;
        else if (d === 2) nx--;
        else nx++;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (cell[j] < 0 || this.eaten[j]) {
          if (!this.air[j]) {
            this.air[j] = 1;
            queue.push(j);
          }
        } else this.markReach(j);
      }
    }
  }

  /** Best reachable cube of `color` (closest to an entrance), or -1. */
  findTarget(color: number): number {
    const hp = this.heaps[color];
    while (this.heapSize[color] > 0 && this.eaten[hp[0]]) this.heapPop(color);
    return this.heapSize[color] > 0 ? hp[0] : -1;
  }

  /** Number of reachable cubes per color (index = color). */
  exposedCounts(out?: Int32Array): Int32Array {
    const res = out ?? new Int32Array(this.s.colors);
    res.set(this.reachCount);
    return res;
  }

  /** Every reachable cube. */
  exposedCells(): number[] {
    const res: number[] = [];
    for (let i = 0; i < this.reach.length; i++) if (this.reach[i]) res.push(i);
    return res;
  }

  eatCell(i: number): void {
    const { w, h, cell, zobA, zobB, edge } = this.s;
    if (this.eaten[i] || cell[i] < 0) return;
    this.eaten[i] = 1;
    const color = cell[i];
    this.remaining[color]--;
    this.left--;
    this.hashA ^= zobA[i];
    this.hashB ^= zobB[i];
    if (this.reach[i]) {
      this.reach[i] = 0;
      this.reachCount[color]--;
    }
    // The freed cell joins the air if it touches the outside or existing air.
    const x = i % w;
    const y = (i - x) / w;
    let connected = edge[i] !== 0;
    if (!connected) {
      if (y + 1 < h && this.air[i + w]) connected = true;
      else if (y > 0 && this.air[i - w]) connected = true;
      else if (x > 0 && this.air[i - 1]) connected = true;
      else if (x + 1 < w && this.air[i + 1]) connected = true;
    }
    if (connected && !this.air[i]) {
      this.air[i] = 1;
      this.flood([i]);
    }
  }

  // ---------------------------------------------------------------- boxes

  boxColor(id: number): number { return this.s.boxColor[id]; }
  boxCount(id: number): number { return this.s.boxCount[id]; }
  boxLink(id: number): number { return this.s.boxLink[id]; }
  boxThawAt(id: number): number { return this.s.boxThaw[id]; }
  get boxIds(): number { return this.s.boxColor.length; }

  isFrozen(id: number): boolean {
    return this.taps < this.s.boxThaw[id];
  }

  /** Taps remaining until the box thaws (0 if not frozen). */
  frozenLeft(id: number): number {
    return Math.max(0, this.s.boxThaw[id] - this.taps);
  }

  groupOf(id: number): number[] {
    const l = this.s.boxLink[id];
    if (l < 0) return [id];
    return this.s.groups.get(l) ?? [id];
  }

  freeSlots(): number {
    let n = 0;
    for (const sl of this.slots) if (!sl) n++;
    return n;
  }

  private firstFreeSlot(): number {
    for (let i = 0; i < this.slots.length; i++) if (!this.slots[i]) return i;
    return -1;
  }

  /** True if the box is at the front of its column, or only has members of its own group in front of it. */
  isAvailable(id: number): boolean {
    if (this.boxWhere[id] !== Where.Queue) return false;
    const col = this.columns[this.boxCol[id]];
    const link = this.s.boxLink[id];
    for (const other of col) {
      if (other === id) return true;
      if (link < 0 || this.s.boxLink[other] !== link) return false;
    }
    return false;
  }

  /** Whether the group containing `id` can be taken right now. */
  canTake(id: number): boolean {
    if (this.status !== 'playing') return false;
    const group = this.groupOf(id);
    if (group.length > this.freeSlots()) return false;
    for (const m of group) {
      if (this.boxWhere[m] !== Where.Queue) return false;
      if (this.isFrozen(m)) return false;
      if (!this.isAvailable(m)) return false;
    }
    return true;
  }

  /** Why a box can't be taken — for UI feedback. */
  whyNot(id: number): 'ok' | 'frozen' | 'blocked' | 'slots' | 'link' | 'gone' {
    if (this.boxWhere[id] !== Where.Queue) return 'gone';
    const group = this.groupOf(id);
    for (const m of group) if (this.isFrozen(m)) return 'frozen';
    if (!this.isAvailable(id)) return 'blocked';
    for (const m of group) if (!this.isAvailable(m)) return 'link';
    if (group.length > this.freeSlots()) return 'slots';
    return 'ok';
  }

  /** Representative box ids of every legal take (one per group). */
  legalMoves(): number[] {
    const res: number[] = [];
    if (this.status !== 'playing' || this.freeSlots() === 0) return res;
    let seenLinks: number[] | null = null;
    for (const col of this.columns) {
      if (!col.length) continue;
      const f = col[0];
      const link = this.s.boxLink[f];
      if (link >= 0) {
        if (seenLinks?.includes(link)) continue;
        (seenLinks ??= []).push(link);
      }
      if (this.canTake(f)) res.push(f);
    }
    return res;
  }

  /** Take a box (and its linked partners) into slots. */
  take(id: number, ev?: SimEvent[]): boolean {
    if (!this.canTake(id)) return false;
    this.moveToSlots(this.groupOf(id), ev, false);
    return true;
  }

  /** Booster: take any non-frozen box from anywhere in the queue. */
  grab(id: number, ev?: SimEvent[]): boolean {
    if (this.status !== 'playing' || this.boxWhere[id] !== Where.Queue) return false;
    const group = this.groupOf(id);
    if (group.length > this.freeSlots()) return false;
    for (const m of group) if (this.boxWhere[m] !== Where.Queue || this.isFrozen(m)) return false;
    this.moveToSlots(group, ev, true);
    return true;
  }

  private moveToSlots(group: number[], ev: SimEvent[] | undefined, grabbed: boolean): void {
    for (const m of group) {
      const ci = this.boxCol[m];
      const col = this.columns[ci];
      const index = col.indexOf(m);
      col.splice(index, 1);
      const slot = this.firstFreeSlot();
      this.slots[slot] = { box: m, left: this.s.boxCount[m] };
      this.boxWhere[m] = Where.Slot;
      this.boxCol[m] = -1;
      if (this.boxHidden[m]) {
        this.boxHidden[m] = 0;
        ev?.push({ t: 'reveal', box: m });
      }
      ev?.push({ t: 'take', box: m, slot, col: ci, index, grabbed: grabbed || undefined });
    }
    this.taps++;
    this.afterQueueChange(ev);
  }

  private afterQueueChange(ev?: SimEvent[]): void {
    for (const col of this.columns) {
      if (col.length && this.boxHidden[col[0]]) {
        this.boxHidden[col[0]] = 0;
        ev?.push({ t: 'reveal', box: col[0] });
      }
    }
    if (ev) {
      for (const col of this.columns) {
        for (const id of col) if (this.s.boxThaw[id] === this.taps) ev.push({ t: 'thaw', box: id });
      }
    }
  }

  /** Booster: one more slot. */
  addSlot(): void {
    this.slots.push(null);
    if (this.status === 'stuck') this.status = 'playing';
  }

  /** Booster: shuffle plain (not linked, not frozen) boxes of the queue among their positions. */
  shuffle(rng: Rng, ev?: SimEvent[]): void {
    const positions: [number, number][] = [];
    const ids: number[] = [];
    this.columns.forEach((col, ci) =>
      col.forEach((id, idx) => {
        if (this.s.boxLink[id] < 0 && !this.isFrozen(id)) {
          positions.push([ci, idx]);
          ids.push(id);
        }
      }),
    );
    rng.shuffle(ids);
    positions.forEach(([ci, idx], k) => {
      this.columns[ci][idx] = ids[k];
      this.boxCol[ids[k]] = ci;
    });
    if (this.status === 'stuck') this.status = 'playing';
    this.afterQueueChange(ev);
  }

  // ---------------------------------------------------------------- dispatch

  /** One dispatch round: every occupied slot (left to right) sends at most one ant. Returns ants sent. */
  round(ev?: SimEvent[]): number {
    if (this.status !== 'playing') return 0;
    let sent = 0;
    for (let s = 0; s < this.slots.length; s++) {
      const sl = this.slots[s];
      if (!sl) continue;
      const color = this.s.boxColor[sl.box];
      const cell = this.findTarget(color);
      if (cell < 0) continue;
      this.eatCell(cell);
      sl.left--;
      sent++;
      ev?.push({ t: 'ant', slot: s, box: sl.box, cell, color, left: sl.left });
      if (sl.left <= 0) {
        this.slots[s] = null;
        this.boxWhere[sl.box] = Where.Done;
        ev?.push({ t: 'boxDone', slot: s, box: sl.box });
      }
    }
    if (this.left === 0 && this.status === 'playing') {
      this.status = 'won';
      ev?.push({ t: 'won' });
    }
    return sent;
  }

  /** True when no ant can be dispatched right now. */
  isQuiet(): boolean {
    for (const sl of this.slots) {
      if (sl && this.findTarget(this.s.boxColor[sl.box]) >= 0) return false;
    }
    return true;
  }

  /** Run rounds until nothing moves; then detect a stuck position. */
  settle(ev?: SimEvent[]): void {
    while (this.status === 'playing' && this.round(ev) > 0) { /* keep going */ }
    this.checkStuck(ev);
  }

  /** Call when quiet: marks the level stuck if no move is possible. */
  checkStuck(ev?: SimEvent[]): boolean {
    if (this.status !== 'playing') return this.status === 'stuck';
    if (this.left > 0 && this.isQuiet() && this.legalMoves().length === 0) {
      this.status = 'stuck';
      ev?.push({ t: 'stuck' });
      return true;
    }
    return false;
  }

  /** Reverts a 'stuck' status (after a booster changed the position). */
  unstick(): void {
    if (this.status === 'stuck') this.status = 'playing';
  }

  /** Compact key of the whole position, for memoization. */
  key(): string {
    let k = '';
    for (const col of this.columns) k += col.length + ',';
    k += '|';
    for (const sl of this.slots) k += sl ? sl.box + ':' + sl.left + ',' : '-,';
    return k + '|' + this.hashA + ',' + this.hashB + '|' + this.taps;
  }

  queueSize(): number {
    let n = 0;
    for (const col of this.columns) n += col.length;
    return n;
  }
}
