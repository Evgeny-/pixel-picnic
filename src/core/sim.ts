import { decodeCells, SIDES, type LevelDef, type Side } from './types';
import type { Rng } from './rng';

/**
 * Deterministic game logic, shared by the game, the solver and the level generator.
 *
 * Rules:
 * - The picture is a grid of colored cubes. Ants enter through the open sides of the frame
 *   (bottom by default) and can only reach the first remaining cube along each line from an
 *   open side (e.g. the lowest cube of every column when only the bottom is open).
 * - The player taps boxes at the front of the queue columns; a box moves into the leftmost free slot.
 * - Every dispatch round, each occupied slot (left to right) sends one ant to the best reachable
 *   cube of its color. The cube is claimed immediately (logically eaten), which may expose the
 *   next cube along that line. A box whose ants are all out frees its slot.
 * - The level is won when every cube is eaten. It is stuck when nothing can be dispatched and no
 *   box can be taken (typically: every slot holds a color with no reachable cube).
 */

export const Where = { Queue: 0, Slot: 1, Done: 2 } as const;

export interface SlotState {
  box: number;
  left: number;
}

export type SimEvent =
  | { t: 'ant'; slot: number; box: number; cell: number; color: number; left: number; side: Side }
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
  colCenter: Int16Array;
  rowCenter: Int16Array;
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
  remaining: Int32Array;
  left: number;
  /** Per side (bottom, top, left, right): pointer per line to the first reachable cell coordinate, -1 if none. */
  ptr: Int16Array[];
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
    this.remaining = new Int32Array(0);
    this.left = 0;
    this.ptr = [];
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
    const colCenter = new Int16Array(w);
    for (let x = 0; x < w; x++) colCenter[x] = Math.floor(Math.abs(x - (w - 1) / 2) * 2);
    const rowCenter = new Int16Array(h);
    for (let y = 0; y < h; y++) rowCenter[y] = Math.floor(Math.abs(y - (h - 1) / 2) * 2);

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
    const sides = level.sides.length ? level.sides.slice() : (['bottom'] as Side[]);
    const open = SIDES.map((sd) => sides.includes(sd));

    const sim = new Sim({
      w, h, colors, cell, zobA, zobB, colCenter, rowCenter,
      boxColor, boxCount, boxLink, boxThaw, groups, sides, open,
    });
    sim.eaten = new Uint8Array(n);
    sim.remaining = new Int32Array(colors);
    for (let i = 0; i < n; i++) {
      if (cell[i] >= 0) {
        sim.remaining[cell[i]]++;
        sim.left++;
      }
    }
    sim.ptr = [new Int16Array(w), new Int16Array(w), new Int16Array(h), new Int16Array(h)];
    for (let x = 0; x < w; x++) {
      sim.ptr[0][x] = sim.scanCol(x, h - 1, -1);
      sim.ptr[1][x] = sim.scanCol(x, 0, 1);
    }
    for (let y = 0; y < h; y++) {
      sim.ptr[2][y] = sim.scanRow(0, y, 1);
      sim.ptr[3][y] = sim.scanRow(w - 1, y, -1);
    }
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
    c.remaining = this.remaining.slice();
    c.left = this.left;
    c.ptr = this.ptr.map((p) => p.slice());
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

  private scanCol(x: number, y: number, dy: number): number {
    const { w, h, cell } = this.s;
    for (; y >= 0 && y < h; y += dy) {
      const i = y * w + x;
      if (cell[i] >= 0 && !this.eaten[i]) return y;
    }
    return -1;
  }

  private scanRow(x: number, y: number, dx: number): number {
    const { w, cell } = this.s;
    for (; x >= 0 && x < w; x += dx) {
      const i = y * w + x;
      if (cell[i] >= 0 && !this.eaten[i]) return x;
    }
    return -1;
  }

  /**
   * Best reachable cell of `color`, encoded as cell*4 + sideIndex, or -1.
   * Preference: shallowest cell (closest to its open edge), then lines closest to the center.
   */
  findTarget(color: number): number {
    const { w, h, cell, open, colCenter, rowCenter } = this.s;
    let best = -1;
    let bestPrio = 1 << 30;
    if (open[0]) {
      const p = this.ptr[0];
      for (let x = 0; x < w; x++) {
        const y = p[x];
        if (y < 0) continue;
        const i = y * w + x;
        if (cell[i] !== color) continue;
        const pr = (h - 1 - y) * 1000 + colCenter[x] * 4;
        if (pr < bestPrio) { bestPrio = pr; best = i * 4; }
      }
    }
    if (open[1]) {
      const p = this.ptr[1];
      for (let x = 0; x < w; x++) {
        const y = p[x];
        if (y < 0) continue;
        const i = y * w + x;
        if (cell[i] !== color) continue;
        const pr = y * 1000 + colCenter[x] * 4 + 1;
        if (pr < bestPrio) { bestPrio = pr; best = i * 4 + 1; }
      }
    }
    if (open[2]) {
      const p = this.ptr[2];
      for (let y = 0; y < h; y++) {
        const x = p[y];
        if (x < 0) continue;
        const i = y * w + x;
        if (cell[i] !== color) continue;
        const pr = x * 1000 + rowCenter[y] * 4 + 2;
        if (pr < bestPrio) { bestPrio = pr; best = i * 4 + 2; }
      }
    }
    if (open[3]) {
      const p = this.ptr[3];
      for (let y = 0; y < h; y++) {
        const x = p[y];
        if (x < 0) continue;
        const i = y * w + x;
        if (cell[i] !== color) continue;
        const pr = (w - 1 - x) * 1000 + rowCenter[y] * 4 + 3;
        if (pr < bestPrio) { bestPrio = pr; best = i * 4 + 3; }
      }
    }
    return best;
  }

  /** Number of distinct reachable cells per color (index = color). */
  exposedCounts(out?: Int32Array): Int32Array {
    const { w, h, cell, open, colors } = this.s;
    const res = out ?? new Int32Array(colors);
    res.fill(0);
    const seen = this.s.sides.length > 1 ? new Set<number>() : null;
    const add = (i: number) => {
      if (seen) {
        if (seen.has(i)) return;
        seen.add(i);
      }
      res[cell[i]]++;
    };
    if (open[0]) for (let x = 0; x < w; x++) { const y = this.ptr[0][x]; if (y >= 0) add(y * w + x); }
    if (open[1]) for (let x = 0; x < w; x++) { const y = this.ptr[1][x]; if (y >= 0) add(y * w + x); }
    if (open[2]) for (let y = 0; y < h; y++) { const x = this.ptr[2][y]; if (x >= 0) add(y * w + x); }
    if (open[3]) for (let y = 0; y < h; y++) { const x = this.ptr[3][y]; if (x >= 0) add(y * w + x); }
    return res;
  }

  /** List of currently reachable cell indices (deduplicated). */
  exposedCells(): number[] {
    const { w, h, open } = this.s;
    const set = new Set<number>();
    if (open[0]) for (let x = 0; x < w; x++) { const y = this.ptr[0][x]; if (y >= 0) set.add(y * w + x); }
    if (open[1]) for (let x = 0; x < w; x++) { const y = this.ptr[1][x]; if (y >= 0) set.add(y * w + x); }
    if (open[2]) for (let y = 0; y < h; y++) { const x = this.ptr[2][y]; if (x >= 0) set.add(y * w + x); }
    if (open[3]) for (let y = 0; y < h; y++) { const x = this.ptr[3][y]; if (x >= 0) set.add(y * w + x); }
    return [...set];
  }

  eatCell(i: number): void {
    const { w, cell, open, zobA, zobB } = this.s;
    this.eaten[i] = 1;
    this.remaining[cell[i]]--;
    this.left--;
    this.hashA ^= zobA[i];
    this.hashB ^= zobB[i];
    const x = i % w;
    const y = (i - x) / w;
    if (open[0] && this.ptr[0][x] === y) this.ptr[0][x] = this.scanCol(x, y - 1, -1);
    if (open[1] && this.ptr[1][x] === y) this.ptr[1][x] = this.scanCol(x, y + 1, 1);
    if (open[2] && this.ptr[2][y] === x) this.ptr[2][y] = this.scanRow(x + 1, y, 1);
    if (open[3] && this.ptr[3][y] === x) this.ptr[3][y] = this.scanRow(x - 1, y, -1);
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
      const t = this.findTarget(color);
      if (t < 0) continue;
      const cell = t >> 2;
      this.eatCell(cell);
      sl.left--;
      sent++;
      ev?.push({ t: 'ant', slot: s, box: sl.box, cell, color, left: sl.left, side: SIDES[t & 3] });
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
