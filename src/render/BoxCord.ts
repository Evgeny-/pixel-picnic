import * as THREE from 'three';
import type { CordPoint } from './cordRouting';

const WIDTHS = [.089, .053, .012];

/** One draw call per cord, with a dark edge, colored core and a fine highlight. */
export class BoxCord {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly samples: (CordPoint & { t: number })[];
  private readonly positions: THREE.BufferAttribute;
  private readonly last = new Float64Array(4).fill(NaN);

  constructor(path: CordPoint[], upperPaths: CordPoint[][], size: number, tilt: number,
    a: THREE.Color, b: THREE.Color, material: THREE.MeshBasicMaterial, order: number) {
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
    const total = lengths.at(-1) ?? 0;
    const cuts: [number, number][] = [];
    // Small breaks under other cords make crossings read as two independent connections.
    for (let i = 1; i < path.length; i++) for (const upper of upperPaths) for (let j = 1; j < upper.length; j++) {
      const p = path[i - 1], q = upper[j - 1];
      const dx = path[i].x - p.x, dz = path[i].z - p.z, ux = upper[j].x - q.x, uz = upper[j].z - q.z;
      const det = dx * uz - dz * ux;
      if (Math.abs(det) < 1e-8) continue;
      const t = ((q.x - p.x) * uz - (q.z - p.z) * ux) / det;
      const u = ((q.x - p.x) * dz - (q.z - p.z) * dx) / det;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const d = lengths[i - 1] + t * (lengths[i] - lengths[i - 1]);
      if (d > size * .12 && d < total - size * .12) cuts.push([d - size * .075, d + size * .075]);
    }
    const distances = [...new Set([...lengths, ...cuts.flat()])].sort((x, y) => x - y);
    let segment = 1;
    this.samples = total > 0 ? distances.map(d => {
      while (segment < path.length - 1 && lengths[segment] < d) segment++;
      const p = path[segment - 1], q = path[segment];
      const t = (d - lengths[segment - 1]) / (lengths[segment] - lengths[segment - 1] || 1);
      return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, t: d / total };
    }) : [];
    const n = this.samples.length, vertices = n * 2 * 3;
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    const colors = new Float32Array(vertices * 3), color = new THREE.Color(), edge = new THREE.Color('#142a2b'), white = new THREE.Color('white');
    const indices: number[] = [];
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < n; i++) {
      if (layer === 0) color.copy(edge);
      else { color.copy(a).lerp(b, this.samples[i].t); if (layer === 2) color.lerp(white, .45); }
      const k = (layer * n + i) * 2;
      color.toArray(colors, k * 3); color.toArray(colors, (k + 1) * 3);
      const d = i ? (distances[i - 1] + distances[i]) / 2 : 0;
      if (i && !cuts.some(([start, end]) => d > start && d < end)) indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3 + order * .001;
    this.mesh.userData.linkColors = [a.getHexString(), b.getHexString()];
    this.size = size;
    this.cos = Math.cos(tilt);
    this.tan = Math.tan(tilt);
    this.update(0, 0, 0, 0);
  }
  private readonly size: number;
  private readonly cos: number;
  private readonly tan: number;

  update(ax: number, az: number, bx: number, bz: number): void {
    if (this.last[0] === ax && this.last[1] === az && this.last[2] === bx && this.last[3] === bz) return;
    this.last[0] = ax; this.last[1] = az; this.last[2] = bx; this.last[3] = bz;
    const n = this.samples.length;
    const shiftX = bx - ax, shiftZ = bz - az;
    for (let i = 0; i < n; i++) {
      const p = this.samples[i], before = this.samples[Math.max(0, i - 1)], after = this.samples[Math.min(n - 1, i + 1)];
      const dt = after.t - before.t;
      const dx = after.x - before.x + shiftX * dt, dz = after.z - before.z + shiftZ * dt;
      const length = Math.hypot(dx, dz) || 1, nx = -dz / length, nz = dx / length;
      const x = p.x + ax + shiftX * p.t, z = p.z + az + shiftZ * p.t;
      for (let layer = 0; layer < 3; layer++) for (let side = 0; side < 2; side++) {
        const offset = WIDTHS[layer] * this.size * (side ? .5 : -.5);
        // All routing is in the projected plane, so neither the text nor the bends squash with tilt.
        const highlight = layer === 2 ? -.01 * this.size : 0;
        this.positions.setXYZ((layer * n + i) * 2 + side, x + nx * offset, .04,
          (z + nz * offset + highlight) / this.cos + .04 * this.tan);
      }
    }
    this.positions.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); }
}
