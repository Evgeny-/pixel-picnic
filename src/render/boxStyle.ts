import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BOX_H = 0.62;
/** Move the printed number slightly toward the front edge of the lid for visual centring. */
export const BOX_LABEL_Z = 0.03;
type Finish = 'matte' | 'metal';
type Point = [number, number, number];

/** Model parts are baked into one coloured body and at most two shared detail meshes. */
class Parts {
  body: THREE.BufferGeometry[] = [];
  detail: Record<Finish, THREE.BufferGeometry[]> = { matte: [], metal: [] };

  add(g: THREE.BufferGeometry, color?: string, finish: Finish = 'matte'): void {
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    if (color) {
      const c = new THREE.Color(color);
      const colors = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.detail[finish].push(g);
    } else this.body.push(g);
  }

  block(size: Point, at: Point, radius = 0.02, color?: string, finish: Finish = 'matte', angle = 0): void {
    const g = new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size) / 2));
    g.rotateZ(angle);
    g.translate(...at);
    this.add(g, color, finish);
  }

  bead(at: Point, size: Point, color: string, finish: Finish = 'matte'): void {
    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(...size);
    g.translate(...at);
    this.add(g, color, finish);
  }

  cord(points: Point[], radius: number, color: string, finish: Finish = 'matte', closed = false): void {
    const path = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
    this.add(new THREE.TubeGeometry(path, Math.max(8, points.length * 2), radius, 5, closed), color, finish);
  }

  rim(w: number, d: number, y: number, corner: number, tube: number, color: string, finish: Finish = 'matte'): void {
    const points: Point[] = [];
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      const cx = (side === 0 || side === 3 ? 1 : -1) * (w / 2 - corner);
      const cz = (side < 2 ? 1 : -1) * (d / 2 - corner);
      for (let i = 0; i <= 4; i++) {
        const a = angle + i * Math.PI / 8;
        points.push([cx + Math.cos(a) * corner, y, cz + Math.sin(a) * corner]);
      }
    }
    this.cord(points, tube, color, finish, true);
  }

  merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const geometry = mergeGeometries(parts)!;
    for (const part of parts) part.dispose();
    return geometry;
  }
}

/** Geometry is shared by all boxes in a level and by the corresponding shop preview. */
export class BoxStyle {
  readonly body: THREE.BufferGeometry;
  readonly roughness: number;
  readonly metalness: number;
  private readonly details: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] = [];

  constructor(skin: string) {
    const p = new Parts();
    this.roughness = skin === 'metal' ? 0.28 : skin === 'crate' || skin === 'basket' ? 0.6 : 0.38;
    this.metalness = skin === 'metal' ? 0.22 : 0;
    if (skin === 'crate') this.crate(p);
    else if (skin === 'basket') this.basket(p);
    else if (skin === 'metal') this.metal(p);
    else this.classic(p);
    this.body = p.merge(p.body);
    for (const finish of ['matte', 'metal'] as const) {
      if (!p.detail[finish].length) continue;
      this.details.push({
        geometry: p.merge(p.detail[finish]),
        material: new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: finish === 'metal' ? 0.32 : 0.72,
          metalness: finish === 'metal' ? 0.55 : 0, envMapIntensity: 0.85,
        }),
      });
    }
  }

  private classic(p: Parts): void {
    p.add(new RoundedBoxGeometry(1, BOX_H, 1, 3, 0.2));
  }

  private crate(p: Parts): void {
    const wood = '#bb7c3e', pale = '#e4b778', grain = '#9b602e', iron = '#625752';
    p.block([0.86, 0.44, 0.86], [0, -0.07, 0], 0.06);
    p.block([0.86, 0.09, 0.86], [0, 0.265, 0], 0.035);
    // A real timber frame with separate planks, end grain and diagonal braces.
    for (const side of [-1, 1]) {
      p.block([1.04, 0.12, 0.105], [0, 0.22, side * 0.46], 0.022, pale);
      p.block([0.105, 0.12, 0.83], [side * 0.46, 0.22, 0], 0.022, wood);
      p.block([1.01, 0.10, 0.105], [0, -0.245, side * 0.45], 0.02, wood);
      p.block([0.105, 0.10, 0.81], [side * 0.45, -0.245, 0], 0.02, pale);
      for (let row = 0; row < 3; row++) {
        const y = -0.16 + row * 0.125;
        p.block([0.87, 0.115, 0.065], [0, y, side * 0.438], 0.012, row % 2 ? '#d59b58' : '#c88b47');
        p.block([0.065, 0.115, 0.87], [side * 0.438, y, 0], 0.012, row % 2 ? '#c88b47' : '#d59b58');
        for (let line = 0; line < 2; line++) {
          const gy = y - 0.025 + line * 0.047;
          p.cord([[-0.36, gy, side * 0.473], [-0.1, gy + 0.008, side * 0.475], [0.15, gy - 0.007, side * 0.475], [0.35, gy, side * 0.473]], 0.003, grain);
        }
      }
      p.block([0.81, 0.082, 0.067], [0, -0.02, side * 0.484], 0.018, pale, 'matte', side * 0.42);
      for (const corner of [-1, 1]) {
        p.block([0.115, 0.43, 0.115], [corner * 0.44, -0.02, side * 0.44], 0.022, wood);
        for (const y of [-0.245, 0.22]) {
          p.bead([corner * 0.43, y, side * 0.518], [0.025, 0.025, 0.009], iron, 'metal');
        }
        p.bead([corner * 0.46, 0.285, side * 0.46], [0.024, 0.009, 0.024], iron, 'metal');
      }
    }
    // Dark inset handles on the sides; all decoration leaves the coloured lid readable.
    for (const side of [-1, 1]) p.block([0.015, 0.052, 0.26], [side * 0.496, 0.19, 0], 0.007, '#6d462d');
  }

  private basket(p: Parts): void {
    const straw = '#d6a257', light = '#efcf91', dark = '#a66d36';
    const core = new RoundedBoxGeometry(0.92, 0.47, 0.88, 3, 0.12);
    const pos = core.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const taper = 0.85 + 0.15 * (pos.getY(i) / 0.47 + 0.5);
      pos.setXYZ(i, pos.getX(i) * taper, pos.getY(i) - 0.07, pos.getZ(i) * taper);
    }
    core.computeVertexNormals();
    p.add(core);
    p.block([0.92, 0.09, 0.88], [0, 0.265, 0], 0.045);
    // Horizontal reeds and wavy uprights alternate over and under each other.
    for (let row = 0; row < 6; row++) {
      const y = -0.245 + row * 0.076;
      p.rim(0.83 + row * 0.026, 0.79 + row * 0.026, y, 0.12, 0.026, row % 2 ? light : straw);
    }
    for (const side of [-1, 1]) {
      for (let reed = 0; reed < 7; reed++) {
        const across = (reed - 3) * 0.105;
        const front: Point[] = [], flank: Point[] = [];
        for (let row = 0; row < 7; row++) {
          const y = -0.25 + row * 0.071;
          const bulge = ((reed + row) % 2 ? 0.014 : -0.01);
          front.push([across * (0.88 + row * 0.02), y, side * (0.4 + row * 0.012 + bulge)]);
          flank.push([side * (0.42 + row * 0.012 + bulge), y, across * (0.88 + row * 0.02)]);
        }
        p.cord(front, 0.019, reed % 2 ? straw : light);
        p.cord(flank, 0.019, reed % 2 ? light : straw);
      }
    }
    p.rim(1.0, 0.96, 0.215, 0.14, 0.042, light);
    p.rim(0.84, 0.8, -0.27, 0.12, 0.026, dark);
    for (const side of [-1, 1]) {
      p.cord([[-0.19, 0.13, side * 0.49], [-0.16, -0.02, side * 0.54], [0, -0.08, side * 0.555], [0.16, -0.02, side * 0.54], [0.19, 0.13, side * 0.49]], 0.03, dark);
      for (const x of [-0.19, 0.19]) p.bead([x, 0.13, side * 0.5], [0.035, 0.045, 0.018], light);
    }
    p.block([0.13, 0.19, 0.027], [0, 0.19, 0.504], 0.018, '#ad693e');
    p.bead([0, 0.16, 0.527], [0.026, 0.026, 0.009], '#e8c978', 'metal');
  }

  private metal(p: Parts): void {
    const silver = '#c6d4d7', dark = '#4a5968', rubber = '#525565', brass = '#dfb660';
    p.block([0.94, 0.49, 0.9], [0, -0.065, 0], 0.12);
    p.block([1.01, 0.15, 0.97], [0, 0.235, 0], 0.075);
    p.rim(0.965, 0.925, 0.139, 0.13, 0.025, dark);
    p.rim(0.98, 0.94, 0.18, 0.13, 0.023, silver, 'metal');
    p.rim(0.92, 0.88, -0.265, 0.13, 0.032, silver, 'metal');
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        p.block([0.17, 0.17, 0.17], [x * 0.393, -0.22, z * 0.375], 0.04, silver, 'metal');
        p.block([0.14, 0.048, 0.14], [x * 0.35, -0.29, z * 0.34], 0.02, rubber);
        p.bead([x * 0.415, 0.297, z * 0.395], [0.021, 0.011, 0.021], silver, 'metal');
      }
      // Stamped ribs on the end panels and sturdy brass latches on the front.
      for (const z of [-0.23, -0.115, 0, 0.115, 0.23]) {
        p.block([0.024, 0.24, 0.026], [x * 0.467, -0.055, z], 0.012, silver, 'metal');
      }
      p.block([0.115, 0.18, 0.052], [x * 0.29, 0.105, 0.47], 0.016, silver, 'metal');
      p.block([0.075, 0.102, 0.034], [x * 0.29, 0.085, 0.507], 0.012, brass, 'metal');
      p.bead([x * 0.29, 0.165, 0.509], [0.018, 0.016, 0.013], dark);
    }
    p.cord([[-0.135, 0.1, 0.495], [-0.155, 0.005, 0.54], [-0.1, -0.045, 0.56], [0.1, -0.045, 0.56], [0.155, 0.005, 0.54], [0.135, 0.1, 0.495]], 0.026, rubber);
    this.antBadge(p, 0, -0.16, 0.457, '#d7ded5', dark);
    // A raised border on the enamel lid is visible from the game's overhead camera.
    p.rim(0.84, 0.8, 0.303, 0.13, 0.012, '#dbe1d8', 'metal');
    for (const x of [-0.12, 0, 0.12]) p.block([0.062, 0.01, 0.018], [x, 0.312, -0.36], 0.005, dark);
  }

  private antBadge(p: Parts, x: number, y: number, z: number, plate: string, ink: string): void {
    p.block([0.22, 0.115, 0.016], [x, y, z], 0.035, plate);
    for (let i = 0; i < 3; i++) p.bead([x + (i - 1) * 0.042, y, z + 0.014], [i === 0 ? 0.028 : 0.022, 0.025, 0.009], ink);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const cx = x - 0.015 + i * 0.025;
        p.cord([[cx, y, z + 0.017], [cx - 0.007, y + side * 0.035, z + 0.017]], 0.004, ink);
      }
    }
  }

  createBody(color: THREE.ColorRepresentation): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const body = new THREE.Mesh(this.body, new THREE.MeshStandardMaterial({
      color, roughness: this.roughness, metalness: this.metalness, envMapIntensity: 1,
    }));
    body.position.y = BOX_H / 2;
    body.castShadow = body.receiveShadow = true;
    for (const detail of this.details) {
      const mesh = new THREE.Mesh(detail.geometry, detail.material);
      mesh.castShadow = mesh.receiveShadow = true;
      body.add(mesh);
    }
    return body;
  }

  dispose(): void {
    this.body.dispose();
    for (const { geometry, material } of this.details) {
      geometry.dispose();
      material.dispose();
    }
  }
}
