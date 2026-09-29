// Prototype router. Shared by every style, planned once per scene, never per frame.
// Reserving lanes prevents neighbouring links from collapsing into one thick stroke.
const STEP = 4, LEFT = 10, TOP = 12, COLS = 86, ROWS = 111;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const size = COLS * ROWS;
const node = (x, y) => Math.round((x - LEFT) / STEP) + Math.round((y - TOP) / STEP) * COLS;
const point = (n) => ({ x: LEFT + n % COLS * STEP, y: TOP + Math.floor(n / COLS) * STEP });

class Heap {
  items = [];
  push(value) {
    let i = this.items.length;
    this.items.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= value.cost) break;
      this.items[i] = this.items[p]; i = p;
    }
    this.items[i] = value;
  }
  pop() {
    const root = this.items[0], last = this.items.pop();
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

function ports(box) {
  const w = box.hidden ? 23 : box.size * .49;
  const h = box.hidden ? 14 : box.size * .47;
  return DIRS.map(([dx, dy], direction) => {
    const attach = { x: box.x + dx * w, y: box.y + dy * h };
    const n = node(attach.x + dx * 9, attach.y + dy * 9);
    return { n, direction, attach };
  });
}

/** Align the whole approach to its attachment, rather than adding a tiny grid-to-pin step. */
function alignApproach(points, port, atEnd = false) {
  const axis = port.direction % 2 === 0 ? 'y' : 'x';
  const first = atEnd ? points.length - 1 : 0;
  const increment = atEnd ? -1 : 1;
  const gridCoordinate = points[first][axis];
  for (let i = first; i >= 0 && i < points.length && points[i][axis] === gridCoordinate; i += increment) {
    points[i][axis] = port.attach[axis];
  }
}

function simplified(points) {
  const out = [];
  for (const p of points) {
    const b = out.at(-1), a = out.at(-2);
    if (b && Math.hypot(p.x - b.x, p.y - b.y) < .01) continue;
    if (a && b && Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < .01) out.pop();
    out.push(p);
  }
  return out;
}

export function roundedPath(points, radius = 8) {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const d1 = Math.hypot(b.x - a.x, b.y - a.y), d2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const u = { x: b.x + (a.x - b.x) / d1 * r, y: b.y + (a.y - b.y) / d1 * r };
    const v = { x: b.x + (c.x - b.x) / d2 * r, y: b.y + (c.y - b.y) / d2 * r };
    path += ` L ${u.x} ${u.y} Q ${b.x} ${b.y} ${v.x} ${v.y}`;
  }
  return `${path} L ${points.at(-1).x} ${points.at(-1).y}`;
}

export function planRoutes(boxes, pairs) {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const blocked = new Uint8Array(size);
  for (let n = 0; n < size; n++) {
    const p = point(n);
    blocked[n] = boxes.some((b) => Math.abs(p.x - b.x) < (b.hidden ? 23 : b.size * .49) + 3 && Math.abs(p.y - b.y) < (b.hidden ? 14 : b.size * .47) + 3) ? 1 : 0;
  }
  const used = [new Uint8Array(size), new Uint8Array(size)];
  const occupiedPorts = new Set();
  const result = [];
  // Short links get the direct gaps first. Long links can then choose a free lane.
  const order = pairs.map((ids, index) => ({ ids, index })).sort((a, b) => {
    const length = ({ ids }) => { const p = byId.get(ids[0]), q = byId.get(ids[1]); return Math.abs(p.x - q.x) + Math.abs(p.y - q.y); };
    return length(a) - length(b);
  });
  for (const { ids, index } of order) {
    const a = byId.get(ids[0]), b = byId.get(ids[1]);
    const starts = ports(a).filter((p) => !blocked[p.n]);
    const goals = ports(b).filter((p) => !blocked[p.n]);
    const dist = new Float64Array(size * 4).fill(Infinity);
    const prev = new Int32Array(size * 4).fill(-1);
    const source = new Int8Array(size * 4).fill(-1);
    const heap = new Heap();
    const heuristic = (n) => {
      const p = point(n);
      return Math.min(...goals.map((g) => { const q = point(g.n); return (Math.abs(p.x - q.x) + Math.abs(p.y - q.y)) / STEP; }));
    };
    starts.forEach((p, i) => {
      const k = p.n * 4 + p.direction;
      dist[k] = occupiedPorts.has(`${a.id}:${p.direction}`) ? 120 : 0;
      source[k] = i;
      heap.push({ k, cost: dist[k] + heuristic(p.n), distance: dist[k] });
    });
    let end = -1, goal;
    while (heap.items.length) {
      const item = heap.pop(), k = item.k, n = k >> 2, direction = k % 4;
      if (item.distance !== dist[k]) continue;
      goal = goals.find((g) => g.n === n && !occupiedPorts.has(`${b.id}:${g.direction}`));
      if (goal) { end = k; break; }
      const x = n % COLS, y = Math.floor(n / COLS);
      for (let d = 0; d < 4; d++) {
        if (d === (direction + 2) % 4) continue;
        const [dx, dy] = DIRS[d], nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const next = nx + ny * COLS;
        if (blocked[next]) continue;
        const axis = d % 2;
        const cross = used[1 - axis][next] ? 8 : 0;
        const offset = axis === 0 ? COLS : 1;
        const crowd = used[axis][next] * 90 + ((used[axis][next - offset] || 0) + (used[axis][next + offset] || 0)) * 18;
        const cost = dist[k] + 1 + (d === direction ? 0 : 3.2) + crowd + cross;
        const nk = next * 4 + d;
        if (cost >= dist[nk]) continue;
        dist[nk] = cost; prev[nk] = k; source[nk] = source[k];
        heap.push({ k: nk, cost: cost + heuristic(next), distance: cost });
      }
    }
    if (end < 0) throw new Error(`No preview route for ${ids.join(' → ')}`);
    const start = starts[source[end]], points = [];
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
    let line = simplified([start.attach, ...points, goal.attach]);
    // Remove sub-grid doglegs between aligned faces, especially the short vertical links.
    if ((Math.abs(start.attach.x - goal.attach.x) < .01 && line.every((p) => Math.abs(p.x - start.attach.x) <= STEP / 2 + .01)) ||
        (Math.abs(start.attach.y - goal.attach.y) < .01 && line.every((p) => Math.abs(p.y - start.attach.y) <= STEP / 2 + .01))) {
      line = [start.attach, goal.attach];
    }
    result[index] = { ids, points: line, path: roundedPath(line), start: line[0], end: line.at(-1) };
  }
  return result;
}
