import type { Sim } from '../core/sim';
import type { Layout } from './layout';

export interface BoardRect { x0: number; x1: number; z0: number; z1: number }
export interface BoardPath { inside: number[]; block: number[]; blockD: number[] }

/** Gate-aware paths, independent of the character geometry and animation. */
export class BoardPathPlanner {
  private sim!: Sim;
  private layout!: Layout;
  private rect!: BoardRect;
  private antSize = 0.46;
  private bfsDist = new Int32Array(0);
  private bfsPrev = new Int32Array(0);
  private bfsQueue = new Int32Array(0);

  private cellXZ(i: number, out: { x: number; z: number }): { x: number; z: number } {
    const l = this.layout;
    const w = this.sim.w;
    const x = i % w;
    out.x = l.picX0 + (x + 0.5) * l.cell;
    out.z = l.picZ0 + ((i - x) / w + 0.5) * l.cell;
    return out;
  }

  /** Point just outside the frame where an ant enters to reach border cell `i` through `side` bit. */
  private exitPoint(i: number, bit: number): { x: number; z: number } {
    const p = this.cellXZ(i, { x: 0, z: 0 });
    const r = this.rect;
    if (bit === 1) p.z = r.z1 + 0.25;
    else if (bit === 2) p.z = r.z0 - 0.25;
    else if (bit === 4) p.x = r.x0 - 0.25;
    else p.x = r.x1 + 0.25;
    return p;
  }

  /**
   * Path inside the frame to a cube: breadth-first search from the cube over free cells to an
   * open side, preferring entrances close to where the ant starts, then smoothed into straight
   * runs. Returns world waypoints (entrance first) and the cells an ant must wait for.
   */
  plan(sim: Sim, layout: Layout, rect: BoardRect, antSize: number, target: number, sx: number, sz: number): BoardPath | null {
    this.sim = sim;
    this.layout = layout;
    this.rect = rect;
    this.antSize = antSize;
    const w = sim.w;
    const h = sim.h;
    const n = w * h;
    const l = this.layout;
    const cellSize = l.cell;
    if (this.bfsDist.length !== n) {
      this.bfsDist = new Int32Array(n);
      this.bfsPrev = new Int32Array(n);
      this.bfsQueue = new Int32Array(n);
    }
    const dist = this.bfsDist.fill(-1);
    const prev = this.bfsPrev;
    const free = (i: number) => sim.isFree(i) && sim.air[i] === 1;
    let bestCost = Infinity;
    let bestCell = -1;
    let bestBit = 0;
    const tryExit = (i: number, d: number) => {
      const mask = sim.edgeMask(i);
      if (mask === 0) return;
      const col = i % w;
      const centerX = l.picX0 + (col + 0.5) * cellSize;
      const centerZ = l.picZ0 + ((i - col) / w + 0.5) * cellSize;
      // Preserve the original bottom/top/left/right tie order without allocating
      // side arrays or temporary point objects for every BFS cell.
      for (let bit = 1; bit <= 8; bit <<= 1) {
        if (!(mask & bit)) continue;
        const exitX = bit === 4 ? rect.x0 - 0.25 : bit === 8 ? rect.x1 + 0.25 : centerX;
        const exitZ = bit === 1 ? rect.z1 + 0.25 : bit === 2 ? rect.z0 - 0.25 : centerZ;
        const cost = d * cellSize + Math.hypot(exitX - sx, exitZ - sz) * 0.8;
        if (cost < bestCost) {
          bestCost = cost;
          bestCell = i;
          bestBit = bit;
        }
      }
    };
    dist[target] = 0;
    tryExit(target, 0);
    const queue = this.bfsQueue;
    let tail = 0;
    queue[tail++] = target;
    for (let qi = 0; qi < tail; qi++) {
      const c = queue[qi];
      const x = c % w;
      const y = (c - x) / w;
      for (let d = 0; d < 4; d++) {
        const nx = d === 2 ? x - 1 : d === 3 ? x + 1 : x;
        const ny = d === 0 ? y + 1 : d === 1 ? y - 1 : y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] >= 0 || !free(j)) continue;
        dist[j] = dist[c] + 1;
        prev[j] = c;
        tryExit(j, dist[j]);
        queue[tail++] = j;
      }
    }
    const tp = this.cellXZ(target, { x: 0, z: 0 });
    const desiredReach = cellSize * 0.5 + this.antSize * 0.4;
    const pts: number[] = [];
    if (bestCell < 0) {
      // Never invent a path through a closed fence. The pickup callback handles missing visuals.
      return null;
    }
    const e = this.exitPoint(bestCell, bestBit);
    const jitter = (Math.random() - 0.5) * cellSize * 0.35;
    const vertical = bestBit === 1 || bestBit === 2;
    pts.push(e.x + (vertical ? jitter : 0), e.z + (vertical ? 0 : jitter));
    // cell chain from the entrance towards the target
    const chain: number[] = [];
    for (let c = bestCell; c !== target; c = prev[c]) chain.push(c);
    const tmp = { x: 0, z: 0 };
    for (const c of chain) {
      this.cellXZ(c, tmp);
      pts.push(tmp.x, tmp.z);
    }
    // approach point: next to the cube, on the side the ant comes from
    const fromX = chain.length ? pts[pts.length - 2] : e.x;
    const fromZ = chain.length ? pts[pts.length - 1] : e.z;
    let dx = fromX - tp.x;
    let dz = fromZ - tp.z;
    const len = Math.hypot(dx, dz) || 1;
    // On dense pictures the character is larger than one cell. Stop between the
    // last free waypoint and the cube instead of backing out through the gate.
    const reach = Math.min(desiredReach, len * 0.9);
    dx /= len;
    dz /= len;
    pts.push(tp.x + dx * reach, tp.z + dz * reach);
    // Keep the entrance-to-border-cell segment intact. Smoothing from the outside point
    // used to cut diagonally through fences after the empty space behind them opened up.
    const smooth = chain.length ? [pts[0], pts[1], ...this.smoothPath(pts.slice(2), target)] : pts;
    const { block, blockD } = this.blockingCells(smooth, target);
    return { inside: smooth, block, blockD };
  }

  /** Is the segment walkable: every sampled point inside the picture lies on free space? */
  private walkable(ax: number, az: number, bx: number, bz: number, target: number): boolean {
    const l = this.layout;
    const w = this.sim.w;
    const h = this.sim.h;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (l.cell * 0.3)));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = Math.floor((ax + (bx - ax) * t - l.picX0) / l.cell);
      const y = Math.floor((az + (bz - az) * t - l.picZ0) / l.cell);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (i === target) continue;
      if (!this.sim.isFree(i) || !this.sim.air[i]) return false;
    }
    return true;
  }

  /** Greedy string pulling: skip waypoints while the straight line stays in free space. */
  private smoothPath(pts: number[], target: number): number[] {
    const m = pts.length / 2;
    if (m <= 2) return pts;
    const out = [pts[0], pts[1]];
    let i = 0;
    while (i < m - 1) {
      let j = Math.min(m - 1, i + 14);
      while (j > i + 1 && !this.walkable(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], target)) j--;
      out.push(pts[j * 2], pts[j * 2 + 1]);
      i = j;
    }
    return out;
  }

  /** Cubes along the path that may still physically be there (claimed by other ants). */
  private blockingCells(pts: number[], target: number): { block: number[]; blockD: number[] } {
    const l = this.layout;
    const w = this.sim.w;
    const h = this.sim.h;
    const block: number[] = [];
    const blockD: number[] = [];
    const seen = new Set<number>();
    let acc = 0;
    const margin = this.antSize * 0.45;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k];
      const az = pts[k + 1];
      const bx = pts[k + 2];
      const bz = pts[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / (l.cell * 0.25)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = Math.floor((ax + (bx - ax) * t - l.picX0) / l.cell);
        const y = Math.floor((az + (bz - az) * t - l.picZ0) / l.cell);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (i === target || seen.has(i) || this.sim.cellColor(i) < 0) continue;
        seen.add(i);
        block.push(i);
        blockD.push(Math.max(0, acc + len * t - margin));
      }
      acc += len;
    }
    return { block, blockD };
  }

}
