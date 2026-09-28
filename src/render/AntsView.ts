import * as THREE from 'three';
import type { Sim } from '../core/sim';
import type { PieceShape } from '../core/types';
import { pieceGeometry, pieceMaterial } from './pieces';
import { hatGeometry, type HatId } from './hats';
import type { Layout } from './layout';
import type { BoardView } from './BoardView';
import { BoardPathPlanner } from './BoardPathPlanner';
import { CreatureGrounding } from './CreatureGrounding';
import { createCreatureRig, type CreatureRig } from './creatureModel';
import { CREATURES, type CreatureId } from '../core/creatures';
import { perf } from './PerformanceMonitor';
export { antModel } from './creatureModel';

const MAX_ANTS = 700;

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


/** Hundreds of instanced cartoon ants walking between slots, the picture and the nest. */
export class AntsView {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private eyes: THREE.InstancedMesh;
  private pupils: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private cubes: THREE.InstancedMesh;
  private details: THREE.InstancedMesh | null = null;
  private tail: THREE.InstancedMesh | null = null;
  private rig: CreatureRig;
  private grounding: CreatureGrounding;
  private creature: CreatureId;
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
  private pathPlanner = new BoardPathPlanner();
  /** Cubes the rules have already released for pickup. */
  private ready = new Set<number>();
  /** The ants' house: an obstacle to walk around, and the doorway they run into. */
  private house = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private door = { x: 0, z: 0 };

  /** The accessory every ant wears (bought in the shop), if any. */
  private hat: THREE.InstancedMesh | null = null;

  constructor(palette: string[], board: BoardView, sim: Sim, cb: AntCallbacks, shape: PieceShape = 'cube', hat: HatId = 'none', creature: CreatureId = 'ant') {
    this.rig = createCreatureRig(creature);
    this.grounding = new CreatureGrounding(this.rig);
    this.creature = creature;
    this.board = board;
    this.sim = sim;
    this.cb = cb;
    const naturalColor = CREATURES.find((item) => item.id === creature)!.color;
    this.palette = palette.map((c) => new THREE.Color(creature === 'ant' ? c : naturalColor));
    this.legColors = this.palette.map((c) => {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.max(0.03, hsl.l * (creature === 'ant' ? 0.45 : 0.75)));
    });
    const matte = { roughness: 0.96, metalness: 0, envMapIntensity: 0.12 };
    const bodyMat = new THREE.MeshStandardMaterial(creature === 'ant' ? { roughness: 0.32, metalness: 0, envMapIntensity: 1.1 } : matte);
    this.body = new THREE.InstancedMesh(this.rig.body, bodyMat, MAX_ANTS);
    this.body.castShadow = true;
    this.eyes = new THREE.InstancedMesh(
      this.rig.eyes,
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: creature === 'ant' ? 0.25 : 0.45, envMapIntensity: creature === 'ant' ? 1 : 0.15 }),
      MAX_ANTS,
    );
    this.pupils = new THREE.InstancedMesh(
      this.rig.pupils,
      new THREE.MeshStandardMaterial({ color: '#15101f', roughness: creature === 'ant' ? 0.2 : 0.35, envMapIntensity: creature === 'ant' ? 1 : 0.15 }),
      MAX_ANTS,
    );
    this.legs = new THREE.InstancedMesh(this.rig.legs, new THREE.MeshStandardMaterial(creature === 'ant' ? { roughness: 0.5 } : matte), MAX_ANTS * 6);
    this.cubes = new THREE.InstancedMesh(pieceGeometry(shape, true), pieceMaterial(shape), MAX_ANTS);
    const hatGeo = hatGeometry(hat);
    if (hatGeo) {
      if (this.rig.hatMatrix) hatGeo.applyMatrix4(this.rig.hatMatrix);
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
    this.makeDetails();
    if (this.rig.tail) {
      this.tail = new THREE.InstancedMesh(this.rig.tail.geometry, new THREE.MeshStandardMaterial({ ...matte, vertexColors: true }), MAX_ANTS);
      this.tail.frustumCulled = false;
      this.tail.count = 0;
      this.tail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.tail);
    }
    // allocate instance color buffers
    this.body.setColorAt(0, this.palette[0]);
    this.legs.setColorAt(0, this.palette[0]);
    this.cubes.setColorAt(0, this.palette[0]);
    for (const mesh of [this.body, this.legs, this.cubes]) mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  private makeDetails(): void {
    if (!this.rig.details) return;
    this.details = new THREE.InstancedMesh(this.rig.details, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.12 }), MAX_ANTS);
    this.details.castShadow = true;
    this.details.frustumCulled = false;
    this.details.count = 0;
    this.details.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.details);
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
    const planStart = perf.enabled ? performance.now() : 0;
    const plan = this.pathPlanner.plan(this.sim, this.layout, this.rect, this.antSize, cell, sx, sz);
    if (!plan) {
      if (perf.enabled) perf.record('paths', performance.now() - planStart);
      return;
    }
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
    if (perf.enabled) perf.record('paths', performance.now() - planStart);
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
    const planStart = perf.enabled ? performance.now() : 0;
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
    if (perf.enabled) perf.record('paths', performance.now() - planStart);
  }

  update(dt: number, time: number): void {
    const spd = 3.3 * this.speed;
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
      if (moving) a.legPhase += dt * (this.creature === 'ant' ? spd * 9 : Math.min(spd, 6) * 4);
      // Keep the whole body and animated tail above the rim until the last part clears it.
      // The footprint ramps up before contact; easing must never sink below that clearance.
      let y = this.grounding.heightAt(a.x, a.z, a.yaw, this.antSize, this.rect);
      if (a.phase === 'out' && a.startY > 0) y = Math.max(y, a.startY * (1 - a.dist / 0.6));
      a.y = Math.max(y, a.y + (y - a.y) * Math.min(1, dt * 18));
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
      this.details?.setMatrixAt(n, this.m);
      if (this.tail && this.rig.tail) {
        const p = this.rig.tail.pivot;
        this.e.set(0, Math.sin(a.legPhase * 0.5 + a.seed * 6) * 0.28, 0);
        this.q.setFromEuler(this.e);
        this.v.set(p.x, p.y, p.z);
        this.m2.compose(this.v, this.q, this.one).premultiply(this.m);
        this.tail.setMatrixAt(n, this.m2);
      }
      for (const pose of this.rig.legPoses) {
        const swing = Math.sin(a.legPhase + pose.phase) * 0.38;
        const lift = Math.max(0, Math.cos(a.legPhase + pose.phase)) * 0.22;
        // Ant legs sweep sideways; paws swing forward and lift together with the gait.
        if (this.creature === 'ant') this.e.set(0, pose.yaw - pose.side * swing, lift);
        else this.e.set(swing, pose.yaw, 0);
        this.q.setFromEuler(this.e);
        this.v.set(pose.x, pose.y + (this.creature === 'ant' ? 0 : lift * 0.22), pose.z);
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
    if (this.details) {
      this.details.count = n;
    }
    if (this.tail) this.tail.count = n;
    this.legs.count = legN;
    this.cubes.count = cubeN;
    if (this.hat) {
      this.hat.count = n;
    }
    for (const mesh of [this.body, this.eyes, this.pupils, this.legs, this.cubes, this.details, this.hat, this.tail]) {
      if (!mesh || !mesh.count) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const mesh of [this.body, this.eyes, this.pupils, this.legs, this.cubes, ...(this.hat ? [this.hat] : []), ...(this.details ? [this.details] : []), ...(this.tail ? [this.tail] : [])]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
