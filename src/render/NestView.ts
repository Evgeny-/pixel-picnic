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

const WALL_W = 1.1;
const WALL_D = 0.95;
const WALL_H = 0.8;
const BASE_H = 0.1;
/** Height of the gable above the walls. */
const GABLE_H = 0.62;
/** Roof overhang past the walls. */
const EAVE = 0.14;

/**
 * The ants' home: a little cottage facing the camera with its gable — a pointed front wall with
 * an open door and a round window, two roof slopes and a chimney. The ants run in through the
 * door; its footprint is an obstacle they walk around.
 */
export class NestView {
  readonly group = new THREE.Group();
  /** Everything that bounces when an ant runs in. */
  private body = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private pulse = 0;
  private scale = 1;

  constructor(roofColor = '#e8674a') {
    const add = (
      geo: THREE.BufferGeometry,
      color: string,
      x: number,
      y: number,
      z: number,
      opts: { rough?: number; parent?: THREE.Object3D; shadow?: boolean; basic?: boolean } = {},
    ) => {
      const mat = opts.basic
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = opts.shadow ?? true;
      mesh.receiveShadow = true;
      (opts.parent ?? this.body).add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const wallColor = '#fbecd0';
    const top = BASE_H + WALL_H;
    const front = WALL_D / 2;

    // Stone footing and the walls.
    add(new RoundedBoxGeometry(WALL_W + 0.16, BASE_H, WALL_D + 0.14, 2, 0.04), '#cfc5b6', 0, BASE_H / 2, 0, { rough: 0.9 });
    add(new RoundedBoxGeometry(WALL_W, WALL_H, WALL_D, 3, 0.06), wallColor, 0, BASE_H + WALL_H / 2, 0, { rough: 0.8 });

    // Gable walls (front and back triangles) under the roof.
    const gable = new THREE.Shape();
    gable.moveTo(-WALL_W / 2, 0);
    gable.lineTo(WALL_W / 2, 0);
    gable.lineTo(0, GABLE_H - 0.04);
    gable.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: WALL_D - 0.02, bevelEnabled: false });
    gableGeo.translate(0, 0, -(WALL_D - 0.02) / 2);
    add(gableGeo, wallColor, 0, top - 0.01, 0, { rough: 0.8 });

    // Two roof slopes meeting at the ridge, overhanging front and back.
    const run = WALL_W / 2 + EAVE;
    const slope = Math.atan2(GABLE_H, WALL_W / 2);
    const slab = Math.hypot(run, GABLE_H * (run / (WALL_W / 2))) + 0.02;
    const roofDepth = WALL_D + 0.26;
    const tile = new THREE.Color(roofColor).offsetHSL(0, 0, -0.12).getStyle();
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0, top + GABLE_H + 0.02, 0);
      g.rotation.z = side * -slope;
      this.body.add(g);
      add(new RoundedBoxGeometry(slab, 0.08, roofDepth, 2, 0.03), roofColor, (side * slab) / 2, 0, 0, { parent: g, rough: 0.55 });
      // Rows of tiles.
      for (let k = 1; k <= 3; k++) {
        add(new THREE.BoxGeometry(0.03, 0.02, roofDepth + 0.01), tile, (side * slab * k) / 4, 0.045, 0, { parent: g, shadow: false });
      }
    }

    // Chimney on the right slope.
    add(new RoundedBoxGeometry(0.16, 0.42, 0.16, 2, 0.02), '#c0714f', 0.3, top + GABLE_H * 0.55 + 0.12, -0.12);
    add(new RoundedBoxGeometry(0.2, 0.05, 0.2, 2, 0.015), '#6d4535', 0.3, top + GABLE_H * 0.55 + 0.34, -0.12);

    // Front: dark doorway with a wooden frame, the door swung open, a round window in the gable.
    add(new THREE.ShapeGeometry(archShape(0.44, 0.6), 12), '#b98a5c', 0, BASE_H, front + 0.003, { shadow: false });
    add(new THREE.ShapeGeometry(archShape(0.34, 0.54), 12), '#2a1810', 0, BASE_H, front + 0.006, { shadow: false, basic: true });
    const doorGeo = new THREE.ExtrudeGeometry(archShape(0.34, 0.54), { depth: 0.035, bevelEnabled: false, curveSegments: 10 });
    doorGeo.translate(0.17, 0, 0);
    const hinge = new THREE.Group();
    hinge.position.set(-0.17, BASE_H, front + 0.01);
    hinge.rotation.y = -1.95;
    this.body.add(hinge);
    const door = add(doorGeo, '#9a5f33', 0, 0, 0, { parent: hinge });
    add(new THREE.SphereGeometry(0.022, 10, 8), '#f2c14e', 0.28, 0.27, 0.045, { parent: door, shadow: false });
    // Round window with a cross.
    const wy = top + GABLE_H * 0.36;
    add(new THREE.CircleGeometry(0.12, 20), '#ffffff', 0, wy, front + 0.004, { shadow: false });
    const glass = add(new THREE.CircleGeometry(0.09, 20), '#9fd8ff', 0, wy, front + 0.008, { shadow: false, rough: 0.2 });
    (glass.material as THREE.MeshStandardMaterial).emissive.set('#bfe8ff');
    (glass.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
    add(new THREE.PlaneGeometry(0.18, 0.02), '#ffffff', 0, wy, front + 0.012, { shadow: false });
    add(new THREE.PlaneGeometry(0.02, 0.18), '#ffffff', 0, wy, front + 0.012, { shadow: false });
    // Little square windows either side of the door.
    for (const x of [-0.37, 0.37]) {
      add(new THREE.PlaneGeometry(0.2, 0.2), '#ffffff', x, BASE_H + 0.47, front + 0.004, { shadow: false });
      const g2 = add(new THREE.PlaneGeometry(0.15, 0.15), '#9fd8ff', x, BASE_H + 0.47, front + 0.008, { shadow: false, rough: 0.2 });
      (g2.material as THREE.MeshStandardMaterial).emissive.set('#bfe8ff');
      (g2.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
    }
    // Doorstep and two bushes at the front corners.
    add(new RoundedBoxGeometry(0.46, 0.05, 0.2, 2, 0.02), '#cfc5b6', 0, 0.025, front + 0.1, { rough: 0.9 });
    add(new THREE.IcosahedronGeometry(0.19, 1), '#6cbf45', -WALL_W / 2 - 0.08, 0.15, front - 0.05, { rough: 0.85 });
    add(new THREE.IcosahedronGeometry(0.15, 1), '#79c94f', WALL_W / 2 + 0.08, 0.12, front - 0.02, { rough: 0.85 });

    this.group.add(this.body);
  }

  setLayout(l: Layout): void {
    this.scale = l.mode === 'portrait' ? 0.8 : 0.95;
    this.group.position.set(l.nest.x, 0, l.nest.z);
    this.group.scale.setScalar(this.scale);
  }

  /** Ground rectangle the ants walk around (world units). */
  footprint(): { x0: number; x1: number; z0: number; z1: number } {
    const p = this.group.position;
    const hw = (WALL_W / 2 + EAVE + 0.1) * this.scale;
    const hd = (WALL_D / 2 + 0.15) * this.scale;
    return { x0: p.x - hw, x1: p.x + hw, z0: p.z - hd, z1: p.z + hd };
  }

  /** Where the ants go in: on the doorstep, in front of the doorway. */
  doorway(out: THREE.Vector3): THREE.Vector3 {
    const p = this.group.position;
    return out.set(p.x, 0, p.z + (WALL_D / 2 + 0.05) * this.scale);
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
