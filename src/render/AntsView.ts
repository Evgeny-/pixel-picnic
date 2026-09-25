import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Sim } from '../core/sim';
import type { PieceShape } from '../core/types';
import { pieceGeometry, pieceMaterial } from './pieces';
import { hatGeometry, type HatId } from './hats';
import type { Layout } from './layout';
import type { BoardView } from './BoardView';

const MAX_ANTS = 700;
const LEGS = 6;

/** Ant parts in local space: forward = +Z, up = +Y, total length ~1. */
function buildBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ell = (rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 12) => {
    const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  ell(0.25, 0.21, 0.31, 0, 0.27, -0.33); // abdomen
  ell(0.075, 0.075, 0.09, 0, 0.23, -0.05, 8); // petiole
  ell(0.13, 0.12, 0.17, 0, 0.25, 0.08, 12); // thorax
  ell(0.22, 0.2, 0.21, 0, 0.33, 0.33); // head
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.07, 0.47, 0.38),
      new THREE.Vector3(s * 0.13, 0.66, 0.43),
      new THREE.Vector3(s * 0.22, 0.72, 0.6),
    ]);
    parts.push(new THREE.TubeGeometry(curve, 6, 0.022, 4, false));
    ell(0.045, 0.045, 0.045, s * 0.22, 0.72, 0.6, 8);
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  merged.computeVertexNormals();
  return merged;
}

function buildEyes(r: number, z: number, y: number, x: number): THREE.BufferGeometry {
  const a = new THREE.SphereGeometry(r, 8, 6);
  a.translate(-x, y, z);
  const b = new THREE.SphereGeometry(r, 8, 6);
  b.translate(x, y, z);
  return mergeGeometries([a, b], false)!;
}

function buildLeg(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.17, 0.09, 0),
    new THREE.Vector3(0.3, 0.02, 0),
    new THREE.Vector3(0.36, -0.2, 0),
  ]);
  return new THREE.TubeGeometry(curve, 6, 0.024, 4, false);
}

/** A single standing ant as ordinary meshes (for shop previews), optionally with a hat. */
export function antModel(color: string, hat: HatId = 'none'): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  body.getHSL(hsl);
  const legColor = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.max(0.03, hsl.l * 0.45));
  g.add(new THREE.Mesh(buildBodyGeometry(), new THREE.MeshStandardMaterial({ color: body, roughness: 0.32 })));
  g.add(new THREE.Mesh(buildEyes(0.085, 0.47, 0.4, 0.1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 })));
  g.add(new THREE.Mesh(buildEyes(0.048, 0.535, 0.41, 0.105), new THREE.MeshStandardMaterial({ color: '#15101f', roughness: 0.2 })));
  const legGeo = buildLeg();
  const legMat = new THREE.MeshStandardMaterial({ color: legColor, roughness: 0.5 });
  for (let k = 0; k < LEGS; k++) {
    const side = k < 3 ? -1 : 1;
    const pair = k % 3;
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(side * 0.08, 0.22, HIP_Z[pair]);
    leg.rotation.set(0, (side < 0 ? Math.PI : 0) - side * LEG_YAW[pair], 0);
    g.add(leg);
  }
  const hatGeo = hatGeometry(hat);
  if (hatGeo) g.add(new THREE.Mesh(hatGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide })));
  return g;
}

export interface AntCallbacks {
  onPick(cell: number): void;
  onDeliver(): void;
}

interface Ant {
  color: number;
  cell: number;
  /** Waypoints (x, z) */
  pts: number[];
  cum: number[];
  dist: number;
  phase: 'out' | 'bite' | 'home' | 'enter' | 'fade';
  timer: number;
  yaw: number;
  legPhase: number;
  startY: number;
  seed: number;
  /** cells on the final approach line that must be gone before the ant can pass (nearest first) */
  line: number[];
  lineD: number[];
  x: number;
  z: number;
  y: number;
  scale: number;
  /** Seconds spent waiting behind a cube that is still there. */
  wait: number;
  /** Number of waypoints (at the end of `pts`) inside the frame, walked back on the way home. */
  back: number;
  /** Walking speed multiplier, chosen so the ant reaches the cube in time. */
  spd: number;
  /** Game seconds before the ant climbs out of its box (slots take turns within a round). */
  delay: number;
}

const HIP_Z = [0.15, 0.07, -0.01];
const LEG_YAW = [0.55, 0, -0.55];

/** Hundreds of instanced cartoon ants walking between slots, the picture and the nest. */
export class AntsView {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private eyes: THREE.InstancedMesh;
  private pupils: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private cubes: THREE.InstancedMesh;
  private ants: Ant[] = [];
  private palette: THREE.Color[];
  private legColors: THREE.Color[];
  private layout!: Layout;
  private board: BoardView;
  private cb: AntCallbacks;
  speed = 1;
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private antSize = 0.42;
  private rect = { x0: 0, x1: 0, z0: 0, z1: 0, ix0: 0, ix1: 0, iz0: 0, iz1: 0, rim: 0.2 };
  private sim: Sim;
  private bfsDist = new Int32Array(0);
  private bfsPrev = new Int32Array(0);
  /** Cubes the rules have already released for pickup. */
  private ready = new Set<number>();
  /** The ants' house: an obstacle to walk around, and the doorway they run into. */
  private house = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private door = { x: 0, z: 0 };

  /** The accessory every ant wears (bought in the shop), if any. */
  private hat: THREE.InstancedMesh | null = null;

  constructor(palette: string[], board: BoardView, sim: Sim, cb: AntCallbacks, shape: PieceShape = 'cube', hat: HatId = 'none') {
    this.board = board;
    this.sim = sim;
    this.cb = cb;
    this.palette = palette.map((c) => new THREE.Color(c));
    this.legColors = this.palette.map((c) => {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.max(0.03, hsl.l * 0.45));
    });
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0, envMapIntensity: 1.1 });
    this.body = new THREE.InstancedMesh(buildBodyGeometry(), bodyMat, MAX_ANTS);
    this.body.castShadow = true;
    this.eyes = new THREE.InstancedMesh(
      buildEyes(0.085, 0.47, 0.4, 0.1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 }),
      MAX_ANTS,
    );
    this.pupils = new THREE.InstancedMesh(
      buildEyes(0.048, 0.535, 0.41, 0.105),
      new THREE.MeshStandardMaterial({ color: '#15101f', roughness: 0.2 }),
      MAX_ANTS,
    );
    this.legs = new THREE.InstancedMesh(buildLeg(), new THREE.MeshStandardMaterial({ roughness: 0.5 }), MAX_ANTS * LEGS);
    this.cubes = new THREE.InstancedMesh(pieceGeometry(shape, true), pieceMaterial(shape), MAX_ANTS);
    const hatGeo = hatGeometry(hat);
    if (hatGeo) {
      this.hat = new THREE.InstancedMesh(hatGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }), MAX_ANTS);
      this.hat.castShadow = true;
      this.hat.frustumCulled = false;
      this.hat.count = 0;
      this.hat.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.hat);
    }
    this.cubes.castShadow = true;
    for (const mesh of [this.body, this.eyes, this.pupils, this.legs, this.cubes]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    // allocate instance color buffers
    this.body.setColorAt(0, this.palette[0]);
    this.legs.setColorAt(0, this.palette[0]);
    this.cubes.setColorAt(0, this.palette[0]);
  }

  setLayout(l: Layout): void {
    this.layout = l;
    this.antSize = Math.max(0.46, Math.min(0.74, l.cell * 1.9));
    const pad = l.cell * 0.35;
    const ix0 = l.picX0 - pad;
    const iz0 = l.picZ0 - pad;
    const ix1 = l.picX0 + l.picW + pad;
    const iz1 = l.picZ0 + l.picH + pad;
    this.rect = {
      ix0, iz0, ix1, iz1,
      x0: ix0 - l.frame, z0: iz0 - l.frame, x1: ix1 + l.frame, z1: iz1 + l.frame,
      rim: Math.max(0.06, Math.min(0.2, l.cell * 0.32)) + 0.1,
    };
    // The queue is an obstacle too: ants walk around it, never over the boxes.
    const half = l.boxSize / 2 + 0.25;
    const zA = l.queueZ0 - Math.sign(l.queueRow) * half;
    const zB = l.queueZ0 + (l.queueRowsVisible + 1) * l.queueRow;
    this.avoid = {
      x0: l.queueCol[0] - half,
      x1: l.queueCol[l.queueCol.length - 1] + half,
      z0: Math.min(zA, zB),
      z1: Math.max(zA, zB),
    };
    this.clear();
  }

  private avoid = { x0: 0, x1: 0, z0: 0, z1: 0 };

  get count(): number {
    return this.ants.length;
  }

  setHome(house: { x0: number; x1: number; z0: number; z1: number }, door: { x: number; z: number }): void {
    this.house = house;
    this.door = { x: door.x, z: door.z };
  }

  /** Remove every ant immediately (undo / restart). */
  clear(): void {
    this.ants.length = 0;
    this.ready.clear();
  }

  /** Fade out ants that are still walking (e.g. after an undo). */
  fadeAll(): void {
    for (const a of this.ants) {
      a.phase = 'fade';
      a.timer = 0;
    }
    this.ready.clear();
  }

  /** The rules say this cube has just been carried off: its ant may take it now. */
  pickup(cell: number): void {
    this.ready.add(cell);
    if (!this.ants.some((a) => a.cell === cell && (a.phase === 'out' || a.phase === 'bite'))) {
      // No ant on screen for it (e.g. too many ants): just remove the cube.
      this.board.remove(cell);
      this.ready.delete(cell);
      this.cb.onPick(cell);
      this.cb.onDeliver();
    }
  }

  /**
   * An ant leaves a slot for `cell`. `dueIn` is how many game seconds the rules give it before the
   * cube is carried off; the ant paces itself to arrive a moment earlier and nibbles until then.
   */
  spawn(from: THREE.Vector3, cell: number, color: number, dueIn = 2, delay = 0): void {
    if (this.ants.length >= MAX_ANTS) return;
    const seed = Math.random();
    const sx = from.x + (seed - 0.5) * 0.3;
    const sz = from.z + 0.2;
    const plan = this.planInside(cell, sx, sz);
    const pts: number[] = [sx, sz];
    this.route(pts, plan.inside[0], plan.inside[1]);
    const entryIndex = pts.length / 2 - 1;
    for (let k = 2; k < plan.inside.length; k += 2) pts.push(plan.inside[k], plan.inside[k + 1]);
    const ant: Ant = {
      color, cell, pts, cum: [], dist: 0, phase: 'out', timer: 0, yaw: Math.PI, legPhase: seed * 6,
      startY: from.y, seed, line: plan.block, lineD: [], x: pts[0], z: pts[1], y: from.y, scale: 0.2,
      wait: 0, back: plan.inside.length / 2, spd: 1, delay,
    };
    this.measure(ant);
    const len = ant.cum[ant.cum.length - 1];
    const base = 3.3;
    ant.spd = Math.max(0.7, Math.min(2.2, len / Math.max(0.3, dueIn - delay - 0.3) / base));
    // Blocking distances were measured along the inside part; shift them to the full path.
    const entryDist = ant.cum[entryIndex];
    ant.lineD = plan.blockD.map((d) => entryDist + d);
    this.ants.push(ant);
  }

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
  private planInside(target: number, sx: number, sz: number): { inside: number[]; block: number[]; blockD: number[] } {
    const sim = this.sim;
    const w = sim.w;
    const h = sim.h;
    const n = w * h;
    const l = this.layout;
    const cellSize = l.cell;
    if (this.bfsDist.length !== n) {
      this.bfsDist = new Int32Array(n);
      this.bfsPrev = new Int32Array(n);
    }
    const dist = this.bfsDist.fill(-1);
    const prev = this.bfsPrev;
    const free = (i: number) => sim.isFree(i) && sim.air[i] === 1;
    let bestCost = Infinity;
    let bestCell = -1;
    let bestBit = 0;
    const tryExit = (i: number, d: number) => {
      const mask = sim.edgeMask(i);
      for (const bit of [1, 2, 4, 8]) {
        if (!(mask & bit)) continue;
        const e = this.exitPoint(i, bit);
        const cost = d * cellSize + Math.hypot(e.x - sx, e.z - sz) * 0.8;
        if (cost < bestCost) {
          bestCost = cost;
          bestCell = i;
          bestBit = bit;
        }
      }
    };
    dist[target] = 0;
    tryExit(target, 0);
    const queue = [target];
    for (let qi = 0; qi < queue.length; qi++) {
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
        queue.push(j);
      }
    }
    const tp = this.cellXZ(target, { x: 0, z: 0 });
    const reach = cellSize * 0.5 + this.antSize * 0.4;
    const pts: number[] = [];
    if (bestCell < 0) {
      // Should not happen (the rules said the cube is reachable): walk straight from below.
      pts.push(tp.x, this.rect.z1 + 0.25, tp.x, tp.z + reach);
      return { inside: pts, block: [], blockD: [] };
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
    dx /= len;
    dz /= len;
    pts.push(tp.x + dx * reach, tp.z + dz * reach);
    const smooth = this.smoothPath(pts, target);
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

  /** Append waypoints from the last point to (x, z), walking around the frame and the queue. */
  private route(pts: number[], x: number, z: number): void {
    const sx = pts[pts.length - 2];
    const sz = pts[pts.length - 1];
    const path = this.findPath(sx, sz, x, z, true) ?? this.findPath(sx, sz, x, z, false) ?? [];
    for (const c of path) pts.push(c[0] + (Math.random() - 0.5) * 0.2, c[1] + (Math.random() - 0.5) * 0.2);
    pts.push(x, z);
  }

  private blocked(ax: number, az: number, bx: number, bz: number, useAvoid: boolean): boolean {
    return (
      this.crosses(this.rect, ax, az, bx, bz) ||
      this.crosses(this.house, ax, az, bx, bz) ||
      (useAvoid && this.crosses(this.avoid, ax, az, bx, bz))
    );
  }

  /** Shortest detour through up to three obstacle corners (tiny visibility graph). */
  private findPath(sx: number, sz: number, x: number, z: number, useAvoid: boolean): number[][] | null {
    if (!this.blocked(sx, sz, x, z, useAvoid)) return [];
    const m = 0.3;
    const corners: number[][] = [];
    const addRect = (r: { x0: number; x1: number; z0: number; z1: number }) =>
      corners.push([r.x0 - m, r.z0 - m], [r.x1 + m, r.z0 - m], [r.x1 + m, r.z1 + m], [r.x0 - m, r.z1 + m]);
    addRect(this.rect);
    addRect(this.house);
    if (useAvoid) addRect(this.avoid);
    const n = corners.length;
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const s = [sx, sz];
    const t = [x, z];
    const free = (a: number[], b: number[]) => !this.blocked(a[0], a[1], b[0], b[1], useAvoid);
    const fromS = corners.map((c) => free(s, c));
    const toT = corners.map((c) => free(c, t));
    let best: number[][] | null = null;
    let bestLen = Infinity;
    for (let i = 0; i < n; i++) {
      if (!fromS[i]) continue;
      if (toT[i]) {
        const len = d(s, corners[i]) + d(corners[i], t);
        if (len < bestLen) { bestLen = len; best = [corners[i]]; }
      }
      for (let j = 0; j < n; j++) {
        if (j === i || !free(corners[i], corners[j])) continue;
        const l2 = d(s, corners[i]) + d(corners[i], corners[j]);
        if (l2 >= bestLen) continue;
        if (toT[j]) {
          const len = l2 + d(corners[j], t);
          if (len < bestLen) { bestLen = len; best = [corners[i], corners[j]]; }
        }
        for (let k = 0; k < n; k++) {
          if (k === i || k === j || !toT[k] || !free(corners[j], corners[k])) continue;
          const len = l2 + d(corners[j], corners[k]) + d(corners[k], t);
          if (len < bestLen) { bestLen = len; best = [corners[i], corners[j], corners[k]]; }
        }
      }
    }
    return best;
  }

  /** Liang–Barsky test: does the segment pass through the (slightly shrunk) rectangle? */
  private crosses(r: { x0: number; x1: number; z0: number; z1: number }, ax: number, az: number, bx: number, bz: number): boolean {
    const e = 0.05;
    const x0 = r.x0 + e, x1 = r.x1 - e, z0 = r.z0 + e, z1 = r.z1 - e;
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dz = bz - az;
    const p = [-dx, dx, -dz, dz];
    const q = [ax - x0, x1 - ax, az - z0, z1 - az];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return t1 - t0 > 1e-4;
  }

  private measure(a: Ant): void {
    a.cum = [0];
    for (let i = 2; i < a.pts.length; i += 2) {
      a.cum.push(a.cum[a.cum.length - 1] + Math.hypot(a.pts[i] - a.pts[i - 2], a.pts[i + 1] - a.pts[i - 1]));
    }
  }

  private posAt(a: Ant, d: number): void {
    const cum = a.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1];
    const k = seg > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)) : 1;
    a.x = a.pts[(i - 1) * 2] + (a.pts[i * 2] - a.pts[(i - 1) * 2]) * k;
    a.z = a.pts[(i - 1) * 2 + 1] + (a.pts[i * 2 + 1] - a.pts[(i - 1) * 2 + 1]) * k;
  }

  /** Swap the simulation (undo / shuffle); paths are planned on its free space. */
  setSim(sim: Sim): void {
    this.sim = sim;
  }

  private goHome(a: Ant): void {
    // Walk back out the same way the ant came in, then around to the house.
    const pts: number[] = [];
    const first = Math.max(0, a.pts.length / 2 - Math.max(2, a.back));
    for (let k = a.pts.length / 2 - 1; k >= first; k--) pts.push(a.pts[k * 2], a.pts[k * 2 + 1]);
    // Around the house to the doorstep, then straight in through the door.
    const dx = this.door.x + (Math.random() - 0.5) * 0.08;
    this.route(pts, dx, this.door.z + 0.35);
    pts.push(dx, this.door.z);
    a.pts = pts;
    a.line = [];
    a.lineD = [];
    this.measure(a);
    a.dist = 0;
    a.phase = 'home';
    a.startY = 0;
  }

  update(dt: number, time: number): void {
    const spd = 3.3 * this.speed;
    const r = this.rect;
    const keep: Ant[] = [];
    for (const a of this.ants) {
      if (a.delay > 0) {
        // Still inside the box, waiting for its turn to climb out.
        a.delay -= dt * this.speed;
        (a as Ant & { _s: number })._s = 0;
        keep.push(a);
        continue;
      }
      let moving = false;
      if (a.phase === 'out' || a.phase === 'home') {
        const total = a.cum[a.cum.length - 1];
        let limit = total;
        // Wait behind cubes that are still in the way (claimed by other ants, not carried off yet).
        for (let k = 0; k < a.line.length; k++) {
          if (this.board.isPresent(a.line[k])) {
            limit = Math.min(limit, a.lineD[k] - 0.05);
            break;
          }
        }
        const before = a.dist;
        a.dist = Math.min(limit, a.dist + spd * dt * (a.phase === 'out' ? a.spd : 1) * (0.95 + a.seed * 0.1));
        if (a.dist < before) a.dist = before;
        moving = a.dist > before + 1e-5;
        if (!moving && a.dist < total - 1e-4) {
          // Two ants waiting for each other's cube would wait forever: squeeze past after a while.
          a.wait += dt * this.speed;
          if (a.wait > 1.4) a.line = [];
        } else a.wait = 0;
        this.posAt(a, a.dist);
        if (a.dist >= total - 1e-4) {
          if (a.phase === 'out') {
            a.phase = 'bite';
            a.timer = 0;
            this.board.wobble(a.cell);
          } else {
            a.phase = 'enter';
            a.timer = 0;
          }
        }
      } else if (a.phase === 'bite') {
        // Nibble until the rules say the cube is carried off.
        a.timer += dt * this.speed;
        if (a.timer > 0.15 && this.ready.has(a.cell)) {
          this.ready.delete(a.cell);
          this.board.remove(a.cell);
          this.cb.onPick(a.cell);
          this.goHome(a);
        }
      } else if (a.phase === 'enter') {
        a.timer += dt * this.speed;
        if (a.timer > 0.22) {
          this.cb.onDeliver();
          continue;
        }
      } else if (a.phase === 'fade') {
        a.timer += dt;
        if (a.timer > 0.35) continue;
      }
      // heading
      const i = Math.min(a.cum.length - 1, Math.max(1, a.cum.findIndex((c) => c >= a.dist)));
      const dx = a.pts[i * 2] - a.pts[(i - 1) * 2];
      const dz = a.pts[i * 2 + 1] - a.pts[(i - 1) * 2 + 1];
      if (a.phase === 'bite') {
        // face the cube
      } else if (dx * dx + dz * dz > 1e-6) {
        const want = Math.atan2(dx, dz);
        let d = want - a.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        a.yaw += d * Math.min(1, dt * 14);
      }
      if (moving) a.legPhase += dt * spd * 9;
      // height: hop down from the box, climb over the rim of the frame
      let y = 0;
      if (a.phase === 'out' && a.startY > 0) y = Math.max(0, a.startY * (1 - a.dist / 0.6));
      const onRim =
        a.x > r.x0 && a.x < r.x1 && a.z > r.z0 && a.z < r.z1 && !(a.x > r.ix0 && a.x < r.ix1 && a.z > r.iz0 && a.z < r.iz1);
      if (onRim) y = Math.max(y, r.rim);
      else if (a.x > r.ix0 && a.x < r.ix1 && a.z > r.iz0 && a.z < r.iz1) y = Math.max(y, 0.04);
      a.y += (y - a.y) * Math.min(1, dt * 18);
      let scale = 1;
      if (a.phase === 'out') a.scale = Math.min(1, a.scale + dt * 5);
      if (a.phase === 'enter') scale = Math.max(0.01, 1 - a.timer / 0.22);
      if (a.phase === 'fade') scale = Math.max(0.01, 1 - a.timer / 0.35);
      a.scale = Math.min(a.scale, 1);
      a.y -= a.phase === 'enter' ? a.timer * 0.8 : 0;
      keep.push(a);
      void time;
      (a as Ant & { _s: number })._s = scale * a.scale;
    }
    this.ants = keep;
    this.writeInstances();
  }

  private writeInstances(): void {
    const size = this.antSize;
    let n = 0;
    let legN = 0;
    let cubeN = 0;
    const cell = this.layout.cell;
    for (const a of this.ants) {
      const sc = (a as Ant & { _s: number })._s * size;
      const bob = Math.sin(a.legPhase * 2) * 0.012 * size;
      const biteTilt = a.phase === 'bite' ? Math.sin(a.timer * 40) * 0.25 : 0;
      this.e.set(biteTilt * 0.5, a.yaw, 0);
      this.q.setFromEuler(this.e);
      this.v.set(a.x, a.y + bob, a.z);
      this.s.set(sc, sc, sc);
      this.m.compose(this.v, this.q, this.s);
      this.body.setMatrixAt(n, this.m);
      this.eyes.setMatrixAt(n, this.m);
      this.pupils.setMatrixAt(n, this.m);
      this.hat?.setMatrixAt(n, this.m);
      this.body.setColorAt(n, this.palette[a.color]);
      for (let k = 0; k < LEGS; k++) {
        const side = k < 3 ? -1 : 1;
        const pair = k % 3;
        const gait = ((pair + (side > 0 ? 1 : 0)) % 2) * Math.PI;
        const swing = Math.sin(a.legPhase + gait) * 0.38;
        const lift = Math.max(0, Math.cos(a.legPhase + gait)) * 0.22;
        this.e.set(0, side < 0 ? Math.PI : 0, 0);
        const baseYaw = (side < 0 ? Math.PI : 0) - side * (LEG_YAW[pair] + swing);
        this.e.set(0, baseYaw, side * 0 + lift);
        this.q.setFromEuler(this.e);
        this.v.set(side * 0.08, 0.22, HIP_Z[pair]);
        this.m2.compose(this.v, this.q, this.one);
        this.m2.premultiply(this.m);
        this.legs.setMatrixAt(legN, this.m2);
        this.legs.setColorAt(legN, this.legColors[a.color]);
        legN++;
      }
      if (a.phase === 'home' || a.phase === 'enter') {
        const cs = Math.min(cell * 0.8, sc * 0.55);
        const fwd = 0.62 * sc;
        this.v.set(a.x + Math.sin(a.yaw) * fwd, a.y + 0.34 * sc + (cs * 0.62) / 2, a.z + Math.cos(a.yaw) * fwd);
        this.e.set(0, a.yaw, 0);
        this.q.setFromEuler(this.e);
        const k = a.phase === 'enter' ? Math.max(0.01, 1 - a.timer / 0.22) : 1;
        this.s.set(cs * k, cs * k, cs * k);
        this.m.compose(this.v, this.q, this.s);
        this.cubes.setMatrixAt(cubeN, this.m);
        this.cubes.setColorAt(cubeN, this.board.cubeColor(a.cell));
        cubeN++;
      }
      n++;
    }
    this.body.count = this.eyes.count = this.pupils.count = n;
    this.legs.count = legN;
    this.cubes.count = cubeN;
    if (this.hat) {
      this.hat.count = n;
      this.hat.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of [this.body, this.eyes, this.pupils, this.legs, this.cubes]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [this.body, this.eyes, this.pupils, this.legs, this.cubes, ...(this.hat ? [this.hat] : [])]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
