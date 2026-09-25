import { decodeCells, SIDES, type Fence, type LevelDef, type Side } from './types';
import type { Rng } from './rng';

/**
 * Deterministic game logic, shared by the game, the solver and the level generator.
 *
 * Rules:
 * - The picture is a grid of colored cubes inside a frame. Ants walk around the frame and come in
 *   from any side that isn't fenced off (fences may leave gates). Inside they walk over free space:
 *   empty cells and cells whose cube has been carried away. A cube is reachable when an ant can
 *   walk up to it from any direction.
 * - The player taps boxes at the front of the queue columns; a box moves into the leftmost free slot.
 * - Every dispatch round, each occupied slot (left to right) sends one ant to the reachable cube of
 *   its color with the shortest walk from the nest: around the frame to an entrance, then over the
 *   free cells (so a cube at the end of a long tunnel counts as far away). The ant claims the cube
 *   (no other ant will go for it), but the cube stays in place until the ant has walked there and
 *   grabbed it; only then does it free the way to the cubes behind it. A box whose ants are all out
 *   frees its slot.
 * - The level is won when every cube is gone. It is stuck when nothing can happen any more and no
 *   box can be taken (typically: every slot holds a color with no reachable cube).
 */

export const Where = { Queue: 0, Slot: 1, Done: 2 } as const;

/** Rounds from the slots to the bottom middle of the picture, plus time to grab a cube. */
const BASE_TRIP = 14;
/** Rounds to walk across the whole picture. */
const CROSS_TRIP = 28;
/** "Not reachable" walking distance. */
const INF = 0x3fffffff;
/** Distances are counted in half cells (the nest sits between two cells on even-width pictures). */
const STEP = 2;

export interface SlotState {
  /** Box id, or -1 for a virtual box used by the level generator. */
  box: number;
  color: number;
  left: number;
}

export type SimEvent =
  | { t: 'ant'; slot: number; box: number; cell: number; color: number; left: number; due: number }
  | { t: 'pickup'; cell: number }
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
  /** For border cells ants can enter through: half-steps around the frame from the nest (else INF). */
  entry: Int32Array;
  maxDim: number;
  /** For border cells: bitmask of open sides they touch (1 bottom, 2 top, 4 left, 8 right). */
  edge: Uint8Array;
  colorCount: Int32Array;
  boxColor: Int16Array;
  boxCount: Int16Array;
  boxLink: Int16Array;
  boxThaw: Int16Array;
  groups: Map<number, number[]>;
  fences: Fence[];
  /** Per side (SIDES order): at least one cell of it lets ants in. */
  open: boolean[];
}

export class Sim {
  readonly s: Shared;
  /** Cube carried off. */
  eaten: Uint8Array;
  /** Cube claimed by an ant that is on its way (still in place). */
  claimed: Uint8Array;
  /** Free cell (empty or eaten) connected to the outside. */
  air: Uint8Array;
  /** Uneaten cube an ant can walk up to. */
  reach: Uint8Array;
  /** Walking distance (half-steps) from the nest to a free cell connected to the outside (else INF). */
  dist: Int32Array;
  /** Walking distance (half-steps) from the nest to a reachable cube (else INF). */
  rd: Int32Array;
  /**
   * Per color: binary min-heap of (distance * 4096 + cell) for reachable cubes. Entries go stale
   * when a cube is eaten, claimed or gets closer; they are skipped when popped.
   */
  heaps: Int32Array[];
  heapSize: Int32Array;
  /** Reachable and unclaimed cubes per color. */
  reachCount: Int32Array;
  /** Cubes still in the picture per color (claimed ones included). */
  remaining: Int32Array;
  left: number;
  /** Pending pickups: min-heap of (due round * 4096 + cell). */
  pending: number[];
  roundNo: number;
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
    this.claimed = new Uint8Array(0);
    this.air = new Uint8Array(0);
    this.reach = new Uint8Array(0);
    this.dist = new Int32Array(0);
    this.rd = new Int32Array(0);
    this.heaps = [];
    this.heapSize = new Int32Array(0);
    this.reachCount = new Int32Array(0);
    this.remaining = new Int32Array(0);
    this.left = 0;
    this.pending = [];
    this.roundNo = 0;
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
    // Which border cells ants can enter through (per side, along the side).
    const fences = level.fences ?? [];
    const gate = SIDES.map((sd) => {
      const len = sd === 'bottom' || sd === 'top' ? w : h;
      const row = new Uint8Array(len).fill(1);
      for (const f of fences) if (f.side === sd) for (let k = Math.max(0, f.from); k < Math.min(len, f.to); k++) row[k] = 0;
      return row;
    });
    const open = gate.map((row) => row.includes(1));

    // Ants come from below the middle of the picture (slots and nest are there) and walk around the
    // frame to an entrance: the cost of stepping into each open border cell.
    const entry = new Int32Array(n).fill(INF);
    const edge = new Uint8Array(n);
    const cx = (w - 1) / 2;
    const [gB, gT, gL, gR] = gate;
    const at = (i: number, cost: number, bit: number) => {
      entry[i] = Math.min(entry[i], Math.round(cost * STEP));
      edge[i] |= bit;
    };
    for (let x = 0; x < w; x++) {
      if (gB[x]) at((h - 1) * w + x, Math.abs(x - cx), 1);
      if (gT[x]) at(x, cx + h + Math.min(x, w - 1 - x), 2);
    }
    for (let y = 0; y < h; y++) {
      if (gL[y]) at(y * w, cx + (h - 1 - y), 4);
      if (gR[y]) at(y * w + w - 1, cx + (h - 1 - y), 8);
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
      w, h, colors, cell, zobA, zobB, entry, maxDim: Math.max(w, h), edge, colorCount,
      boxColor, boxCount, boxLink, boxThaw, groups, fences, open,
    });
    sim.eaten = new Uint8Array(n);
    sim.claimed = new Uint8Array(n);
    sim.air = new Uint8Array(n);
    sim.reach = new Uint8Array(n);
    sim.dist = new Int32Array(n).fill(INF);
    sim.rd = new Int32Array(n).fill(INF);
    sim.heaps = Array.from({ length: colors }, (_, c) => new Int32Array(Math.max(8, colorCount[c] * 2)));
    sim.heapSize = new Int32Array(colors);
    sim.reachCount = new Int32Array(colors);
    sim.remaining = Int32Array.from(colorCount);
    sim.left = colorCount.reduce((a, b) => a + b, 0);
    // Walk in from every entrance: empty border cells become walkable, border cubes reachable.
    const starts: number[] = [];
    for (let i = 0; i < n; i++) {
      if (entry[i] >= INF) continue;
      if (cell[i] < 0) {
        sim.air[i] = 1;
        sim.dist[i] = entry[i];
        starts.push(i);
      } else sim.offer(i, entry[i]);
    }
    sim.spread(starts);

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
    c.claimed = this.claimed.slice();
    c.air = this.air.slice();
    c.reach = this.reach.slice();
    c.dist = this.dist.slice();
    c.rd = this.rd.slice();
    c.heaps = this.heaps.map((hp, k) => {
      const size = this.heapSize[k];
      const copy = new Int32Array(Math.max(8, size + (size >> 1)));
      copy.set(hp.subarray(0, size));
      return copy;
    });
    c.heapSize = this.heapSize.slice();
    c.reachCount = this.reachCount.slice();
    c.remaining = this.remaining.slice();
    c.left = this.left;
    c.pending = this.pending.slice();
    c.roundNo = this.roundNo;
    c.boxHidden = this.boxHidden.slice();
    c.boxWhere = this.boxWhere.slice();
    c.boxCol = this.boxCol.slice();
    c.columns = this.columns.map((col) => col.slice());
    c.slots = this.slots.map((sl) => (sl ? { box: sl.box, color: sl.color, left: sl.left } : null));
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

  /** Free cell (no cube or carried off). */
  isFree(i: number): boolean {
    return this.s.cell[i] < 0 || this.eaten[i] === 1;
  }

  /** Bitmask of open sides a border cell touches. */
  edgeMask(i: number): number {
    return this.s.edge[i];
  }

  isOpen(side: Side): boolean {
    return this.s.open[SIDES.indexOf(side)];
  }

  /** Ants can now reach cube `i` in `d` steps (if that's closer than before). */
  private offer(i: number, d: number): void {
    if (d >= this.rd[i]) return;
    const color = this.s.cell[i];
    if (!this.reach[i]) {
      this.reach[i] = 1;
      if (!this.claimed[i]) this.reachCount[color]++;
    }
    this.rd[i] = d;
    let hp = this.heaps[color];
    let k = this.heapSize[color]++;
    if (k >= hp.length) {
      const bigger = new Int32Array(hp.length * 2);
      bigger.set(hp);
      this.heaps[color] = hp = bigger;
    }
    const key = d * 4096 + i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hp[p] <= key) break;
      hp[k] = hp[p];
      k = p;
    }
    hp[k] = key;
  }

  private heapPop(color: number): void {
    const hp = this.heaps[color];
    const size = --this.heapSize[color];
    if (size <= 0) return;
    const last = hp[size];
    let k = 0;
    for (;;) {
      const l = k * 2 + 1;
      if (l >= size) break;
      const r = l + 1;
      const m = r < size && hp[r] < hp[l] ? r : l;
      if (hp[m] >= last) break;
      hp[k] = hp[m];
      k = m;
    }
    hp[k] = last;
  }

  /**
   * Walking distances changed at the given free cells (their `dist` is set): spread the
   * improvement over the free cells and offer the cubes next to them. Distances only grow along
   * the way, so a bucket queue keeps it a shortest-path search.
   */
  private spread(start: number[]): void {
    const { w, h, cell } = this.s;
    const buckets: number[][] = [];
    let lo = INF;
    for (const i of start) {
      const d = this.dist[i];
      (buckets[d] ??= []).push(i);
      if (d < lo) lo = d;
    }
    for (let d = lo; d < buckets.length; d++) {
      const b = buckets[d];
      if (!b) continue;
      for (let k = 0; k < b.length; k++) {
        const i = b[k];
        if (this.dist[i] !== d) continue;
        const x = i % w;
        const y = (i - x) / w;
        for (let dir = 0; dir < 4; dir++) {
          let j: number;
          if (dir === 0) { if (y + 1 >= h) continue; j = i + w; }
          else if (dir === 1) { if (y === 0) continue; j = i - w; }
          else if (dir === 2) { if (x === 0) continue; j = i - 1; }
          else { if (x + 1 >= w) continue; j = i + 1; }
          const nd = d + STEP;
          if (cell[j] < 0 || this.eaten[j]) {
            if (nd < this.dist[j]) {
              this.air[j] = 1;
              this.dist[j] = nd;
              (buckets[nd] ??= []).push(j);
            }
          } else this.offer(j, nd);
        }
      }
    }
  }

  /** Closest reachable, unclaimed cube of `color`, or -1. */
  findTarget(color: number): number {
    const hp = this.heaps[color];
    while (this.heapSize[color] > 0) {
      const top = hp[0];
      const c = top & 4095;
      if (!this.eaten[c] && !this.claimed[c] && this.rd[c] === (top - c) / 4096) return c;
      this.heapPop(color);
    }
    return -1;
  }

  /** Cells to walk from the nest to a reachable cube (Infinity if it can't be reached). */
  walkTo(i: number): number {
    return this.rd[i] >= INF ? Infinity : this.rd[i] / STEP;
  }

  /** Reachable, unclaimed cubes per color (index = color). */
  exposedCounts(out?: Int32Array): Int32Array {
    const res = out ?? new Int32Array(this.s.colors);
    res.set(this.reachCount);
    return res;
  }

  /** Every reachable, unclaimed cube. */
  exposedCells(): number[] {
    const res: number[] = [];
    for (let i = 0; i < this.reach.length; i++) if (this.reach[i] && !this.claimed[i]) res.push(i);
    return res;
  }

  /** Rounds an ant needs to walk to cube `i` and grab it. */
  tripTo(i: number): number {
    return BASE_TRIP + Math.min(240, Math.round((CROSS_TRIP * this.rd[i]) / (STEP * this.s.maxDim)));
  }

  /** An ant sets off for this cube. */
  private claim(i: number): void {
    this.claimed[i] = 1;
    if (this.reach[i]) this.reachCount[this.s.cell[i]]--;
    this.pending.push((this.roundNo + this.tripTo(i)) * 4096 + i);
    // sift up
    let k = this.pending.length - 1;
    const pd = this.pending;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (pd[p] <= pd[k]) break;
      const t = pd[k];
      pd[k] = pd[p];
      pd[p] = t;
      k = p;
    }
  }

  private popPending(): number {
    const pd = this.pending;
    const top = pd[0];
    const last = pd.pop()!;
    if (pd.length) {
      pd[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < pd.length && pd[l] < pd[m]) m = l;
        if (r < pd.length && pd[r] < pd[m]) m = r;
        if (m === k) break;
        const t = pd[k];
        pd[k] = pd[m];
        pd[m] = t;
        k = m;
      }
    }
    return top;
  }

  /** The cube is carried off: free its cell and open the way to its neighbours. */
  eatCell(i: number): void {
    const { cell, zobA, zobB } = this.s;
    if (this.eaten[i] || cell[i] < 0) return;
    this.eaten[i] = 1;
    const color = cell[i];
    if (this.reach[i] && !this.claimed[i]) this.reachCount[color]--;
    this.reach[i] = 0;
    this.claimed[i] = 0;
    this.remaining[color]--;
    this.left--;
    this.hashA ^= zobA[i];
    this.hashB ^= zobB[i];
    // The ants now walk where the cube was: it's as far from the nest as the cube was.
    const d = this.rd[i];
    this.rd[i] = INF;
    if (d < this.dist[i]) {
      this.air[i] = 1;
      this.dist[i] = d;
      this.spread([i]);
    }
  }

  /** Complete every pickup that is still on its way (used when restoring an undo snapshot). */
  flushPending(ev?: SimEvent[]): void {
    while (this.pending.length) {
      const cell = this.popPending() % 4096;
      this.eatCell(cell);
      ev?.push({ t: 'pickup', cell });
    }
    if (this.left === 0 && this.status === 'playing') {
      this.status = 'won';
      ev?.push({ t: 'won' });
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

  whyNot(id: number): 'ok' | 'frozen' | 'blocked' | 'slots' | 'link' | 'gone' {
    if (this.boxWhere[id] !== Where.Queue) return 'gone';
    const group = this.groupOf(id);
    for (const m of group) if (this.isFrozen(m)) return 'frozen';
    if (!this.isAvailable(id)) return 'blocked';
    for (const m of group) if (!this.isAvailable(m)) return 'link';
    if (group.length > this.freeSlots()) return 'slots';
    return 'ok';
  }

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

  take(id: number, ev?: SimEvent[]): boolean {
    if (!this.canTake(id)) return false;
    this.moveToSlots(this.groupOf(id), ev, false);
    return true;
  }

  grab(id: number, ev?: SimEvent[]): boolean {
    if (this.status !== 'playing' || this.boxWhere[id] !== Where.Queue) return false;
    const group = this.groupOf(id);
    if (group.length > this.freeSlots()) return false;
    for (const m of group) if (this.boxWhere[m] !== Where.Queue || this.isFrozen(m)) return false;
    this.moveToSlots(group, ev, true);
    return true;
  }

  /** Generator helper: put a virtual box of `color` with `count` ants into a free slot. */
  putVirtual(color: number, count: number): boolean {
    const slot = this.firstFreeSlot();
    if (slot < 0) return false;
    this.slots[slot] = { box: -1, color, left: count };
    return true;
  }

  private moveToSlots(group: number[], ev: SimEvent[] | undefined, grabbed: boolean): void {
    for (const m of group) {
      const ci = this.boxCol[m];
      const col = this.columns[ci];
      const index = col.indexOf(m);
      col.splice(index, 1);
      const slot = this.firstFreeSlot();
      this.slots[slot] = { box: m, color: this.s.boxColor[m], left: this.s.boxCount[m] };
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

  addSlot(): void {
    this.slots.push(null);
    if (this.status === 'stuck') this.status = 'playing';
  }

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

  /**
   * One round: cubes whose ants have arrived are carried off, then every occupied slot (left to
   * right) sends at most one ant. Returns > 0 while anything is still going on.
   */
  round(ev?: SimEvent[]): number {
    if (this.status !== 'playing') return 0;
    let activity = 0;
    while (this.pending.length && Math.floor(this.pending[0] / 4096) <= this.roundNo) {
      const cell = this.popPending() % 4096;
      this.eatCell(cell);
      activity++;
      ev?.push({ t: 'pickup', cell });
    }
    for (let s = 0; s < this.slots.length; s++) {
      const sl = this.slots[s];
      if (!sl) continue;
      const cell = this.findTarget(sl.color);
      if (cell < 0) continue;
      this.claim(cell);
      sl.left--;
      activity++;
      ev?.push({ t: 'ant', slot: s, box: sl.box, cell, color: sl.color, left: sl.left, due: this.roundNo + this.tripTo(cell) });
      if (sl.left <= 0) {
        this.slots[s] = null;
        if (sl.box >= 0) this.boxWhere[sl.box] = Where.Done;
        ev?.push({ t: 'boxDone', slot: s, box: sl.box });
      }
    }
    this.roundNo++;
    if (this.left === 0 && this.status === 'playing') {
      this.status = 'won';
      ev?.push({ t: 'won' });
      return activity;
    }
    return activity + this.pending.length;
  }

  /** True when no ant can be dispatched and none is still on its way. */
  isQuiet(): boolean {
    if (this.pending.length) return false;
    for (const sl of this.slots) {
      if (sl && this.findTarget(sl.color) >= 0) return false;
    }
    return true;
  }

  settle(ev?: SimEvent[]): void {
    while (this.status === 'playing' && this.round(ev) > 0) { /* keep going */ }
    this.checkStuck(ev);
  }

  checkStuck(ev?: SimEvent[]): boolean {
    if (this.status !== 'playing') return this.status === 'stuck';
    if (this.left > 0 && this.isQuiet() && this.legalMoves().length === 0) {
      this.status = 'stuck';
      ev?.push({ t: 'stuck' });
      return true;
    }
    return false;
  }

  unstick(): void {
    if (this.status === 'stuck') this.status = 'playing';
  }

  key(): string {
    let k = '';
    for (const col of this.columns) k += col.length + ',';
    k += '|';
    for (const sl of this.slots) k += sl ? sl.box + ':' + sl.left + ',' : '-,';
    return k + '|' + this.hashA + ',' + this.hashB + '|' + this.taps + '|' + this.pending.length;
  }

  queueSize(): number {
    let n = 0;
    for (const col of this.columns) n += col.length;
    return n;
  }
}
