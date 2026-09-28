import { Where, type Sim } from '../core/sim';
import type { Layout } from './layout';

export interface ChainPoint { x: number; z: number }
export interface ChainObstacle extends ChainPoint { id: number; half: number }
export interface ChainAnchor extends ChainPoint { box?: number }
export interface LinkedEndpoint { box: number; visible: boolean; column: number; row: number }
export interface LinkedTarget { a: LinkedEndpoint; b: LinkedEndpoint }

/** End by the partner column's +N hint, rather than following an invisible row off screen. */
export function hiddenChainEnd(layout: Layout, columnX: number, otherX: number): ChainPoint {
  const side = Math.sign(otherX - columnX) || 1;
  const padding = layout.boxSize * 0.15;
  const clamp = (n: number, min: number, max: number) => Math.max(min + padding, Math.min(max - padding, n));
  return {
    x: clamp(columnX + side * layout.boxSize * 0.62, layout.bounds.minX, layout.bounds.maxX),
    z: clamp(layout.queueZ0 + (layout.queueRowsVisible - (layout.queueRow > 0 ? 0.4 : -0.15)) * layout.queueRow,
      layout.bounds.minZ, layout.bounds.maxZ),
  };
}

/** Physical links remain represented when just one end is below the visible queue. */
export function linkedTargets(sim: Sim, visibleRows: number): LinkedTarget[] {
  const seen = new Set<number>();
  const result: LinkedTarget[] = [];
  const endpoint = (box: number): LinkedEndpoint => {
    const column = sim.boxCol[box];
    const row = sim.columns[column]?.indexOf(box) ?? -1;
    return { box, column, row, visible: sim.boxWhere[box] === Where.Slot || (sim.boxWhere[box] === Where.Queue && row < visibleRows) };
  };
  for (let id = 0; id < sim.boxIds; id++) {
    const link = sim.boxLink(id);
    if (link < 0 || seen.has(link)) continue;
    seen.add(link);
    const members = sim.groupOf(id).filter((box) => sim.boxWhere[box] !== Where.Done);
    for (let i = 0; i + 1 < members.length; i++) {
      const a = endpoint(members[i]), b = endpoint(members[i + 1]);
      if (a.visible || b.visible) result.push({ a, b });
    }
  }
  return result;
}

interface Rect { left: number; right: number; top: number; bottom: number }
interface Port { point: ChainPoint; attachment: ChainPoint }
const EPS = 1e-6;

function ports(anchor: ChainAnchor, obstacles: ChainObstacle[], margin: number): Port[] {
  const box = obstacles.find((item) => item.id === anchor.box);
  if (!box) return [{ point: anchor, attachment: anchor }];
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => ({
    point: { x: box.x + x * (box.half + margin), z: box.z + z * (box.half + margin) },
    attachment: { x: box.x + x * box.half, z: box.z + z * box.half },
  }));
}

function clear(a: ChainPoint, b: ChainPoint, rects: Rect[]): boolean {
  for (const r of rects) {
    if (Math.abs(a.z - b.z) < EPS) {
      if (a.z > r.top + EPS && a.z < r.bottom - EPS && Math.max(a.x, b.x) > r.left + EPS && Math.min(a.x, b.x) < r.right - EPS) return false;
    } else if (a.x > r.left + EPS && a.x < r.right - EPS && Math.max(a.z, b.z) > r.top + EPS && Math.min(a.z, b.z) < r.bottom - EPS) return false;
  }
  return true;
}

/** A short rectilinear route through real gaps, with clearance for the width of the gold links. */
export function routeChain(a: ChainAnchor, b: ChainAnchor, obstacles: ChainObstacle[], margin: number): ChainPoint[] {
  const start = ports(a, obstacles, margin), finish = ports(b, obstacles, margin);
  const rects = obstacles.map((box) => ({ left: box.x - box.half - margin, right: box.x + box.half + margin,
    top: box.z - box.half - margin, bottom: box.z + box.half + margin }));
  const unique = (values: number[]) => [...new Set(values.map((n) => Math.round(n * 1e6) / 1e6))].sort((x, y) => x - y);
  const xs = unique([...rects.flatMap((r) => [r.left, r.right]), ...start.map((p) => p.point.x), ...finish.map((p) => p.point.x)]);
  const zs = unique([...rects.flatMap((r) => [r.top, r.bottom]), ...start.map((p) => p.point.z), ...finish.map((p) => p.point.z)]);
  const width = xs.length, count = width * zs.length;
  const at = (p: ChainPoint) => xs.findIndex((x) => Math.abs(x - p.x) < EPS) + width * zs.findIndex((z) => Math.abs(z - p.z) < EPS);
  const point = (index: number): ChainPoint => ({ x: xs[index % width], z: zs[Math.floor(index / width)] });
  const blocked = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = point(i);
    if (rects.some((r) => p.x > r.left + EPS && p.x < r.right - EPS && p.z > r.top + EPS && p.z < r.bottom - EPS)) blocked[i] = 1;
  }
  const dist = new Float64Array(count).fill(Infinity);
  const prev = new Int32Array(count).fill(-1);
  const source = new Int16Array(count).fill(-1);
  const visited = new Uint8Array(count);
  start.forEach((port, index) => {
    const k = at(port.point);
    if (!blocked[k]) { dist[k] = 0; source[k] = index; }
  });
  const goals = finish.map((port) => at(port.point));
  let end = -1;
  // This small grid is built only when boxes move; a cached route is reused by every animation frame.
  for (let step = 0; step < count; step++) {
    let best = -1, cost = Infinity;
    for (let k = 0; k < count; k++) if (!visited[k] && dist[k] < cost) { best = k; cost = dist[k]; }
    if (best < 0) break;
    if (goals.includes(best)) { end = best; break; }
    visited[best] = 1;
    const p = point(best), x = best % width, z = Math.floor(best / width);
    const neighbors = [x > 0 ? best - 1 : -1, x + 1 < width ? best + 1 : -1,
      z > 0 ? best - width : -1, z + 1 < zs.length ? best + width : -1];
    for (const next of neighbors) {
      if (next < 0 || blocked[next] || visited[next]) continue;
      const q = point(next);
      if (!clear(p, q, rects)) continue;
      const d = cost + Math.abs(q.x - p.x) + Math.abs(q.z - p.z);
      if (d < dist[next] - EPS) { dist[next] = d; prev[next] = best; source[next] = source[best]; }
    }
  }
  if (end < 0) return []; // Overlapping boxes during relayout are retried on the next sync.
  const route: ChainPoint[] = [];
  for (let k = end; k >= 0; k = prev[k]) route.push(point(k));
  route.reverse();
  route.unshift(start[source[end]].attachment);
  route.push(finish[goals.indexOf(end)].attachment);
  const simple: ChainPoint[] = [];
  for (const p of route) {
    const last = simple[simple.length - 1];
    if (last && Math.hypot(last.x - p.x, last.z - p.z) < EPS) continue;
    const before = simple[simple.length - 2];
    if (before && last && ((Math.abs(before.x - last.x) < EPS && Math.abs(last.x - p.x) < EPS) ||
      (Math.abs(before.z - last.z) < EPS && Math.abs(last.z - p.z) < EPS))) simple.pop();
    simple.push(p);
  }
  return simple;
}
