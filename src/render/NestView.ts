import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Layout } from './layout';

/** Arched doorway outline (door-sized, bottom edge on y = 0). */
function archShape(w: number, h: number): THREE.Shape {
  const r = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}

/** Deterministic pseudo random numbers so a house looks the same every time. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export type HouseSkin = 'cottage' | 'mushroom' | 'cabin' | 'gingerbread' | 'igloo' | 'pumpkin' | 'tower';

interface AddOpts {
  rough?: number;
  parent?: THREE.Object3D;
  shadow?: boolean;
  basic?: boolean;
  side?: THREE.Side;
}

interface CottageLook {
  walls: 'plain' | 'logs';
  wall: string;
  roof: string;
  gable: string;
  chimney: string;
  icing?: boolean;
}

/**
 * The ants' home. Every look faces the camera with its door in the middle of the front, where the
 * ants run in; its footprint is an obstacle they walk around. Windows glow at night.
 */
export class NestView {
  readonly group = new THREE.Group();
  /** Everything that bounces when an ant runs in. */
  private body = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private pulse = 0;
  private scale = 1;
  /** Window panes: pale sky reflections by day, warm lamplight at night. */
  private panes: THREE.MeshStandardMaterial[] = [];
  /** Local z of the door plane and the half extents of the house on the ground. */
  private frontZ = 0.5;
  private halfW = 0.6;
  private halfD = 0.5;

  constructor(roofColor = '#e8674a', skin: HouseSkin = 'cottage') {
    switch (skin) {
      case 'mushroom':
        this.mushroom();
        break;
      case 'cabin':
        this.cottage({ walls: 'logs', wall: '#a86f3e', roof: '#5f8f3e', gable: '#8b5a2b', chimney: '#9a9a9a' });
        break;
      case 'gingerbread':
        this.cottage({ walls: 'plain', wall: '#b86a2c', roof: '#5a3217', gable: '#b86a2c', chimney: '#f2f2f2', icing: true });
        break;
      case 'igloo':
        this.igloo();
        break;
      case 'pumpkin':
        this.pumpkin();
        break;
      case 'tower':
        this.tower(roofColor);
        break;
      default:
        this.cottage({ walls: 'plain', wall: '#fbecd0', roof: roofColor, gable: '#fbecd0', chimney: '#c0714f' });
    }
    this.group.add(this.body);
    this.setNight(false);
  }

  private add(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, opts: AddOpts = {}): THREE.Mesh {
    const side = opts.side ?? THREE.FrontSide;
    const mat = opts.basic
      ? new THREE.MeshBasicMaterial({ color, side })
      : new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, side });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.shadow ?? true;
    mesh.receiveShadow = true;
    (opts.parent ?? this.body).add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  /** A window pane that lights up at night. */
  private pane(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.Mesh {
    const m = this.add(geo, '#9fd8ff', x, y, z, { shadow: false, rough: 0.2 });
    this.panes.push(m.material as THREE.MeshStandardMaterial);
    return m;
  }

  /** Dark arched doorway with a frame and the door swung open to the left. */
  private door(z: number, y: number, w: number, h: number, frame: string, wood: string): void {
    this.add(new THREE.ShapeGeometry(archShape(w + 0.1, h + 0.06), 12), frame, 0, y, z + 0.003, { shadow: false });
    this.add(new THREE.ShapeGeometry(archShape(w, h), 12), '#2a1810', 0, y, z + 0.006, { shadow: false, basic: true });
    const geo = new THREE.ExtrudeGeometry(archShape(w, h), { depth: 0.035, bevelEnabled: false, curveSegments: 10 });
    geo.translate(w / 2, 0, 0);
    const hinge = new THREE.Group();
    hinge.position.set(-w / 2, y, z + 0.01);
    hinge.rotation.y = -1.95;
    this.body.add(hinge);
    const leaf = this.add(geo, wood, 0, 0, 0, { parent: hinge });
    this.add(new THREE.SphereGeometry(0.022, 10, 8), '#f2c14e', w * 0.82, h * 0.5, 0.045, { parent: leaf, shadow: false });
    this.frontZ = z;
  }

  // ---------------------------------------------------------------- looks

  /** Gabled house facing the camera: plain walls (cottage, gingerbread) or logs (cabin). */
  private cottage(o: CottageLook): void {
    const W = 1.1;
    const D = 0.95;
    const H = 0.8;
    const BASE = 0.1;
    const GABLE = 0.62;
    const EAVE = 0.14;
    const top = BASE + H;
    const front = D / 2;
    this.add(new RoundedBoxGeometry(W + 0.16, BASE, D + 0.14, 2, 0.04), '#cfc5b6', 0, BASE / 2, 0, { rough: 0.9 });
    if (o.walls === 'logs') {
      // Interlocking logs around a dark core that fills the gaps.
      this.add(new THREE.BoxGeometry(W - 0.1, H, D - 0.1), '#4d321c', 0, BASE + H / 2, 0);
      const r = 0.085;
      for (let k = 0; k < 5; k++) {
        const y = BASE + r + k * 0.16;
        for (const z of [-D / 2 + r, D / 2 - r]) {
          const g = new THREE.CylinderGeometry(r, r, W + 0.16, 10);
          g.rotateZ(Math.PI / 2);
          this.add(g, new THREE.Color(o.wall).offsetHSL(0, 0, (hash(k * 7 + z * 10) - 0.5) * 0.08).getStyle(), 0, y, z, { rough: 0.85 });
        }
        for (const x of [-W / 2 + r, W / 2 - r]) {
          const g = new THREE.CylinderGeometry(r, r, D + 0.16, 10);
          g.rotateX(Math.PI / 2);
          this.add(g, new THREE.Color(o.wall).offsetHSL(0, 0, (hash(k * 5 + x * 10) - 0.5) * 0.08).getStyle(), x, y + 0.08, 0, { rough: 0.85 });
        }
      }
    } else {
      this.add(new RoundedBoxGeometry(W, H, D, 3, 0.06), o.wall, 0, BASE + H / 2, 0, { rough: 0.8 });
    }
    const gable = new THREE.Shape();
    gable.moveTo(-W / 2, 0);
    gable.lineTo(W / 2, 0);
    gable.lineTo(0, GABLE - 0.04);
    gable.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: D - 0.02, bevelEnabled: false });
    gableGeo.translate(0, 0, -(D - 0.02) / 2);
    this.add(gableGeo, o.gable, 0, top - 0.01, 0, { rough: 0.8 });

    // Two roof slopes meeting at the ridge, overhanging front and back.
    const run = W / 2 + EAVE;
    const slope = Math.atan2(GABLE, W / 2);
    const slab = Math.hypot(run, GABLE * (run / (W / 2))) + 0.02;
    const depth = D + 0.26;
    const tile = new THREE.Color(o.roof).offsetHSL(0, 0, -0.12).getStyle();
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, top + GABLE + 0.02, 0);
      g.rotation.z = side * -slope;
      this.body.add(g);
      this.add(new RoundedBoxGeometry(slab, 0.08, depth, 2, 0.03), o.roof, (side * slab) / 2, 0, 0, { parent: g, rough: 0.55 });
      if (o.icing) {
        // White icing along the eaves and candy buttons on the roof.
        const edge = new THREE.CylinderGeometry(0.035, 0.035, depth + 0.02, 8);
        edge.rotateX(Math.PI / 2);
        this.add(edge, '#fff8f0', side * slab, 0.02, 0, { parent: g, rough: 0.4 });
        const candies = ['#ff4d6d', '#4cc9f0', '#ffd166', '#06d6a0'];
        for (let k = 0; k < 4; k++) {
          const z = (hash(k * 3 + (side > 0 ? 1 : 0)) - 0.5) * depth * 0.7;
          this.add(new THREE.SphereGeometry(0.045, 10, 8), candies[(k + (side > 0 ? 1 : 0)) % 4], side * slab * (0.25 + k * 0.18), 0.06, z, { parent: g, rough: 0.3 });
        }
      } else {
        for (let k = 1; k <= 3; k++) {
          this.add(new THREE.BoxGeometry(0.03, 0.02, depth + 0.01), tile, (side * slab * k) / 4, 0.045, 0, { parent: g, shadow: false });
        }
      }
    }
    this.add(new RoundedBoxGeometry(0.16, 0.42, 0.16, 2, 0.02), o.chimney, 0.3, top + GABLE * 0.55 + 0.12, -0.12);
    this.add(new RoundedBoxGeometry(0.2, 0.05, 0.2, 2, 0.015), '#6d4535', 0.3, top + GABLE * 0.55 + 0.34, -0.12);

    // Front: doorway, a round window in the gable and two little windows beside the door.
    const trim = o.icing ? '#fff8f0' : '#ffffff';
    this.door(front, BASE, 0.34, 0.54, o.icing ? '#fff8f0' : '#b98a5c', o.icing ? '#7a3d12' : '#9a5f33');
    const wy = top + GABLE * 0.36;
    this.add(new THREE.CircleGeometry(0.12, 20), trim, 0, wy, front + 0.004, { shadow: false });
    this.pane(new THREE.CircleGeometry(0.09, 20), 0, wy, front + 0.008);
    this.add(new THREE.PlaneGeometry(0.18, 0.02), trim, 0, wy, front + 0.012, { shadow: false });
    this.add(new THREE.PlaneGeometry(0.02, 0.18), trim, 0, wy, front + 0.012, { shadow: false });
    for (const x of [-0.37, 0.37]) {
      this.add(new THREE.PlaneGeometry(0.2, 0.2), trim, x, BASE + 0.47, front + 0.004, { shadow: false });
      this.pane(new THREE.PlaneGeometry(0.15, 0.15), x, BASE + 0.47, front + 0.008);
      if (o.walls === 'logs') {
        for (const s of [-1, 1]) this.add(new THREE.PlaneGeometry(0.07, 0.2), '#5f8f3e', x + s * 0.14, BASE + 0.47, front + 0.006, { shadow: false });
      }
    }
    this.add(new RoundedBoxGeometry(0.46, 0.05, 0.2, 2, 0.02), '#cfc5b6', 0, 0.025, front + 0.1, { rough: 0.9 });
    if (o.icing) {
      // A candy cane by the door.
      this.add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), '#ffffff', 0.34, 0.25, front + 0.12, { rough: 0.4 });
      for (let k = 0; k < 4; k++) {
        this.add(new THREE.TorusGeometry(0.032, 0.012, 6, 12), '#ff4d6d', 0.34, 0.08 + k * 0.11, front + 0.12, { rough: 0.4 }).rotation.x = Math.PI / 2;
      }
    } else {
      this.add(new THREE.IcosahedronGeometry(0.19, 1), '#6cbf45', -W / 2 - 0.08, 0.15, front - 0.05, { rough: 0.85 });
      this.add(new THREE.IcosahedronGeometry(0.15, 1), '#79c94f', W / 2 + 0.08, 0.12, front - 0.02, { rough: 0.85 });
    }
    this.halfW = W / 2 + EAVE + 0.05;
    this.halfD = D / 2 + 0.12;
  }

  /** A red-capped mushroom with white spots and a door in its stem. */
  private mushroom(): void {
    // A tall stem so the door shows under the cap from the game's camera.
    const stem: [number, number][] = [[0, 0], [0.46, 0], [0.49, 0.25], [0.46, 0.62], [0.4, 0.95], [0, 0.95]];
    this.add(new THREE.LatheGeometry(stem.map(([r, y]) => new THREE.Vector2(r, y)), 28), '#f3e5c8', 0, 0, 0, { rough: 0.85 });
    const capY = 0.9;
    const cap = new THREE.SphereGeometry(0.74, 30, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.62, 1);
    this.add(cap, '#e5383b', 0, capY, 0, { rough: 0.5 });
    const under = new THREE.CircleGeometry(0.73, 30);
    under.rotateX(Math.PI / 2);
    this.add(under, '#ead7b3', 0, capY, 0, { rough: 0.9, shadow: false });
    for (let k = 0; k < 9; k++) {
      // White spots lying on the cap.
      const a = hash(k + 3) * Math.PI * 2;
      const t = 0.2 + hash(k + 11) * 0.65;
      const r = 0.74 * Math.sin(t * Math.PI * 0.5);
      const y = capY + 0.62 * 0.74 * Math.cos(t * Math.PI * 0.5) + 0.01;
      const spot = new THREE.SphereGeometry(0.07 + hash(k + 20) * 0.05, 12, 8);
      spot.scale(1, 1, 0.3);
      const m = this.add(spot, '#ffffff', Math.cos(a) * r, y, Math.sin(a) * r, { rough: 0.6, shadow: false });
      m.lookAt(Math.cos(a) * r * 3, y + 0.9 * (1 - t), Math.sin(a) * r * 3);
    }
    this.door(0.47, 0.02, 0.3, 0.5, '#c9a06a', '#8a5a33');
    const win = this.add(new THREE.CircleGeometry(0.08, 16), '#c9a06a', -0.29, 0.58, 0.39, { shadow: false });
    win.rotation.y = -0.65;
    this.pane(new THREE.CircleGeometry(0.058, 16), -0.292, 0.58, 0.394).rotation.y = -0.65;
    this.add(new THREE.IcosahedronGeometry(0.15, 1), '#6cbf45', 0.5, 0.1, 0.35, { rough: 0.85 });
    this.halfW = 0.76;
    this.halfD = 0.72;
  }

  /** A snow igloo with a tunnel entrance. */
  private igloo(): void {
    this.add(new THREE.SphereGeometry(0.72, 30, 14, 0, Math.PI * 2, 0, Math.PI / 2), '#eef7ff', 0, 0, 0, { rough: 0.6 });
    for (let k = 1; k <= 4; k++) {
      const y = k * 0.14;
      const r = Math.sqrt(0.72 * 0.72 - y * y);
      const ring = new THREE.TorusGeometry(r + 0.004, 0.012, 6, 40);
      ring.rotateX(Math.PI / 2);
      this.add(ring, '#c7dcee', 0, y, 0, { shadow: false });
    }
    // Half-pipe tunnel sticking out of the dome towards the camera.
    const tunnel = new THREE.CylinderGeometry(0.3, 0.3, 0.46, 22, 1, true, -Math.PI / 2, Math.PI);
    tunnel.rotateZ(Math.PI / 2);
    tunnel.rotateY(Math.PI / 2);
    this.add(tunnel, '#e6f2fd', 0, 0, 0.62, { rough: 0.6, side: THREE.DoubleSide });
    this.add(new THREE.CircleGeometry(0.25, 20, 0, Math.PI), '#23364a', 0, 0, 0.845, { basic: true, shadow: false });
    this.frontZ = 0.845;
    this.pane(new THREE.CircleGeometry(0.07, 14), 0.3, 0.44, 0.56).lookAt(0.7, 0.9, 1.4);
    this.halfW = 0.74;
    this.halfD = 0.8;
  }

  /** A ribbed pumpkin with a stem, a door and carved glowing windows. */
  private pumpkin(): void {
    const g = new THREE.SphereGeometry(0.6, 36, 18);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const k = 1 + Math.cos(Math.atan2(z, x) * 10) * 0.06;
      pos.setX(i, x * k * 1.22);
      pos.setZ(i, z * k * 1.06);
      pos.setY(i, pos.getY(i) * 0.86);
    }
    g.computeVertexNormals();
    this.add(g, '#f77f00', 0, 0.5, 0, { rough: 0.6 });
    const stalk = new THREE.CylinderGeometry(0.05, 0.08, 0.22, 8);
    stalk.rotateZ(0.3);
    this.add(stalk, '#5a7d2a', 0.03, 1.06, 0, { rough: 0.8 });
    const leaf = new THREE.SphereGeometry(0.12, 10, 6);
    leaf.scale(1, 0.2, 0.55);
    this.add(leaf, '#7cb342', -0.13, 1.0, 0.02, { rough: 0.7 }).rotation.z = 0.4;
    this.door(0.62, 0.02, 0.3, 0.44, '#c25e00', '#8a4a1e');
    for (const s of [-1, 1]) {
      // Carved triangle windows: dark by day, glowing at night.
      const tri = new THREE.Shape();
      tri.moveTo(-0.08, 0);
      tri.lineTo(0.08, 0);
      tri.lineTo(0, 0.12);
      tri.closePath();
      this.pane(new THREE.ShapeGeometry(tri), s * 0.25, 0.66, 0.58).rotation.y = s * 0.35;
    }
    this.halfW = 0.78;
    this.halfD = 0.7;
  }

  /** A round stone tower with a pointed roof and a flag. */
  private tower(roofColor: string): void {
    const g = new THREE.CylinderGeometry(0.46, 0.52, 1.25, 22, 6);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.set('#b9b3c9').offsetHSL(0, 0, (hash(i) - 0.5) * 0.1);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const wall = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    wall.position.y = 0.625;
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.body.add(wall);
    this.meshes.push(wall);
    this.add(new THREE.CylinderGeometry(0.56, 0.52, 0.1, 22), '#a39cb6', 0, 1.25, 0, { rough: 0.9 });
    this.add(new THREE.ConeGeometry(0.62, 0.78, 22), roofColor, 0, 1.69, 0, { rough: 0.55 });
    this.add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), '#6d4535', 0, 2.25, 0);
    const flag = new THREE.Shape();
    flag.moveTo(0, 0);
    flag.lineTo(0.22, -0.06);
    flag.lineTo(0, -0.13);
    flag.closePath();
    this.add(new THREE.ShapeGeometry(flag), '#ffd166', 0.01, 2.44, 0, { side: THREE.DoubleSide, shadow: false });
    this.door(0.51, 0, 0.32, 0.5, '#8f8aa3', '#7a5433');
    for (const y of [0.8, 1.05]) {
      this.add(new THREE.ShapeGeometry(archShape(0.13, 0.18), 8), '#8f8aa3', 0, y - 0.01, 0.485, { shadow: false });
      this.pane(new THREE.ShapeGeometry(archShape(0.09, 0.14), 8), 0, y, 0.49);
    }
    this.halfW = 0.64;
    this.halfD = 0.62;
  }

  // ---------------------------------------------------------------- behaviour

  setNight(on: boolean): void {
    for (const m of this.panes) {
      m.color.set(on ? '#ffd27a' : '#9fd8ff');
      m.emissive.set(on ? '#ffb347' : '#bfe8ff');
      m.emissiveIntensity = on ? 1.1 : 0.3;
    }
  }

  setLayout(l: Layout): void {
    this.scale = 0.9;
    this.group.position.set(l.nest.x, 0, l.nest.z);
    this.group.scale.setScalar(this.scale);
  }

  /** Ground rectangle the ants walk around (world units). */
  footprint(): { x0: number; x1: number; z0: number; z1: number } {
    const p = this.group.position;
    const hw = (this.halfW + 0.05) * this.scale;
    const hd = this.halfD * this.scale;
    return { x0: p.x - hw, x1: p.x + hw, z0: p.z - hd, z1: p.z + Math.min(hd, this.frontZ * this.scale) };
  }

  /** Where the ants go in: on the doorstep, in front of the doorway. */
  doorway(out: THREE.Vector3): THREE.Vector3 {
    const p = this.group.position;
    return out.set(p.x, 0, p.z + (this.frontZ + 0.05) * this.scale);
  }

  /** Bounce a little when an ant runs in. */
  gulp(): void {
    this.pulse = Math.min(1, this.pulse + 0.25);
  }

  update(dt: number): void {
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3);
    const k = this.pulse * 0.03;
    this.body.scale.set(1 + k, 1 - k, 1 + k);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
