import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Where, type Sim } from '../core/sim';
import { queuePos, type Layout } from './layout';
import { LabelTexture, mysteryTexture } from './textures';
import { roundedRectShape } from './BoardView';
import { BOX_H, BOX_LABEL_Z, BoxStyle } from './boxStyle';

const MYSTERY = new THREE.Color('#9b94b3');
const DIM = new THREE.Color('#8f8a7c');
const PULSE_RED = new THREE.Color('#ff5a4a');

interface BoxVis {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  label: LabelTexture;
  labelMesh: THREE.Mesh;
  ice: THREE.Mesh | null;
  color: THREE.Color;
  hiddenShown: boolean;
  where: 'queue' | 'slot' | 'gone';
  // motion
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  shake: number;
  flip: number;
  pop: number;
  bump: number;
  hint: number;
  fade: number;
  row: number;
}

interface LinkVis {
  a: number;
  b: number;
  /** A short golden chain between the two boxes. */
  chain: THREE.InstancedMesh;
}

const CHAIN_MAX = 14;
const AXIS_X = new THREE.Vector3(1, 0, 0);

/** Queue columns, slot tray and the ant boxes themselves. */
export class QueueView {
  readonly group = new THREE.Group();
  private boxes = new Map<number, BoxVis>();
  private links: LinkVis[] = [];
  private readonly boxStyle: BoxStyle;
  private readonly iceGeo = new RoundedBoxGeometry(1.12, BOX_H * 1.25, 1.12, 2, 0.16);
  private readonly labelGeo = new THREE.PlaneGeometry(1, 1);
  private readonly iceMat = new THREE.MeshStandardMaterial({
    color: '#cfefff',
    transparent: true,
    opacity: 0.62,
    roughness: 0.08,
    metalness: 0.05,
    envMapIntensity: 1.6,
    depthWrite: false,
  });
  private readonly linkMat = new THREE.MeshStandardMaterial({ color: '#e0b04a', roughness: 0.28, metalness: 0.85, envMapIntensity: 1.4 });
  private readonly linkGeo = new THREE.TorusGeometry(0.075, 0.024, 8, 18);
  private readonly lq = new THREE.Quaternion();
  private readonly lq2 = new THREE.Quaternion();
  private readonly lm = new THREE.Matrix4();
  private readonly ls = new THREE.Vector3();
  private readonly lp = new THREE.Vector3();
  private readonly ldir = new THREE.Vector3();
  private readonly mysteryTex = mysteryTexture();
  private tray: THREE.Group | null = null;
  private readonly trayMat = new THREE.MeshStandardMaterial({ color: '#efd3a0', roughness: 0.62 });
  private readonly padMat = new THREE.MeshStandardMaterial({ color: '#d9b67c', roughness: 0.85 });
  private readonly padBase = new THREE.Color('#d9b67c');
  private layout!: Layout;
  private sim: Sim;
  private colors: THREE.Color[];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private slotPulse = 0;
  /** "+3" under a column: how many boxes are still hidden below the visible rows. */
  private more: { mesh: THREE.Mesh; label: LabelTexture }[] = [];

  /** Show how many boxes are hidden in a column ("+3"), or only that there are some ("?"). */
  private hint: 'count' | 'mystery' = 'count';

  constructor(sim: Sim, palette: string[], hint: 'count' | 'mystery' = 'count', skin = 'classic') {
    this.boxStyle = new BoxStyle(skin);
    this.hint = hint;
    this.sim = sim;
    this.colors = palette.map((c) => new THREE.Color(c));
    for (let id = 0; id < sim.boxIds; id++) {
      if (sim.boxColor(id) < 0) continue;
      this.boxes.set(id, this.makeBox(id));
    }
    for (let c = 0; c < sim.columns.length; c++) {
      const label = new LabelTexture(128);
      const mesh = new THREE.Mesh(
        this.labelGeo,
        new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.more.push({ mesh, label });
    }
    const seen = new Set<number>();
    for (let id = 0; id < sim.boxIds; id++) {
      const l = sim.boxLink(id);
      if (l < 0 || seen.has(l)) continue;
      seen.add(l);
      const g = sim.groupOf(id);
      for (let k = 0; k + 1 < g.length; k++) {
        const chain = new THREE.InstancedMesh(this.linkGeo, this.linkMat, CHAIN_MAX);
        chain.castShadow = true;
        chain.frustumCulled = false;
        this.group.add(chain);
        this.links.push({ a: g[k], b: g[k + 1], chain });
      }
    }
  }

  private makeBox(id: number): BoxVis {
    const group = new THREE.Group();
    const color = this.colors[this.sim.boxColor(id)];
    const body = this.boxStyle.createBody(color);
    const mat = body.material;
    body.userData.boxId = id;
    group.add(body);
    const label = new LabelTexture(128);
    // Lit like the box itself, so the number reads as part of the lid.
    const labelMat = new THREE.MeshStandardMaterial({
      map: label.texture,
      transparent: true,
      depthWrite: false,
      roughness: 0.45,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const labelMesh = new THREE.Mesh(this.labelGeo, labelMat);
    labelMesh.renderOrder = 5;
    group.add(labelMesh);
    let ice: THREE.Mesh | null = null;
    if (this.sim.boxThawAt(id) > 0) {
      ice = new THREE.Mesh(this.iceGeo, this.iceMat);
      ice.position.y = (BOX_H * 1.25) / 2 - 0.02;
      ice.renderOrder = 4;
      group.add(ice);
    }
    this.group.add(group);
    return {
      id, group, body, mat, label, labelMesh, ice, color,
      hiddenShown: false, where: 'queue',
      from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.001, arc: 0,
      shake: 0, flip: 0, pop: 0, bump: 0, hint: 0, fade: 1, row: 0,
    };
  }

  setSim(sim: Sim): void {
    this.sim = sim;
  }

  /** Night mode: the slot tray darkens (the boxes keep their colors). */
  setNight(on: boolean): void {
    this.trayMat.color.set(on ? '#6c6586' : '#efd3a0');
    this.padBase.set(on ? '#57506f' : '#d9b67c');
    this.padMat.color.copy(this.padBase);
  }

  setLayout(l: Layout): void {
    this.layout = l;
    this.buildTray(l);
    // label faces the camera
    for (const b of this.boxes.values()) {
      // Printed on the top face like a sticker: never clipped by the box itself.
      b.labelMesh.rotation.set(-Math.PI / 2, 0, 0);
      b.labelMesh.scale.setScalar(0.92);
    }
    this.more.forEach((m, c) => {
      // Just past the last visible row (rows grow downwards in portrait, upwards in landscape,
      // where the label has to clear the boxes' height).
      const p = queuePos(l, c, l.queueRowsVisible - (l.queueRow > 0 ? 0.4 : -0.15));
      m.mesh.position.set(p.x, 0.02, p.z);
      m.mesh.scale.setScalar(l.boxSize * 0.8);
    });
    this.syncFromSim(false);
  }

  private buildTray(l: Layout): void {
    if (this.tray) {
      this.group.remove(this.tray);
      this.tray.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const tray = new THREE.Group();
    const n = l.slot.length;
    const sp = n > 1 ? l.slot[1].x - l.slot[0].x : 1.6;
    const cx = (l.slot[0].x + l.slot[n - 1].x) / 2;
    const cz = l.slot[0].z;
    const w = sp * (n - 1) + l.slotSize + 0.55;
    const h = l.slotSize + 0.55;
    const shape = roundedRectShape(cx - w / 2, -(cz + h / 2), w, h, 0.4);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 3, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(geo, this.trayMat);
    plate.receiveShadow = true;
    plate.castShadow = true;
    tray.add(plate);
    for (const s of l.slot) {
      const pad = new THREE.Mesh(
        new THREE.ShapeGeometry(roundedRectShape(s.x - l.slotSize / 2 - 0.04, -(s.z + l.slotSize / 2 + 0.04), l.slotSize + 0.08, l.slotSize + 0.08, 0.22), 6),
        this.padMat,
      );
      pad.geometry.rotateX(-Math.PI / 2);
      pad.position.y = 0.175;
      pad.receiveShadow = true;
      tray.add(pad);
    }
    this.tray = tray;
    this.group.add(tray);
  }

  /**
   * X of a queue column: the columns that still have boxes close ranks and stay centred, so an
   * emptied column doesn't leave a hole in the middle.
   */
  private columnX(col: number): number {
    const l = this.layout;
    const n = l.queueCol.length;
    const spacing = n > 1 ? l.queueCol[1] - l.queueCol[0] : 1.6;
    const center = (l.queueCol[0] + l.queueCol[n - 1]) / 2;
    const active: number[] = [];
    for (let c = 0; c < this.sim.columns.length; c++) if (this.sim.columns[c].length) active.push(c);
    const k = active.indexOf(col);
    if (k < 0) return l.queueCol[col];
    return center + (k - (active.length - 1) / 2) * spacing;
  }

  /** Target position for a box according to the simulation. */
  private targetOf(id: number, out: THREE.Vector3): { where: BoxVis['where']; row: number } {
    const w = this.sim.boxWhere[id];
    if (w === Where.Queue) {
      const col = this.sim.boxCol[id];
      const row = this.sim.columns[col].indexOf(id);
      const p = queuePos(this.layout, col, row);
      out.set(this.columnX(col), 0, p.z);
      return { where: 'queue', row };
    }
    if (w === Where.Slot) {
      const s = this.sim.slots.findIndex((sl) => sl?.box === id);
      const p = this.layout.slot[Math.max(0, Math.min(this.layout.slot.length - 1, s))];
      out.set(p.x, 0.17, p.z);
      return { where: 'slot', row: 0 };
    }
    return { where: 'gone', row: 0 };
  }

  /** Move every box towards where the simulation says it is. */
  syncFromSim(animate = true): void {
    for (const b of this.boxes.values()) {
      const { where, row } = this.targetOf(b.id, this.tmp);
      const wasGone = b.where === 'gone';
      if (where === 'gone') {
        if (b.where !== 'gone') {
          b.where = 'gone';
          if (!animate) b.group.visible = false;
          else b.pop = Math.max(b.pop, 0.0001);
        }
        continue;
      }
      if (wasGone) {
        b.group.visible = true;
        b.pop = 0;
      }
      const moved = !b.to.equals(this.tmp) || b.where !== where;
      b.row = row;
      if (moved) {
        b.from.copy(animate ? b.group.position : this.tmp);
        b.to.copy(this.tmp);
        b.t = 0;
        const jump = where === 'slot' && b.where === 'queue';
        b.dur = animate ? (jump ? 0.42 : 0.26) : 0.0001;
        b.arc = jump ? 1.4 : 0;
        if (!animate) b.group.position.copy(this.tmp);
      }
      b.where = where;
    }
    this.refreshLabels();
  }

  refreshLabels(): void {
    for (const b of this.boxes.values()) this.refreshLabel(b);
    if (!this.layout) return;
    this.more.forEach((m, c) => {
      const hidden = Math.max(0, this.sim.columns[c].length - this.layout.queueRowsVisible);
      m.mesh.visible = hidden > 0;
      m.mesh.position.x = this.columnX(c);
      if (hidden > 0) {
        m.label.draw(this.hint === 'mystery' ? '?' : `+${hidden}`, { fill: '#ffffff', stroke: 'rgba(40, 28, 70, 0.9)', shadow: 'rgba(0, 0, 0, 0.3)', scale: 0.85 });
      }
    });
  }

  private refreshLabel(b: BoxVis): void {
    const hidden = this.sim.boxHidden[b.id] === 1;
    const frozen = this.sim.isFrozen(b.id);
    if (hidden) {
      b.mat.color.copy(MYSTERY);
      b.mat.map = this.mysteryTex;
      b.mat.needsUpdate = b.hiddenShown === false;
      b.hiddenShown = true;
      b.label.draw('?', labelStyle(MYSTERY));
    } else {
      if (b.hiddenShown) {
        b.hiddenShown = false;
        b.mat.map = null;
        b.mat.needsUpdate = true;
        b.flip = 1;
      }
      b.mat.color.copy(b.color);
      if (frozen) b.label.draw(String(this.sim.frozenLeft(b.id)), { fill: '#eefaff', stroke: '#3d7fae', shadow: 'rgba(30,70,110,0.4)' });
      else {
        // A finished box keeps showing 0 while it pops (its slot is already empty).
        const sl = this.sim.slots.find((s) => s?.box === b.id);
        const n = sl ? sl.left : this.sim.boxWhere[b.id] === Where.Done ? 0 : this.sim.boxCount(b.id);
        b.label.draw(String(n), labelStyle(b.color));
      }
    }
    if (b.ice && !frozen && b.ice.visible) {
      b.ice.visible = false;
    }
  }

  /** Box ids under the pointer ray. */
  pick(ray: THREE.Raycaster): number | null {
    const meshes: THREE.Object3D[] = [];
    for (const b of this.boxes.values()) if (b.where === 'queue' && b.group.visible && b.fade > 0.2) meshes.push(b.body);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) return hit.object.userData.boxId as number;
    // Forgiving taps: nearest front box within a radius on the ground.
    return null;
  }

  shake(id: number): void {
    const b = this.boxes.get(id);
    if (b) b.shake = 0.45;
  }

  bump(id: number): void {
    const b = this.boxes.get(id);
    if (b) b.bump = 0.25;
  }

  setHint(id: number | null): void {
    for (const b of this.boxes.values()) b.hint = b.id === id ? Math.max(b.hint, 0.001) : 0;
  }

  pulseSlots(): void {
    this.slotPulse = 1;
  }

  /** World position of the top of a box (for ants leaving it). */
  boxTop(id: number, out: THREE.Vector3): THREE.Vector3 {
    const b = this.boxes.get(id);
    if (!b) return out.set(0, 0, 0);
    // Use where the box is heading (a box flying into its slot already releases ants there).
    const p = b.t < 1 ? b.to : b.group.position;
    return out.copy(p).setY(p.y + BOX_H * this.layout.boxSize);
  }

  boxColor(id: number): THREE.Color {
    return this.colors[this.sim.boxColor(id)];
  }

  isSettled(): boolean {
    // A small box can empty while still flying to its slot: finished boxes don't count.
    for (const b of this.boxes.values()) if (b.pop > 0 || (b.t < 1 && b.where !== 'gone')) return false;
    return true;
  }

  update(dt: number, time: number): void {
    const l = this.layout;
    const s = l.boxSize;
    for (const b of this.boxes.values()) {
      // Finished boxes stay hidden; everything else keeps animating even while faded out, so a
      // box moving up from the hidden rows appears again (and the queue can settle).
      if (b.where === 'gone' && b.pop === 0) {
        b.group.visible = false;
        continue;
      }
      if (b.t < 1) {
        b.t = Math.min(1, b.t + dt / b.dur);
        const k = easeOutCubic(b.t);
        b.group.position.lerpVectors(b.from, b.to, k);
        b.group.position.y += Math.sin(b.t * Math.PI) * b.arc;
        if (b.t >= 1 && b.arc > 0) b.bump = 0.22;
      }
      let sx = s;
      let sy = s;
      let sz = s;
      if (b.bump > 0) {
        b.bump = Math.max(0, b.bump - dt);
        const k = b.bump / 0.22;
        sy *= 1 - Math.sin(k * Math.PI) * 0.18;
        sx *= 1 + Math.sin(k * Math.PI) * 0.1;
        sz = sx;
      }
      let offX = 0;
      if (b.shake > 0) {
        b.shake = Math.max(0, b.shake - dt);
        offX = Math.sin(b.shake * 55) * 0.09 * (b.shake / 0.45);
      }
      if (b.pop > 0) {
        b.pop += dt;
        const k = b.pop / 0.3;
        const sc = k < 0.35 ? 1 + k * 0.5 : Math.max(0, 1.18 * (1 - (k - 0.35) / 0.65));
        sx *= sc;
        sy *= sc;
        sz *= sc;
        if (k >= 1) {
          b.group.visible = false;
          b.pop = 0;
          continue;
        }
      }
      if (b.hint > 0) {
        b.hint += dt;
        b.group.position.y = b.to.y + Math.abs(Math.sin(b.hint * 5)) * 0.35;
      }
      // rows beyond the visible range shrink and dim, deeper ones disappear
      // Only the visible rows show; deeper boxes rise into view as the column moves up.
      const targetFade = b.where !== 'queue' ? 1 : b.row < l.queueRowsVisible ? 1 : 0;
      b.fade += (targetFade - b.fade) * Math.min(1, dt * 8);
      const f = b.fade;
      const fs = 0.55 + 0.45 * f;
      b.group.scale.set(sx * fs, sy * fs, sz * fs);
      b.group.visible = f > 0.05 || b.pop > 0;
      if (!b.group.visible) continue;
      b.body.position.x = offX;
      b.labelMesh.position.set(offX, BOX_H + 0.012, BOX_LABEL_Z);
      b.labelMesh.visible = f > 0.75;
      if (!b.hiddenShown) b.mat.color.copy(b.color).lerp(DIM, (1 - f) * 0.9);
      if (b.flip > 0) {
        b.flip = Math.max(0, b.flip - dt * 2.8);
        b.body.rotation.x = (1 - easeOutCubic(1 - b.flip)) * Math.PI * 2 * (b.flip > 0 ? 1 : 0);
      } else b.body.rotation.x = 0;
      if (b.ice) {
        b.ice.rotation.y = Math.sin(time * 1.3 + b.id) * 0.02;
      }
    }
    for (const lk of this.links) this.updateChain(lk, s);
    if (this.slotPulse > 0) {
      this.slotPulse = Math.max(0, this.slotPulse - dt * 0.7);
      const k = Math.sin(this.slotPulse * Math.PI * 4) * this.slotPulse;
      this.padMat.color.copy(this.padBase).lerp(PULSE_RED, Math.max(0, k) * 0.6);
    }
  }

  /** Lay the chain links from the side of one box to the side of the other, sagging a little. */
  private updateChain(lk: LinkVis, s: number): void {
    const a = this.boxes.get(lk.a)!;
    const b = this.boxes.get(lk.b)!;
    const vis = a.group.visible && b.group.visible && a.where !== 'gone' && b.where !== 'gone' && a.fade > 0.3 && b.fade > 0.3;
    lk.chain.visible = vis;
    if (!vis) return;
    const pa = this.tmp.copy(a.group.position);
    const pb = this.tmp2.copy(b.group.position);
    const dir = this.ldir.subVectors(pb, pa).setY(0);
    const centers = dir.length();
    if (centers < 1e-4) {
      lk.chain.count = 0;
      return;
    }
    dir.divideScalar(centers);
    // Start and end just inside the facing sides, at 55% of the box height.
    const half = s * 0.5 * Math.min(1 / Math.max(Math.abs(dir.x), 1e-3), 1 / Math.max(Math.abs(dir.z), 1e-3), 1.4) - 0.05 * s;
    const y0 = pa.y + BOX_H * s * 0.55;
    const y1 = pb.y + BOX_H * s * 0.55;
    const len = Math.max(0.05, centers - half * 2);
    const n = Math.max(2, Math.min(CHAIN_MAX, Math.round(len / (0.13 * s)) + 1));
    this.lq.setFromUnitVectors(AXIS_X, dir);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const d = half + len * t;
      const sag = Math.sin(t * Math.PI) * Math.min(0.12, len * 0.18);
      this.ls.set(pa.x + dir.x * d, y0 + (y1 - y0) * t - sag, pa.z + dir.z * d);
      this.lq2.setFromAxisAngle(AXIS_X, i % 2 ? Math.PI / 2 : 0).premultiply(this.lq);
      this.lm.compose(this.ls, this.lq2, this.lp.set(1.45 * s, s, s));
      lk.chain.setMatrixAt(i, this.lm);
    }
    lk.chain.count = n;
    lk.chain.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const lk of this.links) lk.chain.dispose();
    for (const m of this.more) {
      m.label.dispose();
      (m.mesh.material as THREE.Material).dispose();
    }
    for (const b of this.boxes.values()) {
      b.mat.dispose();
      b.label.dispose();
      (b.labelMesh.material as THREE.Material).dispose();
    }
    this.boxStyle.dispose();
    this.iceGeo.dispose();
    this.labelGeo.dispose();
    this.iceMat.dispose();
    this.linkMat.dispose();
    this.linkGeo.dispose();
    this.mysteryTex.dispose();
    this.trayMat.dispose();
    this.padMat.dispose();
    this.tray?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Number colors derived from the box color: a light tint, a darker rim and a soft shadow. */
function labelStyle(c: THREE.Color): { fill: string; stroke: string; shadow: string } {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const h = Math.round(hsl.h * 360);
  const s = Math.round(Math.min(0.75, hsl.s) * 100);
  if (hsl.l > 0.78) {
    // White and pastel boxes: dark numbers with a light rim, or they'd vanish into the lid.
    return {
      fill: `hsl(${h}, ${Math.round(s * 0.6)}%, 30%)`,
      stroke: `hsl(${h}, ${Math.round(s * 0.4)}%, 98%)`,
      shadow: `hsla(${h}, ${s}%, 25%, 0.22)`,
    };
  }
  const light = hsl.l > 0.66;
  return {
    fill: `hsl(${h}, ${Math.round(s * 0.5)}%, ${light ? 99 : 96}%)`,
    stroke: `hsl(${h}, ${s}%, ${Math.round(Math.max(0.16, hsl.l * (light ? 0.45 : 0.42)) * 100)}%)`,
    shadow: `hsla(${h}, ${s}%, ${Math.round(Math.max(0.1, hsl.l * 0.3) * 100)}%, 0.45)`,
  };
}
