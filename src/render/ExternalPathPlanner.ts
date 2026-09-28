import type { Layout } from './layout';

export interface ObstacleRect { x0: number; x1: number; z0: number; z1: number }

/** The solid tray, padded for the whole creature (including its swinging tail). */
export function slotObstacle(l: Layout, clearance: number): ObstacleRect {
  // QueueView's tray includes a .275 lip and .06 bevel beyond the slot itself.
  const half = l.slotSize / 2 + 0.335 + clearance;
  return {
    x0: l.slot[0].x - half, x1: l.slot[l.slot.length - 1].x + half,
    z0: l.slot[0].z - half, z1: l.slot[0].z + half,
  };
}

export function queueObstacle(l: Layout, clearance: number): ObstacleRect {
  const half = l.boxSize / 2 + 0.08 + clearance;
  const lastZ = l.queueZ0 + Math.max(0, l.queueRowsVisible - 1) * l.queueRow;
  return {
    x0: l.queueCol[0] - half, x1: l.queueCol[l.queueCol.length - 1] + half,
    z0: Math.min(l.queueZ0, lastZ) - half, z1: Math.max(l.queueZ0, lastZ) + half,
  };
}

/** True only when a segment enters the rectangle, not when it touches an edge/corner. */
export function crossesObstacle(r: ObstacleRect, ax: number, az: number, bx: number, bz: number): boolean {
  const epsilon = 1e-6;
  const x0 = r.x0 + epsilon, x1 = r.x1 - epsilon;
  const z0 = r.z0 + epsilon, z1 = r.z1 - epsilon;
  if (x0 >= x1 || z0 >= z1) return false;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < epsilon) {
    if (ax < x0 || ax > x1) return false;
  } else {
    const tx0 = (x0 - ax) / dx, tx1 = (x1 - ax) / dx;
    t0 = Math.max(t0, Math.min(tx0, tx1));
    t1 = Math.min(t1, Math.max(tx0, tx1));
  }
  if (Math.abs(dz) < epsilon) {
    if (az < z0 || az > z1) return false;
  } else {
    const tz0 = (z0 - az) / dz, tz1 = (z1 - az) / dz;
    t0 = Math.max(t0, Math.min(tz0, tz1));
    t1 = Math.min(t1, Math.max(tz0, tz1));
  }
  return t1 >= t0 && t1 >= 0 && t0 <= 1;
}

/**
 * A tiny visibility graph for static scenery. Corner-to-corner visibility is cached on layout
 * changes; each departure/return uses O(corners²) Dijkstra, with no work in the frame loop.
 */
export class ExternalPathPlanner {
  private obstacles: readonly ObstacleRect[] = [];
  private corners: number[] = [];
  private edges = new Float64Array(0);
  private distance = new Float64Array(0);
  private previous = new Int16Array(0);
  private visited = new Uint8Array(0);
  private toEnd = new Float64Array(0);

  setObstacles(obstacles: readonly ObstacleRect[]): void {
    this.obstacles = obstacles.filter((r) => r.x1 > r.x0 && r.z1 > r.z0);
    const corners: number[] = [];
    const margin = 0.025;
    for (const r of this.obstacles) {
      for (const [x, z] of [
        [r.x0 - margin, r.z0 - margin], [r.x1 + margin, r.z0 - margin],
        [r.x1 + margin, r.z1 + margin], [r.x0 - margin, r.z1 + margin],
      ]) {
        if (this.clear(x, z, x, z)) corners.push(x, z);
      }
    }
    this.corners = corners;
    const n = corners.length / 2;
    this.edges = new Float64Array(n * n).fill(Infinity);
    this.distance = new Float64Array(n);
    this.previous = new Int16Array(n);
    this.visited = new Uint8Array(n);
    this.toEnd = new Float64Array(n);
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const ax = corners[a * 2], az = corners[a * 2 + 1];
        const bx = corners[b * 2], bz = corners[b * 2 + 1];
        if (this.clear(ax, az, bx, bz)) {
          this.edges[a * n + b] = this.edges[b * n + a] = Math.hypot(bx - ax, bz - az);
        }
      }
    }
  }

  clear(ax: number, az: number, bx: number, bz: number, except?: ObstacleRect): boolean {
    return !this.obstacles.some((r) => r !== except && crossesObstacle(r, ax, az, bx, bz));
  }

  /** Returns waypoints excluding the start and including the destination. Never ignores blockers. */
  route(sx: number, sz: number, x: number, z: number): number[] | null {
    if (this.clear(sx, sz, x, z)) return [x, z];
    if (!this.clear(sx, sz, sx, sz) || !this.clear(x, z, x, z)) return null;
    const corners = this.corners, n = corners.length / 2;
    const distance = this.distance.fill(Infinity), previous = this.previous.fill(-1);
    const visited = this.visited.fill(0), toEnd = this.toEnd.fill(Infinity);
    for (let i = 0; i < n; i++) {
      const cx = corners[i * 2], cz = corners[i * 2 + 1];
      if (this.clear(sx, sz, cx, cz)) distance[i] = Math.hypot(cx - sx, cz - sz);
      if (this.clear(cx, cz, x, z)) toEnd[i] = Math.hypot(x - cx, z - cz);
    }
    let best = Infinity, last = -1;
    for (let step = 0; step < n; step++) {
      let current = -1, cost = best;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && distance[i] < cost) { current = i; cost = distance[i]; }
      }
      if (current < 0) break;
      visited[current] = 1;
      if (cost + toEnd[current] < best) { best = cost + toEnd[current]; last = current; }
      for (let next = 0; next < n; next++) {
        const candidate = cost + this.edges[current * n + next];
        if (!visited[next] && candidate < distance[next]) {
          distance[next] = candidate;
          previous[next] = current;
        }
      }
    }
    if (last < 0) return null;
    const reversed: number[] = [];
    for (let i = last; i >= 0; i = previous[i]) reversed.push(i);
    const result: number[] = [];
    for (let i = reversed.length - 1; i >= 0; i--) {
      result.push(corners[reversed[i] * 2], corners[reversed[i] * 2 + 1]);
    }
    result.push(x, z);
    return result;
  }
}
