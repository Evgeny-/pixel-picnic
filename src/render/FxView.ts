import * as THREE from 'three';
import { sparkleTexture, radialTexture } from './textures';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  color: THREE.Color;
  spin: number;
  rot: number;
  gravity: number;
  kind: number; // 0 sparkle sprite, 1 confetti quad, 2 soft puff
}

const MAX = 1400;

/**
 * Lightweight particle system: sparkles, puffs and confetti, all in one instanced mesh per kind.
 * Particles are camera-facing quads.
 */
export class FxView {
  readonly group = new THREE.Group();
  private parts: Particle[] = [];
  private meshes: THREE.InstancedMesh[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly camQ = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly z = new THREE.Vector3(0, 0, 1);
  private readonly tmpQ = new THREE.Quaternion();

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const mk = (tex: THREE.Texture | null, blending: THREE.Blending) => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(quad, mat, MAX);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 10;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      return mesh;
    };
    this.meshes = [
      mk(sparkleTexture(), THREE.AdditiveBlending),
      mk(null, THREE.NormalBlending),
      mk(radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), THREE.NormalBlending),
    ];
  }

  setCamera(cam: THREE.Camera): void {
    this.camQ.copy(cam.quaternion);
  }

  sparkle(x: number, y: number, z: number, color: THREE.Color | string, n = 10, spread = 0.6): void {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.5 + Math.random());
      this.add({
        x, y, z,
        vx: Math.cos(a) * sp, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * sp,
        life: 0, max: 0.5 + Math.random() * 0.4, size: 0.25 + Math.random() * 0.25,
        color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.5), spin: 0, rot: 0, gravity: 2.5, kind: 0,
      });
    }
  }

  puff(x: number, y: number, z: number, color: THREE.Color | string, n = 6, size = 0.3): void {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x, y, z,
        vx: Math.cos(a) * 0.8, vy: 0.4 + Math.random() * 0.5, vz: Math.sin(a) * 0.8,
        life: 0, max: 0.35 + Math.random() * 0.25, size: size * (0.6 + Math.random() * 0.6),
        color: c.clone(), spin: 0, rot: 0, gravity: 0, kind: 2,
      });
    }
  }

  confetti(x: number, y: number, z: number, n = 160, spread = 5): void {
    const colors = ['#ff5a7a', '#ffd23f', '#3ec9ff', '#7cf07c', '#b58cff', '#ff9f43'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.3 + Math.random() * 0.7);
      this.add({
        x: x + (Math.random() - 0.5), y, z: z + (Math.random() - 0.5),
        vx: Math.cos(a) * sp, vy: 5 + Math.random() * 6, vz: Math.sin(a) * sp * 0.7,
        life: 0, max: 2.2 + Math.random() * 1.2, size: 0.16 + Math.random() * 0.12,
        color: new THREE.Color(colors[i % colors.length]), spin: (Math.random() - 0.5) * 16, rot: Math.random() * 6,
        gravity: 7, kind: 1,
      });
    }
  }

  shards(x: number, y: number, z: number, n = 14): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x, y, z,
        vx: Math.cos(a) * 2, vy: 2 + Math.random() * 2, vz: Math.sin(a) * 2,
        life: 0, max: 0.6 + Math.random() * 0.3, size: 0.12 + Math.random() * 0.12,
        color: new THREE.Color('#dff6ff'), spin: (Math.random() - 0.5) * 20, rot: 0, gravity: 9, kind: 1,
      });
    }
  }

  private add(p: Particle): void {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push(p);
  }

  get busy(): boolean {
    return this.parts.length > 0;
  }

  update(dt: number): void {
    const counts = [0, 0, 0];
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.gravity * dt;
      if (p.kind === 1) {
        p.vx *= 1 - dt * 0.8;
        p.vz *= 1 - dt * 0.8;
        if (p.vy < -2.2) p.vy = -2.2;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02 && p.kind !== 2) {
        p.y = 0.02;
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      p.rot += p.spin * dt;
      keep.push(p);
      const k = p.life / p.max;
      const mesh = this.meshes[p.kind];
      const idx = counts[p.kind]++;
      let size = p.size;
      if (p.kind === 0) size *= Math.sin(Math.min(1, k * 1.3) * Math.PI);
      else if (p.kind === 2) size *= 0.6 + k * 1.2;
      else size *= k > 0.8 ? (1 - k) / 0.2 : 1;
      this.v.set(p.x, p.y, p.z);
      this.q.copy(this.camQ);
      if (p.kind === 1) this.q.multiply(this.tmpQ.setFromAxisAngle(this.z, p.rot));
      this.s.set(size, p.kind === 1 ? size * 0.6 : size, size);
      this.m.compose(this.v, this.q, this.s);
      mesh.setMatrixAt(idx, this.m);
      const c = p.color;
      if (p.kind === 2) mesh.setColorAt(idx, this.tmpColor.copy(c).multiplyScalar(1 - k * 0.5));
      else mesh.setColorAt(idx, c);
    }
    this.parts = keep;
    this.meshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (i === 2) mat.opacity = 0.75;
    });
  }

  private readonly tmpColor = new THREE.Color();

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      mesh.dispose();
    }
  }
}
