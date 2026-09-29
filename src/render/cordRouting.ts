/** Screen-plane routing, in world units. All links share the same occupied lanes. */
export interface CordPoint { x: number; z: number }
export interface CordObstacle extends CordPoint { id: number; halfX: number; halfZ: number }
export interface CordPair { a: number; b: number }
interface Port { n: number; direction: number; attach: CordPoint }
interface Entry { k: number; cost: number; distance: number }
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const EPS = 1e-7;

class Heap {
  items: Entry[] = [];
  push(value: Entry): void {
    let i = this.items.length;
    this.items.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= value.cost) break;
      this.items[i] = this.items[p]; i = p;
    }
    this.items[i] = value;
  }
  pop(): Entry {
    const root = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let j = i * 2 + 1;
        if (j + 1 < this.items.length && this.items[j + 1].cost < this.items[j].cost) j++;
        if (last.cost <= this.items[j].cost) break;
        this.items[i] = this.items[j]; i = j;
      }
      this.items[i] = last;
    }
    return root;
  }
}

function simplify(points: CordPoint[]): CordPoint[] {
  const out: CordPoint[] = [];
  for (const p of points) {
    const b = out.at(-1), a = out.at(-2);
    if (b && Math.hypot(p.x - b.x, p.z - b.z) < EPS) continue;
    if (a && b && Math.abs((b.x - a.x) * (p.z - b.z) - (b.z - a.z) * (p.x - b.x)) < EPS) out.pop();
    out.push(p);
  }
  return out;
}

/** Align the entire terminal run to its pin, avoiding a one-pixel jog at a counter. */
function alignApproach(points: CordPoint[], port: Port, atEnd = false): void {
  const axis = port.direction % 2 === 0 ? 'z' : 'x';
  const first = atEnd ? points.length - 1 : 0, increment = atEnd ? -1 : 1;
  const coordinate = points[first][axis];
  for (let i = first; i >= 0 && i < points.length && Math.abs(points[i][axis] - coordinate) < EPS; i += increment) {
    points[i][axis] = port.attach[axis];
  }
}

/** Plan once when the queue changes, never in the animation loop. */
export function routeCords(obstacles: CordObstacle[], pairs: CordPair[], size: number): CordPoint[][] {
  if (!pairs.length) return [];
  const step = size * .045, clearance = size * .035, portGap = size * .105;
  const left = Math.min(...obstacles.map(b => b.x - b.halfX)) - size * .52;
  const top = Math.min(...obstacles.map(b => b.z - b.halfZ)) - size * .52;
  const cols = Math.ceil((Math.max(...obstacles.map(b => b.x + b.halfX)) + size * .52 - left) / step) + 1;
  const rows = Math.ceil((Math.max(...obstacles.map(b => b.z + b.halfZ)) + size * .52 - top) / step) + 1;
  const count = cols * rows;
  const node = (x: number, z: number) => Math.round((x - left) / step) + Math.round((z - top) / step) * cols;
  const point = (n: number): CordPoint => ({ x: left + n % cols * step, z: top + Math.floor(n / cols) * step });
  const byId = new Map(obstacles.map(b => [b.id, b]));
  const blocked = new Uint8Array(count);
  // Fill only rectangles, rather than testing every cell against every box.
  for (const b of obstacles) {
    const x0 = Math.max(0, Math.ceil((b.x - b.halfX - clearance - left) / step));
    const x1 = Math.min(cols - 1, Math.floor((b.x + b.halfX + clearance - left) / step));
    const z0 = Math.max(0, Math.ceil((b.z - b.halfZ - clearance - top) / step));
    const z1 = Math.min(rows - 1, Math.floor((b.z + b.halfZ + clearance - top) / step));
    for (let z = z0; z <= z1; z++) blocked.fill(1, z * cols + x0, z * cols + x1 + 1);
  }
  const ports = (b: CordObstacle): Port[] => DIRS.map(([dx, dz], direction) => {
    const attach = { x: b.x + dx * b.halfX, z: b.z + dz * b.halfZ };
    return { n: node(attach.x + dx * portGap, attach.z + dz * portGap), direction, attach };
  }).filter(p => !blocked[p.n]);
  const used = [new Uint8Array(count), new Uint8Array(count)];
  const occupiedPorts = new Set<string>();
  const result: CordPoint[][] = [];
  const order = pairs.map((pair, index) => ({ ...pair, index })).sort((a, b) => {
    const length = (p: CordPair) => { const x = byId.get(p.a)!, y = byId.get(p.b)!; return Math.abs(x.x - y.x) + Math.abs(x.z - y.z); };
    return length(a) - length(b);
  });
  for (const pair of order) {
    const a = byId.get(pair.a)!, b = byId.get(pair.b)!;
    const starts = ports(a), goals = ports(b);
    const dist = new Float64Array(count * 4).fill(Infinity);
    const prev = new Int32Array(count * 4).fill(-1);
    const source = new Int8Array(count * 4).fill(-1);
    const heap = new Heap();
    const heuristic = (n: number) => {
      let best = Infinity;
      const x = n % cols, z = Math.floor(n / cols);
      for (const g of goals) best = Math.min(best, Math.abs(x - g.n % cols) + Math.abs(z - Math.floor(g.n / cols)));
      return best;
    };
    starts.forEach((p, i) => {
      const k = p.n * 4 + p.direction;
      dist[k] = occupiedPorts.has(`${a.id}:${p.direction}`) ? 160 : 0;
      source[k] = i;
      heap.push({ k, cost: dist[k] + heuristic(p.n), distance: dist[k] });
    });
    let end = -1, goal: Port | undefined, best = Infinity;
    while (heap.items.length) {
      const item = heap.pop(), k = item.k, n = k >> 2, direction = k % 4;
      if (item.distance !== dist[k]) continue;
      if (item.cost >= best) break;
      for (const g of goals) if (g.n === n && (direction === (g.direction + 2) % 4 || prev[k] < 0)) {
        const cost = dist[k] + (occupiedPorts.has(`${b.id}:${g.direction}`) ? 160 : 0);
        if (cost < best) { best = cost; end = k; goal = g; }
      }
      const x = n % cols, z = Math.floor(n / cols);
      for (let d = 0; d < 4; d++) {
        if (d === (direction + 2) % 4) continue;
        const [dx, dz] = DIRS[d], nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
        const next = nx + nz * cols;
        if (blocked[next]) continue;
        const axis = d % 2, offset = axis === 0 ? cols : 1;
        const crowd = used[axis][next] * 90 + ((used[axis][next - offset] || 0) + (used[axis][next + offset] || 0)) * 18;
        const cost = dist[k] + 1 + (d === direction ? 0 : 3.2) + crowd + (used[1 - axis][next] ? 8 : 0);
        const nk = next * 4 + d;
        if (cost >= dist[nk]) continue;
        dist[nk] = cost; prev[nk] = k; source[nk] = source[k];
        heap.push({ k: nk, cost: cost + heuristic(next), distance: cost });
      }
    }
    if (end < 0 || !goal) { result[pair.index] = []; continue; }
    const start = starts[source[end]], points: CordPoint[] = [];
    for (let k = end; k >= 0; k = prev[k]) {
      const n = k >> 2;
      points.push(point(n));
      used[k % 2][n]++;
    }
    points.reverse();
    occupiedPorts.add(`${a.id}:${start.direction}`);
    occupiedPorts.add(`${b.id}:${goal.direction}`);
    alignApproach(points, start);
    alignApproach(points, goal, true);
    let line = simplify([start.attach, ...points, goal.attach]);
    if ((Math.abs(start.attach.x - goal.attach.x) < EPS && line.every(p => Math.abs(p.x - start.attach.x) <= step / 2 + EPS)) ||
        (Math.abs(start.attach.z - goal.attach.z) < EPS && line.every(p => Math.abs(p.z - start.attach.z) <= step / 2 + EPS))) {
      line = [start.attach, goal.attach];
    }
    result[pair.index] = line;
  }
  return result;
}

/** A handful of samples per bend is enough for a small on-screen cord. */
export function roundCord(points: CordPoint[], radius: number): CordPoint[] {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const d1 = Math.hypot(b.x - a.x, b.z - a.z), d2 = Math.hypot(c.x - b.x, c.z - b.z);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const u = { x: b.x + (a.x - b.x) / d1 * r, z: b.z + (a.z - b.z) / d1 * r };
    const v = { x: b.x + (c.x - b.x) / d2 * r, z: b.z + (c.z - b.z) / d2 * r };
    out.push(u);
    for (let j = 1; j <= 5; j++) {
      const t = j / 5, s = 1 - t;
      out.push({ x: s * s * u.x + 2 * s * t * b.x + t * t * v.x, z: s * s * u.z + 2 * s * t * b.z + t * t * v.z });
    }
  }
  out.push(points.at(-1)!);
  return out;
}
