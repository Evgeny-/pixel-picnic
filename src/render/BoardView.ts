import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Sim } from '../core/sim';
import type { Fence, PieceShape } from '../core/types';
import { pieceGeometry, pieceMaterial } from './pieces';
import { cellCenter, type Layout } from './layout';

export const CUBE_H = 0.62;
const FLOOR_Y = 0.06;
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const WHITE = new THREE.Color(1, 1, 1);

export function roundedRectShape(x: number, y: number, w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): THREE.Path {
  const s = new THREE.Path();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

interface CubeAnim {
  cell: number;
  t: number;
  dur: number;
  kind: 'wobble' | 'drop';
  delay: number;
}

/** The picture: one rounded voxel per pixel inside a wooden tray. */
export class BoardView {
  readonly group = new THREE.Group();
  readonly cubes: THREE.InstancedMesh;
  private readonly w: number;
  private readonly h: number;
  private readonly instOf: Int32Array;
  private readonly present: Uint8Array;
  private readonly colors: THREE.Color[];
  private readonly cellColor: Int16Array;
  private layoutRef!: Layout;
  private frameMesh: THREE.Mesh | null = null;
  private floorMesh: THREE.Mesh | null = null;
  private anims: CubeAnim[] = [];
  private clock = 0;
  private hl = new Set<number>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly frameMat: THREE.MeshStandardMaterial;
  private readonly floorMat: THREE.MeshStandardMaterial;

  private readonly fenceDefs: Fence[];
  private readonly fences = new THREE.Group();
  private readonly picketGeo: THREE.BufferGeometry;
  private readonly postGeo = new RoundedBoxGeometry(0.14, 0.5, 0.14, 2, 0.03);
  private readonly capGeo = new THREE.SphereGeometry(0.085, 16, 12);
  private readonly railGeo = new THREE.BoxGeometry(1, 0.055, 0.05);
  /** Flat handrail on top: from the steep camera angle it keeps side fences readable. */
  private readonly handGeo = new THREE.BoxGeometry(1, 0.035, 0.14);
  private readonly fenceMat = new THREE.MeshStandardMaterial({ color: '#c0814a', roughness: 0.62 });
  private readonly postMat = new THREE.MeshStandardMaterial({ color: '#8f5a31', roughness: 0.66 });
  private readonly capMat = new THREE.MeshStandardMaterial({ color: '#ff9f1a', roughness: 0.3, emissive: '#ff8a00', emissiveIntensity: 0.25 });

  constructor(sim: Sim, palette: string[], frameColor = '#efd3a0', shape: PieceShape = 'cube') {
    this.w = sim.w;
    this.h = sim.h;
    this.fenceDefs = sim.s.fences;
    // A picket: a thin board with a pointed top, standing on y = 0, facing ±Z.
    const pk = new THREE.Shape();
    pk.moveTo(-0.048, 0);
    pk.lineTo(0.048, 0);
    pk.lineTo(0.048, 0.33);
    pk.lineTo(0, 0.4);
    pk.lineTo(-0.048, 0.33);
    pk.closePath();
    this.picketGeo = new THREE.ExtrudeGeometry(pk, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
    this.picketGeo.translate(0, 0, -0.025);
    this.group.add(this.fences);
    const n = sim.w * sim.h;
    this.instOf = new Int32Array(n).fill(-1);
    this.cellColor = new Int16Array(n);
    const cells: number[] = [];
    for (let i = 0; i < n; i++) {
      this.cellColor[i] = sim.cellColor(i);
      if (sim.cellColor(i) >= 0) {
        this.instOf[i] = cells.length;
        cells.push(i);
      }
    }
    this.present = new Uint8Array(n);
    this.colors = palette.map((c) => new THREE.Color(c));
    // Pieces are small on screen: low segment counts keep the triangle budget down.
    this.cubes = new THREE.InstancedMesh(pieceGeometry(shape), pieceMaterial(shape), Math.max(1, cells.length));
    this.cubes.castShadow = true;
    this.cubes.receiveShadow = true;
    this.cubes.count = cells.length;
    cells.forEach((cell, k) => this.cubes.setColorAt(k, this.colors[this.cellColor[cell]]));
    if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;
    this.group.add(this.cubes);
    this.frameMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.62, metalness: 0 });
    this.floorMat = new THREE.MeshStandardMaterial({ color: '#fbf1dc', roughness: 0.9, metalness: 0 });
    for (let i = 0; i < n; i++) this.present[i] = sim.cellColor(i) >= 0 && !sim.eaten[i] ? 1 : 0;
  }

  setLayout(l: Layout): void {
    this.layoutRef = l;
    this.buildFrame(l);
    this.buildFences(l);
    for (let i = 0; i < this.w * this.h; i++) if (this.instOf[i] >= 0) this.writeMatrix(i, this.present[i] ? 1 : 0, 0);
    this.cubes.instanceMatrix.needsUpdate = true;
    this.cubes.computeBoundingSphere();
  }

  get layout(): Layout {
    return this.layoutRef;
  }

  /**
   * Picket fences on the rim where ants can't get in. A gap in a fence is a gate, marked by two
   * posts with orange knobs.
   */
  private buildFences(l: Layout): void {
    for (const c of this.fences.children) if (c instanceof THREE.InstancedMesh) c.dispose();
    this.fences.clear();
    if (!this.fenceDefs.length) return;
    const pad = l.cell * 0.35;
    const edge = {
      x0: l.picX0 - pad - l.frame / 2,
      x1: l.picX0 + l.picW + pad + l.frame / 2,
      z0: l.picZ0 - pad - l.frame / 2,
      z1: l.picZ0 + l.picH + pad + l.frame / 2,
    };
    const top = 0.1 + Math.max(0.06, Math.min(0.2, l.cell * 0.32));
    type Run = { horiz: boolean; fixed: number; a: number; b: number; gateA: boolean; gateB: boolean };
    const runs: Run[] = [];
    for (const f of this.fenceDefs) {
      const horiz = f.side === 'top' || f.side === 'bottom';
      const len = horiz ? this.w : this.h;
      const from = Math.max(0, f.from);
      const to = Math.min(len, f.to);
      if (to <= from) continue;
      const base = horiz ? l.picX0 : l.picZ0;
      const lo = horiz ? edge.x0 : edge.z0;
      const hi = horiz ? edge.x1 : edge.z1;
      runs.push({
        horiz,
        fixed: f.side === 'top' ? edge.z0 : f.side === 'bottom' ? edge.z1 : f.side === 'left' ? edge.x0 : edge.x1,
        a: from === 0 ? lo : base + from * l.cell,
        b: to === len ? hi : base + to * l.cell,
        gateA: from > 0,
        gateB: to < len,
      });
    }
    const pickets: THREE.Matrix4[] = [];
    const posts: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const hands: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    const at = (r: Run, t: number, y: number) => (r.horiz ? pos.set(t, y, r.fixed) : pos.set(r.fixed, y, t));
    const spacing = 0.135;
    for (const r of runs) {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.horiz ? 0 : Math.PI / 2);
      const len = r.b - r.a;
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k <= n; k++) {
        const t = r.a + (len * k) / n;
        const jitter = 0.94 + (((k * 7919) % 13) / 13) * 0.1;
        sc.set(1, jitter, 1);
        pickets.push(m.compose(at(r, t, top), q, sc).clone());
      }
      sc.set(1, 1, 1);
      sc.set(len, 1, 1);
      rails.push(m.compose(at(r, (r.a + r.b) / 2, top + 0.1), q, sc).clone());
      hands.push(m.compose(at(r, (r.a + r.b) / 2, top + 0.3), q, sc).clone());
      sc.set(1, 1, 1);
      for (const [t, gate] of [[r.a, r.gateA], [r.b, r.gateB]] as const) {
        // Gate posts are taller and wear bright knobs so the opening is easy to spot.
        sc.set(1, gate ? 1.25 : 1, 1);
        posts.push(m.compose(at(r, t, top + (gate ? 0.31 : 0.25)), q, sc).clone());
        sc.set(1, 1, 1);
        if (gate) caps.push(m.compose(at(r, t, top + 0.68), q, sc).clone());
      }
    }
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      this.fences.add(im);
    };
    add(this.picketGeo, this.fenceMat, pickets);
    add(this.railGeo, this.postMat, rails);
    add(this.handGeo, this.postMat, hands);
    add(this.postGeo, this.postMat, posts);
    add(this.capGeo, this.capMat, caps);
  }

  private buildFrame(l: Layout): void {
    if (this.frameMesh) {
      this.group.remove(this.frameMesh);
      this.frameMesh.geometry.dispose();
    }
    if (this.floorMesh) {
      this.group.remove(this.floorMesh);
      this.floorMesh.geometry.dispose();
      (this.floorMat.map as THREE.Texture | null)?.dispose();
    }
    const pad = l.cell * 0.35;
    const x = l.picX0 - pad;
    const z = l.picZ0 - pad;
    const w = l.picW + pad * 2;
    const h = l.picH + pad * 2;
    const f = l.frame;
    const outer = roundedRectShape(x - f, -(z + h + f), w + f * 2, h + f * 2, f * 1.6);
    outer.holes.push(roundedRectPath(x, -(z + h), w, h, f * 0.7));
    const depth = Math.max(0.06, Math.min(0.2, l.cell * 0.32));
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.07,
      bevelSegments: 3,
      curveSegments: 10,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.05, 0);
    this.frameMesh = new THREE.Mesh(geo, this.frameMat);
    this.frameMesh.castShadow = true;
    this.frameMesh.receiveShadow = true;
    this.group.add(this.frameMesh);

    const floorGeo = new THREE.ShapeGeometry(roundedRectShape(x - 0.02, -(z + h + 0.02), w + 0.04, h + 0.04, f * 0.7), 8);
    floorGeo.rotateX(-Math.PI / 2);
    // UVs: map texture 1:1 to the picture grid
    const uv = floorGeo.attributes.uv as THREE.BufferAttribute;
    const pos = floorGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - l.picX0) / l.picW, 1 - (pos.getZ(i) - l.picZ0) / l.picH);
    }
    this.floorMat.map = this.floorTexture();
    this.floorMat.needsUpdate = true;
    this.floorMesh = new THREE.Mesh(floorGeo, this.floorMat);
    this.floorMesh.position.y = 0.035;
    this.floorMesh.receiveShadow = true;
    this.group.add(this.floorMesh);
  }

  /** Floor of the tray: faint dimples where cubes sit, so the eaten area looks like an empty mould. */
  private floorTexture(): THREE.Texture {
    const px = Math.max(8, Math.min(32, Math.floor(1024 / Math.max(this.w, this.h))));
    const c = document.createElement('canvas');
    c.width = this.w * px;
    c.height = this.h * px;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f7ead0';
    g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.cellColor[i] < 0) continue;
        const cx = x * px + px / 2;
        const cy = y * px + px / 2;
        const grad = g.createRadialGradient(cx, cy - px * 0.1, px * 0.05, cx, cy, px * 0.55);
        grad.addColorStop(0, 'rgba(214,186,140,0.55)');
        grad.addColorStop(1, 'rgba(214,186,140,0)');
        g.fillStyle = grad;
        g.fillRect(x * px, y * px, px, px);
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  private writeMatrix(cell: number, scale: number, lift: number, wobble = 0): void {
    const inst = this.instOf[cell];
    if (inst < 0) return;
    const l = this.layoutRef;
    const x = cell % this.w;
    const y = (cell - x) / this.w;
    const p = cellCenter(l, x, y);
    this.v.set(p.x, FLOOR_Y + (CUBE_H * l.cell) / 2 + lift, p.z);
    this.q.setFromAxisAngle(AXIS_Z, wobble);
    const s = l.cell * scale;
    this.sc.set(s, s, s);
    this.m4.compose(this.v, this.q, this.sc);
    this.cubes.setMatrixAt(inst, this.m4);
  }

  isPresent(cell: number): boolean {
    return this.present[cell] === 1;
  }

  /** World position of the top of a cube. */
  cubeWorld(cell: number, out: THREE.Vector3): THREE.Vector3 {
    const l = this.layoutRef;
    const x = cell % this.w;
    const y = (cell - x) / this.w;
    const p = cellCenter(l, x, y);
    return out.set(p.x, FLOOR_Y + CUBE_H * l.cell, p.z);
  }

  cubeColor(cell: number): THREE.Color {
    return this.colors[this.cellColor[cell]];
  }

  /** Lift and brighten the given cubes (reachable cubes of a hovered box color). */
  highlight(cells: number[] | null): void {
    const next = new Set(cells ?? []);
    const tmp = new THREE.Color();
    for (const c of this.hl) {
      if (next.has(c)) continue;
      const inst = this.instOf[c];
      this.cubes.setColorAt(inst, this.colors[this.cellColor[c]]);
      if (this.present[c]) this.writeMatrix(c, 1, 0);
    }
    for (const c of next) {
      if (this.hl.has(c) || !this.present[c]) continue;
      const inst = this.instOf[c];
      this.cubes.setColorAt(inst, tmp.copy(this.colors[this.cellColor[c]]).lerp(WHITE, 0.45));
      this.writeMatrix(c, 1.08, this.layoutRef.cell * 0.3);
    }
    this.hl = next;
    if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;
    this.cubes.instanceMatrix.needsUpdate = true;
  }

  /** A cube was picked up by an ant. */
  remove(cell: number): void {
    if (!this.present[cell]) return;
    this.present[cell] = 0;
    if (this.hl.delete(cell)) this.cubes.setColorAt(this.instOf[cell], this.colors[this.cellColor[cell]]);
    this.anims = this.anims.filter((a) => a.cell !== cell);
    this.writeMatrix(cell, 0, 0);
    this.cubes.instanceMatrix.needsUpdate = true;
  }

  /** Little shiver when an ant starts chewing on a cube. */
  wobble(cell: number): void {
    if (!this.present[cell]) return;
    this.anims.push({ cell, t: 0, dur: 0.35, kind: 'wobble', delay: 0 });
  }

  /** Re-sync visible cubes with the simulation (undo / restart). */
  syncFrom(sim: Sim, pop = true): void {
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.instOf[i] < 0) continue;
      const want = sim.eaten[i] ? 0 : 1;
      if (want === this.present[i]) continue;
      this.present[i] = want;
      if (want && pop) this.anims.push({ cell: i, t: 0, dur: 0.45, kind: 'drop', delay: Math.random() * 0.35 });
      else this.writeMatrix(i, want, 0);
    }
    this.cubes.instanceMatrix.needsUpdate = true;
  }

  /** Celebration: every cube falls back into place row by row. */
  rebuild(): number {
    const l = this.layoutRef;
    let maxDelay = 0;
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.instOf[i] < 0) continue;
      this.present[i] = 1;
      const x = i % this.w;
      const y = (i - x) / this.w;
      const delay = (this.h - 1 - y) * 0.045 + Math.abs(x - this.w / 2) * 0.012 + Math.random() * 0.05;
      maxDelay = Math.max(maxDelay, delay);
      this.anims.push({ cell: i, t: 0, dur: 0.5, kind: 'drop', delay });
      this.writeMatrix(i, 0, 0);
    }
    void l;
    this.cubes.instanceMatrix.needsUpdate = true;
    return maxDelay + 0.5;
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.anims.length) return;
    const keep: CubeAnim[] = [];
    for (const a of this.anims) {
      if (a.delay > 0) {
        a.delay -= dt;
        keep.push(a);
        continue;
      }
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (!this.present[a.cell]) continue;
      if (a.kind === 'wobble') {
        const amp = (1 - k) * 0.22;
        this.writeMatrix(a.cell, 1, 0, Math.sin(k * Math.PI * 6) * amp);
      } else {
        // drop in with a small bounce
        const e = k < 0.7 ? k / 0.7 : 1;
        const lift = (1 - e) * (1 - e) * 2.2 * this.layoutRef.cell * 4;
        const squash = k < 0.7 ? 1 : 1 + Math.sin(((k - 0.7) / 0.3) * Math.PI) * 0.12;
        this.writeMatrix(a.cell, Math.min(1, 0.3 + e * 0.7) * (2 - squash), lift);
      }
      if (k < 1) keep.push(a);
      else this.writeMatrix(a.cell, 1, 0);
    }
    this.anims = keep;
    this.cubes.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.cubes.geometry.dispose();
    (this.cubes.material as THREE.Material).dispose();
    this.frameMesh?.geometry.dispose();
    this.floorMesh?.geometry.dispose();
    this.floorMat.map?.dispose();
    this.frameMat.dispose();
    this.floorMat.dispose();
    for (const c of this.fences.children) if (c instanceof THREE.InstancedMesh) c.dispose();
    for (const g of [this.picketGeo, this.postGeo, this.capGeo, this.railGeo, this.handGeo]) g.dispose();
    for (const mt of [this.fenceMat, this.postMat, this.capMat]) mt.dispose();
  }
}
